// test/render/fxnote.test.js — 丰川祥子's 音符 projectiles, the first visual that is NOT driven by a b.ev 'atk' event:
//   * render/style.js PROJ.note / PROJ.noteSkill: the note look — sizes from NOTE_SIZE, colours from NOTE_FX (the
//     user-set effect colour rgb(197, 62, 70)) and NOTE_INK — the skill's note bigger and its halo brighter
//   * render/textures.js: the procedural FX atlas draws the three note glyphs (八分音符 / 十六分音符 / 高音谱号), each
//     sharing no pixel with any other frame
//   * render/interp.js: a snapshot's `proj` list ([[id, x, y, kind], …]) is validated with the rest of the payload and
//     projAt(time) hands it out with positions lerped like a unit's
//   * render/fx/notes.js FxSystem.syncNotes: one pooled glyph + halo per projectile id — a new id makes a note (with one
//     of the three glyphs drawn at random and kept for its life), a known id only moves it (to the projected board point,
//     the same mapping every other projectile uses), an id that leaves the list (or an empty / missing one) flashes in
//     NOTE_FX, fades out into the pool: sprites are never leaked, at quality 'low' too
//   * render/fx/projectiles.js attack(): a 'none' attack from a RANGED profile is no melee slash — her normal attack
//     reports 'none' because the note the kit adds is its whole visual (sim ai.js `noAttackVis`)
//   * render/app.js: the battle frame feeds interp.projAt(renderT) to fx.syncNotes, and the FX context carries the
//     ranged-def lookup (source guard: app.js needs a DOM)

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { PROJ, NOTE_SIZE, NOTE_FX, NOTE_INK } from '../../public/js/render/style.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';

let fake, FX, T;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  T = await import('../../public/js/render/textures.js');
});
after(() => fake.restore());

const DT = 1 / 60;
const cam = presetCamera('normal', { width: 1600, height: 900 });
/** The three glyph frames the atlas must carry, and the weights every note is drawn from. */
const GLYPHS = ['note', 'note16', 'treble'];

/** A FxSystem on fake layers (the ctx the render frame passes), ground height 0 like the flat test fields. */
function makeFx({ quality = 'high', load = 0 } = {}) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  return new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality, damageNumbers: true },
    timeScale: () => 2, loadLevel: () => load, subProfOf: () => null, view: () => null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
}

/** The screen point a note at board (x, y) must be drawn at: _proj + bodyZ(SHOT_HEIGHT.aim), as every shot is. */
const notePt = (x, y) => cam.project(x, y, FX.bodyZ(cam, { x, y, z: 0, hover: 0 }, FX.SHOT_HEIGHT.aim));
const run = (fx, seconds, dt = DT) => { for (let t = 0; t < seconds - 1e-9; t += dt) fx.update(dt); };
const luma = (c) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.6 + (c & 255) * 0.1;

