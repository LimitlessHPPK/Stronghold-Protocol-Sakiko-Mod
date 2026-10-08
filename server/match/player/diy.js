// server/match/player/diy.js — PlayerState methods: 自选编队 (0.2.0 DIY; research 0.2.0 §2, the owner's decisions of
// 2026-10-05) — the human's picks for the four DIY slots and what a slotted operator changes in the player's own state.
//   * setDiy: the seat's picks when the match started (seats[].diy, server/lobby.js room.diy), re-checked against this
//     match's data and kit registry (shared/protocol.js checkDiyPicks, server/sim/content/kits/index.js KITTED_CHARS) and
//     fixed for the match — an out-of-match setting: a change during a match applies to the next one. Bots field no 自选
//     piece [ASSUMED]. `diy` = { [slotBaseId]: { charId, skillIndex, uniEquipId } } (frozen; uniEquipId null = none).
//   * the player's data view (diyGameData): with picks, `ps.gd` is a view of the match's GameData whose chess(id) is the
//     composed 自选 record of a slotted slot, both forms (shared/diy.js diyRecord: the slot's identity — tier, price, sell
//     price, the 3 → elite merge, status: E2 Lv1 skill rank 4 / E2 Lv60 rank 7 with the module at stage 1 at tier 5, 3 at
//     tier 6 — and the operator's body: name, class, position, stats, range, the pick's skill and module, no 特质, the
//     bonds derived from its factions; `diyFor` = the slot, `charId` = the operator). Every rule that reads a record
//     through ps.gd — bonds (bondsMeta), the 特质 / meta effects (effectsMeta makeCtx), placement and summon ranges, the
//     AI 托管 evaluation, names in toasts and tickers — sees the operator. A player without picks keeps the match's
//     GameData itself: nothing changes for anyone else. token(id) also finds the 自选 summons (data/backups.json
//     `tokens`) and placeableTokens() reads their variant of the owner form (`<charId>@<statusKey>`, shared/diy.js
//     diyTokenOwner), so a placeable 自选 summon comes to the hand like any operator's (PRTS 卫戍协议/帮助 §战斗部署).
//   * the per-player stock (initDiyStock, called by the match once its bans are drawn): each slotted DIY piece has copies
//     of its own — the tier's pool copies, 8 at tier 5 and 5 at tier 6 [ASSUMED: research 0.2.0 §2.5, the excel has no
//     stock field] — drawn by this player only; it never enters the shared pool (PR #71's shared shop was the mistake to
//     avoid). A piece all of whose bonds are switched off this match (本局禁用: the drawn bans and the mode's static list)
//     gets no stock and so leaves the shop, like a preset chess whose bonds are all off (PRTS 卫戍协议：盟约 "禁用盟约有可能
//     影响自选的支援干员"); 协防 (emptyShip) is never banned, so a prototype always stays. poolOf(baseId) routes every copy
//     taken or returned for a slotted slot to that stock (buy, reward picks, merges, promotions, sells, temp, elimination).
//   * the shop's draws (diyRollEntries): the stock of each slotted slot joins this player's copy-weighted rolls — the
//     shop's chess slots and the reward offers' temporary refreshes [ASSUMED] — weighted like any chess of its tier, once
//     the 调度中心 has reached the slot's shopLevel (activity_table shopLevelDisplayDataDict lists the tier-5 slots at
//     level 5 and the tier-6 slots at level 6; PRTS 帮助 "仅在调度中心等级 ≥ 干员所在等阶"). The price is the slot's (any
//     chess of its tier: 4).
//   * random grants (diyStockEntries, 0.2.0 WE2 #9): an effect, reward or 机变 card that grants this player a random
//     operator from the pool draws its stock too — 「自选干员放入后模拟中的补给池随机范围也将被相应扩大」 (bilibili), "调度中心
//     随机资源的范围将被扩大" (PRTS 新手教程) — under the roll's own tier rules (the effect's tier / maxTier: no 调度中心 gate,
//     as for a preset chess) and filters (bonds read through the player's data view).
//   * forceDiyPick: the /dev/grant debug channel's way in (docs/DEV-GRANT.md) — ONE pick written over the ones the match
//     froze at its start, that slot's composed records and stock rebuilt. No gameplay path calls it.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { KITTED_CHARS, GENERIC_KIT_CHARS, OPERATOR_KITS, STANDIN_KITS } from '../../sim/content/kits/index.js';
import { checkDiyPicks } from '../../../shared/protocol.js';
import { checkDiyPick, DIY_TIERS, diyPool, diyRecord, diySlot, diySlotIds, diyTokenOwner, isPrototypePick, lockedSelection } from '../../../shared/diy.js';
import { composeUnitRecord, statusKey, unitForm } from '../../../shared/standIn.js';

