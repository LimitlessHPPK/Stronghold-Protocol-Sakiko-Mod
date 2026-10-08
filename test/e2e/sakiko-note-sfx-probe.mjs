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
// `--units=<n>`: hand out n copies of her 自选 piece (the 自选 slot is per PIECE uid, so n pieces of one chess place n
// units of her on one field) — the two-of-her report 「场上有两只丰川祥子时，似乎只播放其中一只的音效」, and the
// note storm it makes (挥击 + 音符诞生 + 音符命中 per attack, times n) is what starves the shared SFX limiter.
const UNITS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--units='));
  const v = arg ? Number(arg.slice('--units='.length)) : 1;
  return Number.isInteger(v) && v >= 1 && v <= 4 ? v : 1;
})();
// `--combat=<s>`: how long the probe watches the fight. Her S3 costs 47 SP with 28 initial and spType
// INCREASE_WHEN_ATTACK (1 per attack, bat 1.3 s), so ~25 s of fighting before it can even be cast — the default 75 s
// window is what lets the S3 cast cue be measured at all.
const COMBAT_S = (() => {
  const arg = process.argv.find((a) => a.startsWith('--combat='));
  const v = arg ? Number(arg.slice('--combat='.length)) : 75;
  return Number.isFinite(v) && v >= 10 && v <= 300 ? v : 75;
})();
// `--tanky=<n>`: multiply every ENEMY's maxHp by n **in the browser's own simulation data** (nothing server-side, no game
// code touched: the probe wraps `loadBrowserSim` of public/js/battle/runner.js, the module the client's own battle runner
// imports, and scales `raw.enemies[*].stats.maxHp` before the runner freezes it). A wave of round 1 dies in ~18 s, which
// is *less* than the ~25 s her S3 needs to charge from its 28 initial SP: without this the skill is never cast at all and
// its cue cannot be observed. The fight still runs, she still attacks at the same rate, only the enemies take longer to
// fall. The client simulates its own battle (server/sim served at /sim/), so this changes what the PROBE sees, not the
// game: a default run (n = 1) patches nothing.
const TANKY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--tanky='));
  const v = arg ? Number(arg.slice('--tanky='.length)) : 1;
  return Number.isFinite(v) && v >= 1 && v <= 200 ? v : 1;
})();
// `--sp=<n>`: her SP fills n× as fast **in the browser's own simulation** (the probe wraps `Skill.prototype.gainSp` of
// /sim/skills.js — no game code touched, and a run without the flag patches nothing). Round 1 lasts ~18 s and she casts
// S2 (cost 5, +1 per attack at bat 1.3 s) about once in it, which is too few samples to see WHICH impact file a skill
// note plays; S1 (cost 4) and S3 (47) need the same help at the other end of the scale.
const SP_MULT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--sp='));
  const v = arg ? Number(arg.slice('--sp='.length)) : 1;
  return Number.isFinite(v) && v >= 1 && v <= 50 ? v : 1;
})();
const TAG = `skill${SKILL}${UNITS > 1 ? `-x${UNITS}` : ''}`;
const TALENT_BORN = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt.mp3';
const SKILL_BORN = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt_r.mp3';
const SWING = '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt.mp3';
const HIT = '/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt.mp3';

const log = (...a) => console.log(...a);

