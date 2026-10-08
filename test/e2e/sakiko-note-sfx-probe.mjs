// E2E probe (observation only, NOT a test file): 丰川祥子's note launch sound, measured on a real browser.
//
//   $env:CHROME_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
//   node test/e2e/sakiko-note-sfx-probe.mjs
//
// Starts its OWN fast server on a free port (never the owner's 3000), joins as one human, forces her 自选 pick through
// /dev/grant (SP_DEV_GRANT=1) so the hand gets chess_char_6_diy1_a as char_4182_oblvns, lets SP_AUTO_PLACE deploy it
// and plays one combat. The page hooks `AudioManager.prototype.playProj` and `._play` — and `FxSystem.prototype.syncNotes`
// — so every launch request and every real playback is recorded with its URL and timestamp, next to the snapshot's own
// `proj` list. Prints the raw log; writes test/e2e/out/sakiko-note-sfx-probe.json.

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Client, OUT, sleep, startRealServer } from './client.mjs';

const CHAR = 'char_4182_oblvns';
// `--skill=<0|1|2>`: her 自选 skill (0 = S1 八音 fan, 1 = S2 满月的舞会, 2 = S3 残月的余响). S1 fires her SKILL notes
// with nothing to hit, so it is the one that proves the `noteSkill` kind end to end.
const SKILL = (() => {
  const arg = process.argv.find((a) => a.startsWith('--skill='));
  const v = arg ? Number(arg.slice('--skill='.length)) : 2;
  return Number.isInteger(v) && v >= 0 && v <= 2 ? v : 2;
})();
const TAG = `skill${SKILL}`;
const TALENT_BORN = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt.mp3';
const SKILL_BORN = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt_r.mp3';
const SWING = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt.mp3';
const HIT = '/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt.mp3';

const log = (...a) => console.log(...a);