const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The copies of a player's slotted DIY pieces — the shared pool's copy interface (has / cap / left / take / give) for
 * those base ids only. `entries`: baseId → { cap, left, tier, shopLevel }.
 */
export class DiyStock {
  constructor() {
    /** @type {Map<string, { cap: number, left: number, tier: number, shopLevel: number }>} */
    this.entries = new Map();
  }

  has(baseId) { return this.entries.has(baseId); }
  cap(baseId) { return this.entries.get(baseId)?.cap ?? 0; }
  left(baseId) { return this.entries.get(baseId)?.left ?? 0; }

  /** Take up to n copies; returns the number taken (0 for a base id without stock). */
  take(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.left, Math.floor(n));
    e.left -= k;
    return k;
  }

  /** Return n copies (clamped at the cap); returns the number returned. */
  give(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.cap - e.left, Math.floor(n));
    e.left += k;
    return k;
  }

  /** { baseId: left } (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = e.left;
    return o;
  }
}

/**
 * The player's view of the match's GameData (see the header): `records` maps the ids of the slotted slots (normal and
 * elite) to their composed 自选 records; every other lookup is the match's own.
 * @param {import('../gamedata.js').GameData} gd
 * @param {Map<string, object>} records
 * @returns {import('../gamedata.js').GameData}
 */
export function diyGameData(gd, records) {
  const view = Object.create(gd);
  const backups = isObj(gd.raw && gd.raw.backups) ? gd.raw.backups : null;
  const diyTokens = backups && isObj(backups.tokens) ? backups.tokens : {};
  const tokenOf = (id) => (typeof id === 'string' && Object.hasOwn(diyTokens, id) && isObj(diyTokens[id]) ? diyTokens[id] : null);
  Object.defineProperties(view, {
    /** the match's own GameData (the view is per player) */
    matchData: { value: gd },
    chess: { value: (id) => (typeof id === 'string' && records.has(id) ? records.get(id) : gd.chess(id)) },
    token: { value: (id) => gd.token(id) || tokenOf(id) },
    /**
     * GameData.placeableTokens for a slotted slot: the summons its record lists (the pick's skill and talents) that are
     * placeable, by the variant of the owner form (`bySkill[skillIndex]` sources) — the deploy limit as the count (PRTS
     * 卫戍协议/帮助 "根据召唤物部署数量上限（非初始持有量）"), the active module's own when its variant has one (`byModule`:
     * 望's TRP-X "可同时部署的陷阱数量提升", 6 → 7 棋子; SUM-Y stage 2+ 4 drones / summons). The data's deploy limit holds the
     * token's own talent additions (tools/build-data.mjs tokenTalentDeckBonus, 0.2.0): 麦哲伦 / 令 / 电弧 3, 白铁 2, 夜莺 3 幻影.
     */
    placeableTokens: {
      value: (chessId, loadout = null) => {
        const rec = typeof chessId === 'string' && records.has(chessId) ? records.get(chessId) : null;
        if (!rec) return gd.placeableTokens(chessId, loadout);
        const owner = diyTokenOwner(rec.charId, rec.status);
        const out = [];
        for (const tid of Array.isArray(rec.tokens) ? rec.tokens : []) {
          const t = tokenOf(tid);
          if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
          const v = isObj(t.variants) ? t.variants[owner] ?? null : null;
          if (v) {
            const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
            const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
            if (!src.includes('talent') && !src.includes('skill')) continue;
          }
          const mid = rec.module && rec.module.active ? rec.module.id : null;
          const vm = v && mid && isObj(v.byModule) ? v.byModule[mid] ?? null : null;
          out.push({ tokenId: tid, count: Math.min(posIntOr(vm?.stats?.deployLimit, posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1))), 9) });
        }
        return out;
      },
    },
  });
  return view;
}

