// tools/fetch-voice-override.mjs — download the audio of the operators tools/assets/plan.mjs re-points or names
// differently from the official convention: their battle lines (VOICE_LANG_OVERRIDE) and their skill sounds
// (--sfx, audio.mjs SKILL_START_BANKS).
//
// Why this exists: 丰川祥子 (char_4182_oblvns), the Ave Mujica collaboration operator this repo adds locally as a 自选
// pick, has no Chinese battle voice anywhere upstream — `voice_cn/char_4182_oblvns/cn_019.mp3` … `cn_032.mp3` answer
// 404 for every one of her fourteen battle lines, while the JP dump `voice/` carries all of them (the same file names;
// the whole collaboration is like that: 祐天寺若麦 / 三角初华 / 若叶睦 are 404 there too). plan.mjs
// VOICE_LANG_OVERRIDE is what sends her entries to the JP dump; this script is what puts the files on disk. `--sfx`
// does the same for her three skill activation sounds, whose banks are named differently from
// `battle.ON_SKILL_START.<skillId>` (audio.mjs SKILL_START_BANKS; user report "放大招没音效"), and for the launch sound
// of her 音符 (audio.mjs PROJECTILE_SFX_BANKS / manifest `audio.sfx.proj`; user report "音符诞生没有音效" — the file
// `p_atk_MJCkyrdnt` was on no machine, because only a real download run ever fetches it).
//
// `node tools/fetch-assets.mjs` alone cannot do it on a machine whose hosts file sends raw.githubusercontent.com to
// 127.0.0.1: the voice branch has no jsDelivr mirror at all (sources.mjs mirrorUrl returns null for it), so a direct
// run only ever tries the blocked raw URL — which is also where every SFX file lives
// (`audio/sound_beta_2/**` of the same branch). The files are therefore fetched with curl through the project's own
// opt-in GitHub proxy — `process.env.SP_GITHUB_PROXY`, in the order `--asset-source=mirror` uses: proxy first, then the
// direct URL. (curl, not the downloader's fetch: the latter needs `node --use-system-ca` on a machine whose system CA
// store differs from Node's bundled one, which a script cannot turn on for itself.)
//
// What it writes is exactly what the plan resolves — the path voiceAlt() / soundAlt() computes, i.e.
// `public/assets/audio/voice/<lang>/<charId>/cn_nnn.mp3` and `public/assets/audio/sfx/<the bank's path>` — validated
// with the same formats.mjs check the downloader applies. So the sequence is:
//
//   node tools/fetch-voice-override.mjs        # the missing lines (public/assets is git-ignored)
//   node tools/fetch-voice-override.mjs --sfx  # the missing skill sounds
//   node tools/fetch-assets.mjs --offline      # → data/assets.json picks them up
//
// Idempotent: a valid file already on disk is kept (--force re-downloads). A later `npm run assets` keeps these files
// too — downloader.mjs existingSize falls back to content validation when the ledger has no entry for a path.
//
//   node tools/fetch-voice-override.mjs [--dry-run] [--force] [--sfx] [--char=char_4182_oblvns] [--help]
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VOICE_LANG_OVERRIDE, voiceAlt, soundAlt, soundAltOfUrl, projSfxLeaves, SOUND_ALTS } from './assets/plan.mjs';
import { VOICE_BATTLE_SLOTS, SKILL_START_BANKS, indexAudio, indexVoice } from './assets/audio.mjs';
import { DEFAULT_GITHUB_PROXY, downloadUrls, normalizeProxyPrefix } from './assets/sources.mjs';
import { isMp3 } from './assets/formats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const CHARWORD = path.join(ROOT, '.cache', 'gamedata', 'excel', 'charword_table.json');
const AUDIO_DATA = path.join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');
/** The two inputs of the plan's operator table: research 07's records and the 自选 picks (fetch-assets.mjs dataExtras). */
const ASSETS07 = path.join(ROOT, 'docs', 'research', '07-assets.json');
const BACKUPS = path.join(ROOT, 'data', 'backups.json');
/** The committed manifest: read only, for `--char`'s "is this sound that operator's?" test (sfxJobs). */
const MANIFEST = path.join(ROOT, 'data', 'assets.json');
/** The slots are read from the zh_CN table, whose voiceIds are always `CN_*` (plan.mjs VOICE_ID_LANG). */
const VOICE_ID_LANG = 'CN';
/** curl's name differs per platform (the script is shipped for Windows dev boxes and Linux servers alike). */
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';
/**
 * How to get the official tables this script reads but never downloads: they live in the shared gamedata cache
 * (`loadIndexes` / `tools/build-data.mjs` fill `.cache/gamedata/`).
 */
