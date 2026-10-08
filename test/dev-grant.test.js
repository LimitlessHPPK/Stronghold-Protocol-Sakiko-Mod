// test/dev-grant.test.js — the development-only grant channel (server/dev-grant.js; docs/DEV-GRANT.md).
//
// The channel exists because a room lives in this process's memory and the wire protocol has no grant message. Its
// safety rests on four things this file pins down:
//   * nothing is registered without SP_DEV_GRANT=1 (`parseDevGrant`; the wiring is server/index.js → http/routes.js);
//   * a non-loopback peer is refused even then — the endpoint must never be a public cheat door;
//   * grants go through PlayerState.acquireChess (the same door as buys and rewards), never by writing board state,
//     so the pool is taken and hand/temp overflow applies;
//   * a grant is refused while a battle is running (only PREP / SETTLE pass the phase gate), because a grant that
//     completes a merge would force the elite onto a tile the client is already simulating.
//
// 任意发牌 (`diy=<charId>`, the second half of this file) needs a real match: the pick, the slot's composed records and
// its stock live in PlayerState (server/match/player/diy.js forceDiyPick), so those cases run on test/match/harness.js
// and a real data set — including what the simulation makes of the piece (simdata getChess, the call
// server/sim/battle/players.js makes).
//
// The match is a stub: this file is about the channel's decisions, not about acquireChess itself (that is
// test/match/*.test.js). The stubs mirror the fields of 0.2.0's Match / PlayerState that the handler reads
// (roomCode / modeId / phase / round / matchNo / players / order / flush; playerId / seat / isBot / isHumanActive /
// connected / left / funds / acquireChess / addFunds / dirty).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevGrantHandler, parseDevGrant, DEV_GRANT_PATH } from '../server/dev-grant.js';
import { getData, getChess } from '../server/data.js';
import { hasGeneratedData } from '../server/sim/simdata.js';
import { PHASE, BOND_LAYER_CAP } from '../shared/constants.js';
import { makeMatch, give, legalTileFor } from './match/harness.js';
import { bondLayers } from '../server/sim/content/support/index.js';
import { bondBb as addonBb, procChance } from '../server/sim/content/bonds/addon/battle.js';
import { bondBb as coreBb } from '../server/sim/content/bonds/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (p) => readFileSync(join(ROOT, p), 'utf8');
const D = getData({ log: { warn() {}, error() {}, info() {} } });

/** A response recorder standing in for http.ServerResponse. */
function res() {
  const r = { status: 0, headers: null, body: '', ended: false };
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers; };
  r.end = (b) => { r.body = b ? b.toString('utf8') : ''; r.ended = true; };
  r.json = () => JSON.parse(r.body);
  return r;
}
const req = (remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, method: 'GET' });

/** A stub player that records acquireChess calls, with an optional refusal at call n. */
function stubPlayer(playerId, { refuseAt = Infinity, funds = 0 } = {}) {
  const p = {
    playerId, seat: 0, isBot: false, isHumanActive: true, connected: true, left: false,
    funds, calls: [], dirtied: 0, fundCalls: [],
    acquireChess(id, opts) { p.calls.push({ id, opts }); return p.calls.length >= refuseAt ? null : { id }; },
    // mirrors PlayerState.addFunds (server/match/player/economy.js): clamps at 0, counts gains, dirties
    addFunds(n, { reason = '' } = {}) {
      p.fundCalls.push({ n, reason });
      if (!Number.isFinite(n) || n === 0) return 0;
      const v = Math.trunc(n);
      const before = p.funds;
      p.funds = Math.max(0, p.funds + v);
      p.dirtied++;
      return p.funds - before;
    },
    dirty() { p.dirtied++; },
  };
  return p;
}
/** A stub match holding one human; `phase` decides whether the gate lets a grant through. */
function stubMatch({ phase = PHASE.PREP, player = stubPlayer('p1'), roomCode = 'ABCD', round = 3 } = {}) {
  const m = {
    roomCode, modeId: 'mode_multi_normal', phase, round, matchNo: 1, ds: D, data: D,
    players: new Map([[player.playerId, player]]),
    order: [player], flushed: 0,
    flush() { m.flushed++; },
  };
  return m;
}
const lobbyOf = (...matches) => ({ rooms: new Map(matches.map((m, i) => [`R${i}`, { code: m.roomCode, match: m }])) });

