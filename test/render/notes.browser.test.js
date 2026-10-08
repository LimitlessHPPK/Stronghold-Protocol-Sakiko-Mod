// test/render/notes.browser.test.js — the note and Fever DRAW paths in a real browser (headless Edge/Chrome through the
// dev demo, public/dev/render-demo.html). The pure tests (test/render/fxnote.test.js, test/render/fevericon.test.js) run
// the same functions on a fake PIXI; this file is the one that proves the real renderer, the real FX atlas, the real
// camera and app.js's own battle frame draw them — a render-layer mistake can pass every pure test and still take the
// whole page down (the owner's `zoomBy` incident: one wrong identifier in createFieldView and the field silently fell
// back to the simplified view, while 21 pure tests were green).
//
//   * `?board=3d` is FORCED: this machine's headless Edge is software-rendered, so webgl2Available() carries
//     failIfMajorPerformanceCaveat and the `?scene=…` auto probe always refuses the 3D board — without the flag the
//     board would silently be the 2D atlas and the run would prove nothing about the 3D path.
//     `window.__demo.error === null` is asserted explicitly, at boot and after the run.
//   * the battle is driven by hand (enterBattle + one snapshot per animation frame, exactly what the server sends):
//     `snap.proj` (her notes) → interp.projAt → fx.syncNotes, and `snap.fever` → sample.fever → the unit's badge, plus
//     the sim's own 'status' event for 'sakiko:fever' → the badge's state look and the rose SP bar.
//
// Opt-in (starts a browser): RENDER_E2E=1 node --test test/render/notes.browser.test.js
// Browser path: $CHROME_PATH or the macOS default. Needs public/assets (git-ignored).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs a browser and downloaded assets)';

/**
 * Her UnitInfo exactly as the server sends it (server/sim/snapshot.js unitInfo): a 自选 slot as `defId` with the pick
 * in `diy`, and `spine` / `avatar` naming the operator herself (0.2.0's DIY model).
 */
const SAKIKO = {
  id: 1, kind: 'op', side: 'ally', defId: 'chess_char_6_diy1_a',
  diy: { charId: 'char_4182_oblvns', skillIndex: 0, uniEquipId: null },
  spine: 'char_4182_oblvns', avatar: 'char_4182_oblvns', name: '丰川祥子',
  tier: 6, golden: false, x: 5, y: 12, facing: 1, maxHp: 3000, spMax: 20,
};