const CACHE_HINT = 'run node tools/build-data.mjs first (the official tables are cached under .cache/gamedata/)';

const HELP = `Usage: node tools/fetch-voice-override.mjs [options]
  --dry-run         list the files and whether each one is already on disk, then exit
  --force           re-download even when a valid file is already there
  --sfx             fetch the skill activation sounds of the SKILL_START_BANKS operators AND the content-owned
                    projectiles' own sounds (plan.mjs projSfxLeaves / manifest audio.sfx.proj — 丰川祥子's note launch)
                    instead of battle voice (docs/research/07-assets.json + data/backups.json and
                    .cache/gamedata/excel/audio_data.json are read; each sound the plan gives is written to
                    public/assets/audio/sfx/<bank path>.mp3)
  --char=<charId>   only this operator (default: every key of plan.mjs VOICE_LANG_OVERRIDE, or of the SKILL_START_BANKS
                    operators with --sfx)
  --help            this text
Environment: SP_GITHUB_PROXY sets the HTTPS mirror prefix (default ${DEFAULT_GITHUB_PROXY};
empty disables the proxy and only the direct raw URL is tried).`;

/**
 * Parse CLI flags. `sfx` is only present in --sfx mode: a voice run keeps exactly the four keys
 * test/voice-override.test.js pins.
 * @param {string[]} argv
 * @returns {{dryRun:boolean, force:boolean, charId:string|null, help:boolean, sfx?:boolean}}
 */
export function parseArgs(argv) {
  const o = { dryRun: false, force: false, charId: null, help: false };
  for (const a of argv) {
    const [k, v] = a.split('=');
    if (k === '--dry-run') o.dryRun = true;
    else if (k === '--force') o.force = true;
    else if (k === '--char') o.charId = v || null;
    else if (k === '--sfx') o.sfx = true;
    else if (k === '--help' || k === '-h') o.help = true;
    else throw new Error(`unknown option ${a}\n${HELP}`);
  }
  return o;
}

/**
 * The lines to fetch: one job per battle slot line of every override operator, in voiceIndex order.
 * @param {any} charword parsed excel/charword_table.json
 * @param {{charId?:string|null}} [o]
 * @returns {{jobs:{charId:string,slot:string,rel:string,urls:string[]}[], problems:string[]}}
 */
export function voiceJobs(charword, { charId = null } = {}) {
  const slotsByChar = indexVoice(charword, VOICE_ID_LANG, VOICE_BATTLE_SLOTS);
  const proxyPrefix = normalizeProxyPrefix(process.env.SP_GITHUB_PROXY ?? DEFAULT_GITHUB_PROXY);
  const jobs = [];
  const problems = [];
  for (const [id, lang] of Object.entries(VOICE_LANG_OVERRIDE)) {
    if (charId && id !== charId) continue;
    const slots = slotsByChar.get(id);
    if (!slots) { problems.push(`${id}: charword_table.json carries no battle slot (is the cache there?)`); continue; }
    for (const [slot, assets] of Object.entries(slots)) {
      for (const asset of assets) {
        const a = voiceAlt(asset, lang);
        if (!a) { problems.push(`${id}.${slot}: ${asset} is not a <charId>/<voiceId> voiceAsset`); continue; }
        // 'mirror' is the project's proxy-first order; a voice URL has no jsDelivr fallback (sources.mjs mirrorUrl)
        jobs.push({ charId: id, slot, rel: a.rel, urls: downloadUrls(a.urls[0], { source: 'mirror', proxyPrefix }) });
      }
    }
  }
  if (charId && !jobs.length && !problems.length) problems.push(`${charId}: not a VOICE_LANG_OVERRIDE operator (${Object.keys(VOICE_LANG_OVERRIDE).join(', ') || 'none'})`);
  return { jobs, problems };
}

