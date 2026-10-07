// test/sfx-sakiko.test.js — 丰川祥子's skill sounds: "放大招没音效" (user report).
//
// Her普攻 sounds were in the manifest from the start (attack / hit / die / born), but `sfx.units[char_4182_oblvns]`
// carried NO `skills[]` at all, and the client plays a unit's skill sound only from there
// (`public/js/audio.js unit`: `u.skills[skillIndex]`, on the sim's own 'skill' event — no client change is involved).
// The reason is not the manifest but the resolution behind it: `tools/assets/plan.mjs` reads the official
// `battle.ON_SKILL_START.<skillId>` bank, and not one of her three skills has a bank named that way:
//
//   S1 `battle.ON_ABILITY_START.skchr_oblvns_1`            (the plain ability event; three takes of the cast cue)
//   S2 `battle.ON_SKILL_START.skchr_oblvns_2.1` / `.2`     (the h1 / h2 takes split over two ability indices)
//   S3 `battle.ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]`    (the cast; `ON_BUFF_START.oblvns_s_3[loop]` is the loop)
//
// `tools/assets/audio.mjs SKILL_START_BANKS` + `indexAudio().skillStart()` now resolve those three, and
// `node tools/fetch-voice-override.mjs --sfx` downloads the files (the voice branch has no jsDelivr mirror and this
// machine cannot reach raw.githubusercontent.com: AGENTS.md §3.1–3.2). Covered here: the table's own invariants (it
// never shadows a conventional bank, and it cannot touch another operator), the resolver, the fetcher's job
// derivation, and the manifest / disk end.
//
// The data half is skipped when the git-ignored pieces are absent (`.cache/gamedata/excel/audio_data.json`,
// `public/assets/**`); the committed `data/assets.json` half always runs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_START_BANKS, indexAudio } from '../tools/assets/audio.mjs';
import { SOUND_ALTS, buildPlan, soundAlt } from '../tools/assets/plan.mjs';
import { isMp3 } from '../tools/assets/formats.mjs';
import { parseArgs, sfxJobs } from '../tools/fetch-voice-override.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const CHAR = 'char_4182_oblvns';
const RAW = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/';
/** The three skills the exception table exists for, with the cast cue each one's bank carries. */
const EXPECTED = {
  skchr_oblvns_1: { index: 0, bank: 'battle.ON_ABILITY_START.skchr_oblvns_1', files: ['player/p_skill/p_skill_mjckyrdglsnt_d1.mp3'] },
  skchr_oblvns_2: { index: 1, bank: 'battle.ON_SKILL_START.skchr_oblvns_2.1', files: ['player/p_skill/p_skill_mjckyrdslnt_h2.mp3'] },
  skchr_oblvns_3: { index: 2, bank: 'battle.ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]', files: ['player/p_skill/p_skill_mjckyrdslnt_s1.mp3'] },
};

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const a07 = readJson('docs/research/07-assets.json');
const AUDIO_PATH = join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');
const audioData = existsSync(AUDIO_PATH) ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) : null;
const audio = audioData ? indexAudio(audioData) : null;
const noAudio = !audioData && `.cache/gamedata/excel/audio_data.json missing (run scripts/fetch-gamedata.ps1)`;
const manifest = existsSync(join(ROOT, 'data', 'assets.json')) ? readJson('data/assets.json') : null;

/** Every skill record of every operator in research 07. */
const allSkills = Object.entries(a07.operators).flatMap(([id, o]) => (o.skills || []).map((s) => ({ id, s })));

