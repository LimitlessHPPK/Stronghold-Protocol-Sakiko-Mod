// The two dubs of a battle voice line: plan.mjs VOICE_LANG_OVERRIDE + tools/fetch-voice-override.mjs.
//
// 丰川祥子 (char_4182_oblvns), the Ave Mujica collaboration operator this repo adds locally, has NO Chinese battle voice
// anywhere upstream: `voice_cn/char_4182_oblvns/cn_019.mp3` … `cn_032.mp3` answer 404 for all fourteen lines while the JP
// dump `voice/` carries every one of them (the whole collaboration is like that — 祐天寺若麦 / 三角初华 / 若叶睦 too;
// docs/research/12-sakiko.md §6.5). So `--voice-lang=cn` is not a decision anyone can make for her, and the manifest
// cannot simply advertise a CN path that 404s: her entries are planned against the JP dump and the files are fetched by
// tools/fetch-voice-override.mjs — the project's own downloader cannot reach them here (no jsDelivr mirror for the voice
// branch, raw.githubusercontent.com is a black hole on this machine: AGENTS.md §3.1–3.2).
//
// Covered: the override table itself, the jobs the script derives from `charword_table.json`, the download order it uses
// (the project's `--asset-source=mirror` policy) and the summary note tools/fetch-assets.mjs prints instead of claiming
// one language for everyone. The manifest end is checked by test/docs-consistency.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_LANG_OVERRIDE, voiceAlt } from '../tools/assets/plan.mjs';
import { VOICE_DIRS } from '../tools/assets/audio.mjs';
import { parseArgs, voiceJobs } from '../tools/fetch-voice-override.mjs';
import { voiceOverrideNote } from '../tools/fetch-assets.mjs';

const CHAR = 'char_4182_oblvns';
const OTHER = 'char_102_texas';
const RAW = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2';

