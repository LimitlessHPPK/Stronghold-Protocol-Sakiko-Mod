// test/sfx-oblvns.test.js — 丰川祥子's battle SFX: her skill-activation sounds ("放大招没音效") AND her ordinary
// attack / impact sounds ("祥子攻击敌人，敌人受击没有音效", "发出音符也没有声音" — owner reports).
//
// 1. Skill sounds. Her 普攻 sounds were in the manifest from the start (die / born), but `sfx.units[char_4182_oblvns]`
// carried NO `skills[]` at all, and the client plays a unit's skill sound only from there (`public/js/audio.js unit`:
// `u.skills[skillIndex]`, on the sim's own 'skill' event — no client change is involved). The reason is not the
// manifest but the resolution behind it: `tools/assets/plan.mjs` read the official `battle.ON_SKILL_START.<skillId>`
// bank, and not one of her three skills has a bank named that way:
//
//   S1 `battle.ON_ABILITY_START.skchr_oblvns_1`            (the plain ability event; three takes of the cast cue)
//   S2 `battle.ON_SKILL_START.skchr_oblvns_2.1` / `.2`     (the h1 / h2 takes split over two ability indices)
//   S3 `battle.ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]`    (the cast; `ON_BUFF_START.oblvns_s_3[loop]` is the loop)
//
// `tools/assets/audio.mjs SKILL_START_BANKS` + `indexAudio().skillStart()` now resolve those three, and
// `node tools/fetch-voice-override.mjs --sfx` downloads the files (the voice branch has no jsDelivr mirror and this
// machine cannot reach raw.githubusercontent.com). Covered here: the table's own invariants (it never shadows a
// conventional bank, and it cannot touch another operator), the resolver, the fetcher's job derivation, and the
// manifest / disk / client end.
//
// 2. Attack / impact — a PORT REGRESSION of 0.1.4, restored by this file's second half. 0.1.4's `data/assets.json`
// carried
//   "attack": "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt.mp3",
//   "hit":    "/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt.mp3",
// and 0.2.x shipped neither, so the note she fires left her silently and its impact on the enemy was silent too.
// What was NOT lost is the resolution: `plan.mjs` resolves both roles for a 自选 (diy) pick exactly like for a pool
// operator — `extraOperators` joins the same loop (`for (const id of charIds)`), and the real `buildPlan` template
// carries the two files 0.1.4 shipped. What was lost is the two FILES. In 0.1.4 she was a normal chess, so a full
// `npm run assets` downloaded them with the rest of the pool. The 0.2.x port brings her in as a 自选 pick into a
// public/assets folder that is shared with other checkouts and already held thousands of files, and its rebuilds ran
// `--offline --add-only` (which never downloads a file that is not on disk yet) plus
// `tools/fetch-voice-override.mjs --sfx` for her three skill banks — which are exactly the sounds that survived.
// `tools/assets/manifest.mjs resolveTemplate` drops a leaf whose alternatives are missing on disk, silently, inside a
// list of hundreds of legitimate misses (`requiredMisses` checks avatar / portrait / spine.front only), so a role the
// plan HAD resolved disappeared from the manifest together with its file. The repair: the two files on disk in the
// manifest's own (lower-case) spelling, the explicit `UNIT_SFX_BANKS` pin in audio.mjs, and the assertions below.
//
// The data half is skipped when the git-ignored pieces are absent (`.cache/gamedata/excel/audio_data.json`,
// `public/assets/**`); the committed `data/assets.json` half always runs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_START_BANKS, UNIT_SFX_BANKS, indexAudio, pickUnitSfx, unitSfxBanks } from '../tools/assets/audio.mjs';
import { SOUND_ALTS, soundAlt } from '../tools/assets/plan.mjs';
import { isMp3 } from '../tools/assets/formats.mjs';
import { parseArgs, planSkills, sfxJobs } from '../tools/fetch-voice-override.mjs';
import { AudioManager, normalAttackSfx } from '../public/js/audio.js';

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
/** The two unit sounds 0.1.4's manifest carried, verbatim (its `audio.sfx.units.char_4182_oblvns`). */
const V014 = {
  attack: '/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt.mp3',
  hit: '/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt.mp3',
};

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const a07 = readJson('docs/research/07-assets.json');
/** The plan's own operator table: research 07 plus the 自选 picks of data/backups.json (she is one of those). */
const skills = planSkills(a07, readJson('data/backups.json'));
const AUDIO_PATH = join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');
const audioData = existsSync(AUDIO_PATH) ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) : null;
const audio = audioData ? indexAudio(audioData) : null;
const noAudio = !audioData && '.cache/gamedata/excel/audio_data.json missing (run scripts/fetch-gamedata.ps1)';
const manifest = existsSync(join(ROOT, 'data', 'assets.json')) ? readJson('data/assets.json') : null;

