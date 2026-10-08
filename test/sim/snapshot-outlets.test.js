// test/sim/snapshot-outlets.test.js — the two snapshot outlets of server/sim/battle/events.js `snapshot()`:
//
//   proj  [[id, x, y, kind]] — content-owned COSMETIC projectiles (丰川祥子's notes). The client draws them from this
//         list instead of from an 'atk' event: a note flies on its own (projectiles.js `steer`, see
//         test/sim/projectile-steer.test.js), so there is no attack to hang a visual on and no target view to home on
//         (render/fx/projectiles.js FxSystem.syncNotes draws one sprite per id). Only `visual: 'note'` is published;
//         `kind` is 'note' (her talent's) or 'noteSkill' (a skill's), which picks the client's PROJ entry.
//   fever [[id, pct]] — a gauge a KIT keeps on `unit.mem.gauges.fever` (0..100), forwarded so the client can show it
//         (her Fever: render/units.js FEVER_ICON). Deliberately generic — the engine does not know a kit's gauge name,
//         it only forwards what the kit wrote; `unit.mem` is the kit's own space.
//
// Both are present only when non-empty, so an old client / a replay of a battle without them sees exactly what it saw
// before. The engine-side contract is asserted here with synthetic content (her own kit's use of it is asserted in
// test/content/op_oblvns.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const wall = () => chessRec({ id: 't_wall', stats: { atk: 0, maxHp: 1e6, blockCnt: 0 }, skill: null });

function field(o = {}) {
  return makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'none',
    defs: { chess: { t_wall: wall() }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_wall', row: 10, col: 4 }],
    ...o,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// snap.proj

test('snap.proj: absent with nothing to publish, [id, x, y, kind] for a note, and only the note visual', () => {
  const h = field();
  h.step();
  assert.equal(h.b.snapshot().proj, undefined, 'the field is not in the snapshot at all when empty');
  // a plain arrow is not a content-owned cosmetic: the client still draws it from its own 'atk' event
  const arrow = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'arrow' });
  h.step();
  assert.equal(h.b.snapshot().proj, undefined, 'an arrow is not published');
  // …the note is
  const note = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note' });
  h.step();
  const proj = h.b.snapshot().proj;
  assert.equal(proj.length, 1);
  assert.deepEqual(proj[0].slice(0, 1), [note.id], 'the projectile id is the key the client maintains its sprites by');
  assert.equal(proj[0][3], 'note', 'no data.hitTag ⇒ the talent note');
  assert.equal(arrow.steer, null);
});

test('snap.proj carries the note\'s authoritative position (2 decimals) and its kind from data.hitTag', () => {
  const h = field();
  h.step();
  const a = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note', data: { hitTag: 'talent' } });
  const b = h.b.addProjectile({ from: { x: 6, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note', data: { hitTag: 'skill' } });
  a.x = 7.123456; a.y = 10.987654;
  const proj = h.b.snapshot().proj;
  assert.deepEqual(proj, [[a.id, 7.12, 10.99, 'note'], [b.id, 6, 10, 'noteSkill']],
    'the sim\'s own positions, rounded to 2 decimals; a skill\'s notes are told apart by hitTag');
});

test('snap.proj follows a note that left, and a snapshot does not disturb the flight', () => {
  const h = field();
  h.step();
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note' });
  h.step(5);
  assert.equal(h.b.snapshot().proj[0][1], 5.67, 'it moved (5 × 1/30 s × 4 tiles/s)');
  h.b.projectiles.list.length = 0;
  assert.equal(h.b.snapshot().proj, undefined, 'a landed note is simply absent from the next snapshot');
});

// ---------------------------------------------------------------------------------------------------------------
// snap.fever

test('snap.fever: absent without a kit gauge, forwarded as [[id, pct]] — the engine does not know the gauge', () => {
  const h = field();
  const u = h.unit('t_wall');
  h.step();
  assert.equal(h.b.snapshot().fever, undefined, 'no kit wrote a gauge');
  u.mem.gauges = { fever: 42 };
  assert.deepEqual(h.b.snapshot().fever, [[u.id, 42]], 'a gauge a kit keeps on mem.gauges.fever is forwarded');
  // the engine only FORWARDS: it rounds and clamps, it does not invent or scale a value (the kit\'s raw 0–450 stays
  // the kit\'s business — her kit writes the 0–100 share it wants shown)
  u.mem.gauges.fever = 99.6;
  assert.deepEqual(h.b.snapshot().fever[0], [u.id, 100]);
  u.mem.gauges.fever = -5;
  assert.deepEqual(h.b.snapshot().fever[0], [u.id, 0]);
  u.mem.gauges.fever = NaN;
  assert.equal(h.b.snapshot().fever, undefined, 'a non-finite gauge is not published');
  delete u.mem.gauges.fever;
  assert.equal(h.b.snapshot().fever, undefined);
});

test('snap.fever: one entry per LIVE visible unit — a gauge of an undeployed or dead unit is not sent', () => {
  const h = field();
  const u = h.unit('t_wall');
  h.step();
  u.mem.gauges = { fever: 10 };
  assert.equal(h.b.snapshot().fever.length, 1);
  h.b.kill(u);                                   // knocked out: its badge must not be drawn any more
  assert.equal(h.b.snapshot().fever, undefined);
});

test('snap.fever: a gauge of an ENEMY is forwarded too — the outlet is generic, not operator-specific', () => {
  const h = field();
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.unit('t_wall').mem.gauges = { fever: 30 };
  e.mem.gauges = { fever: 70 };
  assert.deepEqual(h.b.snapshot().fever, [[h.unit('t_wall').id, 30], [e.id, 70]]);
});