describe('dev grant channel', () => {
  test('SP_DEV_GRANT: only an explicit yes registers the route', () => {
    for (const v of ['1', 'true', 'YES', 'on', 'always', ' 1 ']) assert.equal(parseDevGrant(v), true, v);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe']) assert.equal(parseDevGrant(v), false, String(v));
    assert.equal(DEV_GRANT_PATH, '/dev/grant');
    // the route is wired in the 0.2.0 request listener, and only when startServer() built a handler for it
    assert.match(doc('server/http/routes.js'), /if \(devGrant && parts\.rawPath === DEV_GRANT_PATH\)/);
    assert.match(doc('server/index.js'), /parseDevGrant\(process\.env\.SP_DEV_GRANT\) \? createDevGrantHandler/);
  });

  test('loopback only: a LAN or internet peer is refused before anything else', () => {
    const m = stubMatch();
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    for (const addr of ['192.168.1.9', '100.64.0.2', '240e:47f:9240:abd0::1', '::ffff:10.0.0.1']) {
      const r = res();
      h(req(addr), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 403, addr);
      assert.match(r.json().error, /loopback only/);
    }
    assert.equal(m.order[0].calls.length, 0, 'nothing was granted');
    // and the loopback forms do get through
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const r = res();
      h(req(addr), r, '');
      assert.equal(r.status, 200, addr);
    }
  });

  test('discovery: no chess= lists the running matches and their players', () => {
    const m = stubMatch({ roomCode: 'WXYZ', phase: PHASE.COMBAT, round: 7 });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    const r = res();
    h(req(), r, '');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.match(j.usage, /^\/dev\/grant\?chess=/);
    assert.match(j.usage, /diy=<charId>/, 'the usage names the 任意发牌 parameters');
    assert.match(j.usage, /bond=<bondId>/, 'and the 设置盟约层数 ones');
    assert.match(j.usage, /layers=<0…999>/, 'with the cap spelled out');
    assert.equal(j.matches.length, 1);
    assert.equal(j.matches[0].roomCode, 'WXYZ');
    assert.equal(j.matches[0].phase, PHASE.COMBAT);
    // each player carries its 自选 picks and stock (read-only, for diagnosis; {} without any — a stub here)
    assert.deepEqual(j.matches[0].players, [{ playerId: 'p1', seat: 0, isBot: false, connected: true, left: false, picks: {}, diyStock: {}, bonds: {} }]);
    assert.deepEqual(j.matches[0].diySlots, ['chess_char_5_diy1_a', 'chess_char_5_diy2_a', 'chess_char_6_diy1_a', 'chess_char_6_diy2_a']);
  });

  test('a grant lands through acquireChess, with pool/door options and an immediate flush', () => {
    const player = stubPlayer('p1');
    const m = stubMatch({ player, roomCode: 'ABCD' });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    const r = res();
    h(req(), r, 'chess=chess_char_1_09_a,chess_char_5_02_a&count=2');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.playerId, 'p1');
    assert.equal(j.round, 3);
    assert.deepEqual(j.granted, [
      { id: 'chess_char_1_09_a', count: 2, name: '跃跃' },
      { id: 'chess_char_5_02_a', count: 2, name: '缇缇' },
    ]);
    assert.deepEqual(j.failed, []);
    // the same door as a buy: fromPool default true, source marked dev, toTemp off
    assert.deepEqual(player.calls.map((c) => c.id), ['chess_char_1_09_a', 'chess_char_1_09_a', 'chess_char_5_02_a', 'chess_char_5_02_a']);
    for (const c of player.calls) assert.deepEqual(c.opts, { source: 'dev', toTemp: false, fromPool: true });
    assert.equal(player.dirtied, 1, 'the client is told');
    assert.equal(m.flushed, 1, 'combat otherwise flushes only once a second');
  });

  test('the phase gate refuses during a battle and names the phase', () => {
    for (const phase of [PHASE.COMBAT, PHASE.UNITE, PHASE.RESULT, PHASE.SP_DRAFT]) {
      const player = stubPlayer('p1');
      const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ player, phase })) });
      const r = res();
      h(req(), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 409, phase);
      assert.equal(r.json().phase, phase);
      assert.equal(player.calls.length, 0, `${phase}: nothing granted`);
    }
    for (const phase of [PHASE.PREP, PHASE.SETTLE]) {
      const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ phase })) });
      const r = res();
      h(req(), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 200, phase);
    }
  });

  test('unknown ids, a full hand and a missing match are reported instead of throwing', () => {
    const player = stubPlayer('p1', { refuseAt: 2 }); // the second copy is refused
    const m = stubMatch({ player });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    const r1 = res();
    h(req(), r1, 'chess=not_a_chess');
    assert.equal(r1.status, 409);
    assert.deepEqual(r1.json().failed, [{ id: 'not_a_chess', error: 'unknown chess id' }]);

    const r2 = res();
    h(req(), r2, 'chess=chess_char_1_09_a&count=3');
    assert.deepEqual(r2.json().granted, [{ id: 'chess_char_1_09_a', count: 1, name: '跃跃' }]);
    assert.equal(r2.json().failed[0].error, 'stopped after 1');

    const empty = createDevGrantHandler({ log: {}, lobby: { rooms: new Map() } });
    const r3 = res();
    empty(req(), r3, 'chess=chess_char_1_09_a');
    assert.equal(r3.status, 404);
    assert.match(r3.json().detail, /先开一局/);

    // several rooms without room= is ambiguous, with room= it resolves
    const a = stubMatch({ roomCode: 'AAAA' }), b = stubMatch({ roomCode: 'BBBB' });
    const two = createDevGrantHandler({ log: {}, lobby: lobbyOf(a, b) });
    const r4 = res();
    two(req(), r4, 'chess=chess_char_1_09_a');
    assert.equal(r4.status, 404);
    assert.match(r4.json().detail, /ambiguous|room=|带上 room/);
    const r5 = res();
    two(req(), r5, 'chess=chess_char_1_09_a&room=bbbb');
    assert.equal(r5.status, 200, 'room codes are case-insensitive');
    assert.equal(r5.json().roomCode, 'BBBB');
  });

  test('a player id that is not in the match, and several humans without player=', () => {
    const p1 = stubPlayer('p1'), p2 = stubPlayer('p2');
    const m = stubMatch({ player: p1 });
    m.players.set('p2', p2); m.order.push(p2);
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    const r1 = res();
    h(req(), r1, 'chess=chess_char_1_09_a');
    assert.equal(r1.status, 404);
    assert.match(r1.json().detail, /p1, p2/);

    const r2 = res();
    h(req(), r2, 'chess=chess_char_1_09_a&player=p2');
    assert.equal(r2.status, 200);
    assert.equal(r2.json().playerId, 'p2');
    assert.equal(p2.calls.length, 1, 'the named player got it');
    assert.equal(p1.calls.length, 0, 'and nobody else did');
  });

  test('funds: funds=N sets the exact amount, fundsAdd=N adds, and it goes through addFunds', () => {
    const player = stubPlayer('p1', { funds: 7 });
    const m = stubMatch({ player });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    // exact set, on its own (no chess= — must not fall into discovery mode)
    const r1 = res();
    h(req(), r1, 'funds=99');
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json().funds, { before: 7, after: 99, delta: 92 });
    assert.equal(player.funds, 99);
    assert.deepEqual(player.fundCalls, [{ n: 92, reason: 'dev' }], 'the delta is what is handed to addFunds');
    assert.equal(r1.json().granted.length, 0, 'no chess was touched');
    assert.equal(player.calls.length, 0);

    // relative add — its own parameter, because `+` in a query decodes to a space
    const r2 = res();
    h(req(), r2, 'fundsAdd=50');
    assert.deepEqual(r2.json().funds, { before: 99, after: 149, delta: 50 });

    // setting a lower amount spends down to it
    const r3 = res();
    h(req(), r3, 'funds=10');
    assert.deepEqual(r3.json().funds, { before: 149, after: 10, delta: -139 });

    // `funds=+50` must NOT silently mean "set to 50": the `+` is a space in a query, so it is rejected outright and
    // nothing is written (the earlier shape of this code mutated state here)
    const rPlus = res();
    h(req(), rPlus, 'funds=+50');
    assert.equal(rPlus.status, 409);
    assert.deepEqual(rPlus.json().failed, [{ id: 'funds= 50', error: 'sign or space not allowed (use fundsAdd=N to add)' }]);
    assert.equal(rPlus.json().funds ?? null, null);
    assert.equal(player.funds, 10, 'unchanged by the malformed value');

    // a bad value is reported, not thrown; and it is the only failure
    const r4 = res();
    h(req(), r4, 'funds=abc');
    assert.equal(r4.status, 409);
    assert.deepEqual(r4.json().failed, [{ id: 'funds=abc', error: 'not a whole number' }]);
    assert.equal(r4.json().funds ?? null, null);
    assert.equal(player.funds, 10, 'unchanged');

    // `funds=` takes no sign either — spending down has its own spelling
    const rMinus = res();
    h(req(), rMinus, 'funds=-5');
    assert.equal(rMinus.status, 409);
    assert.deepEqual(rMinus.json().failed, [{ id: 'funds=-5', error: 'funds= takes no sign (use fundsAdd=-N to spend down)' }]);
    assert.equal(player.funds, 10);

    // a negative add is a valid way to spend down
    const rNeg = res();
    h(req(), rNeg, 'fundsAdd=-4');
    assert.deepEqual(rNeg.json().funds, { before: 10, after: 6, delta: -4 });

    // funds and chess in one call
    const r5 = res();
    h(req(), r5, 'funds=99&chess=chess_char_1_09_a');
    assert.equal(r5.status, 200);
    assert.deepEqual(r5.json().funds, { before: 6, after: 99, delta: 93 });
    assert.equal(r5.json().granted[0].name, '跃跃');
    assert.equal(player.funds, 99);
  });

  test('funds does not bypass the phase gate', () => {
    const player = stubPlayer('p1', { funds: 5 });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ player, phase: PHASE.COMBAT })) });
    const r = res();
    h(req(), r, 'funds=99');
    assert.equal(r.status, 409);
    assert.equal(player.funds, 5, 'nothing changed during a battle');
  });

  test('the two operators the owner asked for resolve to the expected records', () => {
    // guards the ids quoted to the owner: a rename upstream should fail here, not silently grant the wrong chess
    const yue = getChess('chess_char_1_09_a', D), titi = getChess('chess_char_5_02_a', D);
    assert.equal(yue.name, '跃跃');
    assert.equal(yue.tier, 1);
    assert.equal(yue.visible, true);
    assert.equal(titi.name, '缇缇');
    assert.equal(titi.tier, 5);
    assert.equal(titi.visible, true);
    assert.deepEqual(titi.garrisonIds, ['garrison_125_a'], '缇缇 carries the trait §23.40 changed');
    assert.equal(getChess('nope', D), null, 'an unknown id resolves to null, not a throw');
  });

  test('diy= on its own is an action (not discovery), and a player state without picks says so', () => {
    const player = stubPlayer('p1');
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ player })) });
    const r = res();
    h(req(), r, 'diy=char_4182_oblvns');
    assert.equal(r.status, 400, 'not 200 discovery: diy= alone acts');
    assert.equal(r.json().error, 'diy');
    assert.match(r.json().detail, /no 自选 support/);
    assert.equal(player.calls.length, 0, 'nothing was granted');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 任意发牌: `diy=<charId>` — a forced 自选 pick (docs/DEV-GRANT.md §任意发牌)
