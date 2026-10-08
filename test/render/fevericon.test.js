// test/render/fevericon.test.js — the Ave Mujica FEVER badge (official note: 「Fever 值以图标显示于在场 Ave Mujica
// 成员模型右下，其中的玫红色填充反映累积进度，蓄满时出现光效提示」 + 「Fever 状态期间…技力消耗条变为玫红色」):
//   * render/interp.js: a snapshot's `fever` list ([[id, pct], …], 0..100) is validated with the rest of the payload
//     (junk dropped, pct clamped) and sample() hands each unit its own value, null without an entry
//   * render/units.js FEVER_ICON / UnitView._updateFeverIcon: the badge is an INNER RING ONLY — a rose track and the
//     arc filling it with pct % (style.js FEVER_ROSE) — pinned to the model's bottom-right corner, outside the
//     HP / SP bars and the status-icon row. No disc behind it and no outer circle over it (owner, 2026-10-08:
//     「fever 状态条不要外面的大圈，只保留里面的小圈就行」): the dark `downDisc` plate and the full-circle step of the
//     arc atlas are both gone. 蓄满 (100 %) and the Fever state still read apart from plain charging — the arc lights up
//     (higher alpha) and the halo breathes at 蓄满, the arc AND the track take FEVER_ROSE_HI and the halo breathes
//     harder while Fever is ON, and the unit's SP bar turns the same rose until Fever ends. There is NO threshold tick
//     (the trigger is 蓄满, not 50 %).
//   * nothing is drawn without the field (an older server / a recording), in prep, or on a dead unit
// The whole client path is also run for real: her sim gauge (b.snap `fever`, written by the kit's `mem.gauges.fever`)
// pushed through render/interp.js exactly as render/app.js does, into a UnitView.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { FEVER_ROSE, FEVER_ROSE_HI, FEVER_ROSE_DIM, COLORS } from '../../public/js/render/style.js';

let fake, UnitView, FEVER_ICON, ringArc, hudRings;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, FEVER_ICON } = await import('../../public/js/render/units.js'));
  ({ ringArc, hudRings } = await import('../../public/js/render/textures.js'));
});
after(() => fake.restore());

const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const SAKIKO = 'char_4182_oblvns';             // her charId (the 自选 slot's pick)
const SLOT = 'chess_char_6_diy1_a';            // the tier-6 自选 slot she is fielded in (0.2.0's DIY model)
const PICK = { charId: SAKIKO, skillIndex: 0, uniEquipId: null };

/** A battle-side UnitView of 祥子 (its HUD is what these tests look at). */
function view({ quality = 'high', info = {} } = {}) {
  const ctx = fakeViewCtx(fake.P, { cam, settings: { damageNumbers: true, quality } });
  return new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: SLOT, diy: { ...PICK }, tier: 6, x: 5, y: 12, maxHp: 3000, ...info });
}

/** A snapshot sample as render/interp.js sample() hands it over (only the HUD's fields matter here). */
const sample = (o = {}) => ({ id: 1, x: 5, y: 12, hp: 3000, maxHp: 3000, sp: 10, spMax: 20, flags: 0, anim: 0, vx: 0, vy: 0, el: null, elFill: 0, elUntil: 0, elDur: 0, fever: null, ...o });
const draw = (v, s, t = 0) => { v.sync(s, t); v.update(1 / 60, cam(), t); return v._feverIcon; };
/** The arc frame index a fraction is rounded to (0 = no ring drawn … the last = a full circle). */
const arcIndex = (tex) => hudRings().arcs.indexOf(tex);