describe('note projectile visuals', () => {
  test('PROJ.note / PROJ.noteSkill: NOTE_SIZE / NOTE_FX / NOTE_INK, the skill one bigger and brighter', () => {
    for (const k of ['note', 'noteSkill']) {
      const s = PROJ[k];
      assert.ok(s, `render/style.js PROJ has no '${k}'`);
      assert.equal(s.look, 'note', `${k}.look`);
      assert.ok(s.speed > 0, `${k}.speed`);          // the shared PROJ shape (tiles.test.js asserts it for every kind)
      assert.ok(s.width > 0 && s.head > 0, `${k} glyph size`);
      assert.ok(s.halo > 0, `${k}.halo`);
      assert.ok(s.tint !== s.glow, `${k}: a distinct glyph colour`);
      assert.equal(s.glow, NOTE_FX, `${k}.glow is the effect colour`);
      assert.equal(s.trail, NOTE_FX, `${k}.trail is the effect colour`);
    }
    // the user's numbers, exactly: the notes were too big twice over, the effect is rgb(197, 62, 70)
    assert.deepEqual({ ...NOTE_SIZE.talent }, { head: 0.42, width: 0.38, halo: 0.72, haloA: 0.75 });
    assert.deepEqual({ ...NOTE_SIZE.skill }, { head: 0.52, width: 0.47, halo: 0.95, haloA: 0.88 });
    for (const k of ['note', 'noteSkill']) for (const [f, v] of Object.entries(k === 'note' ? NOTE_SIZE.talent : NOTE_SIZE.skill)) assert.equal(PROJ[k][f], v, `${k}.${f}`);
    assert.equal(NOTE_FX, 0xc53e46, 'NOTE_FX is rgb(197, 62, 70)');
    assert.equal(NOTE_INK.talent, 0xffe0e3);
    assert.equal(NOTE_INK.skill, 0xffeef1);
    assert.equal(PROJ.note.tint, NOTE_INK.talent);
    assert.equal(PROJ.noteSkill.tint, NOTE_INK.skill);
    assert.ok(PROJ.noteSkill.head > PROJ.note.head, 'a skill note is bigger');
    assert.ok(PROJ.noteSkill.width > PROJ.note.width);
    assert.ok(PROJ.noteSkill.halo > PROJ.note.halo, 'and has a wider halo');
    assert.ok(PROJ.noteSkill.haloA > PROJ.note.haloA, 'and a brighter one');
    assert.ok(luma(PROJ.noteSkill.tint) >= luma(PROJ.note.tint), 'and a paler, brighter glyph');
  });

  test('the FX atlas draws three note glyphs that share no pixel with any other frame', () => {
    const { size: [W, H], frames } = T.fxFrames();
    for (const g of GLYPHS) {
      const f = frames[g];
      assert.ok(f, `the FX atlas has no \`${g}\` frame (render/textures.js FX_DRAW)`);
      assert.deepEqual(f.slice(2), [128, 128], `${g}: square cell — the sprite is scaled by the glyph size ÷ 128`);
      assert.ok(f[0] >= 0 && f[1] >= 0 && f[0] + f[2] <= W && f[1] + f[3] <= H, `${g} inside the atlas`);
      for (const [name, [x, y, w, h]] of Object.entries(frames)) {
        if (name === g) continue;
        assert.ok(!(f[0] < x + w && x < f[0] + f[2] && f[1] < y + h && y < f[1] + f[3]), `${g} overlaps ${name}`);
      }
      assert.ok(T.fxAtlas().tex[g], `and the atlas builds ${g}`);
    }
  });

  test('a note reaching fx.attack still flies and lands (the look is not syncNotes-only)', () => {
    const fx = makeFx();
    const a = { id: 1, x: 3, y: 10, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: false };
    const b = { ...a, id: 2, x: 8, y: 10, isEnemy: true };
    for (const kind of ['note', 'noteSkill']) {
      fx.clear();
      fx.attack(a, b, kind);
      assert.equal(fx.projs.length, 1, kind);
      const pr = fx.projs[0];
      assert.ok(GLYPHS.some((g) => fx.tex[g] === pr.core.texture), `${kind}: one of the three glyphs`);
      assert.equal(pr.core.tint, PROJ[kind].tint, `${kind}: the glyph colour`);
      assert.equal(pr.glow, NOTE_FX, `${kind}: the halo / hit colour`);
      assert.equal(pr.trailTint, NOTE_FX, `${kind}: the trail / hit-spark colour`);
      assert.equal(pr.trail.visible, false, `${kind}: a drifting note leaves no streak`);
      fx.update(DT);
      assert.ok(pr.core.visible && pr.core.alpha > 0, `${kind}: drawn`);
      assert.ok(Number.isFinite(pr.core.scale.x) && pr.core.scale.x > 0, `${kind}: a real glyph size`);
      assert.ok(pr.halo.visible && pr.halo.alpha > 0, `${kind}: halo`);
      run(fx, 3);
      assert.equal(fx.projs.length, 0, `${kind}: gone after its flight`);
    }
  });

  test("a ranged 'none' attack is no slash either — the content's own visual is the whole attack", () => {
    // ai.js reports 'none' for a profile with no projectile visual of its own. For a MELEE profile that is the blow the
    // slash sweeps; for a RANGED one (丰川祥子's note-carrying normal attack, kits/ops/op-oblvns.js `noAttackVis`) a
    // crescent at the victim would be a blade effect at range. ctx.rangedOf is the renderer's own range-class lookup
    // (app.js data.chess(defId).attackKind).
    const a = { id: 1, x: 4, y: 10, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: false, info: { defId: 'char_4182_oblvns' } };
    const b = { ...a, id: 2, x: 9, y: 10, isEnemy: true };
    const liveTex = (fx, name) => fx.parts.filter((p) => p.sp.texture === fx.tex[name]).length;
    const ranged = makeFx();
    ranged.ctx.rangedOf = () => true;
    ranged.attack(a, b, 'none');
    assert.equal(ranged.projs.length, 0, 'no projectile sprite');
    assert.notEqual(ranged._slashAt, a.id, 'and no pending slash');
    ranged.damage(b, 300, 'phys', a);                 // the damage lands with no slash to sweep
    assert.equal(liveTex(ranged, 'slash'), 0);
    // a 'none' from an attacker the renderer does not know as ranged keeps its slash (every melee operator)
    const melee = makeFx();
    melee.ctx.rangedOf = () => false;
    melee.attack(a, b, 'none');
    assert.equal(melee._slashAt, a.id);
    // …and a context without the lookup at all (an older harness) behaves exactly as it did before
    const older = makeFx();
    older.attack(a, b, 'none');
    assert.equal(older._slashAt, a.id);
    // the real ctx passes the view's UnitInfo too, so a 自选 slot resolves its pick's own attackKind
    assert.match(readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8'), /rangedOf: \(defId, info = null\)/,
      'render/app.js must give the FX context the ranged lookup (data.chess(defId).attackKind)');
  });

  test('the glyph of a note is drawn at random from the three frames, 40 / 40 / 20', () => {
    assert.deepEqual(FX.NOTE_FRAMES.map(([n]) => n), GLYPHS);
    assert.deepEqual(FX.NOTE_FRAMES.map(([, w]) => w), [0.4, 0.4, 0.2]);
    const at = (r) => FX.pickNoteFrame(() => r);
    assert.equal(at(0), 'note');
    assert.equal(at(0.3999), 'note');
    assert.equal(at(0.4), 'note16', 'the boundary belongs to the next weight');
    assert.equal(at(0.7999), 'note16');
    assert.equal(at(0.8), 'treble');
    assert.equal(at(0.999), 'treble');
    // and the actual draw follows those weights (4000 samples: ±0.05 is ~6σ, so this never flakes)
    const N = 4000;
    const counts = new Map(GLYPHS.map((g) => [g, 0]));
    for (let i = 0; i < N; i++) {
      const g = FX.pickNoteFrame();
      assert.ok(counts.has(g), `pickNoteFrame yielded '${g}'`);
      counts.set(g, counts.get(g) + 1);
    }
    for (const [g, w] of FX.NOTE_FRAMES) assert.ok(Math.abs(counts.get(g) / N - w) < 0.05, `${g}: ${counts.get(g)}/${N} vs ${w}`);
  });
});