/** 'docs/research/07-assets.json': a ROOT-relative path in the messages, always with forward slashes. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/**
 * Every skill of every operator the plan can field, in the shape the plan reads them: research 07's records first
 * (they win, exactly like `plan.mjs` `{...known, ...extraOps}`), then the 自选 owned-6★ picks of data/backups.json —
 * 丰川祥子 is one of those, so `--sfx` has to look at both.
 * @param {any} assets07 parsed docs/research/07-assets.json
 * @param {any} backups parsed data/backups.json
 * @returns {Map<string, Array<{index:number, skillId:string}>>} charId → its skills, by index, once
 */
export function planSkills(assets07, backups) {
  const out = new Map();
  const put = (id, skills) => {
    if (out.has(id)) return;
    const byIndex = new Map();
    for (const s of skills || []) if (s?.skillId && !byIndex.has(s.index)) byIndex.set(s.index, { index: s.index, skillId: s.skillId });
    out.set(id, [...byIndex.values()].sort((a, b) => a.index - b.index));
  };
  for (const [id, o] of Object.entries(assets07?.operators || {})) put(id, o?.skills);
  for (const [id, u] of Object.entries(backups?.units || {})) {
    const skills = [];
    for (const f of Object.values(u?.forms || {})) for (const s of f?.skills || []) skills.push(s);
    put(id, skills);
  }
  return out;
}

/**
 * The skill activation sounds to fetch: one job per alternative of every skill sound the plan resolves, so the rel each
 * job writes is the very path the manifest will point at (plan.mjs soundAlt / audio.mjs skillStart — one definition).
 *
 * Without `--char` the scope is the SKILL_START_BANKS skills and the content-owned projectiles of `projSfx` (the plan's
 * `audio.sfx.proj`: 丰川祥子's note launch, whose bank lives on the same voice branch and is missing for the same
 * reason — 发出音符 had no sound at all, owner report); both are sounds a plain `npm run assets` on a machine without
 * raw.githubusercontent.com never gets (the whole voice branch has no jsDelivr mirror).
 * `--char=<charId>` narrows the skill half to that operator's skills (and reports the ones without an activation sound —
 * the ~104 pool skills whose bank is only `ON_ABILITY_START.<skillId>`, a known gap this script deliberately does not
 * close) and narrows the projectile half to the kinds that operator's manifest entry references.
 * @param {Map<string, Array<{index:number, skillId:string}>>} skills from planSkills()
 * @param {any} audioData parsed excel/audio_data.json (null when the cache is missing)
 * @param {{charId?:string|null, audio?:ReturnType<import('./assets/audio.mjs').indexAudio>,
 *   manifest?:any, proj?:Record<string, Record<string,string>>}} [o]
 *   `manifest` (optional) = the committed data/assets.json: `--char` reads its `sfx.units[id]` URLs to decide which
 *   projectile kinds that operator's own sounds are (no manifest ⇒ every kind is planned, which over-fetches, never
 *   under-fetches); `proj` = plan.mjs projSfxLeaves().urls (resolved at fetch time from the official index, and the
 *   fallback for a URL the manifest does not carry yet).
 * @returns {{jobs:{charId:string|null,skill:string,skillId?:string,kind?:string,rel:string,urls:string[]}[], problems:string[]}}
 */