/** Installed before any game script runs: wraps the audio entry points and the renderer's note sync. */
function hookScript() {
  return () => {
    const out = { plays: [], projCalls: [], noteKinds: [], frames: [], errors: [], limited: [], skills: [] };
    globalThis.__SFX_PROBE__ = out;
    let audioMod = null;
    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const load = () => {
      if (!audioMod) {
        audioMod = import('/js/audio.js').then((m) => {
          const A = m.AudioManager.prototype;
          out.audioMod = { exported: Object.keys(m).length, hasProjSfxUrl: typeof m.projSfxUrl };
          if (!A.__probe) {
            A.__probe = true;
            // THE LIMITER: which sounds were ACQUIRED (from the caller's side) and which were refused, with the state
            // the decision was made on. `_play` below only records what really started, so a sound missing there but
            // present here is one the SfxLimiter refused — the difference the 「大招音哑了」 report is about.
            const L = m.SfxLimiter.prototype;
            if (!L.__probe) {
              L.__probe = true;
              const origAcq = L.tryAcquire;
              L.tryAcquire = function (nowMs, unitKey, url, pri) {
                const active = this.active, perUrl = this.activeByUrl.get(url) || 0;
                const lastUnit = unitKey != null ? this.lastByUnit.get(unitKey) : undefined;
                const lastUrl = unitKey != null ? this.lastByUrlUnit.get(`${unitKey}\u0000${url}`) : this.lastByUrl.get(url);
                const ok = origAcq.call(this, nowMs, unitKey, url, pri);
                if (out.limited.length < 4000) {
                  const why = ok ? 'ok'
                    : active >= this.maxVoices ? 'voices'
                      : perUrl >= this.maxPerUrl ? 'perUrl'
                        : (lastUnit != null && nowMs - lastUnit < this.unitCooldownMs) ? 'unitCooldown'
                          : (lastUrl != null && nowMs - lastUrl < this.urlGapMs) ? 'urlGap' : 'other';
                  out.limited.push({ t: now(), url, unitKey: unitKey ?? null, pri: pri ?? null, ok, why, active, maxVoices: this.maxVoices, perUrl });
                }
                return ok;
              };
            }
            const origPlay = A.playProj;
            A.playProj = function (kind, o) {
              let url = null; let err = null;
              try { url = m.projSfxUrl(this.getManifest(), kind, (o && o.role) || 'born', (o && o.unit) || null); } catch (e) { err = String(e); }
              // 按技能细分: which note file the manifest carries for THIS unit's equipped skill, beside the kind's own —
              // `null` unless the `skillSfx` section exists, so the log says out loud whether the per-skill data is in
              const u = o && o.unitId != null ? this.units.get(o.unitId) : null;
              let skillUrl = null;
              try { skillUrl = m.skillSfxUrl(this.getManifest(), (o && o.unit) || null, u?.skillIndex ?? null, 'born'); } catch { /* ignore */ }
              out.projCalls.push({ t: now(), kind, unitId: o && o.unitId, unit: o && o.unit, url, skillUrl, skillIndex: u?.skillIndex ?? null, err, hasCtx: !!this.ctx });
              return origPlay.call(this, kind, o);
            };
            // the 'skill' tuples the page really receives (the event the S3 cast cue hangs on) + what the manager did
            const origEv = A.handleBattleEvents;
            A.handleBattleEvents = function (ev) {
              const before = out.skills.length;
              const r = origEv.call(this, ev);   // the scope is set BY the handler: read it after, never before
              try {
                for (const e of Array.isArray(ev) ? ev : []) {
                  if (!Array.isArray(e) || e[0] !== 'skill' || out.skills.length >= 200) continue;
                  const u = this.units.get(e[1]);
                  const mf = this.getManifest();
                  const skills = u ? mf?.audio?.sfx?.units?.[u.def]?.skills : null;
                  out.skills.push({ t: now(), unit: e[1], start: !!e[2], def: u?.def ?? null, skillIndex: u?.skillIndex ?? null,
                    url: skills && u ? (skills[u.skillIndex] ?? skills[0] ?? null) : null, playsBefore: out.plays.length,
                    // 按技能细分: the scope the event LEFT BEHIND (`activeSkill`), so the log says whether a skill note
                    // landing after this cast can resolve ITS skill's own `hit`
                    scope: this.activeSkill.get(e[1]) ?? null, recent: this.recentSkill.get(e[1])?.index ?? null,
                    // …and the manifest data the scope is computed from, straight out of the page. `loop=null` for S1/S2
                    // is correct (neither is sustained, so neither starts a scope) — `hit` is what the impacts need.
                    manifestSkillSfx: mf?.audio?.sfx?.units?.[u?.def ?? '']?.skillSfx ?? null,
                    lookupLoop: u ? m.skillSfxUrl(mf, u.def, u.skillIndex, 'loop') : null,
                    lookupHit: u ? m.skillSfxUrl(mf, u.def, u.skillIndex, 'hit') : null });
                }
              } catch (err) { out.errors.push(`skill probe: ${err}`); }
              void before;
              return r;
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

/**
 * `--tanky=<n>`: the enemies of the CLIENT's own battle simulation are n× as durable, so the round lasts long enough for
 * her S3 (~25 s to charge from its 28 initial SP) to be cast at all. Nothing server-side and no game code is touched:
 * this wraps `globalThis.fetch` before any game script runs and scales `data/enemies.json` on the way in — the data the
 * browser's own battle runner (`public/js/battle/runner.js loadBrowserSim`) freezes into its simulation. A run without
 * `--tanky` patches nothing.
 *
 * NB the constant is captured in the CLOSURE (the returned function reads it), and it is passed as NO argument: this
 * puppeteer's `evaluateOnNewDocument(fn, …args)` does not forward the args (verified: `arg === undefined` in the page
 * while the same function called directly works), so a parameterised injection silently did nothing at all.
 */
function tankyFetch() {
  const mult = TANKY;
  return () => {
    if (!(mult > 1)) return;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => {
      const res = await origFetch(u, o);
      const url = typeof u === 'string' ? u : (u && u.url) || '';
      if (/\/data\/enemies\.json(\?|$)/.test(url) && res && res.ok) {
        try {
          const j = await res.clone().json();
          let n = 0;
          for (const e of Object.values(j || {})) {
            if (e && e.stats && Number.isFinite(e.stats.maxHp)) { e.stats.maxHp = Math.round(e.stats.maxHp * mult); n += 1; }
          }
          globalThis.__SFX_PROBE__.tanky = { mult, enemies: n };
          return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
        } catch { /* fall through to the original response */ }
      }
      return res;
    };
  };
}

/**
 * `--sp=<n>`: the CLIENT's own battle simulation gains SP n× as fast (see the SP_MULT note). Wraps
 * `Skill.prototype.gainSp` of the module the browser sim loads from `/sim/skills.js`; a run without the flag does
 * nothing. `gainSp(amount, …)` is called with 1 for an attack, so scaling the AMOUNT is exactly "SP fills faster".
 * The multiplier travels in the closure for the reason `tankyFetch` documents (this puppeteer forwards no args).
 */
function spFetch() {
  const mult = SP_MULT;
  return () => {
    if (!(mult > 1)) return;
    const iv = setInterval(() => {
      import('/sim/skills.js').then((m) => {
        const P = m.Skill?.prototype ?? m.default?.prototype;
        if (!P || P.__spProbe) return;
        P.__spProbe = true;
        const orig = P.gainSp;
        P.gainSp = function (amount, ...rest) {
          return orig.call(this, (Number.isFinite(amount) ? amount : 0) * mult, ...rest);
        };
        clearInterval(iv);
      }).catch(() => {});
    }, 50);
    setTimeout(() => clearInterval(iv), 120000);
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
    if (TANKY > 1) await c.page.evaluateOnNewDocument(tankyFetch());
    if (SP_MULT > 1) await c.page.evaluateOnNewDocument(spFetch());
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
    const grants = [];
    for (let n = 0; n < UNITS; n++) {
      // each /dev/grant hands ONE piece of her 自选 slot (a new uid, same chess), so n calls deploy n units of her
      const grantRes = await fetch(`${srv.base}/dev/grant?room=${room}&diy=${CHAR}&skill=${SKILL}`).catch((e) => ({ status: 0, text: () => Promise.resolve(String(e)) }));
      const grantText = await grantRes.text();
      let grant = {};
      try { grant = JSON.parse(grantText); } catch { grant = { parse: false, raw: grantText.slice(0, 300) }; }
      grants.push({ status: grantRes.status, ok: grant.ok, granted: grant.granted, failed: grant.failed, notes: grant.notes });
      log(`grant #${n + 1} HTTP ${grantRes.status}: ${JSON.stringify({ ok: grant.ok, error: grant.error, detail: grant.detail, resolved: grant.resolved?.charId, granted: grant.granted, failed: grant.failed, notes: grant.notes })}`);
      await sleep(1200);
    }
    result.grant = grants.length === 1 ? grants[0] : grants;
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
    // every handed piece must be DEPLOYED (SP_AUTO_PLACE ran at the round jump, before the grant): real drag → wheel
    for (const piece of hand.filter(Boolean)) {
      const tile = await c.freeTileFor(piece.uid);
      log(`deploying uid ${piece.uid} to ${JSON.stringify(tile)}`);
      if (!tile) continue;
      const from = await c.piecePoint(piece.uid);
      const to = await c.tilePoint(tile.row, tile.col);
      log(`drag ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
      await c.drag(from, to);
      await c.page.waitForSelector('.fwheel__dia', { timeout: 5000 }).then(() => c.swipe('RIGHT'), () => log('no direction wheel'));
      const placed = await c.waitFor((s) => s.board > (result.placed?.board ?? 0), 'placed', 12000).then((s) => s, (e) => ({ err: String(e.message).slice(0, 200) }));
      log(`after deploy: board=${placed.board ?? '?'} ${placed.err ? `err=${placed.err}` : ''}`);
      result.placed = placed;
    }
    // ready up and watch the fight
    await c.click('.readybtn');
    st = await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 90000);
    log(`combat r${st.round}`);
    const t0 = Date.now();
    const marks = [];
    while (Date.now() - t0 < COMBAT_S * 1000) {
      const s = await c.st();
      marks.push(`${Math.round((Date.now() - t0) / 100) / 10}s ${s.phase} r${s.round} status=${s.status} board=${s.board}`);
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
    result.limited = probe.limited || [];
    result.skillEvents = probe.skills || [];
    result.tanky = probe.tanky || null;
    // ---- the manifest the PAGE holds, straight out of its own module: the ground truth for the lookups above -------
    const pageManifest = await c.page.evaluate(async () => {
      try {
        const m = await import('/js/audio.js');
        const mf = m.audio.getManifest();
        const s = mf?.audio?.sfx?.units?.char_4182_oblvns?.skillSfx;
        return {
          units: Object.keys(mf?.audio?.sfx?.units ?? {}).length,
          herKeys: Object.keys(mf?.audio?.sfx?.units?.char_4182_oblvns ?? {}),
          skillSfx: s ?? null,
          hit0: m.skillSfxUrl(mf, 'char_4182_oblvns', 0, 'hit'),
          hit1: m.skillSfxUrl(mf, 'char_4182_oblvns', 1, 'hit'),
          hit2: m.skillSfxUrl(mf, 'char_4182_oblvns', 2, 'hit'),
          loop2: m.skillSfxUrl(mf, 'char_4182_oblvns', 2, 'loop'),
        };
      } catch (e) { return { err: String(e) }; }
    }).catch((e) => ({ err: String(e) }));
    result.pageManifest = pageManifest;
    log(`=== the manifest IN THE PAGE: ${JSON.stringify(pageManifest)}`);
    // ---- 按技能细分: which impact file did each skill note really play? ------------------------------------------
    const skillHits = (probe.plays || []).filter((p) => /\/player\/p_imp\/p_imp_mjcky/i.test(p.url));
    result.skillHits = skillHits;
    log(`tanky enemies scaled: ${JSON.stringify(probe.tanky || null)}`);
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
    // ---- the SFX limiter: what was ACQUIRED vs REFUSED (the 「大招音哑了」 question) -------------------------------
    const lim = probe.limited || [];
    const refused = lim.filter((x) => !x.ok);
    const why = {};
    for (const x of refused) why[x.why] = (why[x.why] || 0) + 1;
    log(`\n=== SfxLimiter.tryAcquire calls: ${lim.length} (acquired ${lim.length - refused.length}, refused ${refused.length}) by reason: ${JSON.stringify(why)}`);
    const refusedByUrl = {};
    for (const x of refused) refusedByUrl[x.url] = (refusedByUrl[x.url] || 0) + 1;
    for (const [url, n] of Object.entries(refusedByUrl).sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`   ${String(n).padStart(4)} × refused ${url}`);
    log(`=== every 技能发动 (['skill', id, 1]) the page saw: ${(probe.skills || []).length} tuples`);
    for (const s of (probe.skills || []).slice(0, 40)) log(`   t=${s.t}ms unit=${s.unit} ${s.start ? 'START' : 'end  '} def=${s.def} skillIndex=${s.skillIndex} scope=${s.scope} recent=${s.recent} skillUrl=${s.url}`);
    const SKILL_CUE = '/assets/audio/sfx/player/p_skill/p_skill_mjckyrdslnt_s1.mp3';
    const starts = (probe.skills || []).filter((s) => s.start);
    const cuePlays = probe.plays.filter((p) => p.url === SKILL_CUE);
    log(`=== S3 cast cue ${SKILL_CUE}: ${cuePlays.length} real _play calls, ${starts.length} START tuples`);
    for (const p of cuePlays.slice(0, 20)) log(`   t=${p.t}ms vol=${p.volume} key=${p.unitKey} ctx=${p.hasCtx}`);
    for (const s of starts) {
      const cue = (probe.skills || []).find((x) => x.t >= s.t && x.t <= s.t + 4000 && x.url === SKILL_CUE);
      log(`   START t=${s.t}ms unit=${s.unit} (skillUrl=${s.url}) ⇒ SFX plays in the next 3 s: ${probe.plays.filter((p) => p.t > s.t && p.t < s.t + 3000).length}${cue ? '' : ''}`);
    }
    const around = probe.plays.filter((p) => [TALENT_BORN, SKILL_BORN, SWING, HIT].includes(p.url));
    log(`=== the four files, in order (first 60):`);
    for (const p of around.slice(0, 60)) log(`   t=${p.t}ms ${p.url.split('/').pop()} vol=${p.volume} key=${p.unitKey} ctx=${p.hasCtx}`);
    // ---- 按技能细分: which impact file did each skill note really play? ------------------------------------------
    const byFile = {};
    for (const p of skillHits) byFile[p.url.split('/').pop()] = (byFile[p.url.split('/').pop()] || 0) + 1;
    log(`\n=== skill-note impact sounds actually played (${skillHits.length} _play calls):`);
    for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) log(`   ${String(n).padStart(4)} × ${f}`);
    const perSkillBorn = (probe.projCalls || []).filter((c) => c.skillUrl);
    log(`=== note launches whose unit carries a per-skill \`born\` in the manifest: ${perSkillBorn.length}`);
    for (const c of perSkillBorn.slice(0, 6)) log(`   t=${c.t}ms kind=${c.kind} unitId=${c.unitId} skillIndex=${c.skillIndex} skillUrl=${c.skillUrl} (kind url ${c.url})`);
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