describe('SKILL_START_BANKS (audio.mjs): the banks the ON_SKILL_START convention cannot name', () => {
  test('her three skills, each bank present in the official index and no plain ON_SKILL_START among them', { skip: noAudio }, () => {
    assert.deepEqual(Object.keys(SKILL_START_BANKS).sort(), Object.keys(EXPECTED).sort());
    const mine = allSkills.filter((x) => x.s.skillId in EXPECTED);
    assert.deepEqual(mine.map((x) => [x.id, x.s.index, x.s.skillId]).sort(),
      Object.keys(EXPECTED).map((sid) => [CHAR, EXPECTED[sid].index, sid]).sort(), 'the table names HER skills');
    for (const [skillId, want] of Object.entries(EXPECTED)) {
      const banks = SKILL_START_BANKS[skillId];
      assert.ok(banks.length && banks[0] === want.bank, `${skillId}: ${banks[0]} first`);
      for (const name of banks) {
        assert.match(name, /^battle\./, `${skillId}: ${name} is a battle bank`);
        assert.ok(audio.bank(name).length, `${skillId}: ${name} carries sounds`);
      }
      // the invariant the table's own comment claims: it is only ever consulted when the convention finds nothing,
      // so an entry that HAS a plain bank would be dead weight (and hide a wrong skill id)
      assert.deepEqual(audio.skillStart(skillId), banks.flatMap((n) => audio.bank(n)), `${skillId}: every listed bank's sounds`);
      assert.equal(audio.skillStart(skillId)[0], want.files[0], `${skillId}: the take the manifest plays first`);
    }
  });

  test('no entry shadows a conventional bank, and no other operator can be affected by the table', { skip: noAudio }, () => {
    for (const { id, s } of allSkills) {
      const plain = audio.skillBanks.get(s.skillId)?.get('ON_SKILL_START') ?? [];
      if (s.skillId in SKILL_START_BANKS) assert.equal(plain.length, 0, `${s.skillId}: the table would shadow ${plain[0]}`);
      else assert.deepEqual(audio.skillStart(s.skillId), plain, `${id} ${s.skillId}: resolved as before (no exception applies)`);
    }
  });

  test('skillStart: the plain bank wins, the table is read in order and deduped, an unknown skill is silent', () => {
    const idx = indexAudio({ soundFXBanks: [
      { name: 'battle.ON_SKILL_START.skchr_z_1', sounds: [{ asset: 'Audio/Sound_Beta_2/P/skill' }] },
      { name: SKILL_START_BANKS.skchr_oblvns_2[0], sounds: [{ asset: 'Audio/Sound_Beta_2/P/h2' }] },
      { name: SKILL_START_BANKS.skchr_oblvns_2[1], sounds: [{ asset: 'Audio/Sound_Beta_2/P/h1' }] },
      // the same file in both banks: it must appear once (the tables are read as one bank list)
      { name: 'battle.ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]', sounds: [{ asset: 'Audio/Sound_Beta_2/P/s1' }] },
    ] });
    assert.deepEqual(idx.skillStart('skchr_z_1'), ['p/skill.mp3'], 'the convention, not the table');
    assert.deepEqual(idx.skillStart('skchr_oblvns_2'), ['p/h2.mp3', 'p/h1.mp3'], 'every listed bank, in order');
    assert.deepEqual(idx.skillStart('skchr_oblvns_1'), [], 'a table entry the index does not carry is silent, not a crash');
    assert.deepEqual(idx.skillStart('skchr_nobody_9'), []);
    // dedupe inside the table: the two numbered banks of her S2 holding the same file is one path, not two
    const dup = indexAudio({ soundFXBanks: [
      { name: SKILL_START_BANKS.skchr_oblvns_2[0], sounds: [{ asset: 'Audio/Sound_Beta_2/P/one' }] },
      { name: SKILL_START_BANKS.skchr_oblvns_2[1], sounds: [{ asset: 'Audio/Sound_Beta_2/P/one' }] },
    ] });
    assert.deepEqual(dup.skillStart('skchr_oblvns_2'), ['p/one.mp3']);
  });
});