/** The rows that matter: two battle slots with two lines on 部署, plus every shape that must NOT become a job. */
const charword = { charWords: {
  [`${CHAR}_CN_019`]: { charWordId: `${CHAR}_CN_019`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_019', voiceIndex: 19, placeType: 'BATTLE_START', voiceAsset: `${CHAR}/CN_019` },
  [`${CHAR}_CN_023`]: { charWordId: `${CHAR}_CN_023`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_023', voiceIndex: 23, placeType: 'BATTLE_PLACE', voiceAsset: `${CHAR}/CN_023` },
  [`${CHAR}_CN_024`]: { charWordId: `${CHAR}_CN_024`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_024', voiceIndex: 24, placeType: 'BATTLE_PLACE', voiceAsset: `${CHAR}/CN_024` },
  // prep-only (干员报到): no battle ever asks for it, so it is not planned and not fetched (audio.mjs VOICE_PREP_SLOTS)
  [`${CHAR}_CN_011`]: { charWordId: `${CHAR}_CN_011`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_011', voiceIndex: 11, placeType: 'GACHA', voiceAsset: `${CHAR}/CN_011` },
  // no battle slot at all (标题 / 加载页)
  [`${CHAR}_CN_037`]: { charWordId: `${CHAR}_CN_037`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_037', voiceIndex: 37, placeType: 'LOADING_PANEL', voiceAsset: `${CHAR}/CN_037` },
  // a slot whose row carries no voiceAsset (indexVoice drops it: there is no file to name)
  [`${CHAR}_CN_020`]: { charWordId: `${CHAR}_CN_020`, wordKey: CHAR, charId: CHAR, voiceId: 'CN_020', voiceIndex: 20, placeType: 'BATTLE_FACE_ENEMY' },
  // someone else's line: the override is per operator, never global
  [`${OTHER}_CN_019`]: { charWordId: `${OTHER}_CN_019`, wordKey: OTHER, charId: OTHER, voiceId: 'CN_019', voiceIndex: 19, placeType: 'BATTLE_START', voiceAsset: `${OTHER}/CN_019` },
} };

/** Run `fn` with SP_GITHUB_PROXY set, restoring it afterwards. */
function withProxy(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SP_GITHUB_PROXY');
  const old = process.env.SP_GITHUB_PROXY;
  if (value === undefined) delete process.env.SP_GITHUB_PROXY; else process.env.SP_GITHUB_PROXY = value;
  try { return fn(); } finally { if (had) process.env.SP_GITHUB_PROXY = old; else delete process.env.SP_GITHUB_PROXY; }
}

test('VOICE_LANG_OVERRIDE: one dub per operator, valid dumps only, and the reason written down', () => {
  assert.equal(VOICE_LANG_OVERRIDE[CHAR], 'jp');
  for (const [id, lang] of Object.entries(VOICE_LANG_OVERRIDE)) {
    assert.match(id, /^char_/, `${id} is a charId`);
    assert.ok(VOICE_DIRS[lang], `${id}: ${lang} is one of ${Object.keys(VOICE_DIRS).join('|')}`);
    assert.notEqual(lang, 'cn', `${id}: an override to the default dub would be dead weight (cn is --voice-lang's default)`);
  }
  // voiceAlt is the single definition of where a line lands, shared by the plan and the fetcher
  const a = voiceAlt(`${CHAR}/CN_019`, VOICE_LANG_OVERRIDE[CHAR]);
  assert.equal(a.rel, `audio/voice/jp/${CHAR}/cn_019.mp3`);
  assert.deepEqual(a.urls, [`${RAW}/voice/${CHAR}/cn_019.mp3`], 'the JP dump folder, the same file name');
  assert.equal(voiceAlt(`${CHAR}/CN_019`, 'cn').urls[0], `${RAW}/voice_cn/${CHAR}/cn_019.mp3`, 'without the override: the CN dump');
  assert.equal(voiceAlt('char_x_epoque#28/CN_019', 'jp'), null, 'a skin variant word key is no plain voiceAsset');
});

test('voiceJobs: only the override operator, only the slots a battle plays, one job per line', () => {
  const { jobs, problems } = withProxy('https://gh-proxy.com/', () => voiceJobs(charword));
  assert.deepEqual(problems, []);
  assert.deepEqual(jobs.map((j) => [j.charId, j.slot, j.rel]), [
    [CHAR, 'start', `audio/voice/jp/${CHAR}/cn_019.mp3`],
    [CHAR, 'place', `audio/voice/jp/${CHAR}/cn_023.mp3`],
    [CHAR, 'place', `audio/voice/jp/${CHAR}/cn_024.mp3`],
  ]);
  // the project's mirror order: the proxy first, then the URL it proxies (the voice branch has no jsDelivr mirror)
  assert.deepEqual(jobs[0].urls, [
    `https://gh-proxy.com/${RAW}/voice/${CHAR}/cn_019.mp3`,
    `${RAW}/voice/${CHAR}/cn_019.mp3`,
  ]);
  for (const j of jobs) assert.ok(!j.urls.some((u) => u.includes('cdn.jsdelivr.net')), 'sources.mjs mirrorUrl refuses the voice branch');
});

test('voiceJobs: SP_GITHUB_PROXY decides the order (empty ⇒ the direct raw URL only), --char filters, unknown ids are reported', () => {
  const direct = withProxy('', () => voiceJobs(charword));
  assert.deepEqual(direct.jobs[0].urls, [`${RAW}/voice/${CHAR}/cn_019.mp3`], 'no proxy: nothing is prefixed');
  const custom = withProxy('https://example.test/', () => voiceJobs(charword));
  assert.equal(custom.jobs[0].urls[0], `https://example.test/${RAW}/voice/${CHAR}/cn_019.mp3`);

  assert.equal(withProxy(undefined, () => voiceJobs(charword)).jobs[0].urls[0].startsWith('https://gh-proxy.com/'), true, 'the default prefix');
  assert.equal(withProxy(undefined, () => voiceJobs(charword, { charId: OTHER })).jobs.length, 0, 'not an override operator');
  assert.match(withProxy(undefined, () => voiceJobs(charword, { charId: OTHER })).problems.join('\n'), /not a VOICE_LANG_OVERRIDE operator/);
  assert.equal(withProxy(undefined, () => voiceJobs(charword, { charId: CHAR })).jobs.length, 3, '--char keeps working');
  assert.match(withProxy(undefined, () => voiceJobs({ charWords: {} })).problems.join('\n'), /no battle slot/);
});

test('parseArgs: the fetcher takes --dry-run / --force / --char and refuses anything else', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, force: false, charId: null, help: false });
  assert.deepEqual(parseArgs(['--dry-run', '--force', `--char=${CHAR}`]), { dryRun: true, force: true, charId: CHAR, help: false });
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
});

test('fetch-assets reports the operators that speak another dump (the summary must not claim one language for all)', () => {
  const voice = { [CHAR]: { start: '/assets/audio/voice/jp/x.mp3' }, [OTHER]: { start: '/assets/audio/voice/cn/y.mp3' } };
  assert.equal(voiceOverrideNote(voice, 'cn'), ' (+1 on JP)');
  assert.equal(voiceOverrideNote(voice, 'jp'), '', 'a run in her own dub moves nobody out of it');
  assert.equal(voiceOverrideNote({ char_a: {} }, 'cn'), '');
  assert.equal(voiceOverrideNote({}, 'cn'), '');
  assert.equal(voiceOverrideNote(null, 'cn'), '');
});