describe('syncNotes (b.snap `proj`)', () => {
  test('a new id makes one note (glyph + halo) on its board point; a known id only moves it', () => {
    const fx = makeFx();
    const sprites = fx.projLayer.children.length;
    fx.syncNotes([[1, 4, 10, 'note']]);
    assert.equal(fx.notes.size, 1, 'the record is made as soon as the id appears');
    assert.equal(fx.notes.get(1).core.visible, false, 'its sprites are placed by the frame update');
    fx.update(DT);
    assert.equal(fx.notes.size, 1);
    assert.equal(fx.counts.notes, 1);
    const n = fx.notes.get(1);
    assert.equal(fx.projLayer.children.length, sprites + 2, 'one glyph + one halo');
    assert.ok(GLYPHS.includes(n.frame), `the note's own glyph (${n.frame})`);
    assert.equal(n.core.texture, fx.tex[n.frame]);
    assert.equal(n.halo.texture, fx.tex.glow);
    assert.equal(n.core.tint, PROJ.note.tint, 'glyph in NOTE_INK');
    assert.equal(n.halo.tint, NOTE_FX, 'halo in the effect colour');
    assert.equal(n.core.blendMode, fake.P.BLEND_MODES.ADD, 'additive, like every other projectile');
    assert.equal(n.core.visible, true);
    const p0 = notePt(4, 10);
    assert.ok(Math.abs(n.core.x - p0.x) < 1e-9, 'on the projected board column');
    assert.ok(Math.abs(n.core.y - p0.y) <= 0.06 * p0.s, 'at the aim height of a unit on that tile (plus a small float)');
    assert.ok(Math.abs(n.core.scale.y - (PROJ.note.head * p0.s) / 128) < 1e-9, 'glyph height in tiles × px per tile');
    assert.ok(Math.abs(n.core.scale.x - (PROJ.note.width * p0.s) / 128) < 1e-9);
    assert.ok(n.halo.scale.x > n.core.scale.x, 'the halo spreads wider than the glyph');
    // the same id at a new position: no new sprite, the same record and the same glyph moved
    fx.syncNotes([[1, 5.5, 10, 'note']]);
    assert.equal(fx.notes.size, 1);
    assert.equal(fx.projLayer.children.length, sprites + 2, 'a known id never creates a sprite');
    assert.equal(fx.notes.get(1), n, 'the same pooled record');
    fx.update(DT);
    assert.equal(n.core.texture, fx.tex[n.frame], 'its glyph never changes while it lives');
    const p1 = notePt(5.5, 10);
    assert.ok(Math.abs(n.core.x - p1.x) < 1e-9, 'moved to the new board position');
    assert.ok(Math.abs(n.core.x - p0.x) > 1, 'and it really moved');
  });

  test('every note of a stream is given one of the three glyphs, fixed for its whole life', () => {
    const fx = makeFx();
    const N = 60;   // under MAX_NOTES (64): the live cap is another test's business
    const ids = [];
    for (let i = 0; i < N; i++) ids.push([i, 2 + (i % 17), 6 + (i % 5), 'note']);
    fx.syncNotes(ids);
    fx.update(DT);
    assert.equal(fx.notes.size, N);
    const first = new Map();
    for (const [id, n] of fx.notes) {
      assert.ok(GLYPHS.includes(n.frame), `note ${id}: '${n.frame}'`);
      assert.equal(n.core.texture, fx.tex[n.frame], 'the sprite shows the record’s glyph');
      first.set(id, n.frame);
    }
    assert.deepEqual([...new Set(first.values())].sort(), [...GLYPHS].sort(), `all three glyphs turn up in ${N} notes`);
    // it stays put across frames and moves
    for (let f = 0; f < 30; f++) {
      fx.syncNotes(ids.map(([id, x, y, k]) => [id, x + 0.2, y, k]));
      fx.update(DT);
    }
    for (const [id, n] of fx.notes) assert.equal(n.frame, first.get(id), `note ${id} kept its glyph`);
  });

  test('`kind` picks the spec; an unknown kind draws the talent note', () => {
    const fx = makeFx();
    fx.syncNotes([[2, 6, 10, 'note'], [3, 6, 10, 'noteSkill'], [4, 6, 10, 'something else']]);
    fx.update(DT);
    assert.equal(fx.notes.get(2).spec, PROJ.note);
    assert.equal(fx.notes.get(3).spec, PROJ.noteSkill);
    assert.equal(fx.notes.get(4).spec, PROJ.note, 'unknown kinds fall back to PROJ.note');
    assert.equal(fx.notes.get(2).core.tint, PROJ.note.tint);
    assert.equal(fx.notes.get(3).core.tint, PROJ.noteSkill.tint);
    assert.equal(fx.notes.get(3).halo.tint, PROJ.noteSkill.glow);
    assert.ok(fx.notes.get(3).core.scale.y > fx.notes.get(2).core.scale.y, 'the skill note is the bigger one');
  });

  test('an id that leaves the list flashes in NOTE_FX, fades out and is pooled (an empty / missing list takes them all)', () => {
    const fx = makeFx();
    // the parting flash is a `glow` particle; a live note's trail motes are `dot` ones (and its phase is random per
    // note), so the glow count — not the whole pool — is what "the flash has not happened yet" means
    const glows = () => fx.parts.filter((p) => p.sp.texture === fx.tex.glow).length;
    fx.syncNotes([[7, 3, 10, 'note']]);
    fx.update(DT);
    const n = fx.notes.get(7);
    assert.equal(n.core.alpha, 1);
    assert.equal(glows(), 0, 'no parting flash while it lives');
    fx.syncNotes([]);
    fx.update(DT);
    assert.equal(fx.notes.size, 1, 'still there while it fades');
    assert.ok(n.core.alpha > 0 && n.core.alpha < 1, `fading, not popped out (alpha ${n.core.alpha})`);
    assert.equal(n.core.visible, true);
    assert.ok(glows() >= 1, 'a parting flash');
    assert.ok(fx.parts.some((p) => p.sp.tint === NOTE_FX), 'the parting flash / sparks are in the effect colour');
    assert.equal(n.burst, true, 'the parting flash happens once');
    const parts = fx.parts.length;
    run(fx, 0.2);
    assert.ok(fx.parts.length <= parts, 'and is not repeated');
    run(fx, 0.5);
    assert.equal(fx.notes.size, 0, 'released after the fade');
    assert.equal(n.core.visible, false);
    assert.equal(n.halo.visible, false);
    assert.equal(fx.noteFree.length, 1, 'the record went back to the pool');
    // the pooled sprites come back for the next note — no allocation, no leak
    const sprites = fx.projLayer.children.length;
    fx.syncNotes([[8, 4, 11, 'note']]);
    fx.update(DT);
    assert.equal(fx.noteFree.length, 0);
    assert.equal(fx.projLayer.children.length, sprites, 'reused, not re-created');
    assert.equal(fx.notes.get(8).core.visible, true);
    // undefined / null mean "no notes at all"
    for (const empty of [undefined, null]) {
      fx.syncNotes(empty);
      run(fx, 0.5);
      assert.equal(fx.notes.size, 0, `syncNotes(${empty}) fades every note out`);
      fx.syncNotes([[9, 4, 11, 'note']]);
      fx.update(DT);
    }
  });

  test('junk entries are dropped; the live cap recycles the oldest note (no sprite leak)', () => {
    const fx = makeFx();
    fx.syncNotes([[1, 4, 10, 'note'], 'x', [2, NaN, 10], [3, 4, 'y'], ['id', 5, 10, 'note'], null, [6, 1, 2]]);
    fx.update(DT);
    assert.deepEqual([...fx.notes.keys()], [1, 'id', 6], 'numeric and string ids kept, malformed entries dropped');
    fx.clear();
    const many = [];
    for (let i = 0; i < 200; i++) many.push(['n' + i, 1 + (i % 17), 5 + (i % 4), i % 2 ? 'noteSkill' : 'note']);
    fx.syncNotes(many);
    fx.update(DT);
    assert.ok(fx.notes.size <= 64, `the live cap holds (${fx.notes.size} notes)`);
    assert.ok(fx.projLayer.children.length <= 64 * 2, `sprites stay capped (${fx.projLayer.children.length})`);
    assert.equal(fx.projLayer.children.length, (fx.notes.size + fx.noteFree.length) * 2, 'exactly glyph + halo per record');
    assert.equal(fx.notes.has('n199'), true, 'the newest notes are the live ones');
    assert.equal(fx.notes.has('n0'), false, 'the oldest were recycled, as MAX_PROJ does for shots');
    assert.equal(fx.noteFree.length, 0, 'and their records were handed straight back out');
  });

  test('quality \'low\' still draws the note: a dimmer halo, no motes', () => {
    const low = makeFx({ quality: 'low' });
    low.syncNotes([[1, 4, 10, 'note']]);
    run(low, 0.5);
    const n = low.notes.get(1);
    assert.equal(n.core.visible, true, 'the glyph is drawn at low quality');
    assert.ok(n.core.alpha > 0.9 && n.core.scale.x > 0 && n.core.scale.y > 0, 'fully drawn glyph');
    assert.ok(GLYPHS.includes(n.frame) && n.core.texture === low.tex[n.frame], 'its own glyph, still there');
    assert.equal(n.core.tint, PROJ.note.tint);
    assert.equal(n.core.blendMode, fake.P.BLEND_MODES.ADD);
    assert.ok(n.halo.visible && n.halo.alpha > 0.2, 'the halo stays, dimmer');
    assert.ok(Math.abs(n.halo.alpha - PROJ.note.haloA / 2) < 1e-9, 'exactly half the high-quality halo alpha');
    assert.equal(low.parts.length, 0, 'no cosmetic motes at low quality');
    const high = makeFx();
    high.syncNotes([[1, 4, 10, 'note']]);
    run(high, 0.5);
    assert.ok(Math.abs(high.notes.get(1).halo.alpha - PROJ.note.haloA) < 1e-9, 'the high-quality halo');
    assert.ok(high.notes.get(1).halo.alpha > n.halo.alpha, 'and it is the brighter one');
    assert.ok(high.parts.length >= 1, 'high quality drifts motes off the note');
    assert.equal(high.parts[0].sp.tint, NOTE_FX, 'motes in the effect colour');
  });

  test('clear() (battle reset) takes every note away and pools its sprites', () => {
    const fx = makeFx();
    fx.syncNotes([[1, 4, 10, 'note'], [2, 5, 10, 'noteSkill']]);
    fx.update(DT);
    assert.equal(fx.counts.notes, 2);
    fx.clear();
    assert.equal(fx.notes.size, 0);
    assert.equal(fx.counts.notes, 0);
    assert.equal(fx.noteFree.length, 2);
    for (const n of fx.noteFree) assert.equal(n.core.visible, false);
    run(fx, 1);
    assert.equal(fx.notes.size, 0, 'and nothing comes back on its own');
  });
});