describe('fetch-voice-override.mjs --sfx: the jobs are the plan\'s own files', () => {
  test('parseArgs: --sfx is opt-in and a voice run keeps its exact shape', () => {
    assert.deepEqual(parseArgs([]), { dryRun: false, force: false, charId: null, help: false });
    assert.deepEqual(parseArgs(['--sfx', '--dry-run']), { dryRun: true, force: false, charId: null, help: false, sfx: true });
    assert.equal(parseArgs(['--help']).help, true);
  });

  test('a missing audio index is reported, never a silent empty job list', () => {
    assert.deepEqual(sfxJobs(a07, null).problems,
      ['no .cache/gamedata/excel/audio_data.json — run scripts/fetch-gamedata.ps1 first']);
    assert.deepEqual(sfxJobs(a07, null).jobs, []);
  });

  test('one job per alternative of every SKILL_START_BANKS skill; the proxy comes first, then the raw URL', { skip: noAudio }, () => {
    const jobs = sfxJobs(a07, null, { audio });
    assert.deepEqual(jobs.problems, []);
    // the plan's cap decides how many alternatives of one bank travel (plan.mjs soundLeaf(SOUND_ALTS))
    assert.deepEqual(jobs.jobs.map((j) => [j.skillId, j.skill, j.rel]), [
      ['skchr_oblvns_1', 'S1', soundAlt(EXPECTED.skchr_oblvns_1.files[0]).rel],
      ['skchr_oblvns_1', 'S1', soundAlt('player/p_skill/p_skill_mjckyrdglsnt_d2.mp3').rel],
      ['skchr_oblvns_1', 'S1', soundAlt('player/p_skill/p_skill_mjckyrdglsnt_d3.mp3').rel],
      ['skchr_oblvns_2', 'S2', soundAlt('player/p_skill/p_skill_mjckyrdslnt_h2.mp3').rel],
      ['skchr_oblvns_2', 'S2', soundAlt('player/p_skill/p_skill_mjckyrdslnt_h1.mp3').rel],
      ['skchr_oblvns_3', 'S3', soundAlt('player/p_skill/p_skill_mjckyrdslnt_s1.mp3').rel],
      ['skchr_oblvns_3', 'S3', soundAlt('player/p_skill/p_skill_mjckyrdslnt_s2.mp3').rel],
    ]);
    for (const j of jobs.jobs) {
      assert.equal(j.charId, CHAR);
      assert.match(j.rel, /^audio\/sfx\/player\/p_skill\/p_skill_[a-z0-9_]+\.mp3$/, 'the path plan.mjs soundAlt computes');
      assert.deepEqual(j.urls, [`https://gh-proxy.com/${rawOf(j.rel)}`, rawOf(j.rel)], 'the mirror policy: proxy, then raw');
    }
    assert.ok(jobs.jobs.length <= 3 * SOUND_ALTS, `${SOUND_ALTS} alternatives per skill at most`);
    // the rel is exactly the file the plan keeps, so the fetcher and the plan cannot drift
    for (const j of jobs.jobs) assert.equal(j.rel, soundAlt(j.rel.replace(/^audio\/sfx\//, '')).rel);
  });

  test('--char widens the scope to that operator; a skill without a sound and an unknown operator are reported', { skip: noAudio }, () => {
    // 德克萨斯's banks are `battle.ON_ABILITY_START.skchr_texas_2` / `…skcom_charge_cost[3]`: the pre-existing
    // resolution gap (104 pool skills), NOT touched here — the plan keeps her manifest exactly as it was, and --char
    // says so instead of writing an entry the plan would never emit.
    const any = sfxJobs(a07, null, { audio, charId: 'char_102_texas' });
    assert.deepEqual(any.jobs, []);
    assert.deepEqual(any.problems, [
      'char_102_texas S1 (skcom_charge_cost[3]): audio_data.json carries no activation sound',
      'char_102_texas S2 (skchr_texas_2): audio_data.json carries no activation sound',
    ]);
    assert.deepEqual(sfxJobs(a07, null, { audio, charId: 'char_000_nobody' }).problems.join('\n'), 'char_000_nobody: no skill with an activation sound in docs/research/07-assets.json');
    // a skill the official index carries no activation sound for: reported, never silently dropped
    const a07x = { operators: { [CHAR]: { skills: [{ index: 0, skillId: 'skchr_oblvns_1' }, { index: 1, skillId: 'skchr_oblvns_2' }, { index: 2, skillId: 'skchr_oblvns_3' }, { index: 3, skillId: 'skchr_oblvns_4' }] } } };
    const missing = sfxJobs(a07x, { soundFXBanks: [{ name: SKILL_START_BANKS.skchr_oblvns_1[0], sounds: [{ asset: 'Audio/Sound_Beta_2/P/s1' }] }] });
    assert.deepEqual(missing.jobs.map((j) => j.skill), ['S1']);
    assert.deepEqual(missing.problems, [
      `${CHAR} S2 (skchr_oblvns_2): audio_data.json carries no activation sound`,
      `${CHAR} S3 (skchr_oblvns_3): audio_data.json carries no activation sound`,
    ], 'only the table skills are looked at without --char');
  });

  test('real data: one job per alternative the plan itself resolved for her three skills', { skip: noAudio }, () => {
    const template = buildPlan({
      assets07: a07, ops03: readJson('docs/research/03-operators.json'), enemies05: readJson('docs/research/05-enemies.json'),
      maps05: readJson('docs/research/05-maps.json'), audio, modelsData: {},
    }).template;
    const planned = template.audio.sfx.units[CHAR];
    assert.deepEqual(Object.keys(planned.skills), ['0', '1', '2'], 'the plan gives her every skill a sound');
    // `skill` is only the fallback for a unit that arrives without a skillIndex: the client asks for
    // `skills[skillIndex]` on its 'skill' event (`public/js/audio.js unit`), which is the data/chess.json loadout
    assert.ok(Object.values(planned.skills).includes(planned.skill), 'the fallback is one of the three cues');
    const rels = sfxJobs(a07, null, { audio }).jobs.map((j) => j.rel);
    for (const leaf of Object.values(planned.skills)) for (const a of leaf.alts) assert.ok(rels.includes(a.rel), `${a.rel} is fetched`);
    for (const role of ['attack', 'hit', 'die', 'born']) assert.ok(planned[role], `${role} kept`);
  });
});

describe('the manifest and the files on disk', () => {
  const noManifest = !manifest && 'data/assets.json not generated (run npm run assets)';
  const noAssets = noManifest || !existsSync(PUBLIC) ? 'public/assets missing (run npm run assets)' : false;
  const her = () => manifest.audio.sfx.units[CHAR];

  test('her entry carries skills[] for all three indices, under /assets/audio/sfx/', { skip: noManifest }, () => {
    const u = her();
    for (const role of ['attack', 'hit', 'die', 'born']) assert.match(u[role], /^\/assets\/audio\/sfx\/.+\.mp3$/, role);
    assert.deepEqual(Object.keys(u.skills), ['0', '1', '2']);
    for (const [i, url] of Object.entries(u.skills)) {
      assert.match(url, /^\/assets\/audio\/sfx\/player\/p_skill\/p_skill_[a-z0-9_]+\.mp3$/, `S${Number(i) + 1}`);
      assert.equal(u.skills[i], u.skills[String(i)], `S${Number(i) + 1}: the client indexes with a number`);
    }
    assert.equal(new Set(Object.values(u.skills)).size, 3, 'three distinct cues');
    // the fallback for a unit without a skillIndex (the client asks for `skills[skillIndex]` whenever it has one:
    // public/js/audio.js unit). Research 03 has no chess record for her, so plan.mjs's primary index is 0, not the
    // default skill 07 records — cosmetic, and the sim always passes the equipped index.
    assert.ok(Object.values(u.skills).includes(u.skill), 'the fallback is one of the three cues');
  });

  test('every one of those URLs is an mp3 on disk', { skip: noAssets }, () => {
    for (const url of Object.values(her().skills).concat(her().skill)) {
      const file = join(PUBLIC, url.replace(/^\/assets\//, 'assets/'));
      assert.ok(existsSync(file), `${url} is on disk (node tools/fetch-voice-override.mjs --sfx)`);
      assert.ok(isMp3(readFileSync(file)), `${url} is an MP3`);
    }
  });

  test('the client plays the equipped skill\'s own cue (audio.js unit → u.skills[skillIndex])', { skip: noManifest }, async () => {
    const { AudioManager } = await import('../public/js/audio.js');
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    // the sim's spawn events carry the equipped skill index; audio.js keys the unit by its spine / charId
    a.setFieldUnits([0, 1, 2].map((i) => ({ id: i + 1, side: 'ally', kind: 'op', defId: 'chess_char_6_21_a', spine: CHAR, skillIndex: i })));
    a.handleBattleEvents([['skill', 1, 1], ['skill', 2, 1], ['skill', 3, 1], ['skill', 1, 0]]);
    assert.deepEqual(played, [her().skills['0'], her().skills['1'], her().skills['2']], 'S1 / S2 / S3; the off event (e[2] = 0) is silent');
  });

  test('a cast that arrives BEFORE the unit is known still plays, once, when the unit appears (S3 有时不响)', { skip: noManifest }, async () => {
    // 所有者报告（2026-10-08）:「大招音效有时不触发」. 她 S3 的 initSp（30）已经等于 spCost（46 起手不够，但
    // `carryState.sp` / 开局加成够时）会在**部署的同一个 tick** 发动 —— sim 先发 `['skill', id, 1]`，而
    // `['spawn', unitInfo]` / 备战的 field.units 是同一批或更晚的消息；`units` 里还没有她时 audio.js 静默跳过，
    // 于是「第一次大招没声音、后面每次都响」。这里复现那条顺序并断言它现在会响，而且只响一次。
    const { AudioManager } = await import('../public/js/audio.js');
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    const info = { id: 1, side: 'ally', kind: 'op', defId: 'chess_char_6_21_a', spine: CHAR, skillIndex: 2 };
    // (1) the bug's order: the cast first (the sim's own order at a deploy-time activation), the unit after
    a.handleBattleEvents([['skill', 1, 1]]);
    assert.deepEqual(played, [], 'nothing to play yet — the unit is unknown (the old behaviour: the cue was dropped)');
    a.setFieldUnits([info]);                    // 备战的 field.units / 同批的 spawn arrives
    assert.deepEqual(played, [her().skills['2']], 'the held S3 cue plays as soon as the unit is known');
    // (2) once: another field / another batch must not replay it, and a second cast plays again
    a.setFieldUnits([info]);
    assert.deepEqual(played, [her().skills['2']], 'a new field does not replay the held cue');
    a.handleBattleEvents([['skill', 1, 1]]);
    assert.deepEqual(played, [her().skills['2'], her().skills['2']], 'a later cast of the known unit plays directly');
    // (3) a unit that never appears does not leak a cue into the next field: unit#9's cast is dropped when the new
    // field's unit list arrives without it (and the list's own cue still plays)
    const before = played.length;
    a.handleBattleEvents([['skill', 9, 1]]);
    a.setFieldUnits([info]);
    assert.equal(played.length, before, 'the unknown unit#9 cue never fired');
    assert.equal(played[played.length - 1], her().skills['2'], '…while the field-list cue still did');
  });

  test('a held cue is played through the real handleBattleEvents path, with the same index/voice as a known unit', { skip: noManifest }, async () => {
    const { AudioManager } = await import('../public/js/audio.js');
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [], voiced = [];
    a._play = (url) => { played.push(url); };
    a.voice = (charId, slot, o) => { voiced.push([charId, slot, o.unitKey]); return true; };
    const info = { id: 4, side: 'ally', kind: 'op', defId: 'chess_char_6_21_a', spine: CHAR, skillIndex: 1 };
    a.handleBattleEvents([['skill', 4, 1]]);        // before the unit
    a.setFieldUnits([info]);                        // …and now it exists
    a.handleBattleEvents([['skill', 4, 1]]);        // the ordinary path, for comparison
    assert.deepEqual(played, [her().skills['1'], her().skills['1']], 'the same S2 cue both times');
    assert.deepEqual(voiced, [['char_4182_oblvns', 'skill2', 4], ['char_4182_oblvns', 'skill2', 4]], 'and the same 作战中 voice slot');
  });
});

/** The raw.githubusercontent.com URL of a manifest rel under audio/sfx. */
function rawOf(rel) {
  return RAW + rel.replace(/^audio\/sfx\//, '');
}