/** Every skill record of every operator the plan can field. */
const allSkills = [...skills].flatMap(([id, list]) => list.map((s) => ({ id, s })));

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

describe('UNIT_SFX_BANKS (audio.mjs): the two unit sounds the port lost, pinned to 0.1.4', () => {
  const assetUrl = (p) => `/assets/audio/sfx/${p}`;

  test('her attack / hit resolve to the 0.1.4 files, from the banks the table names', { skip: noAudio }, () => {
    assert.deepEqual(Object.keys(UNIT_SFX_BANKS), [CHAR], 'the table names her and nobody else');
    assert.deepEqual(unitSfxBanks(audio, CHAR), {
      attack: ['player/p_atk/p_atk_mjckyrdslnt.mp3'],
      hit: ['player/p_imp/p_imp_mjckyrdnt.mp3'],
    }, 'the paths behind 0.1.4\'s two manifest URLs');
    for (const [role, names] of Object.entries(UNIT_SFX_BANKS[CHAR])) {
      assert.ok(names.length >= 1, `${role}: at least one bank`);
      for (const name of names) assert.ok(audio.bank(name).length, `${role}: ${name} carries sounds`);
      assert.deepEqual([...new Set(names.flatMap((n) => audio.bank(n)))], Object.values(unitSfxBanks(audio, CHAR)[role]),
        `${role}: bank order, deduped`);
    }
    assert.equal(unitSfxBanks(audio, 'char_000_nobody'), null, 'an unlisted unit has no pinned role');
  });

  test('the `attack` file has exactly ONE bank in the whole official index — the one the table names', { skip: noAudio }, () => {
    // The provenance the table documents: her default-mode banks carry the other take (`…_h`), so the file 0.1.4 played
    // and today's convention picks can only come from this one bank.
    const hits = audioData.soundFXBanks
      .filter((b) => (b.sounds || []).some((s) => /\/p_atk_MJCkyrdslnt$/i.test(String(s.asset))))
      .map((b) => b.name);
    assert.deepEqual(hits, [...UNIT_SFX_BANKS[CHAR].attack]);
  });

  test('the pin agrees with the convention it replaces, and only the client-accepted take is used', { skip: noAudio }, () => {
    // plan.mjs's own call for her (the projectile banks are named after the char's short id there): the pinned roles
    // must be exactly what the convention resolves today — the pin is insurance against the name-luck, not a change.
    const short = CHAR.replace(/^char_\d+_/, '');
    const conventional = pickUnitSfx(audio.unitBanks.get(CHAR), { operator: true, projectile: {
      born: audio.bank(`battle.ON_PROJECTILE_BORN.projectile_chr_${short}`),
      hit: audio.bank(`battle.ON_PROJECTILE_HIT.projectile_chr_${short}`) } });
    const pinned = unitSfxBanks(audio, CHAR);
    for (const role of Object.keys(pinned)) assert.deepEqual(pinned[role], conventional[role], `${role}: the convention already agrees`);
    // and the take that route must NOT drift to: her default-mode bank (`ON_ABILITY_ON.<char>.attack.0.1` / `combat.0`)
    // ends in `_h`, which the client refuses for a normal attack — a manifest pointing there would be silence.
    assert.equal(normalAttackSfx(CHAR, assetUrl('player/p_atk/p_atk_mjckyrdnt_h.mp3')), false, 'the _h take is refused');
    for (const role of ['attack', 'hit']) assert.equal(normalAttackSfx(CHAR, assetUrl(pinned[role][0])), true, `${role} is played`);
  });

  test('no other unit of the plan can be affected by the table', { skip: noAudio }, () => {
    assert.ok(skills.size > 100, `${skills.size} operators in the plan`);
    const named = [...skills.keys()].filter((id) => unitSfxBanks(audio, id));
    assert.deepEqual(named, [CHAR], 'only her');
  });
});