describe('interp: the snapshot `proj` list', () => {
  test('normalizeSnapshot keeps well-formed entries, defaults the kind, drops junk', () => {
    const s = normalizeSnapshot({ t: 1, units: [], proj: [[1, 2, 3, 'note'], [2, 2.5, 3.5, 'noteSkill'], [3, NaN, 1], 'x', [4, 1], [5, 1, 2], [6, 1, 2, 7]] });
    assert.deepEqual(s.proj, [[1, 2, 3, 'note'], [2, 2.5, 3.5, 'noteSkill'], [5, 1, 2, 'note'], [6, 1, 2, 'note']]);
    assert.equal(normalizeSnapshot({ t: 1, units: [] }).proj, null, 'no proj list at all');
    assert.equal(normalizeSnapshot({ t: 1, units: [], proj: 'x' }).proj, null);
  });

  test('projAt(time): the list of the snapshot shown, positions lerped like a unit\'s', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    b.push({ t: 1.0, units: [], proj: [[1, 2, 10, 'note'], [2, 4, 10, 'note']] }, 0);
    b.push({ t: 1.1, units: [], proj: [[1, 2.4, 10, 'note'], [3, 9, 10, 'note']] }, 0.05);
    assert.deepEqual(b.projAt(1.0), [[1, 2, 10, 'note'], [2, 4, 10, 'note']]);
    const mid = b.projAt(1.05);
    assert.equal(mid.find((p) => p[0] === 1)[1], 2.2, 'id 1 lerped halfway to the newer snapshot');
    assert.deepEqual(mid.map((p) => p[0]), [1, 2], 'id 3 (only in the newer snapshot) is not shown yet; 2 holds its place');
    assert.deepEqual(b.projAt(1.1), [[1, 2.4, 10, 'note'], [3, 9, 10, 'note']]);
  });

  test('a teleport-sized jump snaps; no proj anywhere is null', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    b.push({ t: 5, units: [], proj: [[1, 1, 1, 'note']] }, 0);
    b.push({ t: 5.1, units: [], proj: [[1, 15, 1, 'note']] }, 0.05);
    assert.deepEqual(b.projAt(5.05), [[1, 15, 1, 'note']], 'never slides across the field');
    b.push({ t: 5.2, units: [] }, 0.1);
    assert.equal(b.projAt(5.2), null, 'a snapshot without proj carries none');
    assert.equal(new SnapshotBuffer({ delay: 0.1, rate: 2 }).projAt(1), null, 'and an empty buffer has none');
    assert.equal(b.projAt(NaN), null);
  });

  test('the battle frame hands the snapshot list to the FX system (app.js)', () => {
    const src = readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8');
    assert.match(src, /fx\.syncNotes\(interp\.projAt\(renderT\)\)/,
      'render/app.js must feed interp.projAt(renderT) to fx.syncNotes each battle frame (a note has no atk event)');
  });
});