export function sfxJobs(skills, audioData, { charId = null, audio = null, manifest = null, proj = null } = {}) {
  const jobs = [];
  const problems = [];
  if (!audio && !audioData) {
    problems.push(`no ${rel(AUDIO_DATA)} — ${CACHE_HINT}`);
    return { jobs, problems };
  }
  const proxyPrefix = normalizeProxyPrefix(process.env.SP_GITHUB_PROXY ?? DEFAULT_GITHUB_PROXY);
  const idx = audio || indexAudio(audioData);
  const exceptions = new Set(Object.keys(SKILL_START_BANKS));
  for (const [id, list] of skills || []) {
    if (charId && id !== charId) continue;
    for (const s of list || []) {
      if (!s?.skillId || (!charId && !exceptions.has(s.skillId))) continue;
      const paths = idx.skillStart(s.skillId).slice(0, SOUND_ALTS);
      if (!paths.length) {
        problems.push(`${id} ${skillLabel(s)} (${s.skillId}): audio_data.json carries no activation sound`);
        continue;
      }
      for (const p of paths) {
        const a = soundAlt(p);
        if (!a) { problems.push(`${id} ${skillLabel(s)}: ${p} is not a sound path`); continue; }
        jobs.push({ charId: id, skill: skillLabel(s), skillId: s.skillId, rel: a.rel, urls: downloadUrls(a.urls[0], { source: 'mirror', proxyPrefix }) });
      }
    }
  }
  // Content-owned projectiles (plan.mjs projSfxLeaves / audio.sfx.proj): the launch sound of a note. The URL is the
  // manifest's own, so the fetcher and the plan cannot drift; `proj` (resolved from the index) is the fallback for a
  // run whose committed manifest predates the section.
  const kinds = proj && Object.keys(proj).length ? { ...proj } : {};   // a copy: the filter below must not touch the caller's
  const mine = charId ? manifest?.audio?.sfx?.units?.[charId] : null;
  if (charId && mine && Object.keys(kinds).length) {
    // --char NARROWS the projectile kinds to the ones that operator's own manifest entry references (its URL set) — the
    // honest "is this sound that operator's?" test that needs no new data. It only narrows when there IS an entry to
    // read: a manifest without one (an older file, or an operator the plan does not know) keeps every kind, so a
    // --char run can over-fetch but never silently skip a file.
    const urls = new Set(Object.values(mine).filter((v) => typeof v === 'string'));
    for (const kind of Object.keys(kinds)) {
      if (!Object.values(kinds[kind] || {}).some((u) => urls.has(u))) delete kinds[kind];
    }
  }
  for (const [kind, roles] of Object.entries(kinds)) {
    for (const [role, url] of Object.entries(roles)) {
      const a = soundAltOfUrl(url);
      if (!a) { problems.push(`projectile SFX ${kind}.${role}: ${url} is not a /assets/audio URL`); continue; }
      jobs.push({ charId: null, skill: `${kind}.${role}`, kind, rel: a.rel, urls: downloadUrls(a.urls[0], { source: 'mirror', proxyPrefix }) });
    }
  }
  if (charId && !jobs.length && !problems.length) {
    problems.push(`${charId}: no skill with an activation sound in ${rel(ASSETS07)} / ${rel(BACKUPS)}`);
  }
  return { jobs, problems };
}

/** 'S2' of a skill record (0-based `index` → the S1/S2/S3 a player sees). */
const skillLabel = (s) => (Number.isInteger(s?.index) ? `S${s.index + 1}` : String(s?.skillId));

/**
 * Fetch one URL with curl. curl is used on purpose: Node's `fetch` needs `--use-system-ca` on a machine whose system CA
 * store differs from Node's bundled one, and the downloader's own fetch would go through the same blocked DNS.
 * @param {string} url
 * @param {string} dest absolute path to write
 * @returns {boolean} whether the file was written and looks like an MP3
 */