describe('interp: the snapshot `fever` list', () => {
  test('normalizeSnapshot keeps well-formed entries, clamps pct, drops junk; no list is null', () => {
    const s = normalizeSnapshot({ t: 1, units: [[7, 2, 3, 100, 100, 0, 10, 0, 0]], fever: [[7, 37], [8, 120], [9, -5], [10, 'x'], [11], 'x', [7.5, 0], null] });
    assert.deepEqual([...s.fever], [[7, 37], [8, 100], [9, 0], [7.5, 0]]);
    assert.equal(normalizeSnapshot({ t: 1, units: [] }).fever, null, 'no fever list at all');
    assert.equal(normalizeSnapshot({ t: 1, units: [], fever: 'x' }).fever, null);
    assert.equal(normalizeSnapshot({ t: 1, units: [], fever: [[1, NaN]] }).fever, null);
  });

  test('sample() hands each unit its own gauge from the older snapshot (null: no gauge)', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    b.push({ t: 1.0, units: [[1, 2, 3, 100, 100, 0, 10, 0, 0], [2, 4, 3, 100, 100, 0, 10, 0, 0]], fever: [[1, 30]] }, 0);
    b.push({ t: 1.1, units: [[1, 2, 3, 100, 100, 0, 10, 0, 0], [2, 4, 3, 100, 100, 0, 10, 0, 0]], fever: [[1, 60], [2, 10]] }, 0.05);
    const out = new Map();
    b.sample(1.0, out);
    assert.equal(out.get(1).fever, 30, 'the gauge of the snapshot shown');
    assert.equal(out.get(2).fever, null, 'a unit without an entry has none');
    const mid = b.sample(1.05, out);
    assert.equal(mid.get(1).fever, 30, 'flags come from the older snapshot: so does the gauge');
    b.sample(1.1, out);
    assert.equal(out.get(1).fever, 60);
    assert.equal(out.get(2).fever, 10);
    // a feed without the field (older server / recording) leaves every unit without a gauge
    const c = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    c.push({ t: 2, units: [[1, 2, 3, 100, 100, 0, 10, 0, 0]] }, 0);
    const o2 = new Map();
    c.sample(2, o2);
    assert.equal(o2.get(1).fever, null);
  });
});

