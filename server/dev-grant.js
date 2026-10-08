// server/dev-grant.js — DEVELOPMENT-ONLY chess grant channel (SP_DEV_GRANT=1). Off by default.
// (i18n-ignore-file: a loopback-only developer endpoint; every message here is written for the owner reading a response
// in a terminal, never shown to players — docs/DEV-GRANT.md, docs/I18N.md)
//
//   GET /dev/grant?chess=<id>[,<id>…][&count=N][&funds=N | &fundsAdd=N][&room=CODE][&player=ID][&toTemp=1]
//   GET /dev/grant?diy=<charId>[&skill=0|1|2][&module=<uniEquipId>|none][&elite=1][&slot=<slotBaseId>]   任意发牌
//   GET /dev/grant?bond=<bondId>[,<bondId>…]&layers=<N>                                                设置盟约层数
//   GET /dev/grant                      (no acting parameter: discovery — rooms, players, 自选 picks and bond layers)
//
// Why it exists: a match lives in this process's memory and the wire protocol (shared/protocol.js) has no grant /
// debug / admin message, so there is no supported way to hand a piece to a player mid-match. This endpoint adds one
// for testing and for the owner's own sessions. It is deliberately NOT a cheat vector for a public server:
//
//   * the process must have been started with SP_DEV_GRANT=1 (nothing registers otherwise — server/index.js);
//   * the request must come from a loopback peer (this machine only — no LAN, no internet);
//   * it goes through PlayerState.acquireChess (server/match/player/acquire.js), the same door as buys, rewards and
//     effects, so the shared pool is taken, hand/temp overflow applies, merges still invent an elite, and onGain
//     fires. Nothing is written into the board or the battle input directly, so the invariants (match/invariants.js)
//     and the audit (match/audit.js) still hold.
//
// The one thing acquireChess cannot make safe is a grant that COMPLETES A MERGE during a battle: _mergeChess then
// forces the elite onto a board tile while the client is running that round, and the audit checks the board. So the
// phase gate below refuses everything except PREP and SETTLE — the same reason a SETTLE-time merge defers its copy.
//
// 任意发牌 (`diy=<charId>`; docs/DEV-GRANT.md §任意发牌): a 自选 slot is a different operator for every player, and a slot
// its player never filled has no body at all — acquireChess refuses it (`rec.isDiy && !rec.diyFor`), which is why a plain
// `chess=chess_char_6_diy1_a` came back refused for a player without picks. `diy=` therefore writes the pick FIRST
// (PlayerDiy.forceDiyPick: a NEW frozen pick over the ones the match fixed at its start — the frozen objects are never
// mutated — that slot's composed records and its stock rebuilt) and then grants the piece through the same door. The
// operator may sit outside the slot's pool or have no kit: `resolved` says what that means (`ownedPool` / `pooled` /
// `kitted` / `kit`) and `notes` spells it out. `resolved.sim` is the one that decides whether it is playable at all —
// the sim and the client re-run shared/diy.js checkDiyPick on the pick (simdata getDiy, ui/gameLogic/diy.js), so a pick
// that check refuses is a piece that exists in the match (hand, shop, detail card, AI) but never deploys into a battle.
// The four gates above are untouched: still loopback-only, still PREP / SETTLE only.
//
// 设置盟约层数 (`bond=<bondId>[,<bondId>…]&layers=<N>`; docs/DEV-GRANT.md §设置盟约层数) writes bond layers, not layers of
// a chess: `layers=` is the value to SET (0 … BOND_LAYER_CAP 999) for every named bond of the target player. It is a
// SET, not a gain, because that is what an owner tuning a test wants ("make 迅捷 and 萨尔贡 both 500"), and because the
// persistent count (`ps.layers[bondId]`) is what the next battle's input is built from (PlayerState.battleInput →
// bondSnapshot), so one write covers the rest of the match. An increase still goes through the engine's own door
// (PlayerState.addLayers: `layerGainRoom` clamps at the cap and `onLayers` fires, so prep-side milestones are paid like
// any gain); a decrease has no engine API at all and is written straight into `ps.layers` + `recompute()` (the
// milestone counters are only ever paid forwards, so lowering pays nothing). Both then reach every battle this match
// still holds a field for (`m.fields`: `Battle.getPlayer(pid).bonds[bondId].layers`, the copy `Battle.addLayers` writes
// — `layerGains` stays a delta, so a settlement never double-counts). A bond the player has no record of is created
// (the debug point of the endpoint), and the response says whether it existed. Client-side: setting layers makes the
// bond appear in the strip with its count (`bondList` lists `layers > 0`), and `ps.dirty()` + `m.flush(true)` publish it
// at once — no new protocol message. ⚠️ Layers do NOT activate a bond: activation is the member count (`computeBonds`),
// and the battle content registers nothing below tier 1 — 500 layers on a bond with no members on the board do nothing.
// The response carries `active` and says so in `notes`.