describe('notes & Fever in a real browser (3D board forced)', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('her notes and her Fever badge draw on the real 3D board, with no page error', async () => {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: 1600, height: 900 });
    // board=3d forces the 3D board even under software rendering (the allowSlow branch of webgl2Available)
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?board=3d&panel=0&scene=prep&paused=1`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'demo boot');

    // ---- hand-drive a real battle frame loop (the shape server/sim/battle/events.js sends) ----------------------
    await page.evaluate(async (info) => {
      const v = window.__view;
      v.enterBattle({ fieldId: 'notes', kind: 'normal', stageId: 'act2autochess_m01', units: [info] });
      v.setCamera('normal');
      const [P, T] = await Promise.all([import('/js/render/style.js'), import('/js/render/textures.js')]);
      window.__probe = { P, T };
      window.__empty = false;
      let t = 0;
      window.__drive = setInterval(() => {
        t += 1 / 60;
        const x = 5 + (t % 2) * 0.5;                                  // the note drifting east, as the sim moves it
        const proj = window.__empty ? [] : [[1, x, 12, 'note']];
        const fever = window.__empty ? [[1, 40]] : [[1, Math.min(100, Math.round((t / 4) * 100))]];
        v.pushSnapshot({ t: 'b.snap', fieldId: 'notes', gt: t, units: [[1, 5, 12, 3000, 3000, 10, 20, 0, 0]], proj, fever });
      }, 16);
    }, SAKIKO);
    await new Promise((r) => setTimeout(r, 1800));

    const st = await page.evaluate(() => window.__demo.stats());
    assert.ok(st.board3d.on === true, `the 3D board really is on (${JSON.stringify(st.board3d)})`);
    assert.equal(st.mode, 'battle', 'battle mode');
    assert.ok(st.notes >= 1, `the note pool is live (stats().notes = ${st.notes})`);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'no demo error after the run');

    // ---- the note sprite: a real atlas glyph, at the snapshot's own authoritative position ----------------------
    const note = await page.evaluate(() => {
      const view = window.__view;
      const fx = view.debug.fx, interp = view.debug.interp, cam = view.debug.cam;
      const n = fx.notes.get(1);
      if (!n) return null;
      const glyphs = ['note', 'note16', 'treble'];
      // the very list this frame drew from, projected with the very camera the frame used (ground height 0)
      const list = interp.projAt(interp.renderT) || [];
      const e = list.find((p) => p[0] === 1);
      const p = e ? cam.project(e[1], e[2], 0) : null;
      return {
        visible: n.core.visible, alpha: n.core.alpha, frame: n.frame,
        glyph: glyphs.find((g) => fx.tex[g] === n.core.texture) || null,
        atlasGlyph: Object.keys(window.__probe.T.fxAtlas().tex).includes(n.frame),
        halo: n.halo.texture === fx.tex.glow, haloVisible: n.halo.visible, haloWider: n.halo.scale.x > n.core.scale.x,
        sx: n.core.scale.x, sy: n.core.scale.y, x: n.core.x, y: n.core.y, tint: n.core.tint,
        wantX: p ? p.x : null, s: p ? p.s : 0, listX: e ? e[1] : null,
      };
    });
    assert.ok(note, 'a note record exists for the snapshot id');
    assert.ok(note.visible && note.alpha > 0.9, `the note is drawn (alpha ${note.alpha})`);
    assert.ok(note.glyph, `its sprite is one of the three atlas glyphs (frame ${note.frame})`);
    assert.ok(note.atlasGlyph, 'and that frame exists in the real FX atlas');
    assert.ok(note.halo && note.haloVisible && note.haloWider, 'with its halo behind it');
    assert.ok(note.sx > 0 && note.sy > 0 && Number.isFinite(note.x) && Number.isFinite(note.y), 'with a real size and position');
    assert.equal(note.tint, 0xffe0e3, 'the talent note glyph colour (NOTE_INK.talent)');
    // drawn where the snapshot says it is (the sprite follows interp.projAt's interpolated column, in camera px). The
    // probe runs a frame or two after the frame that placed the sprite, and the note drifts 0.5 tiles/game s, so the
    // comparison allows that drift — a wrong mapping would be off by whole tiles, not by a fraction of one.
    assert.ok(Math.abs(note.x - note.wantX) < 0.15 * note.s,
      `on the projected column of the shown snapshot (${note.x} vs ${note.wantX}, s=${note.s.toFixed(1)}, x=${note.listX})`);

    // ---- the Fever badge: the charging look from the snapshot's own gauge --------------------------------------
    const badge = await page.evaluate(() => {
      const v = window.__view.debug.views.get(1);
      const r = v && v._feverIcon;
      return r ? { visible: r.root.visible, arc: r.arc.tint, track: r.track.tint, w: r.arc.width, glow: r.glow.visible, sp: v.spFill.tint, fever: v.fever, children: r.root.children.length } : null;
    });
    assert.ok(badge, 'the badge was built');
    assert.ok(badge.visible, 'and shows');
    assert.ok(badge.w >= 11 && badge.w <= 20, `its size is inside the px clamps (${badge.w})`);
    assert.equal(badge.children, 3, 'halo + track + arc: the inner ring only (no disc, no outer circle)');
    assert.equal(badge.arc, 0xe8467c, 'the filling ring is the Fever rose (FEVER_ROSE)');
    assert.equal(badge.track, 0x6d2139, 'over the dimmed rose track (FEVER_ROSE_DIM) — no 50 % tick');

    // ---- …then the state: the sim's visible 'sakiko:fever' status event (the production path) ------------------
    await page.evaluate(() => {
      // stamped just ahead of the render clock, the way a live frame is (a state event is delivered even when late)
      const view = window.__view;
      const gt = view.debug.interp.renderT + 0.1;
      view.pushEvents({ t: 'b.ev', fieldId: 'notes', gt, ev: [['status', 1, 'sakiko:fever', 1]] });
    });
    await new Promise((r) => setTimeout(r, 700));
    const active = await page.evaluate(() => {
      const v = window.__view.debug.views.get(1);
      const r = v._feverIcon;
      const P = window.__probe.P;
      return {
        feverActive: v.feverActive(), arc: r.arc.tint, track: r.track.tint, rose: P.FEVER_ROSE, hi: P.FEVER_ROSE_HI,
        glow: r.glow.visible, glowTint: r.glow.tint, spTint: v.spFill.tint, gauge: v.fever,
      };
    });
    assert.equal(active.feverActive, true, "the sim's 'sakiko:fever' status reached the view");
    assert.equal(active.arc, active.hi, 'the filling ring switches to FEVER_ROSE_HI');
    assert.equal(active.track, active.rose, 'and the whole badge takes the state colour');
    assert.equal(active.glow, true, 'the halo breathes while Fever runs');
    assert.equal(active.glowTint, active.hi);
    assert.equal(active.spTint, active.rose, `her SP bar turns the same rose (tint ${active.spTint?.toString(16)})`);

    await page.screenshot({ path: path.join(OUT, 'render-notes-fever-3d.png') });

    // ---- her notes leave the snapshot: they fade out and are pooled (never leaked) -----------------------------
    await page.evaluate(() => { window.__empty = true; });
    await new Promise((r) => setTimeout(r, 900));
    const after = await page.evaluate(() => ({ notes: window.__view.debug.fx.notes.size, free: window.__view.debug.fx.noteFree.length, stats: window.__demo.stats().notes }));
    assert.equal(after.notes, 0, 'a snapshot without her notes fades them out and pools them');
    assert.equal(after.stats, 0);
    assert.ok(after.free >= 1, `the record went back to the pool (${after.free})`);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'still no demo error');
    await page.evaluate(() => clearInterval(window.__drive));

    await page.close();
    assert.deepEqual(problems, []);
  });
});