describe('the Fever badge on the unit', () => {
  test("the badge sits at the model's bottom-right, not in the bars row, and rides the unit", () => {
    const v = view();
    const s = 40;                                   // px per tile of this camera at the unit's tile
    const r = draw(v, sample({ fever: 40 }));
    assert.ok(r && r.root.visible, 'the badge exists and shows');
    assert.ok(r.root.x > v.screen.x, `right of the model (${r.root.x} > ${v.screen.x})`);
    assert.ok(r.root.x - v.screen.x > 0.2 * s, 'clearly to the right of the body');
    assert.ok(r.root.y < v.screen.y && r.root.y > v.screen.y - 0.6 * s, 'at the bottom of the model (above the feet)');
    // the whole point of the change: it left the HP / SP bars row
    assert.ok(r.root.y > v.hpFill.position.y, 'below the HP bar');
    assert.ok(r.root.y > v.spFill.position.y, 'below the SP bar');
    assert.ok(!r.tick && !r.fill, 'no bar, no threshold tick');
    // it follows the unit (and the camera): the offset from the feet is the same at another tile
    const r2 = draw(v, sample({ fever: 40, x: 9, y: 8 }), 1);
    assert.equal(r2, r, 'the same badge');
    const p = cam().project(9, 8, 0);
    assert.ok(Math.abs(r.root.x - (p.x + FEVER_ICON.dx * p.s + r.arc.width * 0.3)) < 1e-6, 'anchored to the new feet');
    assert.ok(Math.abs(r.root.y - (p.y - FEVER_ICON.dy * p.s - r.arc.width * 0.3)) < 1e-6);
  });

  test('the badge is an INNER RING ONLY: no disc, no outer circle, just the track + the filling arc', () => {
    const v = view();
    const r = draw(v, sample({ fever: 40 }));
    // the owner's report: 「fever 状态条不要外面的大圈，只保留里面的小圈就行」. Two outer circles used to surround the
    // small ring — the `downDisc` plate (a dark disc spanning the whole atlas cell, ~2× the ring's diameter, which is
    // what read as the big circle) and the full-circle step of the arc atlas laid over the track as an outline.
    assert.deepEqual(Object.keys(r).sort(), ['arc', 'glow', 'root', 'track'],
      'the badge holds the track, the arc and the halo — no plate, no outer ring');
    assert.equal(r.plate, undefined, 'the dark disc behind the ring is gone');
    assert.equal(r.ring, undefined, 'the outer circle over the ring is gone');
    // nothing of the badge draws the disc or the full-circle frame any more
    const rings = hudRings();
    const drawn = [];
    const walk = (c) => { if (c.texture && c.texture !== r.glow.texture) drawn.push(c.texture); for (const k of c.children || []) walk(k); };
    walk(r.root);
    assert.ok(!drawn.includes(rings.downDisc), 'the plate texture is not used by the badge');
    assert.ok(!drawn.includes(rings.arcs[rings.arcs.length - 1]), 'the outer full-circle frame is not drawn at 40 %');
    const names = [...new Set(drawn)].map((t) => (t === rings.track ? 'track' : `arc${rings.arcs.indexOf(t)}`));
    assert.deepEqual(names.sort(), [`arc${arcIndex(ringArc(0.4))}`, 'track'], 'exactly the track and the 40 % arc step');
    assert.ok(r.track.visible && r.arc.visible, 'both are on screen');
    assert.ok(r.root.children.length <= 3, `at most halo + track + arc (${r.root.children.length})`);
  });

  test('the rose ring fills with the gauge, and 蓄满 (100 %) adds the light effect', () => {
    const v = view();
    const r = draw(v, sample({ fever: 0 }));
    assert.equal(r.arc.visible, false, 'nothing charged, nothing drawn');
    assert.equal(r.glow.visible, false, 'and no ready effect');
    assert.ok(r.track.visible, 'the empty badge is still a badge');
    assert.equal(r.track.tint, FEVER_ROSE_DIM, 'the empty track is the dimmed rose, not a grey outline');
    let prev = -1;
    for (const pct of [5, 25, 50, 75, 100]) {
      draw(v, sample({ fever: pct }), pct);
      const k = arcIndex(r.arc.texture);
      assert.ok(r.arc.visible, `${pct} %: the fill shows`);
      assert.ok(k > prev, `${pct} %: the ring grew (${prev} → ${k})`);
      assert.equal(r.arc.tint, FEVER_ROSE, `${pct} %: the filling is the rose`);
      prev = k;
    }
    assert.equal(arcIndex(r.arc.texture), hudRings().arcs.length - 1, '100 % fills the ring');
    // 蓄满 without an outer circle: the arc itself lights up (higher alpha) and the halo breathes around the badge
    const lit = r.arc.alpha;
    assert.ok(lit > 1, `蓄满: the filling ring itself reads as lit (alpha ${lit})`);
    assert.equal(r.glow.visible, true, 'and the halo appears');
    const a1 = r.glow.alpha;
    let pulsed = false, litPulsed = false;
    for (let i = 10; i < 60; i++) {
      draw(v, sample({ fever: 100 }), i / 10);
      if (Math.abs(r.glow.alpha - a1) > 0.02) pulsed = true;
      if (Math.abs(r.arc.alpha - lit) > 0.02) litPulsed = true;
    }
    assert.ok(pulsed, 'the ready effect breathes');
    assert.ok(litPulsed, 'the lit arc breathes with it');
    draw(v, sample({ fever: 99 }), 7);
    assert.equal(r.glow.visible, false, 'just below full the ready effect is gone again');
    assert.ok(r.arc.alpha <= 1 + 1e-9, 'and the arc is back to its plain brightness');
  });

  test('no threshold tick exists any more (the trigger is 蓄满, not 50 %)', () => {
    assert.equal(FEVER_ICON.threshold, undefined);
    assert.equal(FEVER_ICON.full, 100);
    const v = view();
    const r = draw(v, sample({ fever: 50 }));
    assert.deepEqual(Object.keys(r).sort(), ['arc', 'glow', 'root', 'track'], 'track / arc / glow only');
    assert.equal(r.glow.visible, false);
    assert.equal(r.track.tint, FEVER_ROSE_DIM, '50 % is just another charge value now');
  });

  test('pct changes update the badge in place (no new HUD objects), and it can empty', () => {
    const v = view();
    draw(v, sample({ fever: 25 }));
    const kids = v.hud.children.length;
    const r = v._feverIcon;
    for (const [pct, i] of [[25, 1], [100, 2], [0, 3], [80, 4]]) {
      draw(v, sample({ fever: pct }), i);
      assert.equal(v.hud.children.length, kids, `no new HUD objects at ${pct} %`);
      assert.equal(v._feverIcon, r, 'the same badge');
      assert.equal(r.arc.visible, pct > 0, `an empty gauge fills nothing (${pct})`);
      assert.ok(r.root.visible);
    }
  });

  test('without the `fever` field nothing is drawn (and a badge that loses it hides)', () => {
    const v = view();
    draw(v, sample());                        // fever: null — an older server / recording
    assert.ok(!v._feverIcon || !v._feverIcon.root.visible, 'no badge without the field');
    const r = draw(v, sample({ fever: 40 }));
    assert.ok(r.root.visible);
    draw(v, sample(), 1);
    assert.equal(r.root.visible, false, 'hidden again');
    draw(v, sample({ fever: 40 }), 2);
    assert.equal(r.root.visible, true, 'and back when it returns');
  });

  test('prep and a dead unit show no badge', () => {
    const p = new UnitView(fakeViewCtx(fake.P, { cam, settings: { quality: 'high' } }), { id: 1, side: 'ally', kind: 'chess', defId: SLOT, diy: { ...PICK }, tier: 6, x: 5, y: 12, maxHp: 3000 }, { prep: true });
    p.sync(sample({ fever: 50 }), 0);
    p.update(1 / 60, cam(), 0);
    assert.ok(!p._feverIcon || !p._feverIcon.root.visible, 'prep has no battle HUD');
    const v = view();
    draw(v, sample({ fever: 50 }));
    v.alive = false;
    v.update(1 / 60, cam(), 1);
    assert.equal(v._feverIcon.root.visible, false, 'a dead unit draws no badge');
  });

  test('Fever ON: the badge turns to the state look — pale rose fill, rose track, stronger halo', () => {
    const v = view();
    const r = draw(v, sample({ fever: 100 }));
    assert.equal(r.arc.tint, FEVER_ROSE, 'charging: the plain rose');
    assert.equal(r.track.tint, FEVER_ROSE_DIM, '…over the dimmed track');
    assert.equal(v.feverActive(), false);
    v.onStatus('sakiko:fever', true);          // the sim's visible Fever buff (kits/ops/op-oblvns.js)
    assert.equal(v.feverActive(), true);
    // while Fever is ON the sim sends the REMAINING TIME (100 → 0): the ring falls
    draw(v, sample({ fever: 100 }), 1);
    assert.equal(r.arc.tint, FEVER_ROSE_HI, 'the fill switches to the Fever rose');
    assert.equal(r.track.tint, FEVER_ROSE, 'and the track takes the state colour too (no outline needed)');
    assert.equal(r.glow.visible, true, 'the halo is on');
    assert.equal(r.glow.tint, FEVER_ROSE_HI);
    const k0 = arcIndex(r.arc.texture);
    draw(v, sample({ fever: 45 }), 2);
    assert.ok(arcIndex(r.arc.texture) < k0, 'the countdown drains the ring');
    let pulsed = false;
    const a1 = r.glow.alpha;
    for (let i = 30; i < 60; i++) { draw(v, sample({ fever: 45 }), i / 10); if (Math.abs(r.glow.alpha - a1) > 0.02) pulsed = true; }
    assert.ok(pulsed, 'the Fever halo breathes');
    draw(v, sample({ fever: 0 }), 3);
    assert.equal(r.arc.visible, false, 'counted down to nothing');
    assert.equal(r.glow.visible, true, 'but the state is still marked (the halo breathes on)');
    assert.equal(r.track.tint, FEVER_ROSE, '…and the ring is still rose-hot');
    v.onStatus('sakiko:fever', false);
    draw(v, sample({ fever: 0 }), 4);
    assert.equal(r.arc.tint, FEVER_ROSE, 'back to the charging look');
    assert.equal(r.track.tint, FEVER_ROSE_DIM);
    assert.equal(r.glow.visible, false);
  });

  test('a status key that is not the Fever buff does not switch the badge', () => {
    const v = view();
    const r = draw(v, sample({ fever: 50 }));
    v.onStatus('burn', true);
    v.onStatus('sakiko:note', true);
    v.onStatus('feverish', true);
    draw(v, sample({ fever: 50 }), 1);
    assert.equal(v.feverActive(), false);
    assert.equal(r.arc.tint, FEVER_ROSE);
    assert.equal(r.track.tint, FEVER_ROSE_DIM);
    v.onStatus('sakiko:fever', true);
    draw(v, sample({ fever: 50 }), 2);
    assert.equal(v.feverActive(), true, 'the sim key does');
    assert.equal(r.arc.tint, FEVER_ROSE_HI);
    assert.equal(r.track.tint, FEVER_ROSE);
  });

  test('Fever ON turns the SP bar rose, and Fever over restores it', () => {
    const v = view();
    draw(v, sample({ fever: 40, sp: 10, spMax: 20 }));
    const normal = v.spFill.tint;
    assert.ok(normal === COLORS.sp || normal === COLORS.spReady || normal === COLORS.spActive, `a normal SP colour (${normal.toString(16)})`);
    v.onStatus('sakiko:fever', true);
    draw(v, sample({ fever: 40, sp: 10, spMax: 20 }), 1);
    assert.equal(v.spFill.tint, FEVER_ROSE, 'the SP bar takes the gauge rose while Fever is ON');
    assert.equal(v.spFill.visible, true);
    v.onStatus('sakiko:fever', false);
    draw(v, sample({ fever: 40, sp: 10, spMax: 20 }), 2);
    assert.equal(v.spFill.tint, normal, 'and goes back when it ends');
    // a ready SP bar is not stuck rose either
    const v2 = view();
    v2.onStatus('sakiko:fever', true);
    draw(v2, sample({ fever: 40, sp: 20, spMax: 20 }), 0);
    assert.equal(v2.spFill.tint, FEVER_ROSE, 'Fever wins over the ready colour');
    v2.onStatus('sakiko:fever', false);
    draw(v2, sample({ fever: 40, sp: 20, spMax: 20 }), 1);
    assert.equal(v2.spFill.tint, COLORS.spReady, 'back to the ready glow colour');
  });

  test('quality \'low\' still shows the charge, the ready effect and the Fever state (no halo)', () => {
    const v = view({ quality: 'low' });
    const r = draw(v, sample({ fever: 64 }));
    assert.ok(r.root.visible && r.arc.visible && r.track.visible, 'badge + fill at low quality');
    assert.equal(arcIndex(r.arc.texture), arcIndex(ringArc(0.64)), 'the charge is readable');
    assert.equal(r.arc.tint, FEVER_ROSE);
    assert.equal(r.glow.visible, false, 'no halo at low quality');
    draw(v, sample({ fever: 100 }), 1);
    assert.ok(r.arc.alpha > 1, '蓄满 is still marked by the lit filling ring');
    assert.equal(r.glow.visible, false);
    v.onStatus('sakiko:fever', true);
    draw(v, sample({ fever: 30 }), 2);
    assert.equal(r.arc.tint, FEVER_ROSE_HI, 'the Fever state reads by colour at low quality too');
    assert.equal(r.track.tint, FEVER_ROSE);
    assert.equal(r.glow.visible, false, 'still no halo');
    assert.equal(v.spFill.tint, FEVER_ROSE, 'and the SP bar is rose');
  });

  test('the badge is `cell` tiles big (clamped to px), so it follows the camera zoom', () => {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const sizes = [];
    for (const [w, h] of [[320, 200], [1280, 720], [2560, 1440]]) {
      const c = () => presetCamera('normal', { width: w, height: h });
      const v = new UnitView(fakeViewCtx(fake.P, { cam: c, settings: { quality: 'high' } }), { id: 1, side: 'ally', kind: 'chess', defId: SLOT, diy: { ...PICK }, tier: 6, x: 5, y: 12, maxHp: 3000 });
      v.sync(sample({ fever: 60 }), 0);
      v.update(1 / 60, c(), 0);
      const r = v._feverIcon;
      const want = clamp(v.screen.s * FEVER_ICON.cell, FEVER_ICON.min, FEVER_ICON.max);
      assert.ok(Math.abs(r.arc.width - want) < 1e-9, `${w}×${h}: badge ${r.arc.width} px vs ${want} (s = ${v.screen.s})`);
      for (const sp of ['track']) assert.equal(r[sp].width, r.arc.width, `${sp} shares the badge size`);
      assert.ok(want >= FEVER_ICON.min - 1e-9 && want <= FEVER_ICON.max + 1e-9, 'inside the px clamps');
      sizes.push(r.arc.width);
    }
    assert.ok(new Set(sizes).size >= 2, `the camera zoom really changes the drawn size (${sizes})`);
  });
});