/** Installed before any game script runs: wraps the audio entry points and the renderer's note sync. */
function hookScript() {
  return () => {
    const out = { plays: [], projCalls: [], noteKinds: [], frames: [], errors: [] };
    globalThis.__SFX_PROBE__ = out;
    let audioMod = null;
    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const load = () => {
      if (!audioMod) {
        audioMod = import('/js/audio.js').then((m) => {
          const A = m.AudioManager.prototype;
          out.audioMod = { exported: Object.keys(m).length, hasProjSfxUrl: typeof m.projSfxUrl, sameProto: true };
          if (!A.__probe) {
            A.__probe = true;
            const origPlay = A.playProj;
            A.playProj = function (kind, o) {
              let url = null; let err = null;
              try { url = m.projSfxUrl(this.getManifest(), kind, (o && o.role) || 'born', (o && o.unit) || null); } catch (e) { err = String(e); }
              out.projCalls.push({ t: now(), kind, unitId: o && o.unitId, unit: o && o.unit, url, err, hasCtx: !!this.ctx });
              return origPlay.call(this, kind, o);
            };
            const origPlay2 = A._play;
            A._play = function (url, opts) {
              const o = opts || {};
              out.plays.push({ t: now(), url, volume: o.volume, limited: !!o.limited, unitKey: o.unitKey ?? null, hasCtx: !!this.ctx, muted: !!this.volumes?.muted, sfx: this.volumes?.sfx });
              return origPlay2.call(this, url, opts);
            };
            // the singleton the renderer imports is the SAME object this prototype backs; expose it for direct pokes
            import('/js/render/fx/notes.js').then((n) => {
              out.notesModule = { hasClass: typeof n.FxNotes, hasPick: typeof n.pickNoteFrame };
              const N = n.FxNotes.prototype;
              if (!N.__probe) {
                N.__probe = true;
                const origFired = N._noteFired;
                N._noteFired = function (kind, x, y, sink) {
                  // instrument the ORIGINAL body's own decisions: which object does `sink ?? audio` resolve to, and what
                  // does that object's `play` look like? (`this.time` and `_noteOwner` are recorded above.)
                  const api = sink ?? null;
                  const rec = { t: now(), kind, x, y, time: this.time, sink: sink === undefined ? 'undefined' : (sink === null ? 'null' : typeof sink), owner: this._noteOwner(x, y) };
                  out.fired = out.fired || [];
                  if (out.fired.length < 60) out.fired.push(rec);
                  else if (out.fired.length === 60) out.fired.push({ t: now(), note: 'truncated' });
                  // the module the FxNotes file itself imported: ask it directly (a second import returns the same instance)
                  import('/js/audio.js').then((m) => {
                    const a = m.audio;
                    rec.audioSingleton = !!a;
                    rec.audioPlayType = typeof a?.play;
                    rec.audioCtx = !!a?.ctx;
                    rec.audioPlayProjType = typeof a?.playProj;
                    rec.playProjSource = typeof a?.playProj === 'function' ? String(a.playProj).slice(0, 220) : null;
                    try { rec.playReturns = typeof a?.play === 'function' ? a.play(kind, { unitId: rec.owner?.id ?? null, unit: rec.owner?.def ?? null }) : 'no play'; } catch (e) { rec.playThrew = String(e); }
                    rec.playsAfter = out.plays.length;
                  }).catch((e) => { rec.err = String(e); });
                  void api;
                  return origFired.call(this, kind, x, y, sink);
                };
              }
            }).catch((e) => { out.errors.push(`notes import: ${e}`); });
          }
          return m;
        }).catch((e) => { out.errors.push(`audio import: ${e}`); return null; });
      }
      return audioMod;
    };
    // poll: the audio module is imported by main.js at startup; wrapping the prototype before that is fine, but the
    // export must exist first. Retry until it does (a few frames at most).
    const iv = setInterval(() => { load().then((m) => { if (m) clearInterval(iv); }); }, 50);
    // the renderer's own view of the notes: which ids/kinds appeared and when, plus the fx clock
    const loadFx = () => {
      import('/js/render/fx.js').then((m) => {
        const P = m.FxSystem && m.FxSystem.prototype;
        if (P && !P.__probe) {
          P.__probe = true;
          const orig = P.syncNotes;
          P.syncNotes = function (list, sink) {
            try {
              if (Array.isArray(list)) {
                const ids = new Set(this.notes.keys());
                for (const e of list) {
                  if (!Array.isArray(e) || e.length < 3) continue;
                  if (!ids.has(e[0])) {
                    out.noteKinds.push({ t: now(), id: e[0], kind: e[3], time: this.time, x: e[1], y: e[2] });
                  }
                }
                out.frames.push({ t: now(), n: list.length, kinds: [...new Set(list.map((e) => e && e[3]))], time: Math.round(this.time * 1000) / 1000 });
                if (out.frames.length > 4000) out.frames.splice(0, 2000);
              }
            } catch (e) { out.errors.push(`syncNotes probe: ${e}`); }
            return orig.call(this, list, sink);
          };
        }
      }).catch(() => {});
    };
    const iv2 = setInterval(() => { loadFx(); }, 200);
    setTimeout(() => clearInterval(iv2), 120000);
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const srv = await startRealServer({
    env: { SP_DEV_GRANT: '1' },
    fast: {
      timerScale: 0.5, combatSpeed: 1, startRound: 1, kit: 0, level: 6,
      // no starter operators: her 自选 slot is the only piece the hand gets (via /dev/grant)
      autoPlace: true,
    },
  });
  log(`probe server: ${srv.base}`);
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'note-sfx', { prefix: `note-sfx-${TAG}` });
  const result = { base: srv.base, phases: [], projKinds: {}, plays: [], projCalls: [], notes: [], errors: [], logs: [] };
  try {
    await c.open('');
    await c.page.evaluateOnNewDocument(hookScript());
    await c.page.reload({ waitUntil: 'domcontentloaded' });
    await c.page.waitForFunction(() => !!globalThis.__SFX_PROBE__, { timeout: 20000 });
    await c.enter('音符探针');
    // solo match
    await c.click('.mode-card', '独立模拟');
    await c.click('.diff-card', '标准模拟');
    await c.click('.create-box button', '开始独立模拟');
    await c.waitFor((s) => !!s.room, 'solo room');
    if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
    await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 40000);
    // get through the draft
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 40000);
    await c.click('.dband', null, { nth: 1 });
    await c.click('.draft-detail__btns .btn--primary', '确认选择');
    // PREP: force her pick + hand the piece, then let auto-place deploy it
    let st = await c.waitFor((s) => s.phase === 'PREP', 'prep', 90000);
    log(`prep r${st.round}, room ${st.room?.code}, funds ${st.funds}, level ${st.level}`);
    const room = st.room?.code;
    const grantRes = await fetch(`${srv.base}/dev/grant?room=${room}&diy=${CHAR}&skill=${SKILL}`).catch((e) => ({ status: 0, text: () => Promise.resolve(String(e)) }));
    const grantText = await grantRes.text();
    let grant = {};
    try { grant = JSON.parse(grantText); } catch { grant = { parse: false, raw: grantText.slice(0, 300) }; }
    log(`grant HTTP ${grantRes.status}: ${JSON.stringify({ ok: grant.ok, error: grant.error, detail: grant.detail, resolved: grant.resolved, granted: grant.granted, failed: grant.failed, notes: grant.notes })}`);
    result.grant = { ok: grant.ok, resolved: grant.resolved, granted: grant.granted, failed: grant.failed, notes: grant.notes };
    await sleep(2500);
    const board = await c.boardPieces();
    const hand = await c.handPieces();
    const raw = await c.page.evaluate(() => {
      const p = globalThis.__SP__.store.get().match.private;
      return { hand: (p?.hand || []).map((x) => x && `${x.kind}:${x.id}#${x.uid}`), temp: (p?.temp || []).map((x) => x && `${x.kind}:${x.id}`), board: (p?.board || []).map((x) => x && `${x.kind}:${x.id}@${x.row},${x.col}`), deployCap: p?.deployCap, deployCount: p?.deployCount, ready: p?.ready, diy: p?.diy };
    });
    log(`board after grant: ${JSON.stringify(board)}`);
    log(`hand after grant: ${JSON.stringify(hand)}`);
    log(`private: ${JSON.stringify(raw)}`);
    result.board = board; result.hand = hand; result.priv = raw;
    // the hand piece must be DEPLOYED (SP_AUTO_PLACE ran at the round jump, before the grant): real drag → direction wheel
    const piece = hand[0];
    if (piece) {
      const tile = await c.freeTileFor(piece.uid);
      log(`deploying uid ${piece.uid} to ${JSON.stringify(tile)}`);
      if (tile) {
        const from = await c.piecePoint(piece.uid);
        const to = await c.tilePoint(tile.row, tile.col);
        log(`drag ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
        await c.drag(from, to);
        await c.page.waitForSelector('.fwheel__dia', { timeout: 5000 }).then(() => c.swipe('RIGHT'), () => log('no direction wheel'));
        const placed = await c.waitFor((s) => s.board > 0, 'placed', 12000).then((s) => s, (e) => ({ err: String(e.message).slice(0, 200) }));
        log(`after deploy: ${JSON.stringify(placed)}`);
        result.placed = placed;
      }
    }
    // ready up and watch the fight
    await c.click('.readybtn');
    st = await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 90000);
    log(`combat r${st.round}`);
    const t0 = Date.now();
    const marks = [];
    while (Date.now() - t0 < 75000) {
      const s = await c.st();
      marks.push(`${Math.round((Date.now() - t0) / 100) / 10}s ${s.phase} r${s.round} status=${s.status}`);
      if (s.phase !== 'COMBAT') break;
      await sleep(2000);
    }
    result.phases = marks;
    log(`phases:\n  ${marks.join('\n  ')}`);
    const probe = await c.page.evaluate(() => globalThis.__SFX_PROBE__);
    result.plays = probe.plays;
    result.projCalls = probe.projCalls;
    result.notes = probe.noteKinds;
    result.errors = probe.errors;
    result.fired = probe.fired || null;
    result.audioMod = probe.audioMod || null;
    result.notesModule = probe.notesModule || null;
    const frames = probe.frames || [];
    result.frames = frames.length;
    result.projKinds = {};
    for (const f of frames) for (const k of f.kinds) result.projKinds[k || '(none)'] = (result.projKinds[k || '(none)'] || 0) + 1;
    log(`\n=== snapshot proj kinds seen: ${JSON.stringify(result.projKinds)} (over ${frames.length} syncNotes calls)`);
    log(`=== note ids born (${probe.noteKinds.length}):`);
    for (const n of probe.noteKinds.slice(0, 60)) log(`   t=${n.t}ms id=${n.id} kind=${n.kind} fx.time=${n.time} @(${n.x},${n.y})`);
    const byKind = {};
    for (const n of probe.noteKinds) byKind[n.kind || '(none)'] = (byKind[n.kind || '(none)'] || 0) + 1;
    log(`=== note ids by kind: ${JSON.stringify(byKind)}`);
    log(`=== playProj calls (${probe.projCalls.length}):`);
    log(`=== audio module probe: ${JSON.stringify(probe.audioMod)} notes module: ${JSON.stringify(probe.notesModule)}`);
    log(`=== _noteFired calls (${(probe.fired || []).length}):`);
    for (const f of (probe.fired || []).slice(0, 40)) log(`   ${JSON.stringify(f)}`);
    for (const p of probe.projCalls.slice(0, 80)) log(`   t=${p.t}ms kind=${p.kind} unitId=${p.unitId} url=${p.url}`);
    log(`=== _play calls (${probe.plays.length}):`);
    const counts = {};
    for (const p of probe.plays) counts[p.url] = (counts[p.url] || 0) + 1;
    for (const [url, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) log(`   ${String(n).padStart(4)} × ${url}`);
    log(`\n   talent born ${TALENT_BORN}: ${counts[TALENT_BORN] || 0} plays`);
    log(`   skill  born ${SKILL_BORN}: ${counts[SKILL_BORN] || 0} plays`);
    log(`   swing       ${SWING}: ${counts[SWING] || 0} plays`);
    log(`   impact      ${HIT}: ${counts[HIT] || 0} plays`);
    log(`=== probe errors: ${JSON.stringify(probe.errors)}`);
    const around = probe.plays.filter((p) => [TALENT_BORN, SKILL_BORN, SWING, HIT].includes(p.url));
    log(`=== the four files, in order (first 60):`);
    for (const p of around.slice(0, 60)) log(`   t=${p.t}ms ${p.url.split('/').pop()} vol=${p.volume} key=${p.unitKey} ctx=${p.hasCtx}`);
    // the audible question of the report: how far apart is her swing from the note's launch?
    const deltas = [];
    for (const p of probe.plays) {
      if (p.url !== SWING) continue;
      const born = probe.plays.find((q) => q.url === TALENT_BORN && q.t >= p.t - 50);
      if (born) deltas.push(born.t - p.t);
    }
    log(`=== 挥击 → 天赋音符诞生 Δms (${deltas.length} pairs): ${JSON.stringify(deltas)}`);
    result.deltas = deltas;
    log(`=== client problems: ${JSON.stringify(c.problems.slice(0, 10))}`);
  } finally {
    try { writeFileSync(path.join(OUT, `sakiko-note-sfx-probe-${TAG}.json`), JSON.stringify(result, null, 1)); log(`wrote ${path.join(OUT, `sakiko-note-sfx-probe-${TAG}.json`)}`); } catch (e) { log(`json write failed: ${e}`); }
    await c.close();
    await srv.stop();
  }
}

// Not a test file: `node --test` runs everything under test/, so it is a no-op module there (the `fastServer.mjs`
// convention — a probe must never start a server and a browser in the middle of the suite).
if (!process.env.NODE_TEST_CONTEXT) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