describe('fetch-voice-override.mjs --sfx: the jobs are the plan\'s own files', () => {
  test('parseArgs: --sfx is opt-in and a voice run keeps its exact shape', () => {
    assert.deepEqual(parseArgs([]), { dryRun: false, force: false, charId: null, help: false });
    assert.deepEqual(parseArgs(['--sfx', '--dry-run']), { dryRun: true, force: false, charId: null, help: false, sfx: true });
    assert.equal(parseArgs(['--help']).help, true);
  });

  test('planSkills: research 07 first, then the 自选 picks of data/backups.json — by index, once', () => {
    const a = skills.get(CHAR);
    assert.deepEqual(a, [
      { index: 0, skillId: 'skchr_oblvns_1' },
      { index: 1, skillId: 'skchr_oblvns_2' },
      { index: 2, skillId: 'skchr_oblvns_3' },
    ], 'her three skills come from the 自选 data, not research 07');
    assert.ok(!a07.operators[CHAR], 'research 07 does not list her');
    assert.ok(skills.get('char_102_texas').length >= 2, 'a research 07 operator is there too');
    assert.deepEqual(planSkills(null, null).size, 0);
    assert.deepEqual(planSkills({ operators: { c: { skills: [{ index: 1, skillId: 'b' }, { index: 0, skillId: 'a' }, { index: 0, skillId: 'dup' }] } } }, null).get('c'),
      [{ index: 0, skillId: 'a' }, { index: 1, skillId: 'b' }], 'sorted by index, the first record of an index wins');
  });

  test('a missing audio index is reported, never a silent empty job list', () => {
    assert.deepEqual(sfxJobs(skills, null).problems,
      ['no .cache/gamedata/excel/audio_data.json — run node tools/build-data.mjs first (the official tables are cached under .cache/gamedata/)']);
    assert.deepEqual(sfxJobs(skills, null).jobs, []);
  });

  test('one job per alternative of every SKILL_START_BANKS skill; the proxy comes first, then the raw URL', { skip: noAudio }, () => {
    const jobs = sfxJobs(skills, null, { audio });
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
      assert.equal(j.charId, CHAR, 'only her: the table names her three skills');
      assert.match(j.rel, /^audio\/sfx\/player\/p_skill\/p_skill_[a-z0-9_]+\.mp3$/, 'the path plan.mjs soundAlt computes');
      assert.deepEqual(j.urls, [`https://gh-proxy.com/${rawOf(j.rel)}`, rawOf(j.rel)], 'the mirror policy: proxy, then raw');
    }
    assert.ok(jobs.jobs.length <= 3 * SOUND_ALTS, `${SOUND_ALTS} alternatives per skill at most`);
    // the rel is exactly the file the plan keeps, so the fetcher and the plan cannot drift
    for (const j of jobs.jobs) assert.equal(j.rel, soundAlt(j.rel.replace(/^audio\/sfx\//, '')).rel);
  });

  test('--char widens the scope to that operator; a skill without a sound and an unknown operator are reported', { skip: noAudio }, () => {
    // 德克萨斯's skills have `battle.ON_ABILITY_START.<skillId>` banks only: the pre-existing resolution gap (~104 pool
    // skills), NOT touched here — the plan keeps every other operator's manifest exactly as it was, and --char says so
    // instead of writing an entry the plan would never emit.
    const any = sfxJobs(skills, null, { audio, charId: 'char_102_texas' });
    assert.deepEqual(any.jobs, [], 'no activation sound the convention can name');
    assert.ok(any.problems.length >= 1 && any.problems.every((p) => /audio_data\.json carries no activation sound$/.test(p)), any.problems.join('\n'));
    assert.match(sfxJobs(skills, null, { audio, charId: 'char_000_nobody' }).problems.join('\n'), /no skill with an activation sound in docs\/research\/07-assets\.json \/ data\/backups\.json$/);
    // a skill the official index carries no activation sound for: reported, never silently dropped
    const only = new Map([[CHAR, [{ index: 0, skillId: 'skchr_oblvns_1' }, { index: 1, skillId: 'skchr_oblvns_2' }, { index: 2, skillId: 'skchr_oblvns_3' }, { index: 3, skillId: 'skchr_oblvns_4' }]]]);
    const missing = sfxJobs(only, { soundFXBanks: [{ name: SKILL_START_BANKS.skchr_oblvns_1[0], sounds: [{ asset: 'Audio/Sound_Beta_2/P/s1' }] }] });
    assert.deepEqual(missing.jobs.map((j) => j.skill), ['S1']);
    assert.deepEqual(missing.problems, [
      `${CHAR} S2 (skchr_oblvns_2): audio_data.json carries no activation sound`,
      `${CHAR} S3 (skchr_oblvns_3): audio_data.json carries no activation sound`,
    ], 'only the table skills are looked at without --char');
  });
});

describe('the manifest, the files on disk and the client', () => {
  const noManifest = !manifest && 'data/assets.json not generated (run npm run assets)';
  const noAssets = noManifest || !existsSync(PUBLIC) ? 'public/assets missing (run npm run assets)' : false;
  const her = () => manifest.audio.sfx.units[CHAR];

  test('her entry carries skills[] for all three indices, under /assets/audio/sfx/', { skip: noManifest }, () => {
    const u = her();
    for (const role of ['die', 'born']) assert.match(u[role], /^\/assets\/audio\/sfx\/.+\.mp3$/, role);
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

  test('her entry carries the 0.1.4 attack / hit sounds — the port regression this file exists for', { skip: noManifest }, () => {
    const u = her();
    assert.equal(u.attack, V014.attack);
    assert.equal(u.hit, V014.hit);
    assert.deepEqual(Object.keys(u).sort(), ['attack', 'born', 'die', 'hit', 'skill', 'skills'],
      'the four unit roles + the skill cues, and nothing else (no invented slot: see UNIT_SFX_BANKS)');
    // the manifest's own numbers: her fix added two FILES, not a unit, and no other unit lost its entry
    assert.equal(manifest.stats.sfxUnits, Object.keys(manifest.audio.sfx.units).length);
    assert.ok(manifest.stats.files >= 8001, `${manifest.stats.files} files listed`);
    // both roles are played by the client for a NORMAL attack (the _d / _h / _s filter would refuse a skill take)
    for (const role of ['attack', 'hit']) assert.equal(normalAttackSfx(CHAR, u[role]), true, role);
  });

  test('every one of those URLs is an mp3 on disk', { skip: noAssets }, () => {
    for (const url of Object.values(her().skills).concat(her().skill)) {
      const file = join(PUBLIC, url.replace(/^\/assets\//, 'assets/'));
      assert.ok(existsSync(file), `${url} is on disk (node tools/fetch-voice-override.mjs --sfx)`);
      assert.ok(isMp3(readFileSync(file)), `${url} is an MP3`);
    }
  });

  test('every one of her files is on disk in exactly the case the manifest spells', { skip: noAssets }, () => {
    const u = her();
    // Windows resolves any case, a Linux server does not: the DIRECTORY LISTING (not existsSync) is what proves the
    // name. The seven skill files were on disk as `p_skill_MJC….mp3` while the manifest said `…_mjc…` — the official
    // audio_data `asset` strings carry that case, the dump's file NAMES do not (`fetch-assets` lower-cases both), so the
    // mismatch was invisible on Windows and a 404 on Linux.
    const urls = [...new Set([u.attack, u.hit, u.die, u.born, u.skill, ...Object.values(u.skills)])];
    assert.equal(urls.length, 7, 'her four unit roles + the three skill cues (the `skill` fallback is one of them)');
    for (const url of urls) {
      const file = join(PUBLIC, url.replace(/^\/assets\//, 'assets/'));
      assert.ok(existsSync(file), `${url} is on disk`);
      assert.ok(readdirSync(dirname(file)).includes(basename(file)), `${url}: exact name on disk (a case-only mismatch is a 404 on Linux)`);
      assert.ok(isMp3(readFileSync(file)), `${url} is an MP3`);
    }
  });

  test('the client plays the equipped skill\'s own cue (audio.js unit → u.skills[skillIndex])', { skip: noManifest }, () => {
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    for (const i of [0, 1, 2]) assert.equal(a.unit(CHAR, 'skill', 1, i), true, `S${i + 1} has a sound`);
    assert.deepEqual(played, [her().skills[0], her().skills[1], her().skills[2]], 'S1 / S2 / S3');
    // a unit without a skillIndex still gets her S1 cue through the `skill` fallback the manifest carries
    assert.equal(a.unit(CHAR, 'skill', 2, undefined), true);
    assert.equal(played[3], her().skill);
  });

  test('one ordinary attack: her attack cue (vis "none") and its note\'s impact, from the real event stream', { skip: noManifest }, () => {
    // The exact tuples the sim emits for her (measured against a real battle, `makeBattle` with her 自选 slot): the
    // 'atk' of a normal attack carries vis 'none' — the kit's `noAttackVis`, ai.js — and her talent note lands
    // 900–933 ms later as `['dmg', 2, n, 'arts']`. Both sides matter: the 'atk' registers her as the target's attacker
    // (the client still plays a unit's `attack` cue for a vis-less attack), and the 'dmg' within IMPACT_WINDOW_MS
    // (2500) plays HER `hit` — which is the sound the owner reported missing.
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    a.setFieldUnits([{ id: 1, side: 'ally', kind: 'chess', spine: CHAR }, { id: 2, side: 'enemy', kind: 'enemy', spine: 'enemy_1007_slime' }]);
    const perf = globalThis.performance;
    let now = 1000;
    globalThis.performance = { now: () => now };
    try {
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      assert.deepEqual(played, [her().attack], '发出音符: the swing/launch cue, even with vis "none"');
      now += 900;
      a.handleBattleEvents([['dmg', 2, 490, 'arts']]);
      assert.deepEqual(played, [her().attack, her().hit], '命中: her note\'s impact on the enemy');
      // an impact outside the window is another attack's (or none): no second hit cue
      played.length = 0;
      a.handleBattleEvents([['atk', 1, 2, 'none']]);
      now += 2600;
      a.handleBattleEvents([['dmg', 2, 490, 'arts']]);
      assert.deepEqual(played, [her().attack], '2500 ms window');
    } finally { globalThis.performance = perf; }
  });
});

/** The raw.githubusercontent.com URL of a manifest rel under audio/sfx. */
function rawOf(rel) {
  return RAW + rel.replace(/^audio\/sfx\//, '');
}