//
// These cases need a real match: the pick, the slot's composed records and its stock live in PlayerState
// (server/match/player/diy.js forceDiyPick), and whether the piece is playable at all is the simulation's own verdict
// (shared/diy.js checkDiyPick, re-run by simdata getDiy — the call server/sim/battle/players.js makes).
// ---------------------------------------------------------------------------------------------------------------

/** The generated data set (data/*.json): a real match, the record composition and the sim all read it. */
const REAL = { skip: !hasGeneratedData() };
const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy2_a';
const T6A = 'chess_char_6_diy1_a';
const T6B = 'chess_char_6_diy2_a';
const SLOTS = [T5A, T5B, T6A, T6B];
const SIEGE = 'char_112_siege'; // 推进之王 — an owned 6★ (a legal pick of both tiers)
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const OBV = 'char_4182_oblvns'; // 丰川祥子 — an owned 6★ with a kit (S1/S2/S3, module uniequip_002_oblvns)
const RESERVE = 'char_601_cguard'; // 预备干员-近卫 — a tier-5 prototype, NOT in diy.ownedPool (generic kit)
const NOBODY = 'char_600_cpione'; // a unit form the DIY data does not list at any tier (diy.operators lacks it)

/** A real match in PREP R1 (fake battles keep round transitions cheap; the pick / sim cases read the real data). */
function realMatch(seats = null) {
  const h = makeMatch({
    mode: 'solo',
    seats: seats || [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
    seed: 11, fake: true,
  }).start();
  h.toPrep(1);
  return h;
}
const handlerFor = (m) => createDevGrantHandler({ log: {}, lobby: { rooms: new Map([['R0', { code: m.roomCode, match: m }]]) } });
const handIds = (ps) => ps.hand.filter(Boolean).map((p) => p.id);

describe('任意发牌: forcing a 自选 pick (diy=)', () => {
  test('a player without picks: the pick goes in, the stock is rebuilt, and the piece IS that operator in the sim', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    assert.deepEqual(ps.diy, {}, 'no picks at the start');
    assert.deepEqual(ps.diyStock.snapshot(), {}, 'and no stock');

    const r = res();
    handlerFor(m)(req(), r, `diy=${OBV}`);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.playerId, 'p_0');
    assert.equal(j.phase, PHASE.PREP);
    assert.deepEqual(j.picksBefore, {}, 'the roster before the force');
    assert.deepEqual(j.picks, { [T6A]: { charId: OBV, skillIndex: 0, uniEquipId: null } }, 'the roster after it');
    assert.deepEqual(j.failed, []);
    assert.deepEqual(j.granted, [{ id: T6A, count: 1, name: '丰川祥子' }], 'the granted piece is named after the operator');
    // resolved: what the slot holds and what it means (the task's required block)
    assert.equal(j.resolved.charId, OBV);
    assert.equal(j.resolved.name, '丰川祥子');
    assert.equal(j.resolved.skillIndex, 0);
    assert.equal(j.resolved.uniEquipId, null);
    assert.equal(j.resolved.tier, 6);
    assert.equal(j.resolved.elite, false);
    assert.equal(j.resolved.slot, T6A);
    assert.equal(j.resolved.chessId, T6A);
    assert.equal(j.resolved.skillId, 'skchr_oblvns_1');
    assert.equal(j.resolved.ownedPool, true);
    assert.equal(j.resolved.pooled, true);
    assert.equal(j.resolved.kitted, true);
    assert.equal(j.resolved.kit, 'operator');
    assert.equal(j.resolved.sim, true);
    assert.equal(j.resolved.check ?? null, null);
    assert.deepEqual(j.stock, { slot: T6A, cap: 5, before: null, left: 4 }, 'the stock was rebuilt (5 at tier 6) and one copy taken');

    // the piece itself: in the hand, one pool copy, and the player's data view makes the slot the operator
    const piece = ps.hand.find(Boolean);
    assert.equal(piece.id, T6A);
    assert.equal(piece.poolCopies, 1);
    assert.deepEqual(ps.diyStock.snapshot(), { [T6A]: 4 });
    const rec = ps.gd.chess(T6A);
    assert.deepEqual([rec.charId, rec.name, rec.skill.skillId, rec.diyFor, rec.tier, rec.price], [OBV, '丰川祥子', 'skchr_oblvns_1', T6A, 6, 4]);
    assert.deepEqual(rec.bonds, ['emptyShip'], 'the pick\'s derived bonds');

    // …and the SIM resolves that same piece to that operator: the exact lookup server/sim/battle/players.js does
    const pick = ps.diyPickOf(T6A);
    assert.deepEqual(pick, { charId: OBV, skillIndex: 0, uniEquipId: null });
    const def = m.ds.getChess(T6A, { diy: pick });
    assert.equal(def.charId, OBV);
    assert.equal(def.skill.id, 'skchr_oblvns_1');
    assert.equal(def.diyFor, T6A);
    assert.deepEqual(def.loadout.diy, pick);
    // the server → sim hand-off (battleInput): a deployed 自选 piece carries its pick, never loadout fields
    const tile = legalTileFor(m, ps, T6A);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
    const u = ps.battleInput().units.find((x) => x.uid === piece.uid);
    assert.deepEqual(u.diy, pick);
    assert.ok(!('skillIndex' in u) && !('moduleId' in u) && !('standIn' in u));
    h.invariants();
    m.dispose();
  });

  test('elite=1 grants the _b form with the chosen skill and module; slot=<elite id> implies elite', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');

    const r = res();
    handlerFor(m)(req(), r, `diy=${OBV}&elite=1&skill=2&module=uniequip_002_oblvns`);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.resolved.elite, true);
    assert.equal(j.resolved.chessId, 'chess_char_6_diy1_b');
    assert.equal(j.resolved.skillIndex, 2);
    assert.equal(j.resolved.uniEquipId, 'uniequip_002_oblvns');
    assert.equal(j.resolved.skillId, 'skchr_oblvns_3');
    assert.deepEqual(j.picks, { [T6A]: { charId: OBV, skillIndex: 2, uniEquipId: 'uniequip_002_oblvns' } });
    assert.deepEqual(j.granted, [{ id: 'chess_char_6_diy1_b', count: 1, name: '丰川祥子' }]);
    assert.deepEqual(j.stock, { slot: T6A, cap: 5, before: null, left: 2 }, 'an elite takes goldenCopies = 3');
    const elite = ps.hand.find(Boolean);
    assert.equal(elite.id, 'chess_char_6_diy1_b');
    assert.equal(elite.poolCopies, 3);
    const rec = ps.gd.chess(elite.id);
    assert.deepEqual([rec.charId, rec.isGolden, rec.skill.skillId], [OBV, true, 'skchr_oblvns_3']);
    assert.deepEqual([rec.module.id, rec.module.active, rec.module.level], ['uniequip_002_oblvns', true, 3]);
    const def = m.ds.getChess(elite.id, { diy: ps.diyPickOf(elite.id) });
    assert.deepEqual([def.charId, def.golden, def.skill.id], [OBV, true, 'skchr_oblvns_3']);

    // the elite id in slot= is the same thing (its `_a` is the slot's base id)
    const r2 = res();
    handlerFor(m)(req(), r2, `diy=${OBV}&slot=chess_char_5_diy1_b`);
    assert.equal(r2.status, 200);
    // the defaults are per slot: that slot held no pick, so the skill is 0 (the pick in the tier-6 slot is another slot's)
    assert.deepEqual(r2.json().picks[T5A], { charId: OBV, skillIndex: 0, uniEquipId: null });
    assert.equal(r2.json().resolved.elite, true);
    assert.equal(r2.json().resolved.chessId, 'chess_char_5_diy1_b');
    assert.deepEqual(r2.json().granted, [{ id: 'chess_char_5_diy1_b', count: 1, name: '丰川祥子' }]);
    h.invariants();
    m.dispose();
  });

  test('a player who picked someone else is overwritten: before and after in the response, the frozen picks untouched', REAL, () => {
    const h = realMatch([{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T6A]: SIEGE_PICK } }]);
    const m = h.m;
    const ps = h.ps('p_0');
    const frozen = ps.diy; // the object the match fixed when it started
    assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen[T6A]));
    assert.equal(ps.gd.chess(T6A).charId, SIEGE);

    const r = res();
    handlerFor(m)(req(), r, `diy=${OBV}&slot=${T6A}`);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.deepEqual(j.picksBefore, { [T6A]: { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' } });
    assert.deepEqual(j.picks, { [T6A]: { charId: OBV, skillIndex: 2, uniEquipId: null } });
    assert.equal(j.resolved.skillIndex, 2, 'the skill is inherited from the pick it replaced (丰川祥子 has S3 too)');
    assert.equal(j.resolved.uniEquipId, null, '推进之王\'s module is not hers: dropped');
    assert.equal(j.resolved.ownedPool, true);
    assert.equal(j.resolved.sim, true);
    assert.ok(j.notes.some((n) => /已被覆盖/.test(n)), 'the overwrite is called out');
    assert.ok(j.notes.some((n) => /技能沿用原来的 pick/.test(n)));
    assert.ok(j.notes.some((n) => /不属于 char_4182_oblvns/.test(n)), 'and so is the dropped module');
    // a NEW frozen object replaced the old one: the old picks are never mutated (setDiy's rule)
    assert.notEqual(ps.diy, frozen);
    assert.equal(frozen[T6A].charId, SIEGE);
    assert.equal(ps.diy[T6A].charId, OBV);
    assert.equal(ps.gd.chess(T6A).charId, OBV);
    assert.equal(ps.gd.chess(T6A).skill.skillId, 'skchr_oblvns_3');
    h.invariants();
    m.dispose();
  });

  test('a match already under way (its picks frozen at the start) still takes it', REAL, () => {
    const h = realMatch([{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T6A]: SIEGE_PICK } }]);
    const m = h.m;
    const ps = h.ps('p_0');
    assert.equal(typeof m.setDiy, 'undefined', 'a running match has no way to change them');
    h.toPrep(2); // a round has been fought: the picks are as frozen as they get
    assert.equal(m.round, 2);
    assert.ok(Object.isFrozen(ps.diy));
    assert.equal(ps.diy[T6A].charId, SIEGE, 'still the seat\'s pick');

    const r = res();
    handlerFor(m)(req(), r, `diy=${OBV}&slot=${T6A}`);
    assert.equal(r.status, 200);
    assert.equal(r.json().picks[T6A].charId, OBV);
    assert.equal(ps.diy[T6A].charId, OBV);
    const piece = ps.allChess().find((p) => p.id === T6A);
    assert.ok(piece, 'the piece is in the hand');
    assert.equal(ps.gd.chess(T6A).charId, OBV);
    // the client is told (m.private carries the picks and the bounded list of slots out of the shop)
    h.m.flush(true);
    assert.deepEqual(h.lastTo('p_0', 'm.private').diy, { [T6A]: { charId: OBV, skillIndex: 2, uniEquipId: null } });
    h.invariants();
    m.dispose();
  });

  test('an operator outside diy.ownedPool: it lands, and the response says what that means', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');

    // 预备干员-近卫: a tier-5 prototype, not an owned 6★ — the auto-slot picks tier 5, where the sim accepts it
    const r = res();
    handlerFor(m)(req(), r, `diy=${RESERVE}`);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.resolved.slot, T5A, 'the tier-5 slot, not the tier-6 default (only tier 5 offers it)');
    assert.equal(j.resolved.tier, 5);
    assert.equal(j.resolved.ownedPool, false);
    assert.equal(j.resolved.pooled, true, 'a legal pick of that tier\'s pool');
    assert.deepEqual(j.resolved.pooledTiers, [5]);
    assert.equal(j.resolved.prototype, true);
    assert.equal(j.resolved.skillIndex, 2, 'a prototype carries its locked S3');
    assert.equal(j.resolved.kitted, true);
    assert.equal(j.resolved.kit, 'generic');
    assert.equal(j.resolved.sim, true, 'the sim fields it');
    assert.equal(j.resolved.name, '预备干员-近卫');
    assert.ok(j.notes.some((n) => /不在 diy\.ownedPool/.test(n)), 'marked honestly');
    assert.ok(j.notes.some((n) => /原型干员/.test(n)), 'and its locked selection is explained');
    const piece = ps.hand.find(Boolean);
    assert.equal(piece.id, T5A);
    assert.equal(ps.gd.chess(T5A).charId, RESERVE);
    const def = m.ds.getChess(T5A, { diy: ps.diyPickOf(T5A) });
    assert.deepEqual([def.charId, def.skill.id], [RESERVE, 'skcom_atk_up[3]']);
    h.invariants();

    // 预备干员-先锋: no 自选 pool lists it at all — the piece exists in the match, the sim refuses it, and the answer says so
    // (tier 5: its unit forms are the tier-5 statuses, a 4★ has no E2 module stage — the data, not the endpoint, says so)
    const r2 = res();
    handlerFor(m)(req(), r2, `diy=${NOBODY}&slot=${T5B}`);
    assert.equal(r2.status, 200);
    const j2 = r2.json();
    assert.equal(j2.resolved.ownedPool, false);
    assert.equal(j2.resolved.pooled, false);
    assert.deepEqual(j2.resolved.pooledTiers, []);
    assert.equal(j2.resolved.sim, false, 'the sim will not field it');
    assert.match(j2.resolved.check, /is not a tier-5 自选 pick/);
    assert.ok(j2.notes.some((n) => /sim 不认这个 pick/.test(n)));
    assert.ok(j2.notes.some((n) => /没有派生盟约/.test(n)));
    assert.deepEqual(j2.granted, [{ id: T5B, count: 1, name: '预备干员-先锋' }], 'the grant still lands');
    assert.equal(ps.gd.chess(T5B).charId, NOBODY, 'the match\'s own view is the operator');
    assert.equal(m.ds.getChess(T5B, { diy: ps.diyPickOf(T5B) }), null, 'the simulation refuses the pick — exactly what the response says');
    h.invariants();
    m.dispose();
  });

  test('count=3 merges into the elite through the same door, and the stock accounting stays balanced', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const r = res();
    handlerFor(m)(req(), r, `diy=${OBV}&count=3`);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.deepEqual(j.granted, [{ id: T6A, count: 3, name: '丰川祥子' }]);
    assert.deepEqual(j.failed, []);
    assert.deepEqual(ps.diyStock.snapshot(), { [T6A]: 2 }, 'three copies bought three stock copies');
    assert.deepEqual(j.stock, { slot: T6A, cap: 5, before: null, left: 2 });
    const elite = ps.hand.find(Boolean);
    assert.equal(elite.id, 'chess_char_6_diy1_b', 'the three copies merged');
    assert.equal(elite.poolCopies, 3);
    assert.equal(ps.gd.chess(elite.id).charId, OBV);
    h.invariants();
    m.dispose();
  });

  test('a request that cannot be applied: a specific reason, nothing written, nothing granted', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    const cases = [
      [`diy=char_nope`, /no unit record for char_nope/],
      [`diy=${OBV}&slot=chess_char_1_09_a`, /not a 自选 slot: chess_char_1_09_a/],
      [`diy=${OBV}&slot=nope`, /not a 自选 slot: nope/],
      [`diy=${OBV}&skill=9`, /no skill 9 for char_4182_oblvns at tier 6/],
      [`diy=${OBV}&skill=abc`, /skill= 只接受 0–9/],
      [`diy=${OBV}&module=uniequip_999_x`, /no module uniequip_999_x/],
      [`diy=${OBV}&module=推进之王`, /module= 只接受 uniEquipId/],
    ];
    for (const [query, re] of cases) {
      const r = res();
      g(req(), r, query);
      assert.equal(r.status, 400, query);
      const j = r.json();
      assert.equal(j.ok, false, query);
      assert.equal(j.error, 'diy', query);
      assert.match(j.detail, re, query);
      assert.deepEqual(j.picks, {}, `${query}: the roster is untouched`);
      assert.deepEqual(j.notes, [], query);
      assert.equal(j.granted, undefined, `${query}: nothing granted`);
      assert.deepEqual(ps.diy, {}, query);
      assert.deepEqual(handIds(ps), [], query);
      assert.deepEqual(ps.diyStock.snapshot(), {}, query);
    }
    // a bad slot says which ones exist
    const r = res();
    g(req(), r, `diy=${OBV}&slot=nope`);
    assert.deepEqual(r.json().diySlots, SLOTS);
    assert.deepEqual(r.json().requested, { charId: OBV, skill: null, module: null, elite: false, slot: 'nope' });
    h.invariants();
    m.dispose();
  });

  test('diy= bypasses none of the four gates', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    // loopback only
    const r1 = res();
    g(req('192.168.1.9'), r1, `diy=${OBV}`);
    assert.equal(r1.status, 403);
    assert.match(r1.json().error, /loopback only/);
    // a battle is running (a real battle would take a round to reach; the gate only reads m.phase)
    m.phase = PHASE.COMBAT;
    const r2 = res();
    g(req(), r2, `diy=${OBV}`);
    assert.equal(r2.status, 409);
    assert.equal(r2.json().error, 'phase');
    assert.equal(r2.json().phase, PHASE.COMBAT);
    m.phase = PHASE.PREP;
    // several rooms without room= (the trap this endpoint has already bitten on)
    const two = createDevGrantHandler({ log: {}, lobby: { rooms: new Map([['R0', { code: m.roomCode, match: m }], ['R1', { code: 'OTHER', match: m }]]) } });
    const r3 = res();
    two(req(), r3, `diy=${OBV}`);
    assert.equal(r3.status, 404);
    assert.match(r3.json().detail, /ambiguous|room=/);
    const r4 = res();
    two(req(), r4, `diy=${OBV}&room=${m.roomCode}`);
    assert.equal(r4.status, 200);
    assert.deepEqual(ps.diy, { [T6A]: { charId: OBV, skillIndex: 0, uniEquipId: null } }, 'only the last call wrote anything');
    assert.deepEqual(handIds(ps), [T6A]);
    h.invariants();
    m.dispose();
  });

  test('discovery lists what each player slotted (read-only) — the picks a force would replace', REAL, () => {
    const h = realMatch([{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T6A]: SIEGE_PICK } }]);
    const m = h.m;
    const r = res();
    handlerFor(m)(req(), r, '');
    assert.equal(r.status, 200);
    const match = r.json().matches[0];
    assert.deepEqual(match.diySlots, SLOTS);
    const p = match.players.find((x) => x.playerId === 'p_0');
    assert.deepEqual(p.picks, { [T6A]: { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' } });
    assert.deepEqual(p.diyStock, { [T6A]: 5 }, 'its own copies (5 at tier 6)');
    m.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 设置盟约层数: `bond=<bondId>[,<bondId>…]&layers=<N>` (docs/DEV-GRANT.md §设置盟约层数)
//
// The persistent count is `ps.layers[bondId]` (what every later battle's input is built from: PlayerState.battleInput →
// bondSnapshot); `ps.bonds[bondId].layers` is the computed view the client's strip shows. An increase goes through the
// engine's own prep-side door (PlayerState.addLayers — layerGainRoom clamps at BOND_LAYER_CAP, onLayers fires);
// a decrease has no engine API and is a direct persistent write + recompute. `m.fields` battles — the copies
// Battle.addLayers writes — are updated too, and the battle's own `layerGains` stays a delta (a settlement adds it on
// top of whatever the live copy holds, never twice).
// ---------------------------------------------------------------------------------------------------------------

/** A match whose battles are the REAL simulation (m.newBattle → Battle), so an effect can be read off the battle. */
function simMatch() {
  const h = makeMatch({
    mode: 'solo',
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
    seed: 11,
  }).start();
  h.toPrep(1);
  return h;
}
/** The battle this match builds for the player right now, the way startCombat does (`_normalOpts` → battleInput). */
const battleOf = (m, ps) => { const b = m.newBattle(m._normalOpts(ps)); b.start(); return b; };
/** Put a chess on the board at a legal tile (test/match/harness.js give; takes pool copies like a buy). */
function deploy(m, ps, chessId) {
  const piece = give(m, ps, chessId, 'board', legalTileFor(m, ps, chessId));
  ps.recompute();
  return piece;
}

describe('设置盟约层数: bond= / layers= (set, not add)', () => {
  test('sets the persistent layers of several bonds at once, creates the records, and the client views carry them', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    assert.deepEqual(ps.layers, {}, 'no layers at the start');
    assert.deepEqual([ps.bonds.swiftShip.layers, ps.bonds.sargonShip.layers], [0, 0], 'the bonds are known, at 0 layers');

    const r = res();
    handlerFor(m)(req(), r, 'bond=swiftShip,sargonShip&layers=500');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.roomCode, m.roomCode);
    assert.equal(j.playerId, 'p_0');
    assert.equal(j.phase, PHASE.PREP);
    assert.equal(j.round, 1);
    assert.deepEqual(j.bonds, [
      { bondId: 'swiftShip', name: '迅捷', before: 0, after: 500, active: false, created: true },
      { bondId: 'sargonShip', name: '萨尔贡', before: 0, after: 500, active: false, created: true },
    ]);
    assert.deepEqual(j.granted, [], 'nothing was granted');
    assert.deepEqual(j.failed, []);
    assert.ok(j.notes.some((n) => /此前在该玩家身上没有任何记录/.test(n)), 'the created records are called out');
    assert.ok(j.notes.some((n) => /未激活/.test(n)), 'and so is the fact that layers do not activate a bond');
    assert.ok(j.notes.some((n) => /当前没有握着战场/.test(n)));

    // the persistent value every later battle is built from, and the computed view the strip shows
    assert.deepEqual([ps.layers.swiftShip, ps.layers.sargonShip], [500, 500]);
    assert.deepEqual([ps.bonds.swiftShip.layers, ps.bonds.sargonShip.layers], [500, 500]);
    // …and it is in the views the client gets on its next refresh (bondList lists `layers > 0`), no new message type
    for (const list of [ps.privateView().bonds, m.publicView().players[0].bonds]) {
      assert.equal(list.find((b) => b.bondId === 'swiftShip').layers, 500, 'the client sees 500');
      assert.equal(list.find((b) => b.bondId === 'sargonShip').layers, 500);
    }
    h.m.flush(true);
    assert.equal(h.lastTo('p_0', 'm.private').bonds.find((b) => b.bondId === 'swiftShip').layers, 500, 'flushed at once');
    h.invariants();
    m.dispose();
  });

  test('it is a SET: lowering works (direct persistent write), 0 clears, the same value is a no-op, and gains still clamp', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    const set = (q) => { const r = res(); g(req(), r, q); return r; };

    assert.equal(set('bond=yanShip&layers=500').status, 200);
    const down = set('bond=yanShip&layers=200');
    assert.deepEqual(down.json().bonds, [{ bondId: 'yanShip', name: '炎', before: 500, after: 200, active: false, created: false }]);
    assert.equal(ps.layers.yanShip, 200, 'a decrease is written straight into the persistent value');
    assert.ok(down.json().notes.some((n) => /层数下调 500 → 200/.test(n)));
    assert.equal(set('bond=yanShip&layers=200').status, 200, 'setting the value it already has is not an error');
    assert.equal(ps.layers.yanShip, 200);
    const zero = set('bond=yanShip&layers=0');
    assert.deepEqual(zero.json().bonds, [{ bondId: 'yanShip', name: '炎', before: 200, after: 0, active: false, created: false }]);
    assert.deepEqual(ps.layers.yanShip, 0, 'layers=0 is a legal operation: it clears the count');
    assert.ok(zero.json().notes.some((n) => /0 层 = 清空/.test(n)));

    // the cap is not bypassed: 999 is the highest settable value, and a gain at the cap adds nothing (the engine's rule)
    assert.equal(set(`bond=yanShip&layers=${BOND_LAYER_CAP}`).status, 200);
    assert.equal(ps.layers.yanShip, BOND_LAYER_CAP);
    assert.equal(ps.addLayers('yanShip', 40, { reason: 'test' }), 0, 'at the cap the engine adds nothing');
    assert.equal(ps.layers.yanShip, BOND_LAYER_CAP);
    h.invariants();
    m.dispose();
  });

  test('the next battle is built from the new layers, and they survive a round transition', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const r = res();
    handlerFor(m)(req(), r, 'bond=swiftShip&layers=500');
    assert.equal(r.status, 200);
    // the input the match hands to the simulation (battleInput → bondSnapshot): 500, in this prep
    assert.equal(ps.battleInput().bonds.swiftShip.layers, 500, 'the very next battle starts from 500');
    assert.equal(ps.battleInput().bonds.swiftShip.active, false, 'layers do not activate the bond (members do)');
    h.toPrep(2); // a whole round (its battle, the settlement, the next prep)
    assert.equal(ps.layers.swiftShip, 500, 'the persistent value is kept across rounds');
    assert.equal(ps.bonds.swiftShip.layers, 500);
    assert.equal(ps.battleInput().bonds.swiftShip.layers, 500, 'and the next battle still starts from it');
    h.invariants();
    m.dispose();
  });

  test('a battle the match still holds gets its live copy synced; its own layerGains stay a delta', REAL, () => {
    const h = simMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const b = battleOf(m, ps);
    assert.equal(bondLayers(b, 'p_0', 'swiftShip'), 0, 'the live copy starts at 0');
    m.fields = [{ fieldId: 'n:p_0', kind: 'normal', players: ['p_0'], battle: b, live: true }];
    m.phase = PHASE.SETTLE; // the window the phase gate allows in which a battle object can still be held

    const r = res();
    handlerFor(m)(req(), r, 'bond=swiftShip&layers=321');
    assert.equal(r.status, 200);
    assert.equal(b.getPlayer('p_0').bonds.swiftShip.layers, 321, 'Battle.getPlayer — the copy Battle.addLayers writes');
    assert.equal(ps.layers.swiftShip, 321, 'and the persistent value');
    assert.ok(r.json().notes.some((n) => /实时层数副本已同步（1 个战场/.test(n)));
    assert.deepEqual(b.result().perPlayer.p_0.layerGains, {}, 'the gains the battle accrues stay a delta — never a copy of 321');
    assert.equal(b.addLayers('p_0', 'swiftShip', 4, 'test'), 4, 'a later in-battle gain adds on top of the live copy');
    assert.equal(b.getPlayer('p_0').bonds.swiftShip.layers, 325);
    assert.deepEqual(b.result().perPlayer.p_0.layerGains, { swiftShip: 4 });
    m.phase = PHASE.PREP;
    m.fields = [];
    h.invariants();
    m.dispose();
  });

  test('layers= is validated before anything is written: unknown ids, out of range, non-numeric, missing partner', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    const bad = (query, re, check = null) => {
      const r = res();
      g(req(), r, query);
      assert.equal(r.status, 400, query);
      const j = r.json();
      assert.equal(j.ok, false, query);
      assert.equal(j.error, 'bond', query);
      assert.match(j.detail, re, query);
      assert.deepEqual(j.notes, [], query);
      assert.equal(j.bonds, undefined, query);
      assert.deepEqual(ps.layers, {}, `${query}: nothing was written`);
      assert.deepEqual(handIds(ps), [], `${query}: nothing was granted`);
      if (check) check(j);
    };
    bad('bond=nopeShip&layers=5', /未知盟约 id：nopeShip/, (j) => {
      assert.deepEqual(j.unknown, ['nopeShip']);
      assert.ok(j.available.includes('swiftShip') && j.available.includes('sargonShip'), 'the answer lists the ids that exist');
      assert.equal(j.available.length, getData().bonds ? Object.keys(getData().bonds).length : j.available.length);
      assert.deepEqual(j.requested, { bond: 'nopeShip', layers: '5' });
    });
    bad('bond=swiftShip,sargonShip_typo&layers=5', /未知盟约 id：sargonShip_typo/, (j) => {
      assert.deepEqual(j.unknown, ['sargonShip_typo'], 'every id is checked before any is written');
    });
    bad(`bond=swiftShip&layers=${BOND_LAYER_CAP + 1}`, /超出上限：1000 > 999/);
    bad('bond=swiftShip&layers=99999999999999999999', /超出上限/);
    bad('bond=swiftShip&layers=-1', /只接受 0–999 的整数：-1/);
    bad('bond=swiftShip&layers=1.5', /只接受 0–999 的整数：1\.5/);
    bad('bond=swiftShip&layers=abc', /只接受 0–999 的整数：abc/);
    bad('bond=swiftShip&layers=', /layers= 要给出层数/);
    bad('bond=swiftShip', /layers= 要给出层数/);
    bad('layers=5', /bond= 要给出至少一个盟约 id/);
    // a bad bond= does not half-apply the rest of the request either (the diy= rule)
    const fundsBefore = ps.funds;
    const r = res();
    g(req(), r, 'bond=swiftShip&layers=1000&chess=chess_char_1_09_a&funds=99');
    assert.equal(r.status, 400);
    assert.deepEqual(handIds(ps), [], 'no chess was granted');
    assert.equal(ps.funds, fundsBefore, 'and no funds were set');
    h.invariants();
    m.dispose();
  });

  test('bond= bypasses none of the four gates (loopback / phase / room / player)', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    const query = 'bond=swiftShip&layers=500';
    // loopback only
    const r1 = res();
    g(req('192.168.1.9'), r1, query);
    assert.equal(r1.status, 403);
    assert.match(r1.json().error, /loopback only/);
    assert.deepEqual(ps.layers, {});
    // a battle is running: still 409, the persistent value is NOT set behind the client's back
    m.phase = PHASE.COMBAT;
    const r2 = res();
    g(req(), r2, query);
    assert.equal(r2.status, 409);
    assert.equal(r2.json().error, 'phase');
    assert.equal(r2.json().phase, PHASE.COMBAT);
    assert.deepEqual(ps.layers, {}, 'nothing written during a battle');
    m.phase = PHASE.PREP;
    // several rooms without room= is ambiguous; with room= it resolves (case-insensitive)
    const two = createDevGrantHandler({ log: {}, lobby: { rooms: new Map([['R0', { code: m.roomCode, match: m }], ['R1', { code: 'OTHER', match: m }]]) } });
    const r3 = res();
    two(req(), r3, query);
    assert.equal(r3.status, 404);
    assert.match(r3.json().detail, /ambiguous|带上 room=/);
    assert.deepEqual(ps.layers, {});
    const r4 = res();
    two(req(), r4, `${query}&room=${m.roomCode.toLowerCase()}`);
    assert.equal(r4.status, 200);
    assert.equal(ps.layers.swiftShip, 500);
    // no match at all
    const empty = createDevGrantHandler({ log: {}, lobby: { rooms: new Map() } });
    const r5 = res();
    empty(req(), r5, query);
    assert.equal(r5.status, 404);
    assert.match(r5.json().detail, /先开一局/);
    // a player id that is not in the match
    const r6 = res();
    g(req(), r6, `${query}&player=p_nope`);
    assert.equal(r6.status, 404);
    assert.equal(r6.json().error, 'player not found or ambiguous');
    assert.equal(ps.layers.swiftShip, 500, 'unchanged');
    h.invariants();
    m.dispose();
  });

  test('discovery lists each player\'s layers (read-only) and the usage names bond= / layers=', REAL, () => {
    const h = realMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const g = handlerFor(m);
    const set = res();
    g(req(), set, 'bond=swiftShip,sargonShip&layers=500');
    assert.equal(set.status, 200);
    const r = res();
    g(req(), r, '');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.match(j.usage, /\[&bond=<bondId>\[,<bondId>…\]&layers=<0…999>\]$/);
    const p = j.matches[0].players.find((x) => x.playerId === 'p_0');
    assert.deepEqual(p.bonds, {
      swiftShip: { layers: 500, count: 0, active: false },
      sargonShip: { layers: 500, count: 0, active: false },
    });
    // a bond with nothing to show is not listed; a member on the board brings its count
    deploy(m, ps, 'chess_char_1_01_a'); // 隐现: lateranoShip + swiftShip
    const r2 = res();
    g(req(), r2, '');
    const p2 = r2.json().matches[0].players.find((x) => x.playerId === 'p_0');
    assert.deepEqual(p2.bonds.swiftShip, { layers: 500, count: 1, active: false }, 'count 1 of 2 — not active yet');
    assert.ok(!('yanShip' in p2.bonds), 'a bond with no members, no layers and no tier is not listed');
    h.invariants();
    m.dispose();
  });

  // ---- what "500 layers" MEANS to the simulation: the two bonds the owner named, on a real battle ----------------

  test('迅捷 at 500: the proc chance is 1 (not 0.20), the ≥40-layer part applies, and a skill end really pays +12/+15', REAL, () => {
    const h = simMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const bb = addonBb('swiftShip');
    assert.deepEqual([bb.base_prob, bb.prob_per_stack, bb.power_bond_stack_cnt], [0.2, 0.0035, 40]);
    // 2 distinct 迅捷 members activate it (bonds.json thresholds [2]): 隐现 (SNIPER) and 野鬃 (PIONEER, spCost 40)
    deploy(m, ps, 'chess_char_1_01_a');
    deploy(m, ps, 'chess_char_1_19_a');
    assert.deepEqual([ps.bonds.swiftShip.count, ps.bonds.swiftShip.active], [2, true]);

    const r = res();
    handlerFor(m)(req(), r, 'bond=swiftShip&layers=500');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().bonds, [{ bondId: 'swiftShip', name: '迅捷', before: 0, after: 500, active: true, created: false }]);

    const b = battleOf(m, ps);
    assert.equal(bondLayers(b, 'p_0', 'swiftShip'), 500, 'the battle reads the live copy the endpoint set');
    assert.equal(procChance(bb, bondLayers(b, 'p_0', 'swiftShip')), 1, 'p = min(1, 0.20 + 0.0035·500) = 1 — a certain proc, where 0 layers would be 20 %');
    assert.equal(procChance(bb, 0), 0.2, 'the same formula at 0');
    assert.ok(bondLayers(b, 'p_0', 'swiftShip') >= bb.power_bond_stack_cnt, 'past the 40-layer milestone: the extra roll applies');

    // the bond's own skillEnd handler: p is certain, so the member rolls both (normal_sp) and the ≥40-layer (power_sp)
    const gains = [];
    b.on('spGain', (c) => { if (c.reason === 'bond') gains.push([c.unit.defId, c.amount]); });
    const u = b.allyUnits.find((x) => x.defId === 'chess_char_1_19_a');
    assert.equal(u.skill.spCost, 40, 'the carrier is the one whose bar can hold both gifts');
    const spBefore = u.skill.sp;
    u.skill.activate('test', { free: true });
    u.skill.end('test');
    assert.deepEqual(gains, [['chess_char_1_19_a', bb.normal_sp], ['chess_char_1_19_a', bb.power_sp]], `+${bb.normal_sp} and +${bb.power_sp} SP`);
    assert.equal(u.skill.sp, Math.min(u.skill.spCost, spBefore + bb.normal_sp + bb.power_sp), 'both landed on the bar (capped at its cost)');
    h.invariants();
    m.dispose();
  });

  test('萨尔贡 at 500: the ASPD stack the sim applies lasts base_time + 0.22·500 = 115 s instead of 5 s', REAL, () => {
    const h = simMatch();
    const m = h.m;
    const ps = h.ps('p_0');
    const bb = coreBb('sargonShip');
    assert.deepEqual([bb.base_time, bb.time_per_stack, bb.base_attack_speed], [5, 0.22, 12]);
    // 3 distinct 萨尔贡 members activate it (thresholds [3, 6]) and share the stacks on every member's skill start
    deploy(m, ps, 'chess_char_1_12_a'); // 艾丝黛尔 (the caster)
    deploy(m, ps, 'chess_char_2_08_a'); // 泡泡
    deploy(m, ps, 'chess_char_3_13_a'); // 至简
    assert.deepEqual([ps.bonds.sargonShip.count, ps.bonds.sargonShip.active], [3, true]);
    const stackOf = (b) => {
      b.allyUnits.find((x) => x.defId === 'chess_char_1_12_a').skill.activate('test', { free: true });
      const buf = b.allyUnits.find((x) => x.defId === 'chess_char_2_08_a').findBuff('bond:sargon');
      return buf ? buf.timeLeft : null;
    };

    const before = battleOf(m, ps);
    assert.equal(bondLayers(before, 'p_0', 'sargonShip'), 0);
    assert.equal(stackOf(before), bb.base_time, 'at 0 layers the stack lasts base_time = 5 s');

    const r = res();
    handlerFor(m)(req(), r, 'bond=sargonShip&layers=500');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().bonds, [{ bondId: 'sargonShip', name: '萨尔贡', before: 0, after: 500, active: true, created: false }]);

    const after = battleOf(m, ps);
    assert.equal(bondLayers(after, 'p_0', 'sargonShip'), 500, 'the next battle starts from 500 (battleInput)');
    assert.equal(stackOf(after), bb.base_time + bb.time_per_stack * 500, 'the stack is computed with L = 500 (115 s)');
    assert.equal(after.allyUnits.find((x) => x.defId === 'chess_char_2_08_a').s.aspd, 100 + bb.base_attack_speed, 'and it is a real ASPD stack');
    h.invariants();
    m.dispose();
  });
});