import { getChess, getBond } from './data.js';
import { PHASE, APP_VERSION, BOND_LAYER_CAP } from '../shared/constants.js';
import { diySlotIds } from '../shared/diy.js';

/** The only path this module serves. */
export const DEV_GRANT_PATH = '/dev/grant';

/** Phases a grant may land in: a battle is not running, so the board cannot be forced under the client. */
const SAFE_PHASES = new Set([PHASE.PREP, PHASE.SETTLE]);

/** SP_DEV_GRANT → register the route or not. Anything but an explicit yes leaves it off. */
export function parseDevGrant(v) {
  return ['1', 'true', 'yes', 'on', 'always'].includes(String(v ?? '').trim().toLowerCase());
}

/** Is this peer the machine itself? `::1`, `127.0.0.0/8`, and their IPv4-mapped forms. */
function isLoopback(addr) {
  const s = String(addr ?? '');
  return s === '::1' || /^127\./.test(s) || /^::ffff:127\./.test(s);
}

/** JSON reply without needing the request object (the callers only pass `req` for HEAD handling). */
function reply(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** A player's 自选 picks as plain JSON data ({ [slotBaseId]: { charId, skillIndex, uniEquipId } }; frozen values copied). */
function picksOf(ps) {
  const out = {};
  const picks = ps.diy && typeof ps.diy === 'object' ? ps.diy : {};
  for (const [id, p] of Object.entries(picks)) {
    if (!p || typeof p !== 'object') continue;
    out[id] = { charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId ?? null };
  }
  return out;
}

/** A player's 自选 stock as plain data ({ [slotBaseId]: copies left }; {} without picks). */
function stockOf(ps) {
  const snap = ps.diyStock && typeof ps.diyStock.snapshot === 'function' ? ps.diyStock.snapshot() : null;
  return snap && typeof snap === 'object' ? snap : {};
}

/** One-line summary of a match for discovery and logs — with each player's 自选 picks (read-only; the debug view). */
function describeMatch(m) {
  return {
    roomCode: m.roomCode,
    modeId: m.modeId,
    phase: m.phase,
    round: m.round,
    matchNo: m.matchNo,
    diySlots: diySlotIds(m.data),
    players: m.order.map((ps) => ({
      playerId: ps.playerId,
      seat: ps.seat,
      isBot: ps.isBot,
      connected: !!ps.connected,
      left: !!ps.left,
      picks: picksOf(ps),
      diyStock: stockOf(ps),
      bonds: bondsOf(ps),
    })),
  };
}

/**
 * A player's bond layers as plain read-only data ({ [bondId]: { layers, count, active } }) — the bonds the views carry
 * (bondList's rule: members, layers or an active tier), which is what the client's strip shows. `bondsView()` is the
 * exact list the client is sent (a finished battle's unsettled gains included); a stub without it falls back to the
 * computed state. {} without any.
 */
function bondsOf(ps) {
  const out = {};
  const bonds = (typeof ps.bondsView === 'function' ? ps.bondsView() : ps.bonds);
  const map = bonds && typeof bonds === 'object' ? bonds : {};
  for (const [bondId, b] of Object.entries(map)) {
    if (!b || typeof b !== 'object') continue;
    const layers = Number.isFinite(b.layers) && b.layers > 0 ? Math.floor(b.layers) : 0;
    const count = Number.isFinite(b.count) ? b.count : 0;
    const active = !!b.active;
    if (!(count > 0 || layers > 0 || active)) continue;
    out[bondId] = { layers, count, active };
  }
  return out;
}

/** Bond layers on a player state: the persistent `ps.layers[bondId]` every engine writer clamps (0 when unset). */
function layersOf(ps, bondId) {
  const v = ps.layers ? ps.layers[bondId] : undefined;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** The bond's data record (data/bonds.json) as this match sees it (`m.gd` first; the raw map for a stub match). */
function bondRecordOf(m, id) {
  const gd = m.gd;
  if (gd && typeof gd.bond === 'function') { const rec = gd.bond(id); if (rec) return rec; }
  return getBond(id, m.data);
}

/** Every bond id this data set knows — the list an unknown `bond=` is answered with. */
function bondIdsOf(m) {
  const gd = m.gd;
  if (gd && Array.isArray(gd.bondIds) && gd.bondIds.length) return gd.bondIds;
  const bonds = m.data && m.data.bonds;
  return bonds && typeof bonds === 'object' ? Object.keys(bonds) : [];
}

/**
 * Set one bond's layers to an exact value: the persistent `ps.layers[bondId]` (what every later battle is built from)
 * and, as far as this match can see, the live copy a battle still holds in a field (`m.fields` →
 * `Battle.getPlayer(pid).bonds[bondId].layers`). An increase uses PlayerState.addLayers — the engine's own prep-side
 * door, so `layerGainRoom` clamps at BOND_LAYER_CAP and `onLayers` fires (milestones paid like any gain); a decrease
 * has no engine API and is a direct write + recompute. The battle's own `layerGains` is a delta and is never touched:
 * a settlement adds what the battle accrued on top of whatever the live copy holds.
 */
function setBondLayers(m, ps, bondId, want) {
  const before = layersOf(ps, bondId);
  if (want > before) ps.addLayers(bondId, want - before, { reason: 'dev' });
  else if (want < before) { ps.layers[bondId] = want; ps.recompute(); }
  let live = 0;
  for (const f of Array.isArray(m.fields) ? m.fields : []) {
    const battle = f && f.battle;
    if (!battle || typeof battle.getPlayer !== 'function') continue;
    const bp = battle.getPlayer(ps.playerId);
    if (!bp || !bp.bonds || !bp.bonds[bondId]) continue;
    bp.bonds[bondId].layers = want;
    live++;
  }
  return { before, after: layersOf(ps, bondId), live };
}

/**
 * Why a grant came back null — a specific reason instead of a bare "refused". The 自选 one is the case this endpoint
 * used to hit: a slot its player never filled has no operator to hand over (acquireChess: `rec.isDiy && !rec.diyFor`).
 */
function refusalReason(ps, id) {
  const gd = ps.gd;
  if (!gd || typeof gd.chess !== 'function') return 'refused (hand and temp full?)';
  const rec = gd.chess(id);
  if (!rec) return `unknown chess id for this player: ${id}`;
  if (rec.isDiy && !rec.diyFor) return `${id} is a 自选 slot this player has not filled — force a pick with diy=<charId>`;
  if (Array.isArray(ps.hand) && Array.isArray(ps.temp) && ps.hand.every(Boolean) && ps.temp.every(Boolean)) return 'refused (hand and temp are full)';
  return 'refused (hand and temp full?)';
}

/**
 * The diagnostics of a forced 自选 pick (the response's `notes`): what was overwritten, what this operator's pool / kit /
 * bonds mean for this slot, and — the one that matters — whether the simulation will accept the piece at all.
 */
function diyNotes(ps, r) {
  const out = [];
  const slot = r.slot.id;
  const { charId, skillIndex, uniEquipId } = r.pick;
  const mod = uniEquipId ?? '无模组';
  if (r.slot.auto) {
    out.push(r.slot.overwrite
      ? `没有空闲的自选槽：覆盖了 ${slot}（原本是 ${r.before.charId}）。`
      : `自动选了 ${r.slot.tier} 阶的空闲槽 ${slot}。`);
  } else if (r.slot.overwrite) {
    out.push(`${slot} 原本是 ${r.before.charId}（skill=${r.before.skillIndex}）${r.before.uniEquipId ? `，${r.before.uniEquipId}` : ''}，已被覆盖。`);
  }
  if (!r.pooled && r.pooledTiers.length) out.push(`${charId} 不在 ${r.slot.tier} 阶的池子里（只在 ${r.pooledTiers.join(' / ')} 阶）——放在这个槽里 sim 不认。`);
  if (r.defaults.skill === 'inherited') out.push(`技能沿用原来的 pick：skill=${skillIndex}。`);
  if (r.defaults.skill === 'locked') out.push(`${charId} 是原型干员：技能取它锁定的 S${skillIndex + 1}（与系统补位一致）。`);
  if (r.defaults.skillDropped !== null) out.push(`原来的 skill=${r.defaults.skillDropped} 不是 ${charId} 的技能：改用 skill=${skillIndex}。`);
  if (r.defaults.module === 'inherited') out.push(`模组沿用原来的 pick：${uniEquipId}。`);
  if (r.defaults.module === 'locked') out.push(`模组取原型干员锁定的 ${uniEquipId}。`);
  if (r.defaults.moduleDropped !== null) out.push(`原来的模组 ${r.defaults.moduleDropped} 不属于 ${charId}：已置空（要带模组就加 module=<uniEquipId>）。`);
  if (r.prototype && r.locked && (r.locked.skillIndex !== skillIndex || (r.locked.uniEquipId ?? null) !== (uniEquipId ?? null))) {
    out.push(`原型干员的技能 / 模组固定为 skill=${r.locked.skillIndex}、${r.locked.uniEquipId ?? '无模组'}，这次强制写成 skill=${skillIndex}、${mod}。`);
  }
  if (!r.ownedPool) out.push(`${charId} 不在 diy.ownedPool（可选的已拥有 6★）里：这是调试口强发的「任意」干员。`);
  if (!r.kitted) out.push(`${charId} 没有 kit（KITTED_CHARS 之外）：模拟按职业走泛用 kit（server/sim/content/generic.js），技能 / 天赋不是这名干员的。`);
  if (!r.sim) {
    out.push(`sim 不认这个 pick：${r.check}。手牌 / 详情 / 商店 / AI 按该干员成立，但进战场时 sim 和客户端都用 shared/diy.js diyRecordOf 重建记录，会被同一个 checkDiyPick 拒绝——这只棋子部署不出来。`);
  }
  if (!r.bonds.length) out.push(`${charId} 没有派生盟约（不在 data/backups.json diy.operators 里）：这只棋子不计入任何盟约。`);
  if (r.stock.banned) out.push(`本局禁用了它的全部盟约（${r.bonds.join('、')}）：正常玩法里这个槽不会有库存，调试口照样重建了一份。`);
  if (r.duplicates.length) out.push(`${charId} 还填在 ${r.duplicates.join('、')}：同一个干员占了两个槽（正常编队不允许）。`);
  if (ps.isBot) out.push('目标是机器人：正常编队里机器人没有自选（[ASSUMED]），这是强发的。');
  return out;
}

/**
 * `diy=<charId>` (+ skill / module / elite / slot): force the 自选 pick this grant needs (PlayerDiy.forceDiyPick) and
 * describe it. Returns `{ ok: true, result, chessId, notes }`, or `{ ok: false, status, detail, slots? }` for a bad
 * parameter or a pick the data cannot compose — the caller replies and touches nothing else (nothing was written).
 */
function forceDiy(m, ps, q, charId) {
  if (typeof ps.forceDiyPick !== 'function') return { ok: false, status: 400, detail: 'this player state has no 自选 support (no matches in this process?)' };
  const rawSkill = (q.get('skill') || '').trim();
  if (rawSkill && !/^\d{1,2}$/.test(rawSkill)) return { ok: false, status: 400, detail: `skill= 只接受 0–9：${rawSkill}` };
  const rawModule = (q.get('module') || '').trim();
  if (rawModule && rawModule !== 'none' && !/^[A-Za-z0-9_-]{1,64}$/.test(rawModule)) return { ok: false, status: 400, detail: `module= 只接受 uniEquipId 或 none：${rawModule}` };
  const want = { charId };
  if (rawSkill) want.skillIndex = Number(rawSkill);
  if (rawModule) want.uniEquipId = rawModule === 'none' ? null : rawModule;
  // the bonds switched off this match: Match draws them once, and initDiyStock gave every slotted slot its stock then
  const off = new Set([...(m.disabledBonds ?? []), ...(m.staticInactiveBonds ?? [])]);
  const res = ps.forceDiyPick((q.get('slot') || '').trim() || null, want, { elite: q.get('elite') === '1', off });
  if (!res || !('ok' in res)) return { ok: false, status: 400, detail: (res && res.error) || 'diy force failed', slots: res && res.slots };
  return { ok: true, result: res, chessId: res.chessId, notes: diyNotes(ps, res) };
}

/** The `resolved` block of a forced pick: what the slot now holds and what it means (docs/DEV-GRANT.md). */
function resolvedOf(r) {
  return {
    charId: r.pick.charId,
    name: r.name,
    skillIndex: r.pick.skillIndex,
    uniEquipId: r.pick.uniEquipId,
    tier: r.slot.tier,
    elite: r.slot.elite,
    slot: r.slot.id,
    chessId: r.chessId,
    skillId: r.skillId,
    ownedPool: r.ownedPool,
    pooled: r.pooled,
    pooledTiers: r.pooledTiers,
    prototype: r.prototype,
    kitted: r.kitted,
    kit: r.kit,
    sim: r.sim,
    ...(r.check ? { check: r.check } : null),
  };
}

/**
 * @param {{
 *   log?: { info?: Function, warn?: Function },
 *   lobby: { rooms: Map<string, any> },
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, query: string) => void}
 */
export function createDevGrantHandler({ log, lobby }) {
  /** The room holding a running match: the named one, else the only one, else a helpful error. */
  const pickMatch = (wantedCode) => {
    const live = [...lobby.rooms.values()].filter((r) => r.match);
    if (wantedCode) {
      const room = [...lobby.rooms.values()].find((r) => String(r.code).toUpperCase() === wantedCode.toUpperCase());
      return room ? room.match : null;
    }
    return live.length === 1 ? live[0].match : null;
  };

  return function handleDevGrant(req, res, query) {
    if (!isLoopback(req.socket && req.socket.remoteAddress)) {
      reply(res, 403, { ok: false, error: 'loopback only', detail: 'SP_DEV_GRANT 只接受来自本机的请求。' });
      return;
    }
    const q = new URLSearchParams(query || '');

    // Discovery: no acting parameter lists what can be granted where (room / player ids are what the grant needs, and
    // each player's 自选 picks + stock + bond layers are what a diy= force / a bond= set would replace — loopback-only).
    const chessArg = (q.get('chess') || q.get('id') || '').trim();
    const diyArg = (q.get('diy') || '').trim();
    const bondArg = (q.get('bond') || '').trim();
    const rawLayers = q.get('layers');
    // Any of the acting parameters suppresses discovery, so `?funds=99` on its own works without `chess=`.
    const acts = chessArg || diyArg || bondArg || (rawLayers !== null && rawLayers.trim() !== '')
      || (q.get('funds') || '').trim() || (q.get('fundsAdd') || '').trim();
    if (!acts) {
      reply(res, 200, {
        ok: true, app: APP_VERSION, devGrant: true,
        usage: `${DEV_GRANT_PATH}?chess=<id>[,<id>…][&count=N][&funds=N | &fundsAdd=N][&room=CODE][&player=ID][&toTemp=1]`
          + `[&diy=<charId>[&skill=<0|1|2>][&module=<uniEquipId>|none][&elite=1][&slot=<slotBaseId>]]`
          + `[&bond=<bondId>[,<bondId>…]&layers=<0…${BOND_LAYER_CAP}>]`,
        matches: [...lobby.rooms.values()].filter((r) => r.match).map((r) => describeMatch(r.match)),
      });
      return;
    }

    const wantedRoom = (q.get('room') || '').trim();
    const m = pickMatch(wantedRoom);
    if (!m) {
      const live = [...lobby.rooms.values()].filter((r) => r.match).map((r) => r.code);
      reply(res, 404, {
        ok: false,
        error: live.length ? 'room not found or ambiguous' : 'no running match',
        detail: live.length ? `带上 room=<CODE>；正在进行的房间：${live.join(', ')}` : '先开一局再发牌。',
        rooms: live,
      });
      return;
    }
    if (!SAFE_PHASES.has(m.phase)) {
      reply(res, 409, {
        ok: false, error: 'phase', detail: `现在是对局阶段「${m.phase}」，作战进行中不能发牌（会打乱棋盘校验）。等休整期。`,
        phase: m.phase, round: m.round, roomCode: m.roomCode,
      });
      return;
    }

    // Target player: an explicit id, else the only human still in the match.
    const wantedPlayer = (q.get('player') || '').trim();
    const humans = m.order.filter((ps) => ps.isHumanActive);
    let ps = null;
    if (wantedPlayer) ps = m.players.get(wantedPlayer) || null;
    else if (humans.length === 1) ps = humans[0];
    if (!ps) {
      reply(res, 404, {
        ok: false, error: 'player not found or ambiguous',
        detail: wantedPlayer ? `这个对局里没有 ${wantedPlayer}` : `有多名玩家，带上 player=<id>；可选：${humans.map((p) => p.playerId).join(', ')}`,
        players: m.order.map((p) => p.playerId),
      });
      return;
    }

    // 设置盟约层数: `bond=` / `layers=` are validated BEFORE anything is written, so a request that names an unknown bond
    // or a bad value changes nothing at all — not even the chess= / funds= it may carry (the diy= rule).
    let bondSet = null;
    if (bondArg || rawLayers !== null) {
      const ids = bondArg ? bondArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const fail = (detail, extra = null) => reply(res, 400, {
        ok: false, error: 'bond', detail, roomCode: m.roomCode, playerId: ps.playerId, phase: m.phase, round: m.round,
        requested: { bond: bondArg || null, layers: rawLayers },
        ...(extra || null), notes: [],
      });
      if (!ids.length) { fail('bond= 要给出至少一个盟约 id，例如 bond=swiftShip,sargonShip&layers=500'); return; }
      const raw = String(rawLayers ?? '').trim();
      if (rawLayers === null || raw === '') { fail('layers= 要给出层数（0–999），例如 bond=swiftShip&layers=500'); return; }
      // the RAW value, like funds=: a sign, a space (a `+` in a query decodes to one) or a fraction is refused, never rounded
      if (!/^\d+$/.test(raw)) { fail(`layers= 只接受 0–${BOND_LAYER_CAP} 的整数：${raw}`); return; }
      const want = Number(raw);
      if (!(want <= (BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity))) {
        fail(`layers= 超出上限：${want} > ${BOND_LAYER_CAP}（BOND_LAYER_CAP，shared/constants.js）`); return;
      }
      const unknown = ids.filter((id) => !bondRecordOf(m, id));
      if (unknown.length) {
        fail(`未知盟约 id：${unknown.join(', ')}`, { unknown, available: bondIdsOf(m) });
        return;
      }
      bondSet = { ids, want };
    }

    const ids = chessArg ? chessArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const count = Math.max(0, Math.min(50, Number(q.get('count')) || 1));
    const toTemp = q.get('toTemp') === '1';

    // 任意发牌: the pick goes in before the grant (a 自选 slot has no operator without one). On a failure nothing at
    // all is granted — the pick is the point of the call, and a half-applied request is worse than a clean 400.
    const notes = [];
    const picksBefore = picksOf(ps);
    let forced = null;
    if (diyArg) {
      const want = forceDiy(m, ps, q, diyArg);
      if (!want.ok) {
        reply(res, want.status ?? 400, {
          ok: false, error: 'diy', detail: want.detail, roomCode: m.roomCode, playerId: ps.playerId, phase: m.phase, round: m.round,
          requested: { charId: diyArg, skill: q.get('skill') || null, module: q.get('module') || null, elite: q.get('elite') === '1', slot: q.get('slot') || null },
          picks: picksOf(ps), ...(want.slots ? { diySlots: want.slots } : null), notes: [],
        });
        return;
      }
      forced = want.result;
      notes.push(...want.notes);
      // 然后照常发一只: the same acquireChess door, `count` / `toTemp` as always (count=3 merges into the elite)
      ids.push(forced.chessId);
    }

    const granted = [];
    const failed = [];
    for (const id of ids) {
      const rec = getChess(id, m.data);
      if (!rec) { failed.push({ id, error: 'unknown chess id' }); continue; }
      let got = 0;
      let err = null;
      for (let i = 0; i < count; i++) {
        const piece = ps.acquireChess(id, { source: 'dev', toTemp, fromPool: true });
        if (!piece) { err = i === 0 ? refusalReason(ps, id) : `stopped after ${got}`; break; }
        got++;
      }
      if (got) {
        // the name this player's data shows (a slotted 自选 slot is its operator, not 甄选干员)
        const shown = ps.gd && typeof ps.gd.chess === 'function' ? ps.gd.chess(id) : null;
        granted.push({ id, count: got, name: (shown && shown.name) || rec.name });
      }
      if (err) failed.push({ id, error: err });
    }

    // Funds, through addFunds (server/match/player/economy.js — the same door as every gain: fundsGained, dirty).
    // `funds=N` sets the exact amount; `fundsAdd=N` adds. A `+` cannot express "add" in a query string — it decodes
    // to a space, so `funds=+50` would read as "set to 50" — so a value carrying `+`, whitespace or anything else
    // non-numeric is REJECTED rather than guessed at, and nothing is written. NB `economy.leftoverFundsLost` still
    // applies: unspent funds are cleared when the prep ends unless the band is one of `leftoverFundsKeptByBands`, so
    // a top-up lasts that prep only.
    let funds = null;
    const rawSet = q.get('funds');
    const rawAdd = q.get('fundsAdd') ?? q.get('fundsadd');
    const rawFund = rawSet !== null ? rawSet : rawAdd;
    if (rawFund !== null && rawFund.trim() !== '') {
      // Test the RAW value: a `+` in a query decodes to a space, so trimming first would turn `funds=+50` into a
      // perfectly valid "50" and silently set funds to 50 instead of adding. Only `fundsAdd=-N` may carry a sign.
      const problem = /^[+\s]/.test(rawFund) ? 'sign or space not allowed (use fundsAdd=N to add)'
        : !/^-?\d+$/.test(rawFund) ? 'not a whole number'
          : (rawFund.startsWith('-') && rawSet !== null) ? 'funds= takes no sign (use fundsAdd=-N to spend down)'
            : null;
      if (problem) {
        failed.push({ id: `${rawSet !== null ? 'funds' : 'fundsAdd'}=${rawFund}`, error: problem });
      } else {
        const want = Number(rawFund);
        const before = ps.funds;
        const applied = ps.addFunds(rawSet !== null ? want - before : want, { reason: 'dev' });
        funds = { before, after: ps.funds, delta: applied };
      }
    }

    // 设置盟约层数 (validated above): SET each named bond to `layers=`. `created` = this player had no record of the bond
    // at all (it was not in the views: no member, no layers, no tier) — the debug endpoint creates it and says so.
    let bonds = null;
    if (bondSet) {
      bonds = [];
      let live = 0; // battles whose live copy this write reached (the same set for every bond of the call)
      for (const bondId of bondSet.ids) {
        const rec = bondRecordOf(m, bondId);
        const state = ps.bonds && ps.bonds[bondId] ? ps.bonds[bondId] : null;
        const created = !(state && (state.count > 0 || state.layers > 0 || state.active));
        const name = (state && state.name) || (rec && rec.name) || bondId;
        const r = setBondLayers(m, ps, bondId, bondSet.want);
        live = Math.max(live, r.live);
        const after = ps.bonds && ps.bonds[bondId] ? ps.bonds[bondId] : null;
        const count = after && Number.isFinite(after.count) ? after.count : 0;
        const active = !!(after && after.active);
        bonds.push({ bondId, name, before: r.before, after: r.after, active, created });
        if (created && r.after > 0) notes.push(`${bondId}（${name}）此前在该玩家身上没有任何记录：已新建并把层数设为 ${r.after}。`);
        else if (created) notes.push(`${bondId}（${name}）此前在该玩家身上没有任何记录；层数设为 0，等于仍然没有记录。`);
        if (r.after === 0 && !created) notes.push(`${bondId}：0 层 = 清空这条盟约的层数（记录保留）。`);
        if (r.before > r.after) notes.push(`${bondId}：层数下调 ${r.before} → ${r.after}（引擎只有加层 API，这一处直接写持久值 + recompute）。`);
        if (!active) notes.push(`${bondId} 未激活（成员数 ${count}）——层数会保留，但盟约效果只在激活后按层数生效，先让它在场上凑够人。`);
        if (!after) notes.push(`${bondId} 不在本局的可激活盟约里（modeInactiveBonds）：层数照样写进持久值，视图只把它当禁用的灰色记录。`);
        if (r.after >= (BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity)) notes.push(`${bondId} 已到上限 ${BOND_LAYER_CAP}（BOND_LAYER_CAP，shared/constants.js）。`);
      }
      notes.push(live
        ? `当前战斗的实时层数副本已同步（${live} 个战场：Battle.getPlayer(...).bonds[id].layers）。`
        : '当前没有握着战场（PREP / SETTLE）：下一场战斗的输入从持久层数初始化（battleInput → bondSnapshot）。');
      log?.info?.(`[dev-grant] layers: ${bondSet.ids.join(', ')} = ${bondSet.want}${live ? ` (live copies: ${live})` : ''}`);
    }

    // What the 自选 stock looks like now (the force rebuilt that slot's copies; the grants took from them)
    let stock = null;
    if (forced) {
      const left = ps.diyStock && typeof ps.diyStock.left === 'function' ? ps.diyStock.left(forced.slot.id) : null;
      stock = { slot: forced.slot.id, cap: forced.stock.cap, before: forced.stock.before, left };
      notes.push(`库存 ${forced.slot.id}：${forced.stock.before === null ? '没有' : forced.stock.before} → ${left}（cap ${forced.stock.cap}）。`);
      if (left === 0) notes.push(`槽 ${forced.slot.id} 的份数已发完：商店不会再抽到它，再发就是超发（份数记 0，账目仍然平）。`);
    }

    // Land it in the client now: combat flushes once a second, but a grant should be visible immediately.
    ps.dirty();
    try { m.flush(true); } catch (e) { log?.warn?.('[dev-grant] flush', e); }

    const did = granted.length > 0 || funds !== null || bonds !== null;
    log?.info?.(`[dev-grant] room ${m.roomCode} player ${ps.playerId} phase ${m.phase}: granted ${granted.map((g) => `${g.id}×${g.count}`).join(', ') || 'nothing'}${forced ? `; diy ${forced.slot.id}=${forced.pick.charId} (skill ${forced.pick.skillIndex}, ${forced.pick.uniEquipId ?? 'no module'})${forced.sim ? '' : ' [sim refuses]'}` : ''}${funds ? `; funds ${funds.before}→${funds.after}` : ''}${bonds ? `; bonds ${bonds.map((b) => `${b.bondId} ${b.before}→${b.after}${b.created ? ' (new)' : ''}`).join(', ')}` : ''}${failed.length ? `; failed ${failed.map((f) => `${f.id} (${f.error})`).join(', ')}` : ''}`);
    reply(res, did ? 200 : 409, {
      ok: did, roomCode: m.roomCode, playerId: ps.playerId, phase: m.phase, round: m.round,
      // the roster before and after a diy= force (a plain grant leaves it alone, and `picks` still shows it)
      ...(forced ? { picksBefore, resolved: resolvedOf(forced), stock } : null),
      picks: picksOf(ps),
      granted, ...(funds ? { funds } : {}), ...(bonds ? { bonds } : {}), failed, notes,
    });
  };
}