function curlTo(url, dest) {
  const tmp = `${dest}.part`;
  try {
    execFileSync(CURL, ['-sS', '-f', '-L', '--retry', '2', '--max-time', '120', '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 180000 });
    const buf = readFileSync(tmp);
    if (!isMp3(buf)) throw new Error(`not an MP3 (${buf.length} B)`);
    renameSync(tmp, dest);
    return true;
  } catch (e) {
    const msg = (e?.stderr ? String(e.stderr).trim() : '') || e?.message || String(e);
    process.stderr.write(`    ${msg.split('\n')[0]}\n`);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const sfx = !!opts.sfx;
  const tag = sfx ? 'sfx-override' : 'voice-override';
  let jobs, problems;
  if (sfx) {
    if (!existsSync(AUDIO_DATA)) throw new Error(`no ${path.relative(ROOT, AUDIO_DATA)} — ${CACHE_HINT}`);
    if (!existsSync(ASSETS07)) throw new Error(`no ${path.relative(ROOT, ASSETS07)}`);
    const backups = existsSync(BACKUPS) ? JSON.parse(readFileSync(BACKUPS, 'utf8')) : null;
    const skills = planSkills(JSON.parse(readFileSync(ASSETS07, 'utf8')), backups);
    const audioData = JSON.parse(readFileSync(AUDIO_DATA, 'utf8'));
    // the committed manifest is read for --char's ownership test (see sfxJobs); projSfxLeaves resolves the projectile
    // sounds from the official index, so a manifest that predates `audio.sfx.proj` still gets its files fetched
    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
    const proj = projSfxLeaves(indexAudio(audioData)).urls;
    ({ jobs, problems } = sfxJobs(skills, audioData, { ...opts, manifest, proj }));
  } else {
    if (!existsSync(CHARWORD)) throw new Error(`no ${path.relative(ROOT, CHARWORD)} — ${CACHE_HINT}`);
    ({ jobs, problems } = voiceJobs(JSON.parse(readFileSync(CHARWORD, 'utf8')), opts));
  }
  for (const p of problems) console.error(`[${tag}] ${p}`);
  if (!jobs.length) { console.log(`[${tag}] nothing to do`); return problems.length ? 1 : 0; }

  let ok = 0, kept = 0, failed = 0, bytes = 0;
  for (const job of jobs) {
    const dest = path.join(ASSETS, job.rel);
    const label = `${(job.charId || '——').padEnd(18)} ${(sfx ? job.skill : job.slot).padEnd(13)} ${job.rel}`;
    if (!opts.force && existsSync(dest) && isMp3(readFileSync(dest))) {
      kept++; console.log(`[keep] ${label}`);
      continue;
    }
    if (opts.dryRun) { console.log(`[plan] ${label}`); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    let done = false;
    for (const url of job.urls) {
      if (curlTo(url, dest)) {
        const size = statSync(dest).size;
        ok++; bytes += size;
        console.log(`[ok]   ${label}  ${size} B  <- ${url}`);
        done = true;
        break;
      }
    }
    if (!done) { failed++; console.error(`[FAIL] ${label}  (tried ${job.urls.length} URL(s))`); }
  }
  console.log('');
  console.log(`=== fetch-${tag} summary ===`);
  console.log(`${jobs.length} ${sfx ? 'sounds' : 'lines'} · kept ${kept} · downloaded ${ok} (${(bytes / 1048576).toFixed(2)} MB) · failed ${failed}`);
  console.log('next: node tools/fetch-assets.mjs --offline   (writes data/assets.json)');
  return failed || problems.length ? 1 : 0;
}

// run only as a script (tests import parseArgs / voiceJobs / sfxJobs)
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`[voice-override] FAILED: ${process.env.DEBUG ? e?.stack || e : e?.message || e}`);
    process.exitCode = 1;
  });
}