describe('the whole client path (battle → snapshot → interp → view)', () => {
  test("祥子's own sim gauge (snap.fever, no fabrication): it charges as she deals damage and the badge follows", () => {
    // the real thing: 丰川祥子 (a 自选 slot + its pick) in front of an immortal dummy charges her talent's gauge
    // (server/sim/content/kits/ops/op-oblvns.js) and Battle.snapshot publishes it as [[unitId, pct], …].
    const h = makeBattle({
      seed: 7, autoFinish: false, timeLimit: 400,
      units: [{ uid: 1, diy: { slot: SLOT, charId: SAKIKO, skillIndex: 0, uniEquipId: null }, row: 10, col: 4, dir: 'RIGHT' }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
      defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
    });
    h.runUntil(() => h.allies().length > 0, 60);
    const u = h.allies()[0];
    assert.ok(u, 'the operator deployed');
    const info = h.b.fieldMeta().units.find((x) => x.id === u.id);
    const v = new UnitView(fakeViewCtx(fake.P, { cam, settings: { quality: 'high' } }), info);
    const buf = new SnapshotBuffer({ delay: 0.034, rate: 2, maxRate: 8 });
    const out = new Map();
    const seen = [];
    let fullFrames = 0;
    for (let i = 0; i < 40 * 60; i++) {          // her gauge charges slowly (~3 %/s here): 40 s cover 0 → 100
      h.step();
      const snap = h.b.snapshot();
      if (!snap.fever) continue;                       // nothing to draw before the first charge
      const want = (snap.fever.find((f) => f[0] === u.id) || [])[1];
      assert.ok(Number.isFinite(want), `the snapshot lists her gauge (${JSON.stringify(snap.fever)})`);
      const now = (i + 1) / 60;
      buf.push({ ...snap, gt: snap.t }, now);
      const rt = buf.update(now);
      buf.sample(rt, out);
      const s = out.get(u.id);
      if (!s) continue;
      v.sync(s, rt);
      v.update(1 / 60, cam(), now);
      const r = v._feverIcon;
      assert.ok(r && r.root.visible, 'the badge shows');
      assert.equal(arcIndex(r.arc.texture), arcIndex(ringArc(s.fever / 100)), `the ring is the gauge (${s.fever} %)`);
      if (s.fever > 0 && !v.feverActive()) assert.equal(r.arc.tint, FEVER_ROSE, 'charging rose');
      // 蓄满 (100 %) reads by the lit ring (and the halo, above this test's scope): the badge's own ready mark
      if (s.fever >= 100) { fullFrames++; assert.ok(r.arc.alpha > 1, 'the filling ring lights up at 蓄满'); }
      // the sample's gauge is the snapshot shown at renderT, not a fabricated number (the gauge both charges and, once
      // the state starts, counts DOWN, so it is not monotonic: compare with the shown snapshot, not with the newest)
      const shown = buf.snaps[Math.max(0, buf._indexAt(rt))];
      assert.equal(s.fever, shown.fever.get(u.id), `the sample carries the shown snapshot's gauge (${s.fever})`);
      seen.push(s.fever);
    }
    assert.ok(seen.length > 1200, `she carries a gauge for most of the run (${seen.length} frames)`);
    assert.ok(seen.some((p) => p > 0 && p < 50), 'it is seen charging through the first half');
    assert.ok(seen.some((p) => p >= 50), `it passes the 50 % mark (max ${Math.max(...seen)})`);
    assert.ok(fullFrames > 0, `the run reached 蓄满 (${fullFrames} frames at 100 %)`);
  });
});