export class PlayerDiy {
  /**
   * Fix the 自选 picks for the match (see the header): the seat's picks re-checked against this match's data and kits;
   * a slot whose record cannot be composed is left empty. With picks, `this.gd` becomes the player's data view.
   * @param {any} picks `{ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }`
   * @param {{ kitted?: Iterable<string> }} [opts] the operators with a kit (default: the registry's KITTED_CHARS; tests may
   *   widen it to slot an operator whose kit is still being written)
   * @returns {boolean} false when the picks are malformed (nothing changes) or the player is a bot
   */
  setDiy(picks, { kitted = KITTED_CHARS } = {}) {
    if (this.isBot) return false;
    const gd = this.m.gd;
    const data = gd.raw;
    const res = checkDiyPicks(picks, { data, kitted });
    if (!res || !('ok' in res)) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] 自选 picks of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const kept = {};
    const records = new Map();
    for (const [slotId, pick] of Object.entries(res.picks)) {
      const slot = diySlot(slotId, data);
      let normal;
      let golden;
      try {
        normal = diyRecord(slotId, pick, { elite: false, data });
        golden = diyRecord(slotId, pick, { elite: true, data });
      } catch { normal = null; golden = null; }
      if (!slot || !normal || !golden) continue;
      records.set(slot.baseId, Object.freeze(normal));
      records.set(slot.goldenId, Object.freeze(golden));
      kept[slot.baseId] = Object.freeze({ charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId ?? null });
    }
    this.diy = Object.freeze(kept);
    this._diyRecords = records;
    this.gd = records.size ? diyGameData(gd, records) : gd;
    return true;
  }

  /**
   * The stock of each slotted DIY piece (see the header), once the match has drawn its bans: `off` = the bonds switched
   * off this match (drawn + the mode's static list). A piece all of whose bonds are off gets none (`diyBanned`).
   * @param {Set<string>} off
   */
  initDiyStock(off = new Set()) {
    this.diyStock = new DiyStock();
    const banned = [];
    const gd = this.m.gd;
    for (const slotId of Object.keys(this.diy || {})) {
      const rec = this._diyRecords.get(slotId);
      const slot = diySlot(slotId, gd.raw);
      if (!rec || !slot) continue;
      const bonds = Array.isArray(rec.bonds) ? rec.bonds : [];
      if (bonds.length > 0 && bonds.every((b) => off.has(b))) { banned.push(slotId); continue; }
      const cap = gd.poolCopies(slotId);
      if (!(cap > 0)) continue;
      this.diyStock.entries.set(slotId, { cap, left: cap, tier: gd.tierOf(slotId), shopLevel: slot.shopLevel });
    }
    this.diyBanned = Object.freeze(banned);
  }

  /** The copy accounting of base chess `baseId` for this player: its own stock for a slotted DIY slot, else the shared pool. */
  poolOf(baseId) {
    return this.diyStock && this.diyStock.has(baseId) ? this.diyStock : this.m.pool;
  }

  /**
   * The stock entries this player's shop draws from now ([baseId, entry] with copies left and the 调度中心 at the slot's
   * shopLevel), or null (none — the shared pool's roll alone, exactly as without picks).
   * @returns {Array<[string, { cap: number, left: number, tier: number, shopLevel: number }]> | null}
   */
  diyRollEntries() {
    if (!this.diyStock || !this.diyStock.entries.size) return null;
    const out = [];
    for (const [id, e] of this.diyStock.entries) if (e.left > 0 && this.shop.level >= e.shopLevel) out.push([id, e]);
    return out.length ? out : null;
  }

  /**
   * The stock entries a random grant of this player draws besides the shared pool (see the header): every slotted piece
   * with copies left, whatever the 调度中心 level (the roll's own tier rules apply), or null (none).
   * @returns {Array<[string, { cap: number, left: number, tier: number, shopLevel: number }]> | null}
   */
  diyStockEntries() {
    if (!this.diyStock || !this.diyStock.entries.size) return null;
    const out = [...this.diyStock.entries].filter(([, e]) => e.left > 0);
    return out.length ? out : null;
  }

  /**
   * The 自选 pick a chess id (normal or elite) of this player fields — its slot's — or null (not a slotted slot).
   * @param {string} id
   * @returns {{ charId: string, skillIndex: number, uniEquipId: string|null } | null}
   */
  diyPickOf(id) {
    const rec = this._diyRecords && typeof id === 'string' ? this._diyRecords.get(id) : null;
    return rec ? this.diy[rec.diyFor] ?? null : null;
  }

  /**
   * Force ONE 自选 pick into a slot — the /dev/grant development endpoint only (server/dev-grant.js, docs/DEV-GRANT.md);
   * no gameplay path calls it. setDiy is the normal door: a whole roster, checked against the slot's pool and the kit
   * registry, once, when the match starts. This one writes a single pick over whatever this player had — a NEW frozen
   * object, the picks the match froze are never mutated — so it also works for a player who picked nothing, picked
   * someone else, or whose picks were fixed when the match started; it rebuilds that slot's composed records (both
   * forms) and its stock, so the piece fields the operator from the next line on.
   * The record is composed from the data as it is: the operator needs NO place in the slot's pool (diyPool) and no kit
   * (KITTED_CHARS). Those two decide what the result reports instead — `sim` (whether the simulation will accept the
   * piece: shared/diy.js checkDiyPick is what simdata getDiy and the client re-run on the pick) and `kit` (its own kit,
   * or the generic one).
   * @param {string|null} slotId a slot's normal or elite id; null / '' auto-picks one: an empty slot, tier 6 first (a
   *   pick that only the other tier's pool holds takes that tier first), else — every slot filled — one is overwritten
   * @param {{ charId: string, skillIndex?: number|null, uniEquipId?: string|null }} want `skillIndex` / `uniEquipId`
   *   omitted = inherit (the pick already in the slot when the operator has it, else a prototype's locked selection,
   *   else skill 0 / no module); `uniEquipId: 'none'` = explicitly no module
   * @param {{ elite?: boolean, off?: Iterable<string>|null }} [opts] `elite` = grant the slot's `_b` form later (a slot
   *   id naming the elite form implies it); `off` = the bonds switched off this match (Match.disabledBonds +
   *   staticInactiveBonds — the stock rule initDiyStock applies)
   * @returns {{ ok: true, slot: { id: string, tier: number, elite: boolean, auto: boolean, overwrite: boolean },
   *   slotIds: string[], chessId: string, pick: any, before: any, duplicates: string[], name: string, skillId: string,
   *   ownedPool: boolean, pooled: boolean, pooledTiers: number[], prototype: boolean, locked: any, kitted: boolean,
   *   kit: 'operator'|'standin'|'generic'|'fallback', sim: boolean, check: string|null, bonds: string[],
   *   bondsOff: string[], defaults: { skill: string|null, module: string|null, skillDropped: number|null,
   *   moduleDropped: string|null }, stock: { cap: number, before: number|null, banned: boolean } }
   *   | { error: string, slots?: string[] }} the diagnostics the endpoint renders; nothing was written on an error
   */
  forceDiyPick(slotId, want, { elite = false, off = null } = {}) {
    const gd = this.m.gd;
    const data = gd.raw;
    const slots = diySlotIds(data).map((id) => diySlot(id, data)).filter(Boolean);
    if (!slots.length) return { error: 'no 自选 slot in the data (data/backups.json diy.slots)' }; // i18n-ignore: developer detail
    const slotsList = slots.map((s) => s.baseId);
    const nav = this.diy && typeof this.diy === 'object' ? this.diy : {};
    let auto = false;
    let slot = null;
    if (slotId) {
      slot = diySlot(slotId, data);
      if (!slot) return { error: `not a 自选 slot: ${slotId}`, slots: slotsList }; // i18n-ignore: developer detail
    } else {
      auto = true;
      const charId = want?.charId;
      const tiers = [...new Set(slots.map((s) => s.tier))].sort((a, b) => b - a); // 6 before 5 (data order is 5, 5, 6, 6)
      const pickable = (t) => diyPool(t, { data }).includes(charId);
      // the default is an empty tier-6 slot, a tier-5 one next; an operator only the tier-5 pool holds takes that tier,
      // so the piece is one the sim accepts
      const order = pickable(tiers[0]) || !tiers[1] || !pickable(tiers[1]) ? tiers : [tiers[1], tiers[0]];
      const free = slots.filter((s) => !nav[s.baseId]);
      const pool = free.length ? free : slots;
      slot = order.map((t) => pool.find((s) => s.tier === t)).find(Boolean) || pool[0];
    }
    const charId = want?.charId;
    if (typeof charId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(charId)) return { error: `bad charId: ${charId}` }; // i18n-ignore: developer detail
    const backups = isObj(data?.backups) ? data.backups : null;
    const unit = isObj(backups?.units?.[charId]) ? backups.units[charId] : null;
    if (!unit) return { error: `no unit record for ${charId} (data/backups.json units)` }; // i18n-ignore: developer detail
    const forms = [slot.normal, slot.golden].map((rec) => (rec ? unitForm(backups, charId, rec.status) : null));
    if (forms.some((f) => !f)) {
      const at = [slot.normal?.status, slot.golden?.status].map((s) => statusKey(s)).join(' / ');
      return { error: `no unit form of ${charId} at ${at} (tier ${slot.tier})` }; // i18n-ignore: developer detail
    }
    const skills = (f) => (Array.isArray(f.skills) ? f.skills.filter(Boolean) : []);
    const hasSkill = (i) => forms.every((f) => skills(f).some((s) => s.index === i));
    const mods = Array.isArray(forms[1].modules) ? forms[1].modules.filter(Boolean) : [];
    const hasModule = (id) => mods.some((m) => m.uniEquipId === id);
    const proto = isPrototypePick(data, slot.tier, charId);
    const locked = proto ? lockedSelection(data, slot.tier, charId) : null;
    const before = Object.hasOwn(nav, slot.baseId) ? nav[slot.baseId] : null;
    // the selection: what the caller gave, else the pick already in the slot, else a prototype's locked one, else nothing
    let skillIndex = Number.isInteger(want?.skillIndex) ? want.skillIndex : null;
    let howSkill = skillIndex === null ? null : 'given';
    let skillDropped = null;
    if (skillIndex === null && before && Number.isInteger(before.skillIndex)) {
      if (hasSkill(before.skillIndex)) { skillIndex = before.skillIndex; howSkill = 'inherited'; } else skillDropped = before.skillIndex;
    }
    if (skillIndex === null && locked && hasSkill(locked.skillIndex)) { skillIndex = locked.skillIndex; howSkill = 'locked'; }
    if (skillIndex === null) { skillIndex = 0; howSkill = 'default'; }
    if (!hasSkill(skillIndex)) {
      const have = [...new Set(skills(forms[0]).map((s) => s.index))].join(', ');
      return { error: `no skill ${skillIndex} for ${charId} at tier ${slot.tier} (has: ${have})` }; // i18n-ignore: developer detail
    }
    const wanted = want?.uniEquipId;
    let uniEquipId = wanted === undefined || wanted === null || wanted === 'none' ? null : wanted;
    let howModule = wanted === undefined ? null : 'given';
    let moduleDropped = null;
    if (wanted === undefined) {
      if (before && before.uniEquipId) {
        if (hasModule(before.uniEquipId)) { uniEquipId = before.uniEquipId; howModule = 'inherited'; } else moduleDropped = before.uniEquipId;
      }
      if (uniEquipId === null && locked && locked.uniEquipId && hasModule(locked.uniEquipId)) { uniEquipId = locked.uniEquipId; howModule = 'locked'; }
      if (uniEquipId === null) howModule = 'none';
    }
    if (uniEquipId !== null && (typeof uniEquipId !== 'string' || !hasModule(uniEquipId))) {
      return { error: `no module ${uniEquipId} for ${charId} at tier ${slot.tier} (has: ${mods.map((m) => m.uniEquipId).join(', ') || 'none'})` }; // i18n-ignore: developer detail
    }
    // the record, composed as diyRecordOf does — minus its checkDiyPick gate (the pool and kit rules become `sim` / `kit`)
    const bonds = backups?.diy?.operators?.[charId]?.bonds ?? null;
    const compose = (rec) => {
      const out = composeUnitRecord(rec, unit, unitForm(backups, charId, rec.status), { skillIndex, moduleId: uniEquipId, bonds });
      // the mark of a 自选 piece (diyRecordOf): without it acquireChess refuses the slot ("没有填的槽没有身体")
      if (out) out.diyFor = out.baseId ?? out.chessId;
      return out;
    };
    const normal = slot.normal ? compose(slot.normal) : null;
    const golden = slot.golden ? compose(slot.golden) : null;
    if (!normal?.skill || !golden?.skill) return { error: `cannot compose ${slot.baseId} with ${charId}` }; // i18n-ignore: developer detail

    // the picks: a new object (this.diy is frozen), this slot replaced
    const pick = Object.freeze({ charId, skillIndex, uniEquipId });
    const kept = {};
    for (const [id, p] of Object.entries(nav)) if (id !== slot.baseId) kept[id] = p;
    kept[slot.baseId] = pick;
    this.diy = Object.freeze(kept);
    const records = new Map(this._diyRecords);
    records.set(slot.baseId, Object.freeze(normal));
    records.set(slot.goldenId, Object.freeze(golden));
    this._diyRecords = records;
    this.gd = diyGameData(gd, records);

    // the stock of that slot, as initDiyStock would give it (a full set of copies), even for one whose every bond is
    // switched off this match — a debug grant that lands nowhere would be useless; the caller says so in its notes
    const offSet = off instanceof Set ? off : new Set(off || []);
    const bondList = Array.isArray(normal.bonds) ? normal.bonds : [];
    const bondsOff = bondList.filter((b) => offSet.has(b));
    const cap = gd.poolCopies(slot.baseId);
    const stockBefore = this.diyStock && this.diyStock.has(slot.baseId) ? this.diyStock.left(slot.baseId) : null;
    if (cap > 0 && this.diyStock) this.diyStock.entries.set(slot.baseId, { cap, left: cap, tier: gd.tierOf(slot.baseId), shopLevel: slot.shopLevel });
    if (Array.isArray(this.diyBanned) && this.diyBanned.includes(slot.baseId)) this.diyBanned = Object.freeze(this.diyBanned.filter((id) => id !== slot.baseId));

    const check = checkDiyPick(slot.baseId, pick, data);
    const inPool = (t) => DIY_TIERS.includes(t) && diyPool(t, { data }).includes(charId);
    const kitted = KITTED_CHARS.includes(charId);
    return {
      ok: true,
      slot: { id: slot.baseId, tier: slot.tier, elite: !!elite || !!slot.elite, auto, overwrite: !!before },
      slotIds: slotsList,
      chessId: !!elite || slot.elite ? slot.goldenId : slot.baseId,
      pick,
      before,
      duplicates: Object.entries(kept).filter(([id, p]) => id !== slot.baseId && p?.charId === charId).map(([id]) => id),
      name: normal.name,
      skillId: normal.skill.skillId,
      ownedPool: (backups?.diy?.ownedPool ?? []).includes(charId),
      pooled: inPool(slot.tier),
      pooledTiers: DIY_TIERS.filter(inPool),
      prototype: proto,
      locked,
      kitted,
      kit: Object.hasOwn(OPERATOR_KITS, charId) ? 'operator'
        : Object.hasOwn(STANDIN_KITS, charId) ? 'standin'
          : GENERIC_KIT_CHARS.includes(charId) ? 'generic' : 'fallback',
      sim: 'ok' in check,
      check: 'ok' in check ? null : check.error,
      bonds: bondList,
      bondsOff,
      defaults: { skill: howSkill, module: howModule, skillDropped, moduleDropped },
      stock: { cap, before: stockBefore, banned: bondList.length > 0 && bondsOff.length === bondList.length },
    };
  }
}
