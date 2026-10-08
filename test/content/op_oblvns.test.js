// test/content/op_oblvns.test.js — the 自选 operator kit of 丰川祥子 (char_4182_oblvns, 6★ 领主; kit
// server/sim/content/kits/ops/op-oblvns.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or the
// LOR-Y module at stage 1 (tier 5) / 3 (tier 6), under each of her three skills. Every number is read back from
// data/backups.json (the form of that slot status) and from the skill's own record — the pick chooses the skill, so a
// spec must never read another skill's blackboard.
//
// The mechanics follow the official notes quoted in docs/research/12-sakiko.md: §16 Fever (450 points, a FULL gauge,
// any activation, the switch skill excluded, no SP inside, the sustained-skill clocks) and §17 (one note-parameter row
// per skill, S1's 13.125° / 3.75° fan, S3's −3000 protection). §5.4 is the LOR-Y module: 「技能期间远程攻击不再降低攻击力」
// (stage 2 / 3 of `uniequip_002_oblvns`, the kit reads the sentence — it has no blackboard key — and the 自选 path ships
// stages 1 and 3 only, so the stage-2 record is composed in `recordAt` below from the official phase-2 numbers) and the
// conditional 攻击速度+12 the ENGINE consumes (content/traitMods.js, not the kit). The 0.1.4 tree implements the same
// operator in server/sim/content/kits/collab.js; that kit's test is test/content/kits_collab_sakiko.test.js there.
//
// The engine extensions this port needs are in this tree as well — `projectiles.js steer` (the three-state flight),
// `ai.js noAttackVis` / `noAttackDamage` (the note is the attack; the engine's own arrow carries nothing) and the
// snapshot outlets `snap.proj` / `snap.fever` (the notes' positions and the Fever gauge, drawn by
// render/fx/notes.js + render/units.js). Their own tests: test/sim/projectile-steer.test.js,
// test/sim/snapshot-outlets.test.js, test/render/fxnote.test.js, test/render/fevericon.test.js — this file asserts what
// the KIT does.
// Run: node --test test/content/op_oblvns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { composeUnitRecord } from '../../shared/standIn.js';
import { frontOf } from '../../server/sim/dir.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CHAR = 'char_4182_oblvns';
const FORMS = BACKUPS.units[CHAR].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const MOD = 'uniequip_002_oblvns';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
/** 12-sakiko.md §16: 「Fever累计至450点时…」 — the gauge and the trigger are points, the bar is a percentage. */
const FEVER_MAX = 450;
/** §16 「在场所有 Ave Mujica 成员 20 秒内会持续释放当前技能」 — the window. */
const FEVER_SEC = 20;
/** op-oblvns.js FEVER_CAST_GAP [ASSUMED 观感]: the kit's own seconds between two Fever-driven releases. */
const FEVER_CAST_GAP = 1.5;
const HOOKS = ['damaged', 'skillStart', 'skillEnd', 'attack', 'death', 'fatal', 'spGain', 'statusApplied'];

/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, MOD].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_far: dummy('enemy_far') };

/**
 * A battle with 丰川祥子 as uid 1 at (row, col) facing RIGHT, plus `others` (more copies of her). The default enemy is a
 * stationary immortal dummy two tiles ahead of her (inside her 0-1 + three-tiles-ahead range).
 *
 * `record` fields a composed record instead of a 自选 pick (`chessId` only, no `diy`): the module stages the 自选 path
 * does not ship are tested through `recordAt` below.
 */
function field({ tier = 5, elite = false, mod = null, skill = 2, row = 10, col = 4, dir = 'RIGHT', others = [], seed = 7, enemies, defs, setup, record = null } = {}) {
  const h = makeBattle({
    seed, autoFinish: false, timeLimit: 400, captureNoisy: true, hooks: HOOKS,
    defs: { enemies: { ...ENEMIES, ...(defs ?? {}) }, ...(record ? { chess: { [record.chessId]: record } } : {}) },
    units: record
      ? [{ uid: 1, chessId: record.chessId, row, col, dir }, ...others]
      : [{ uid: 1, diy: { slot: SLOT[tier], charId: CHAR, skillIndex: skill, uniEquipId: mod }, elite, row, col, dir }, ...others],
    enemies: enemies ?? [{ key: 'enemy_dummy', pos: [10, 6] }],
    setup,
  });
  h.step();
  return { h, u: h.unit(1) };
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
/** Damage instances `u` dealt, optionally of one tag (`talent` / `skill`) or type. */
const hitsOf = (h, u, tag = null, type = null) => h.hooksOf('damaged')
  .filter((c) => c.source === u && (!tag || (c.dmg?.tags ?? []).includes(tag)) && (!type || c.dmg?.type === type));
const notesOf = (h, u, hitTag = null) => h.b.projectiles.list.filter((p) => p.data?.tag === 'sakiko:note' && p.source === u && (!hitTag || p.data.hitTag === hitTag));
const spGains = (h, u, reason) => h.hooksOf('spGain').filter((c) => c.unit === u && (!reason || c.reason === reason));
const castsOf = (h, u) => h.hooksOf('skillStart').filter((c) => c.unit === u);
/** Hold the engine's own automatic cast back (the very thing the kit does for a member inside Fever). */
const hold = (u) => { const rule = u.skill.rule; u.skill.rule = 'NEVER'; return rule; };
const release = (u, rule) => { u.skill.rule = rule; };
/** Step until `u` casts (or `maxSec` runs out); returns that `skillStart` context. */
function untilCast(h, u, maxSec = 10) {
  const n = castsOf(h, u).length;
  const t0 = h.b.time;
  while (h.b.time - t0 < maxSec) {
    h.step(1);
    const now = castsOf(h, u);
    if (now.length > n) return now[now.length - 1];
  }
  return null;
}
/** Talent 2's `cnt`: the Fever the gauge gains per damage instance (3 in every form). */
const feverAdd = (u) => u.def.raw.talents[1].bb.cnt;

// ---- the LOR-Y module stages --------------------------------------------------------------------------------------
// `battle_equip_table uniequip_002_oblvns` has three phases; the 自选 path ships two of them (the tier-5 elite slot's
// status is `2/60/7/1`, the tier-6 one's `2/60/7/3`), so stage 2 — the first stage whose phase carries a TALENT part —
// is composed here. Official phase data (`.cache/gamedata/excel/battle_equip_table.json`, as dumped):
//   * attributeBlackboard per stage: max_hp / atk / attack_speed = 180 / 38 / 5, 250 / 54 / 6, 300 / 63 / 7;
//   * stage 1 has ONE part (`target: TRAIT` — the 攻击范围内存在2名及以上敌人时攻击速度+12 line the engine consumes);
//     stages 2 and 3 add the TALENT parts, and the first talent's own sentence (the `TALENT_DATA_ONLY` candidate's
//     `upgradeDescription`) ends with 「技能期间远程攻击不再降低攻击力」 at both of them — the clause the kit reads.
const Y2_ATTR = Object.freeze({ maxHp: 250, atk: 54, aspd: 6 });
/** The LOR-Y stage-2 talent upgrade (`def_penetrate_ratio` 0.04 / `magic_resist_penetrate_ratio` 0.02 / `max_cnt` 12). */
function y2Talent() {
  const l3 = FORMS['2/60/7/3'].modules[0].talentChanges[0];
  const stage2 = (s) => String(s).replace('5%', '4%').replace('2.5%', '2%');
  return { ...l3, desc: stage2(l3.desc), descRaw: stage2(l3.descRaw), bb: { ...l3.bb, def_penetrate_ratio: 0.04, magic_resist_penetrate_ratio: 0.02 } };
}
/**
 * Her record at a module stage the 自选 path does not ship, composed exactly like shared/diy.js `diyRecordOf` composes
 * any pick (the slot's identity + the operator's form + the pick, through the production `composeUnitRecord`), so the
 * battle resolves it the way it resolves a real 自选 piece — def.charId hers, def.diyFor the slot (her kit is looked up
 * by charId), the module at `level` active. `moduleId` another of her modules builds that one instead (the 证章 probe).
 */
function recordAt(id, { tier = 6, level = 3, attr = null, talentChange = null, moduleId = MOD, moduleName = null } = {}) {
  const slot = CHESS[CHESS[SLOT[tier]].goldenId];
  const identity = { ...slot, chessId: id, baseId: id, goldenId: null, status: { ...slot.status, equipLevel: level } };
  const own = FORMS['2/60/7/3'].modules[0];
  const mod = moduleId === MOD
    ? { ...own, level, attr: attr ?? own.attr, talentChanges: talentChange ? [talentChange] : [] }
    : { uniEquipId: moduleId, name: moduleName, typeName: null, level, attr: {}, traitOverride: null, talentChanges: [] };
  const rec = composeUnitRecord(identity, BACKUPS.units[CHAR], { ...FORMS['2/60/7/3'], modules: [mod] }, {
    skillIndex: 2, moduleId, bonds: BACKUPS.diy.operators[CHAR].bonds,
  });
  rec.diyFor = slot.baseId ?? slot.chessId;
  return rec;
}
/** The multiplier ratios (damage ÷ ATK) of the notes of one tag that LANDED inside `[from, to]`. */
const ratiosIn = (h, u, tag, from = 0, to = Infinity) =>
  hitsOf(h, u, tag).filter((c) => c.t >= from && c.t <= to).map((c) => c.dmg.amount / u.s.atk);
/** Every note ratio is `want` (and at least one landed). */
function allRatio(list, want, msg) {
  assert.ok(list.length > 0, `${msg}: notes landed (${list.length})`);
  for (const v of list) assert.ok(Math.abs(v - want) < 1e-6, `${msg}: ratio ${v} should be ${want}`);
}
/** The atk_scale values of a skill form's own row (S1's fan: one per note). */
const scalesOf = (tier, elite, id) => Object.keys(skillOf(tier, elite, id).bb).filter((k) => /^atk_scale(_\d+)?$/.test(k)).map((k) => skillOf(tier, elite, id).bb[k]);
/** The `attack@atk_scale` of the S3 record a unit actually fights with (rank 4 on the normal form, rank 7 on the elite). */
const s3ScaleOf = (u) => u.def.raw.skills.find((s) => s.skillId === S3).bb['attack@atk_scale'];
/**
 * Fill the shared gauge the way a battle does — one damage instance per `cnt` points — without waiting the ~195 s a
 * real fight needs (`FEVER_MAX / cnt` instances). Returns the number of instances dealt.
 */
function chargeGauge(h, u, target) {
  const per = feverAdd(u);
  const n = Math.ceil(FEVER_MAX / per);
  for (let i = 0; i < n; i++) h.b.dealDamage(u, target, { amount: 1, type: 'true' });
  return n;
}

// -------------------------------------------------------------------------------------------------------------------
// 1. wiring: every form × every skill

test('丰川祥子 in every 自选 form × every skill: her own kit (all three skills authored), the form\'s body, 领主 trait, 协防干员 bond, no 特质', () => {
  assert.equal(OPERATOR_KITS[CHAR], KITS[CHAR], 'registered under her charId');
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const form = formOf(tier, elite);
    const m = elite && mod ? (form.modules ?? []).find((x) => x.uniEquipId === mod) : null;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const sk = form.skills[skill];
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource],
        [CHAR, SLOT[tier], sk.skillId, false, 'skills'], `${label(f)} S${skill + 1}`);
      // the form's body (the module's own stat bonus included) and 领主: ranged, blocks 2, 1.3 s, can hit air
      const attr = m?.attr ?? {};
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (attr.maxHp ?? 0), form.stats.atk + (attr.atk ?? 0), form.stats.def + (attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.base.bat, u.s.blockCnt, u.profile.attack, u.profile.canHitFly], [1.3, 2, 'ranged', true], `${label(f)}: 领主`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 0-1 + 3 ahead`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: 协防干员 / no 特质`);
      // the skill's own data drives the runtime (the pick's choice, not a default)
      assert.deepEqual([u.skill.spCost, u.skill.initSp, u.skill.spType, u.skill.maxCharges],
        [sk.spCost, sk.initSp, 'attack', Math.max(1, sk.maxChargeTime ?? 1)], `${label(f)} S${skill + 1}: SP data`);
      assert.equal(u.skill.duration, sk.skillId === S2 ? 9999 : Math.max(0, sk.duration), `${label(f)} S${skill + 1}: duration`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN): E2 Lv1 1624 / 613 / 352, E2 Lv60 1910 / 704 / 400; LOR-Y +180 / +38 / +5 (stage 1)
  // and +300 / +63 / +7 (stage 3).
  // The ATK is the FULL-potential one (tools/build-data.mjs OPERATOR_POTENTIAL applies 潜能 6 to every form — chess,
  // 补位 stand-in and 自选 pick alike — so her picks fight with the potentials too): 678 + 26 (潜能 3 攻击力+26) = 704,
  // 587 likewise → 613. maxHp / def have no potential modifier, so they are the raw card values.
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1624, 613, 1910, 704]);
  assert.deepEqual([formOf(5, true).modules[0].attr, formOf(6, true).modules[0].attr], [{ maxHp: 180, atk: 38, aspd: 5 }, { maxHp: 300, atk: 63, aspd: 7 }]);
});

test('her talents and skills read the picked FORM: LOR-Y stage 3 upgrades talent 1 (0.05 / 0.025 / 12), the tier and skill blackboards differ', () => {
  const { h: h5, u: u5 } = field({ tier: 5, elite: true, mod: MOD, skill: 2 });
  const { h: h6, u: u6 } = field({ tier: 6, elite: true, mod: MOD, skill: 2 });
  assert.deepEqual([u5.def.raw.talents[0].bb.def_penetrate_ratio, u5.def.raw.talents[0].bb.max_cnt], [0.03, 10], 'tier 5 elite: the module stage 1 has no talent change');
  assert.deepEqual([u6.def.raw.talents[0].bb.def_penetrate_ratio, u6.def.raw.talents[0].bb.magic_resist_penetrate_ratio, u6.def.raw.talents[0].bb.max_cnt], [0.05, 0.025, 12], 'tier 6 elite: LOR-Y stage 3');
  // 潜能 4 「第二天赋效果增强」 is part of the full-potential form too: 毋畏遗忘's +12 becomes +16 (and the talent's own
  // descRaw says so: 「攻击范围内干员攻击速度+16<@ba.talpu>（+4）</>」). Tier-independent — no module touches talent 2.
  assert.equal(u5.def.raw.talents[1].bb.attack_speed, 16, '毋畏遗忘: 攻击范围内干员攻击速度+16（潜能 6）');
  assert.equal(u5.def.raw.talents[1].bb.cnt, 3, '毋畏遗忘: 对敌人造成伤害时使Fever+3');
  // S1 / S2 / S3 at rank 4 (normal) vs rank 7 (elite): the blackboards of the skill the pick chose
  assert.deepEqual([skillOf(5, false, S1).bb.atk_scale, skillOf(5, true, S1).bb.atk_scale], [0.65, 0.8]);
  assert.deepEqual([skillOf(5, false, S2).bb['attack@attack_speed'], skillOf(5, true, S2).bb['attack@attack_speed']], [80, 110]);
  assert.deepEqual([skillOf(5, false, S3).bb['attack@atk_scale'], skillOf(5, true, S3).bb['attack@atk_scale']], [1.55, 1.8]);
  done(h5); done(h6);
});

test('a 自选 pick: 丰川祥子 is offered at tiers 5 and 6 and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(CHAR));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(CHAR), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: CHAR, skillIndex: 2, uniEquipId: MOD } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: CHAR, skillIndex: 2, uniEquipId: MOD } } });
  // …and she is one of the pool's own members now (data/backups.json diy.ownedPool, rebuilt by tools/build-data.mjs)
  assert.ok(BACKUPS.diy.ownedPool.includes(CHAR));
  assert.deepEqual(BACKUPS.diy.operators[CHAR].bonds, ['emptyShip'], 'no faction of her own ⇒ 协防干员');
});

// -------------------------------------------------------------------------------------------------------------------
// 2. the notes (talent 1)

test('her ordinary attack IS a note: one attack = ONE damage instance (tag talent, arts, isAttack), the engine\'s arrow carries nothing', () => {
  // 天赋一「攻击会演奏追踪敌人的音符」+ PRTS「所有音符强制使用缓存攻击力与攻击倍率」⇒ the note is the attack itself.
  // The engine flags `noAttackDamage` on her profile make its own arrow deal nothing and complete no attack (ai.js), so
  // this instance is the whole attack; the note's own tag says which note it is, and `isAttack` keeps it an attack for
  // every 反伤 / 「受到攻击时」 / on-hit effect.
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 0, enemies: [] });   // no target: no attack, no damage at all
    h.run(6);
    assert.equal(hitsOf(h, u).length, 0, `T${tier}: nothing to hit, nothing damaged`);
    assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u).length >= 3, `T${tier}: she kept attacking (持续攻击)`);
    done(h);
  }
  // with a target: exactly one instance per attack, and it is the note's (the skill held back: only plain attacks)
  const { h, u } = field({ skill: 0 });
  hold(u);
  h.run(12);
  const mine = hitsOf(h, u);
  assert.ok(mine.length > 5, `her notes landed (${mine.length})`);
  assert.deepEqual([...new Set(mine.map((c) => (c.dmg.tags ?? []).join('+')))], ['talent'], 'every instance is a talent note');
  assert.deepEqual([...new Set(mine.map((c) => c.dmg.type))], ['arts'], 'the note deals arts damage');
  assert.ok(mine.every((c) => c.dmg.isAttack === true), '…and is marked as an attack (isAttack), as the arrow was');
  assert.deepEqual(h.hooksOf('damaged').filter((c) => c.source === u && !(c.dmg?.tags ?? []).length), [], 'no untagged (arrow) instance is left');
  // the engine's own attacks are one per interval: no attack produces two instances
  const atk = h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0);
  assert.ok(mine.length <= atk.length, `at most one note per attack (${mine.length} notes / ${atk.length} attacks)`);
  const expected = u.s.atk * u.profile.dmgMul(h.b, u, h.enemies()[0]);
  assert.ok(Math.abs(mine[0].dmg.amount - expected) < 1e-6, `the instance is ATK × the attack multiplier ${expected} (got ${mine[0].dmg.amount})`);
  done(h);
});

test('a note carries the ATK and the attack multiplier cached at LAUNCH (PRTS 缓存攻击力与攻击倍率)', () => {
  /** Talent-note damage of a field with the dummy at `pos`. */
  const measure = (pos) => {
    const { h, u } = field({ skill: 0, enemies: [{ key: 'enemy_dummy', pos }] });
    hold(u);
    h.run(12);
    const notes = hitsOf(h, u, 'talent').map((c) => c.dmg.amount);
    assert.ok(notes.length > 0, `notes landed at ${pos}`);
    done(h);
    return { notes, atk: u.s.atk, ranged: u.profile.rangedScale };
  };
  const far = measure([10, 6]);      // 未阻挡 ranged ⇒ the 领主 trait's 0.8 (professions.js lord dmgMul)
  const near = measure([10, 5]);     // blocked / on the tile in front ⇒ 1
  assert.ok(far.ranged > 0 && far.ranged < 1, `the lord ranged penalty is a real number (${far.ranged})`);
  for (const v of far.notes) assert.ok(Math.abs(v - far.atk * far.ranged) < 1e-6, `far: ${v} = ${far.atk} × ${far.ranged}`);
  assert.ok(Math.abs(Math.max(...near.notes) - near.atk) < 0.3, `near: the tile in front does not scale (${Math.max(...near.notes)} ≈ ${near.atk})`);
  // a buff that lands while a note flies does not change it; one fired afterwards does
  const { h, u } = field({ skill: 0 });
  hold(u);
  h.run(3);
  const before = Math.max(...hitsOf(h, u, 'talent').map((c) => c.dmg.amount));
  const flying = notesOf(h, u, 'talent')[0] ?? null;
  assert.ok(flying, 'a note is in flight');
  const mark = h.hooksOf('damaged').length;
  h.b.addBuff(u, { key: 'test:atk', duration: 30, mods: { atkPct: 5 } });
  for (let i = 0; i < 200 && h.b.projectiles.list.includes(flying); i++) h.step(1);
  const landed = h.hooksOf('damaged').slice(mark).filter((c) => c.source === u && (c.dmg?.tags ?? []).includes('talent')).map((c) => c.dmg.amount);
  assert.ok(landed.some((v) => Math.abs(v - before) < 1e-6), `the note already in flight kept its ATK (${JSON.stringify(landed)} vs ${before})`);
  h.run(4);
  assert.ok(Math.max(...hitsOf(h, u, 'talent').map((c) => c.dmg.amount)) > before * 3, 'a note fired after it does carry the new ATK');
  done(h);
});

test('talent 1 gives her the DEF / RES penetration of the notes in flight — the engine\'s own mod keys, one stack per note, capped (every module stage: 3%/2%/10 base and stage 1, 4%/2%/12 stage 2, 5%/2.5%/12 stage 3)', () => {
  // 每存在一个音符，Ave Mujica 成员无视敌人 3% 防御力和 2% 法术抗性（最多 10 层, `max_cnt`）. The kit's first version wrote
  // `defPen` / `resPen`, which are not mod keys at all (buffs.js ADD_KEYS has defIgnorePct / resIgnorePct) and were read
  // by nothing, so the whole talent was silently 0 while `findBuff('sakiko:notes')` still existed.
  // base 3% / 2% / 10, LOR-Y stage 1 the same (its phase has only the TRAIT part), stage 3 5% / 2.5% / 12 and stage 2 —
  // which the 自选 path cannot field — 4% / 2% / 12 (its own phase in battle_equip_table; see recordAt / y2Talent above).
  const cases = [
    { name: 'T5 normal, no module', o: { tier: 5, elite: false, mod: null }, want: [0.03, 0.02, 10] },
    { name: 'T5 elite, LOR-Y stage 1', o: { tier: 5, elite: true, mod: MOD }, want: [0.03, 0.02, 10] },
    { name: 'T6 elite, LOR-Y stage 3', o: { tier: 6, elite: true, mod: MOD }, want: [0.05, 0.025, 12] },
    { name: 'T6 elite, LOR-Y stage 2', o: { record: recordAt('test_oblvns_y2_pen', { level: 2, attr: Y2_ATTR, talentChange: y2Talent() }) }, want: [0.04, 0.02, 12] },
  ];
  for (const { name, o, want } of cases) {
    const { h, u } = field({ skill: 0, ...o });
    hold(u);
    const t0 = u.def.raw.talents[0].bb;        // the composed record: the module's talent change is already in it
    const perDef = t0.def_penetrate_ratio, perRes = t0.magic_resist_penetrate_ratio, cap = Math.floor(t0.max_cnt);
    assert.deepEqual([perDef, perRes, cap], want, name);
    h.run(1);
    let peak = { def: 0, res: 0 };
    for (let i = 0; i < 60; i++) {
      h.run(0.05);
      if (u.s.defIgnorePct > peak.def) peak = { def: u.s.defIgnorePct, res: u.s.resIgnorePct };
    }
    assert.ok(peak.def > 0, `${name}: the DEF penetration is real (peak ${peak.def})`);
    assert.ok(Math.abs(peak.res / peak.def - perRes / perDef) < 1e-9, 'both ratios come from her own blackboards');
    assert.ok(Math.abs(peak.def / perDef - Math.round(peak.def / perDef)) < 1e-9, 'it stacks per note, not once');
    assert.ok(peak.def <= perDef * cap + 1e-9, `capped at max_cnt = ${cap} notes`);
    assert.ok(u.findBuff('sakiko:notes'), 'the buff itself is up while she lives');
    done(h);
  }
});

// -------------------------------------------------------------------------------------------------------------------
// 3. the three skills

test('S1 新月的苏醒: 可充能2次, 8 notes on the fixed 自左 13.125° 至右 13.125° (间隔 3.75°) 顺时针 fan, each at its own atk_scale, one after another', () => {
  // §17:「触发技能时以自身朝向为基准，自左 13.125° 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」；音符数 = 自己黑盒里
  // atk_scale* 的条目数（8）。The row's own `angle` blackboard (15) is NOT the fan.
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.kind, u.skill.maxCharges, u.skill.spCost, u.skill.spType], ['charges', 2, sk.spCost, 'attack'], `T${tier}`);
    h.run(0.2);
    u.skill.gainSp(9999);
    const seen = new Map();
    assert.equal(u.skill.activate('manual'), true, `T${tier}: S1 fired`);
    assert.equal(u.skill.charges, u.skill.maxCharges - 1, 'one charge spent');
    for (let i = 0; i < 90; i++) {
      h.step(1);
      for (const p of notesOf(h, u, 'skill')) if (!seen.has(p.id)) seen.set(p.id, { t: h.b.time, vx: p.data.st.vx, vy: p.data.st.vy });
    }
    const rows = [...seen.values()].sort((a, b) => a.t - b.t);
    assert.equal(rows.length, 8, `eight notes (got ${rows.length})`);
    const [dr, dc] = u.fwd;
    const degs = rows.map((r) => Math.atan2(r.vx * dr - r.vy * dc, r.vx * dc + r.vy * dr) * (180 / Math.PI));
    const want = [13.125, 9.375, 5.625, 1.875, -1.875, -5.625, -9.375, -13.125];
    degs.forEach((d, i) => assert.ok(Math.abs(d - want[i]) < 0.01, `note ${i + 1}: ${d.toFixed(3)}° should be ${want[i]}°`));
    for (let i = 1; i < degs.length; i++) assert.ok(Math.abs((degs[i - 1] - degs[i]) - 3.75) < 0.01, 'adjacent notes 3.75° apart');
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t - rows[i - 1].t > 0.05, 'they leave one after another, not in one tick');
    // every note of the fan is a skill note that deals ITS OWN atk_scale × the cached attack damage, as arts
    const skillHits = hitsOf(h, u, 'skill');
    assert.ok(skillHits.length >= 4, `the fan connected (${skillHits.length})`);
    const scales = Object.keys(sk.bb).filter((k) => /^atk_scale(_\d+)?$/.test(k)).map((k) => sk.bb[k]);
    const mult = u.s.atk * u.profile.dmgMul(h.b, u, h.enemies()[0]);
    for (const c of skillHits) {
      const ratio = c.dmg.amount / mult;
      assert.ok(scales.some((s) => Math.abs(s - ratio) < 1e-6), `each note carries one of the row's atk_scale values (${ratio.toFixed(4)})`);
    }
    assert.ok(skillHits.some((c) => Math.abs(c.dmg.amount / mult - sk.bb.atk_scale) < 1e-6), 'the first note of the fan is atk_scale × ATK');
    assert.deepEqual([...new Set(skillHits.map((c) => c.dmg.type))], ['arts'], 'S1 notes are arts damage');
    done(h);
  }
});

test('S2 满月的舞会: one timbre for the cast (elite 钢琴 = ATK, normal 风琴 = ASPD), its notes carry the timbre\'s type, and Fever doubles them', () => {
  // [ASSUMED] the elite plays 钢琴 and the normal form 风琴: the official lets the player switch freely, so which form
  // gets which timbre is ours — the numbers of both branches are the row's own Lv4 / Lv7 blackboards.
  const piano = field({ tier: 6, elite: true, skill: 1 });
  const organ = field({ tier: 5, elite: false, skill: 1 });
  assert.deepEqual([piano.u.skill.duration, piano.u.skill.kind], [9999, 'duration'], 'a sustained state (the row is a switch: duration -1)');
  const b2p = skillOf(6, true, S2).bb, b2o = skillOf(5, false, S2).bb;
  assert.deepEqual([b2p['attack@atk'], b2p['attack@attack_speed'], b2o['attack@atk'], b2o['attack@attack_speed']], [0.75, 110, 0.6, 80]);
  for (const [f, type] of [[piano, 'phys'], [organ, 'arts']]) {
    const { h, u } = f;
    h.run(0.2);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true, 'timbre switched on');
    h.run(6);
    const notes = hitsOf(h, u, 'skill');
    assert.ok(notes.length > 0, `the timbre played (${notes.length} skill notes)`);
    assert.deepEqual([...new Set(notes.map((c) => c.dmg.type))], [type], `钢琴 = 物理 / 风琴 = 法术 (${type})`);
    done(h);
  }
  // the engine's own mods: exactly one of the two branches is on
  const { h: hp, u: up } = piano;
  assert.ok(up.s.atk > up.base.atk * 1.5, `钢琴 攻击力+75% (${up.base.atk} → ${up.s.atk})`);
  const { h: ho, u: uo } = organ;
  assert.ok(uo.s.aspd > 100 + 70, `风琴 攻击速度+80 (${uo.s.aspd})`);
  done(hp); done(ho);
});

test('S2 in Fever: 二连击 — twice the notes per attack (「【Fever】状態中は現在の音色による2連撃」), and it stays the open timbre', () => {
  // S2 can only be switched on OUTSIDE Fever (inside it cannot be opened, and a cast at a full gauge only triggers
  // Fever), so the test opens it first, then fills the gauge and triggers Fever with that press.
  const skillHits = (withFever) => {
    const { h, u } = field({ tier: 5, elite: false, skill: 1 });
    h.run(0.2);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true);
    assert.equal(u.skill.active, true);
    if (withFever) {
      const rule = hold(u);
      const e = h.enemies()[0];
      chargeGauge(h, u, e);
      assert.equal(u.mem.sakikoFever, FEVER_MAX, 'the shared gauge reached 450');
      release(u, rule);
      assert.equal(u.skill.activate('manual'), false, 'a full gauge turns the cast into Fever: no timbre switch');
      assert.ok(u.mem.sakikoFeverLeft > 0, 'in Fever');
      assert.equal(u.skill.active, true, 'S2 is still the open timbre');
    }
    const n0 = hitsOf(h, u, 'skill').length;
    h.run(12);
    const n = hitsOf(h, u, 'skill').length - n0;
    done(h);
    return n;
  };
  const plain = skillHits(false);
  const fevered = skillHits(true);
  assert.ok(plain > 0, `S2 deals skill damage outside Fever (${plain})`);
  assert.ok(fevered > plain * 1.5, `二連撃: ${fevered} S2 notes in Fever vs ${plain} outside`);
});

test('S3 残月的余响: the 3-21 skill range while it runs, and per attack 钢琴 + 风琴 "各 2 个音符" seeking the highest DEF / highest RES enemy', () => {
  const enemies = [{ key: 'enemy_soft', pos: [10, 5] }, { key: 'enemy_hard', pos: [10, 6] }];
  const defs = { enemy_soft: dummy('enemy_soft', { res: 90 }), enemy_hard: dummy('enemy_hard', { def: 900 }) };
  const { h, u } = field({ tier: 6, elite: true, skill: 2, enemies, defs });
  const sk = skillOf(6, true, S3);
  h.run(0.5);
  const baseRange = u.rangeKeys.length;
  assert.equal(u.skill.id, S3, 'S3 equipped');
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true);
  assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, 'the skill range (3-21) replaces the 0-1 + 3');
  assert.ok(u.rangeKeys.length > baseRange, `and it is wider (${baseRange} → ${u.rangeKeys.length} tiles)`);
  assert.ok(Math.abs(u.skill.timeLeft - sk.duration) < 0.01, `${sk.duration} s`);
  h.run(12);
  const phys = hitsOf(h, u, 'skill', 'phys');
  const arts = hitsOf(h, u, 'skill', 'arts');
  assert.ok(phys.length > 0 && arts.length > 0, `both timbres played (${phys.length} phys / ${arts.length} arts)`);
  assert.deepEqual([...new Set(phys.map((c) => c.target.defId))], ['enemy_hard'], 'the physical notes seek the highest DEF');
  assert.deepEqual([...new Set(arts.map((c) => c.target.defId))], ['enemy_soft'], 'the arts notes seek the highest RES');
  const per = Math.max(...[phys, arts].map((l) => l.length));
  assert.ok(per >= 4, `at least two attacks' worth of notes each (${per})`);
  for (const c of [...phys, ...arts]) {
    assert.ok(Math.abs(c.dmg.amount - u.s.atk * u.profile.dmgMul(h.b, u, c.target) * sk.bb['attack@atk_scale']) < 1e-6,
      `${sk.bb['attack@atk_scale'] * 100}% ATK as the cached note damage (${c.dmg.amount})`);
  }
  done(h);
});

test('S3 outside its duration: the range goes back and the plain attack is a single talent note again', () => {
  const { h, u } = field({ tier: 5, elite: false, skill: 2 });
  const base = formOf(5, false).rangeGrid;
  h.run(0.3);
  u.skill.gainSp(9999);
  u.skill.activate('manual');
  u.skill.extend(-24);                       // run the 25 s state out quickly
  assert.ok(h.runUntil(() => !u.skill.active, 5), 'the state ended');
  assert.deepEqual(u.liveRangeGrid, base, 'range back to 0-1 + 3 ahead');
  const n = hitsOf(h, u).length;
  h.run(6);
  const after = hitsOf(h, u).slice(n);
  assert.ok(after.length > 0, 'she keeps attacking');
  assert.deepEqual([...new Set(after.map((c) => (c.dmg.tags ?? []).join('+')))], ['talent'], 'only the talent note again');
  done(h);
});

// -------------------------------------------------------------------------------------------------------------------
// 3b. LOR-Y 2 级 / 3 级: 「技能期间远程攻击不再降低攻击力」
//
// PRTS 第一天赋「颂乐音符」的 精英2 Y模组2级 / 3级 行末尾多出这一句（base 精英2 与 1 级没有；docs/research/12-sakiko.md
// §5.4）。模块自己的数据里它**没有黑盒键**：battle_equip_table `uniequip_002_oblvns` 的 phase 1 只有一件 TRAIT 部件，
// phase 2 / 3 才多出 TALENT 部件，而那句话只在 TALENT_DATA_ONLY 候选的句子（`upgradeDescription`）里 —— 也就是
// `modules[].talentChanges[0].descRaw`，被 composeTalents 合进每个战斗解析到的 `talents[0]`。kit 因此按**这句话**判定
// （op-oblvns.js LIFT_RANGED_CLAUSE / liftsRangedPenalty），不是按等级硬编码；「技能期间」用引擎自己的技能状态
// `unit.skill.active`（另有释放当 tick 的口径，见 skillRunning）。
// 领主特性的 0.8 是共享字段（professions.js lord `dmgMul`），kit 只在音符快照这一处取消它。

test('LOR-Y 3 级: 技能期间音符 ×1.0（S3 自己的音符 ×1.8），技能外 ×0.8，贴身近战判定两边都是 ×1.0，技能一结束立刻恢复', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: MOD, skill: 2 });
  const sk = skillOf(6, true, S3);
  const rule = hold(u);
  h.run(6);
  allRatio(ratiosIn(h, u, 'talent'), u.profile.rangedScale, 'outside any skill: ATK × 0.8 (the 领主 ranged penalty)');
  assert.equal(u.def.raw.module.level, 3, 'LOR-Y stage 3 through the production 自选 path (the tier-6 elite slot)');
  release(u, rule);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true);
  assert.equal(u.skill.active, true, 'S3 is a 25 s sustained state');
  const t0 = h.b.time + 1.2;        // every note launched before the cast has landed by now (a flight is ≲1 s)
  h.run(6);
  allRatio(ratiosIn(h, u, 'talent', t0), 1, 'during S3: ATK × 1.0 — the ranged reduction is not applied');
  allRatio(ratiosIn(h, u, 'skill', t0), sk.bb['attack@atk_scale'], 'during S3: the skill\'s own notes keep their atk_scale (1.8), not 1.8 × 0.8');
  done(h);
  // it stops with the skill: 技能结束后立刻回到 ×0.8
  u.skill.extend(-24);
  assert.ok(h.runUntil(() => !u.skill.active, 5), 'the state ran out');
  const t1 = h.b.time + 1.2;
  h.run(6);
  allRatio(ratiosIn(h, u, 'talent', t1), u.profile.rangedScale, 'after the skill: ATK × 0.8 again');
  done(h);

  // a target on the tile ahead is the lord's melee case (×1 already): the clause cancels a REDUCTION, it never adds one
  const near = field({ tier: 6, elite: true, mod: MOD, skill: 2, enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
  const r2 = hold(near.u);
  near.h.run(6);
  assert.equal(near.u.profile.dmgMul(near.h.b, near.u, near.h.enemies()[0]), 1, 'the melee-range value of the profile');
  allRatio(ratiosIn(near.h, near.u, 'talent'), 1, 'melee-range target outside the skill: ×1.0');
  release(near.u, r2);
  near.u.skill.gainSp(9999);
  near.u.skill.activate('manual');
  near.h.run(6);
  allRatio(ratiosIn(near.h, near.u, 'talent'), 1, '…and during it: still ×1.0, never double-lifted');
  done(near.h);
});

test('LOR-Y 2 级（自选路径拿不到的档位）: 同一条句子同样生效 — 技能内 ×1.0 / 技能外 ×0.8，且 2 级自己的数值（250/54/6、4%/2%/12）', () => {
  // The 自选 slots ship stage 1 (tier 5) and stage 3 (tier 6) only: `checkDiyPick` validates the module against the
  // slot's own status (`equipLevel`), so a stage-2 record has to be composed — recordAt / y2Talent above do it exactly
  // the way shared/diy.js composes any pick, from the official phase-2 numbers.
  const { h, u } = field({ record: recordAt('test_oblvns_y2', { level: 2, attr: Y2_ATTR, talentChange: y2Talent() }), skill: 2 });
  const form = formOf(6, true);
  assert.deepEqual([u.def.raw.module.id, u.def.raw.module.level, u.def.raw.module.active], [MOD, 2, true], 'stage 2 is really in play');
  assert.deepEqual([u.def.charId, u.def.diyFor, u.kit.skillSource, !!u.kit.generic], [CHAR, SLOT[6], 'skills', false], 'a 自选 piece: her kit, keyed by charId');
  assert.deepEqual([u.base.maxHp, u.base.atk, u.base.aspd],
    [form.stats.maxHp + Y2_ATTR.maxHp, form.stats.atk + Y2_ATTR.atk, form.stats.aspd + Y2_ATTR.aspd], 'the stage-2 attributeBlackboard');
  const t0 = u.def.raw.talents[0];
  assert.deepEqual([t0.bb.def_penetrate_ratio, t0.bb.magic_resist_penetrate_ratio, Math.floor(t0.bb.max_cnt)], [0.04, 0.02, 12], 'LOR-Y stage 2: 4% / 2% / 12');
  assert.ok(/技能期间远程攻击不再降低攻击力/.test(t0.descRaw), 'the sentence the clause is read from is on the stage-2 record too');
  const rule = hold(u);
  h.run(6);
  allRatio(ratiosIn(h, u, 'talent'), u.profile.rangedScale, 'stage 2 outside the skill: ATK × 0.8');
  release(u, rule);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true);
  const t1 = h.b.time + 1.2;
  h.run(6);
  allRatio(ratiosIn(h, u, 'talent', t1), 1, 'stage 2 during the skill: ATK × 1.0');
  done(h);
});

test('瞬发的 S1 也算「技能期间」: 八只音符是一次释放，全部取释放瞬间的倍率（3 级 ×1.0；1 级 / 无模组仍 ×0.8）', () => {
  // S1 is `kind: 'charges'`: activate() sets `active`, runs onStart (the fan) and ends the skill inside the same call,
  // so a per-note `active` check would lift the first note and drop the seven that leave S1_STAGGER apart. The fan
  // captures the window once — one release, one multiplier for all eight (op-oblvns.js S1 onStart / skillRunning).
  const fan = (o) => {
    const { h, u } = field({ ...o, skill: 0 });
    const rule = hold(u);
    h.run(3);
    release(u, rule);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true, 'S1 fired');
    assert.equal(u.skill.active, false, 'the instant is already over — the fan cannot ask `active` per note');
    h.run(5);
    const ratios = ratiosIn(h, u, 'skill');
    done(h);
    return { ratios, scales: scalesOf(o.tier, o.elite, S1) };
  };
  const y3 = fan({ tier: 6, elite: true, mod: MOD });
  assert.ok(y3.ratios.length >= 4, `the fan connected (${y3.ratios.length})`);
  for (const v of y3.ratios) assert.ok(y3.scales.some((s) => Math.abs(s - v) < 1e-6), `stage 3: ${v} is one of the row's atk_scale values`);
  const l1 = fan({ tier: 5, elite: true, mod: MOD });
  assert.ok(l1.ratios.length >= 4, `the fan connected (${l1.ratios.length})`);
  for (const v of l1.ratios) assert.ok(l1.scales.some((s) => Math.abs(s * 0.8 - v) < 1e-6), `stage 1: ${v} = its atk_scale × 0.8`);
});

test('回归: 没有这句文本的形态技能期间仍然 ×0.8 — LOR-Y 1 级、无模组（两种形态）、以及她的另一个模组（证章）', () => {
  const cases = [
    { name: 'T5 elite, LOR-Y stage 1', o: { tier: 5, elite: true, mod: MOD } },
    { name: 'T6 elite, no module', o: { tier: 6, elite: true, mod: null } },
    { name: 'T6 normal, no module', o: { tier: 6, elite: false, mod: null } },
    // her other module: the 证章 `uniequip_001_oblvns` (typeName ORIGINAL). It has no battle_equip_table phases at all, so
    // no form record carries it and checkDiyPick refuses it — composed here like any pick, at stage 2 on purpose: the
    // rule is the module's SENTENCE, not a stage number, so a stage-≥2 module without it must not lift anything.
    { name: 'her 证章 (uniequip_001_oblvns) at stage 2', o: { record: recordAt('test_oblvns_badge', { level: 2, moduleId: 'uniequip_001_oblvns', moduleName: '丰川祥子证章' }) } },
  ];
  for (const { name, o } of cases) {
    const { h, u } = field({ skill: 2, ...o });
    assert.ok(!/技能期间远程攻击不再降低攻击力/.test(u.def.raw.talents[0]?.descRaw ?? ''), `${name}: the record carries no such sentence`);
    const rule = hold(u);
    h.run(6);
    allRatio(ratiosIn(h, u, 'talent'), u.profile.rangedScale, `${name}: outside the skill ×0.8`);
    release(u, rule);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true, `${name}: S3 fired`);
    const t0 = h.b.time + 1.2;
    h.run(6);
    allRatio(ratiosIn(h, u, 'talent', t0), u.profile.rangedScale, `${name}: during the skill STILL ×0.8`);
    allRatio(ratiosIn(h, u, 'skill', t0), s3ScaleOf(u) * u.profile.rangedScale, `${name}: its own notes keep atk_scale × 0.8`);
    done(h);
  }
});

test('回归: LOR-Y 的条件攻速 +12 由引擎的 traitMods.js 消费（kit 不做第二遍），天赋二的光环 +16 仍在', () => {
  // 「攻击范围内存在2名及以上敌人时攻击速度+12」是 TRAIT 部件上的黑盒，条件在句子里 —— 引擎通用消费（traitMods.js，
  // 由 battle/players.js `_setupUnit` 接线）：1 名敌人时不装，2 名时 +12 点，离开条件即摘掉。她的 kit 只留天赋二那个
  // 光环（`sakiko:aura:aspd`，+16 满潜能，连自己也照到），绝不能把模组这条再写一遍（那就是 +24）。
  for (const { name, o, carrier } of [
    { name: 'T6 elite LOR-Y stage 3', o: { tier: 6, elite: true, mod: MOD }, carrier: 12 },
    { name: 'T5 elite LOR-Y stage 1', o: { tier: 5, elite: true, mod: MOD }, carrier: 12 },
    { name: 'T6 normal, no module', o: { tier: 6, elite: false, mod: null }, carrier: 0 },
    { name: 'T6 elite LOR-Y stage 2', o: { record: recordAt('test_oblvns_y2_aspd', { level: 2, attr: Y2_ATTR, talentChange: y2Talent() }) }, carrier: 12 },
  ]) {
    const { h, u } = field({ skill: 0, enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], ...o });
    hold(u);
    const aura = u.def.raw.talents[1].bb.attack_speed;
    h.run(1);
    assert.equal(u.findBuff('sakiko:aura:aspd')?.mods.aspd, aura, `${name}: talent 2's aura (+${aura})`);
    assert.equal(u.s.aspd, u.base.aspd + aura, `${name}: 1 enemy in range → base + the aura only`);
    assert.equal(u.findBuff('trait:attack_speed'), null, `${name}: the module line is not installed yet`);
    h.spawn('enemy_far', { pos: [11, 5] });          // a second dummy (the same synthetic record)
    h.step();
    assert.equal(u.findBuff('trait:attack_speed')?.mods.aspd ?? 0, carrier, `${name}: the ENGINE owns the module line`);
    assert.equal(u.s.aspd, u.base.aspd + aura + carrier, `${name}: 2 enemies in range → ${carrier ? '+12 more' : 'unchanged'}`);
    assert.notEqual(u.s.aspd, u.base.aspd + aura + 24, `${name}: never twice (no kit copy)`);
    done(h);
  }
});

test('回归: 那名 2 级形态在真实战斗里跑得动 —— 一整场（无内容错误、不变量成立）', () => {
  const { h, u } = field({ record: recordAt('test_oblvns_y2_full', { level: 2, attr: Y2_ATTR, talentChange: y2Talent() }), skill: 2, seed: 13 });
  h.run(20);
  assert.ok(u.alive && hitsOf(h, u, 'talent').length > 0, 'she fought with the stage-2 record');
  assert.ok(u.mem.sakikoFever >= 0 && u.mem.sakikoFever <= FEVER_MAX, `the gauge stayed in range (${u.mem.sakikoFever})`);
  done(h);
});

// -------------------------------------------------------------------------------------------------------------------
// 4. 持续攻击 (PRTS 术语: 无论攻击范围内是否有攻击目标，都会持续进行攻击)

test('持续攻击: she keeps playing notes with nothing in range, and each note that reaches an enemy pays her attack-type SP back', () => {
  // PRTS: 攻击范围内不存在敌人时，若自身朝向的前方一格地块的通行类型为无，持续攻击无法发射音符. 空转 ≠ 空放: with nothing
  // in range the engine never performs an attack, so the note IS her attack for that cycle and pays its SP where the
  // engine pays every attack (`onAttackPerformed`), on CONTACT — «击中就加», whatever the damage pipeline did with it.
  const { h, u } = field({ tier: 5, elite: false, skill: 0, enemies: [{ key: 'enemy_far', pos: [10, 8] }] });
  const far = h.enemies()[0];
  assert.equal(far.defId, 'enemy_far', 'the enemy is four tiles ahead — outside her three');
  h.run(0.3);
  assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).length, 0, 'nothing in her range');
  const hits = () => hitsOf(h, u, 'talent').filter((c) => c.target === far);
  while (hits().length < 3 && h.b.time < 90) h.step(1);
  assert.equal(hits().length, 3, `the drifting notes found it by themselves (${hits().length})`);
  assert.equal(u.skill.sp, 3, 'three contacts = 3 attack-type SP (S1 costs 4 ⇒ one charge every 4)');
  assert.equal(u.skill.charges, 0, 'not a full charge yet');
  assert.equal(spGains(h, u, 'attack').length, 3, 'exactly one spGain per contact, none doubled');
  assert.equal(spGains(h, u, 'attack').reduce((s, c) => s + c.amount, 0), 3, 'one point each');
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0).length, 0, 'the engine never started an attack');
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length > 0, 'she was 持续攻击 all along');
  while (hits().length < 4 && h.b.time < 120) h.step(1);
  assert.equal(u.skill.charges, 1, 'the fourth contact completes a charge');
  assert.equal(u.skill.sp, 0, '…and the bar restarts');
  done(h);
});

test('空转但没打到人: no SP (空放不是攻击回复) — an empty field, and an enemy the note never reaches', () => {
  {
    const { h, u } = field({ skill: 0, enemies: [] });
    h.run(25);
    assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length >= 10, 'she kept attacking');
    assert.equal(hitsOf(h, u).length, 0, 'nothing to hit');
    assert.equal(u.skill.sp, 0, 'no SP');
    assert.deepEqual(spGains(h, u), [], 'not one spGain');
    done(h);
  }
  {
    const { h, u } = field({ skill: 0, enemies: [{ key: 'enemy_far', pos: [10, 14] }] });
    h.run(0.3);
    assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).length, 0, 'far outside her range');
    h.run(25);
    assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length >= 10, 'she kept attacking');
    assert.equal(hitsOf(h, u, 'talent').length, 0, 'no note ever reached it');
    assert.equal(u.skill.sp, 0, 'no contact, no attack recovery');
    assert.deepEqual(spGains(h, u), [], 'not one spGain');
    done(h);
  }
});

test('命中判定不含伤害量: a shield that eats the whole note still counts as a hit (the attack recovery is paid)', () => {
  // 所有者 2026-10-08:「是攻击到敌人（无论有没有造成伤害）才结算」. `strike` runs the engine's dealDamage first (a full shield
  // makes it return 0) and then reports the contact unconditionally — the same 口径 as the drifting note above.
  const { h, u } = field({
    skill: 0,
    enemies: [{ key: 'enemy_far', pos: [10, 8] }],
    setup: (b) => b.on('enemySpawn', ({ enemy }) => b.addBuff(enemy, { key: 'test:shield', shield: 1e9 }), { priority: 100 }),
  });
  const far = h.enemies()[0];
  assert.ok(far.s.shield >= 1e9, 'the shield is up');
  const hits = () => hitsOf(h, u, 'talent').filter((c) => c.target === far);
  while (spGains(h, u, 'attack').length < 3 && h.b.time < 90) h.step(1);
  assert.equal(hits().length, 3, 'three contacts');
  assert.equal(far.hp, far.s.maxHp, 'the shield ate every point of damage');
  assert.equal(hitsOf(h, u).filter((c) => c.amount > 0).length, 0, 'not one point of damage got through');
  assert.equal(spGains(h, u, 'attack').length, 3, 'and yet three attack recoveries — the hit is the contact');
  assert.equal(u.skill.sp, 3, 'S1 charges up on contacts that dealt nothing');
  done(h);
});

test('持续攻击 的前方一格守卫只挡「通行类型为无」: an obstacle blocks, a FLY-only tile does not (all four directions)', () => {
  // PRTS: 攻击范围内不存在敌人时，若自身朝向的前方一格地块的通行类型为无，持续攻击无法发射音符 — 只有「无」才挡。The guard
  // used to require `walkable()`, which is stricter than the text: a FLY-only tile (深水区 / 沟壑) is NOT 「无」, and the
  // operator went silent forever once she faced one (owner's report 2026-10-08). Obstacles still block.
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const { h, u } = field({ skill: 0, dir, enemies: [] });
    assert.equal(u.dir, dir, `deployed facing ${dir}`);
    const [fr, fc] = frontOf(u.tileR, u.tileC, dir);
    assert.equal(h.b.grid.walkable(fr, fc), true, `${dir}: the tile ahead (${fr},${fc}) starts out passable`);
    const before = h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length;
    h.b.grid.setObstacle(fr, fc, true);
    assert.equal(h.b.grid.walkable(fr, fc), false, `${dir}: now 通行类型为无`);
    h.run(u.s.bat * 4);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length, before, `${dir}: not one note while the tile ahead is impassable`);
    h.b.grid.setObstacle(fr, fc, false);
    h.run(u.s.bat * 4);
    assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length > before, `${dir}: and it resumes`);
    done(h);
  }
  // a FLY-only tile ahead does NOT stop her (flyPassable && !walkable is not 「无」)
  const { h } = field({ skill: 0, enemies: [] });
  const g = h.b.grid;
  let spot = null;
  for (let r = 1; r < 19 && !spot; r++) for (let c = 1; c < 20 && !spot; c++) if (g.flyPassable(r, c) && !g.walkable(r, c) && g.walkable(r, c - 1)) spot = [r, c];
  if (!spot) return;                                  // the synthetic field has no such tile: nothing to assert
  const { h: h2, u: u2 } = field({ skill: 0, enemies: [], row: spot[0], col: spot[1] - 1 });
  const dir2 = u2.dir;
  const [fr2, fc2] = frontOf(u2.tileR, u2.tileC, dir2);
  assert.equal(g2(h2, fr2, fc2), 'fly', `the tile ahead (${fr2},${fc2}) is FLY-only`);
  h2.run(u2.s.bat * 4);
  assert.ok(h2.hooksOf('attack').filter((c) => c.attacker === u2 && (c.targets ?? []).length === 0).length > 0, 'she keeps playing notes towards it');
  done(h2);
});

/** 'fly' | 'walk' | 'none' for a tile of `h`'s grid. */
function g2(h, r, c) {
  const g = h.b.grid;
  if (!g.flyPassable(r, c)) return 'none';
  return g.walkable(r, c) ? 'walk' : 'fly';
}

test('the notes fly where she faces — all four directions (unit.fwd, never the ±1 sprite scalar)', () => {
  // `unit.facing` is the ±1 sprite-flip scalar (dir.js: "the legacy scalar facing survives only as hSign") and is never
  // 0, so the old `(unit.facing || 1) >= 0 ? 1 : -1` fired every LEFT-facing note to the right.
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const { h, u } = field({ skill: 0, dir, enemies: [] });
    h.run(0.3);
    const p = notesOf(h, u)[0];
    assert.ok(p, `${dir}: a note is in flight`);
    const [dr, dc] = u.fwd;
    assert.ok(p.data.st.vx * dc + p.data.st.vy * dr > 0, `${dir}: launched inside ±angle of the facing (${p.data.st.vx.toFixed(2)}, ${p.data.st.vy.toFixed(2)})`);
    const x0 = p.x, y0 = p.y;
    h.step(3);
    assert.ok((p.x - x0) * dc + (p.y - y0) * dr > 0, `${dir}: and it travelled that way (Δ ${(p.x - x0).toFixed(3)}, ${(p.y - y0).toFixed(3)})`);
    done(h);
  }
});

test('a note of a targetless attack hunts for itself: it switches to tracking inside its seek radius, and expires when its leg is over', () => {
  const { h, u } = field({ skill: 0, enemies: [{ key: 'enemy_far', pos: [10, 8] }] });
  h.run(0.3);
  let tracked = false, far = 0, peak = 0;
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    h.step(1);
    const live = notesOf(h, u);
    peak = Math.max(peak, live.length);
    for (const p of live) {
      seen.add(p.id);
      if (p.data.st.state === 'track') tracked = true;
      if (Math.abs(p.x - u.x) > 3.4) far++;
    }
  }
  assert.ok(tracked, 'a note switched to 【追踪移动】 by itself');
  assert.ok(far > 0, 'notes really travel past her three-tile range');
  assert.ok(peak >= 1 && peak <= 12, `a few notes at a time, not an armada (peak ${peak})`);
  assert.ok(seen.size > peak, `notes come and go (${seen.size} launched, ${peak} at once)`);
  assert.equal(notesOf(h, u).length <= peak, true, 'no leak');
  done(h);
});

// -------------------------------------------------------------------------------------------------------------------
// 5. Fever (§16)

test('Fever 计量: 每次造成伤害 +cnt, 0–450 累积、快照给 0–100, 不到 450 发动技能进不去', () => {
  const { h, u } = field({ tier: 5, elite: false, skill: 2 });
  h.run(0.2);
  const rule = hold(u);
  h.run(6);
  const gauge = u.mem.sakikoFever;
  const per = feverAdd(u);
  assert.equal(gauge, hitsOf(h, u).length * per, `+${per} per damage instance (${gauge} points / ${hitsOf(h, u).length} instances)`);
  assert.ok(gauge > 0 && gauge < FEVER_MAX, `between 0 and 450 (${gauge})`);
  assert.equal(u.mem.gauges.fever, Math.round(gauge / FEVER_MAX * 100), 'mem.gauges.fever is the 0–100 share');
  release(u, rule);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true, 'the skill itself fires');
  assert.equal(u.mem.sakikoFeverLeft, 0, 'far below 450: no Fever');
  assert.equal(u.findBuff('sakiko:fever'), null, 'and no marker');
  done(h);
});

test('蓄满（450）时任意一次技能发动触发 Fever: 全员进入 20 秒、计量耗尽、SP 停止、常规自动发动被压住', () => {
  const { h, u } = field({ tier: 5, elite: false, skill: 0 });       // S1 (charges): the skill Fever 持续释放
  h.run(0.2);
  const rule = hold(u);
  const n = chargeGauge(h, u, h.enemies()[0]);
  assert.equal(u.mem.sakikoFever, FEVER_MAX, `the gauge is full after ${n} instances`);
  assert.equal(u.mem.gauges.fever, 100, 'the bar reads 100');
  release(u, rule);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true, 'a manual cast at a full gauge');
  assert.ok(Math.abs(u.mem.sakikoFeverLeft - FEVER_SEC) < 0.2, `Fever runs ${FEVER_SEC} s (${u.mem.sakikoFeverLeft})`);
  assert.equal(u.mem.sakikoFever, 0, '「耗尽」: the state spends the gauge it was paid with');
  assert.ok(u.findBuff('sakiko:fever'), 'the marker is on every member');
  assert.equal(u.s.flags.noSp, true, 'the marker carries the engine\'s own noSp (技能不积累)');
  assert.equal(u.skill.rule, 'NEVER', '常规自动发动 is suspended');
  // inside the window: SP and charges do not move, and the only casts are Fever's own (free: no charge, no SP)
  u.skill.sp = 0;
  u.skill.charges = 0;
  const t0 = h.b.time;
  h.run(8);
  const inWindow = castsOf(h, u).filter((c) => c.t > t0 + 1e-6);
  assert.ok(inWindow.length >= 2, `持续释放 (${inWindow.length} releases in 8 s)`);
  assert.deepEqual([...new Set(inWindow.map((c) => c.reason))], ['fever'], 'all of them are Fever\'s');
  assert.equal(u.skill.sp, 0, 'no SP accumulates inside');
  assert.equal(u.skill.charges, 0, 'and the free releases spend none');
  assert.equal(u.mem.sakikoFever, 0, 'the gauge does not accumulate either');
  for (let i = 1; i < inWindow.length; i++) {
    assert.ok(inWindow[i].t - inWindow[i - 1].t >= FEVER_CAST_GAP - 1e-6, `at least the kit's own ${FEVER_CAST_GAP} s apart`);
  }
  h.run(FEVER_SEC);
  assert.equal(u.mem.sakikoFeverLeft, 0, 'the window is over');
  assert.equal(u.findBuff('sakiko:fever'), null, 'and the marker is gone');
  assert.equal(u.skill.rule, rule, '常规自动发动 is restored');
  done(h);
});

test('S1 的充能满自动释放不触发 Fever，普通的自动发动会 (§17)', () => {
  // §17 S1:「因充能到达上限自动释放时，不会触发 Fever…自动释放始终不改变技能为手动触发的本质」. The engine's own release and
  // that one have to be told apart: the kit marks the charge state before the cast and the skillStart handler decides.
  const autoRelease = (sp) => {
    const { h, u } = field({ tier: 5, elite: false, skill: 0 });
    h.run(0.2);
    const rule = hold(u);
    chargeGauge(h, u, h.enemies()[0]);
    u.skill.charges = 0;
    u.skill.sp = 0;
    release(u, rule);
    u.skill.gainSp(sp);
    const cast = untilCast(h, u, 10);
    assert.ok(cast, 'the engine released it');
    assert.notEqual(cast.reason, 'manual');
    done(h);
    return { u, cast };
  };
  const full = autoRelease(9999);
  assert.equal(full.u.skill.sakikoChargeFull, true, 'this release started from a full charge (2/2)');
  assert.equal(full.u.mem.sakikoFeverLeft, 0, '充能满自动释放: no Fever');
  const one = autoRelease(full.u.skill.spCost);
  assert.equal(one.u.skill.sakikoChargeFull, false, 'this one did not');
  assert.ok(one.u.mem.sakikoFeverLeft > 0, 'a plain automatic cast at a full gauge does trigger it');
});

test('S2 是切换类技能: Fever 期间无法开启，可以触发 Fever 时只触发 Fever、不切换形态', () => {
  const { h, u } = field({ tier: 5, elite: false, skill: 1 });
  h.run(0.2);
  const rule = hold(u);
  chargeGauge(h, u, h.enemies()[0]);                 // with everything held back the timbre never switched on
  release(u, rule);
  assert.equal(u.skill.active, false, 'not switched on yet');
  assert.equal(u.skill.activate('manual'), false, 'at a full gauge the cast only triggers Fever');
  assert.equal(u.skill.activations, 0, 'no timbre switch happened');
  assert.equal(u.skill.active, false, 'S2 is still off');
  assert.ok(u.mem.sakikoFeverLeft > 0, '…but Fever is in');
  const n0 = u.skill.activations;
  assert.equal(u.skill.activate('manual'), false, '「Fever 期间，此技能无法手动开启」');
  h.run(6);
  assert.equal(u.skill.active, false, 'and Fever never opens it either (切换类技能除外)');
  assert.equal(u.skill.activations, n0, 'not one activation');
  assert.equal(castsOf(h, u).filter((c) => c.reason === 'fever').length, 0, 'no Fever release of the switch skill');
  done(h);
});

test('Fever 结束: 凭 Fever 开启的持续类技能被强制结束，进入前已在跑的那一个从暂停处继续', () => {
  // §16:「通过 Fever 状态开启的持续类技能将在 Fever 状态结束时强制结束；进入 Fever 状态前正在释放的持续类技能暂停计时」.
  // Two copies of her: A carries S1 (the trigger) and B S3 (a 25 s state Fever opens for it).
  const { h, u: a } = field({
    tier: 5, elite: false, skill: 0,
    others: [{ uid: 2, diy: { slot: SLOT[5], charId: CHAR, skillIndex: 2 }, row: 11, col: 4 }],
  });
  const b = h.unit(2);
  assert.equal(b.skill.id, S3, 'B carries S3');
  h.run(0.2);
  const ra = hold(a), rb = hold(b);
  chargeGauge(h, a, h.enemies()[0]);
  release(a, ra); release(b, rb);
  assert.equal(a.mem.sakikoFeverLeft, 0, 'nothing triggered yet');
  a.skill.gainSp(9999);
  assert.equal(a.skill.activate('manual'), true, 'A triggers Fever for the whole team');
  assert.ok(a.mem.sakikoFeverLeft > 0 && b.mem.sakikoFeverLeft > 0, 'both copies are in');
  h.run(1);
  assert.equal(b.skill.active, true, 'Fever opened B\'s S3 (free, outside the SP limit)');
  const start = castsOf(h, b).find((c) => c.reason === 'fever');
  assert.ok(start, 'and that release came from Fever');
  const n = h.hooksOf('skillEnd').length;
  b.skill.extend(400);                               // the state would outlive the window on its own
  h.run(FEVER_SEC);
  assert.equal(a.mem.sakikoFeverLeft, 0, 'Fever is over');
  const ends = h.hooksOf('skillEnd').slice(n).filter((c) => c.unit === b);
  assert.ok(ends.some((c) => c.reason === 'fever'), `S3 was ended by Fever (reasons: ${JSON.stringify(ends.map((c) => c.reason))})`);
  assert.equal(b.skill.active, false, 'not left running');
  done(h);

  // …and the other way round: the skill that was ALREADY running when Fever started has its clock frozen
  const { h: h2, u: u2 } = field({ tier: 5, elite: false, skill: 2 });
  h2.run(0.3);
  const r2 = hold(u2);
  u2.skill.gainSp(9999);                             // the SP its own cast needs (it is filled in one tick here)
  chargeGauge(h2, u2, h2.enemies()[0]);
  release(u2, r2);
  const cast = untilCast(h2, u2, 10);
  assert.ok(cast && cast.reason !== 'fever', 'S3 started on its own, which set Fever off');
  assert.ok(u2.skill.active && u2.mem.sakikoFeverLeft > 0, 'S3 runs and Fever is in');
  const frozen = u2.skill.timeLeft;
  h2.run(10);
  assert.ok(Math.abs(u2.skill.timeLeft - frozen) < 0.05, `its clock is frozen for the whole window (${frozen.toFixed(2)} → ${u2.skill.timeLeft.toFixed(2)})`);
  assert.equal(u2.skill.active, true, 'so it does not end inside Fever');
  h2.run(11);
  assert.equal(u2.mem.sakikoFeverLeft, 0, 'Fever over');
  assert.equal(u2.skill.active, true, 'the skill that was already running is not ended by Fever');
  assert.ok(u2.skill.timeLeft > 0.5, `it resumes with the clock it had (${u2.skill.timeLeft.toFixed(2)} left)`);
  const after = u2.skill.timeLeft;
  h2.run(2);
  assert.ok(u2.skill.timeLeft < after - 1, '…and the clock runs again');
  done(h2);
});

test('S3 【Fever】免死: priority −3000, kept at 1 HP, 強制退場 when Fever ends (and when she leaves first)', () => {
  {
    const { h, u } = field({ tier: 5, elite: false, skill: 2 });
    h.run(0.2);
    const mine = (h.b._hooks.fatal ?? []).filter((x) => x.owner === u);
    assert.equal(mine.length, 1, 'she registered one fatal handler');
    assert.equal(mine[0].priority, -3000, '§17: 优先级 −3000 (every other protection speaks first)');
    // another protection at −1000 takes over: hers sees `prevented` and claims nothing
    h.b.on('fatal', (ctx) => { if (ctx.unit === u) ctx.prevented = true; }, { priority: -1000 });
    const rule = hold(u);
    chargeGauge(h, u, h.enemies()[0]);
    release(u, rule);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true, 'into Fever');
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    assert.equal(u.alive, true, 'someone saved her');
    assert.ok(!u.mem.sakikoSaved, 'the −3000 handler did not claim the save');
    h.run(FEVER_SEC + 1);
    assert.equal(u.alive, true, 'so there is no forced exit for her');
    done(h);
  }
  {
    const { h, u } = field({ tier: 5, elite: false, skill: 2 });
    h.run(0.2);
    const rule = hold(u);
    chargeGauge(h, u, h.enemies()[0]);
    release(u, rule);
    u.skill.gainSp(9999);
    u.skill.activate('manual');
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    assert.equal(u.alive, true, '致命的なダメージを受けてもHPは1以下にならず');
    assert.equal(u.hp, 1, 'held at exactly 1 HP');
    assert.equal(u.mem.sakikoSaved, true, 'marked for the exit');
    h.run(FEVER_SEC + 1);
    assert.equal(u.alive, false, 'Fever 終了後に強制退場');
    assert.equal(u.removeReason, FORCED_EXIT, 'a 退场, not a plain retreat');
    assert.equal(u.findBuff('sakiko:fever'), null, 'and the marker is cleaned up');
    done(h);
  }
  {
    // 「自身退场时」: another mechanism takes her off the field while Fever runs — she still leaves as a 退场
    const { h, u } = field({ tier: 5, elite: false, skill: 2 });
    h.run(0.2);
    const rule = hold(u);
    chargeGauge(h, u, h.enemies()[0]);
    release(u, rule);
    u.skill.gainSp(9999);
    u.skill.activate('manual');
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    assert.equal(u.mem.sakikoSaved, true);
    h.b.retreat(u, { reason: 'retreat' });
    assert.equal(u.alive, false, 'off the field');
    assert.equal(u.removeReason, FORCED_EXIT, 'the forced exit still marks her departure');
    h.run(FEVER_SEC + 1);
    assert.equal(u.mem.sakikoFeverLeft, 0, 'the window ran out without her');
    assert.equal(u.findBuff('sakiko:fever'), null, 'no marker left behind on a unit that is gone');
    done(h);
  }
  {
    // outside Fever the same hit kills her normally
    const { h, u } = field({ tier: 5, elite: false, skill: 2 });
    h.run(0.3);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    assert.equal(u.alive, false, 'no protection outside Fever');
    assert.equal(u.removeReason, 'killed');
    done(h);
  }
});

test('两/三只祥子共用一条 Fever: 谁的伤害都进同一条，任一只触发全员进入，结束后一起恢复', () => {
  const { h } = field({
    tier: 5, elite: false, skill: 0,
    others: [
      { uid: 2, diy: { slot: SLOT[5], charId: CHAR, skillIndex: 0 }, row: 10, col: 3 },
      { uid: 3, diy: { slot: SLOT[5], charId: CHAR, skillIndex: 0 }, row: 11, col: 4 },
    ],
  });
  h.run(3);
  const three = [h.unit(1), h.unit(2), h.unit(3)];
  assert.ok(three.every(Boolean), 'three copies on the field');
  const rules = three.map((u) => [u, hold(u)]);
  h.run(3);                                          // their notes land (~0.6 s of flight) and fill the ONE gauge
  const gauge = three[0].mem.sakikoFever;
  assert.ok(gauge > 0, `they filled it together (${gauge})`);
  assert.equal(new Set(three.map((u) => u.mem.sakikoFever)).size, 1, 'they all read the same number');
  // one of them damages an enemy: the ONE gauge moves for all three
  const before = three[0].mem.sakikoFever;
  h.b.dealDamage(three[2], h.enemies()[0], { amount: 1, type: 'true' });
  assert.deepEqual(three.map((u) => u.mem.sakikoFever), [before + feverAdd(three[0])].concat([before + feverAdd(three[0]), before + feverAdd(three[0])]), 'any copy\'s damage fills the shared one');
  const caster = three[1];
  chargeGauge(h, caster, h.enemies()[0]);
  assert.deepEqual(three.map((u) => u.mem.sakikoFever), [FEVER_MAX, FEVER_MAX, FEVER_MAX], 'still one number at the top');
  assert.equal(three[0].mem.gauges.fever, 100, 'and the share is 100');
  for (const [u, r] of rules) release(u, r);
  caster.skill.gainSp(9999);
  assert.equal(caster.skill.activate('manual'), true, 'any one of them can trigger it');
  for (const u of three) {
    assert.ok(u.mem.sakikoFeverLeft > 0, 'every copy entered');
    assert.ok(u.findBuff('sakiko:fever'), 'every copy wears the marker');
  }
  assert.equal(new Set(three.map((u) => u.mem.gauges.fever)).size, 1, 'and they stay in step');
  h.run(FEVER_SEC + 1);
  for (const u of three) {
    assert.equal(u.mem.sakikoFeverLeft, 0, 'they end together');
    assert.equal(u.findBuff('sakiko:fever'), null, 'marker gone');
    assert.equal(u.skill.rule, 'DEFAULT', '常规自动发动 restored');
  }
  done(h);
});

test('Fever 计量只在本回合这一场战斗内保留: 新的一场战斗从 0 开始（不继承）', () => {
  // 所有者裁定 (12-sakiko.md §16): 「是一回合内，每回合从 0 开始，并且协助队友的时候也要重新积累」 — the record is keyed
  // by the `Battle` instance, so a new battle (a new round, or the 联防 battle she is called into) starts at 0.
  const { h, u } = field({ tier: 5, elite: false, skill: 0 });
  h.run(4);
  assert.ok(u.mem.sakikoFever > 0, `the gauge filled in this battle (${u.mem.sakikoFever})`);
  const { h: h2, u: u2 } = field({ tier: 5, elite: false, skill: 0, seed: 11 });
  assert.ok(u2?.mem, 'she is on the field in the second battle');
  assert.ok(!u2.mem.sakikoFever, `a new battle starts with no gauge (read ${u2.mem.sakikoFever})`);
  assert.ok(!u2.mem.gauges?.fever, 'and no bar value');
  h2.run(4);
  assert.ok(u2.mem.sakikoFever > 0, 'it fills again from scratch');
  done(h); done(h2);
});

// -------------------------------------------------------------------------------------------------------------------
// 6. the remaining talent (talent 2's aura) and the error surface

test('talent 2 毋畏遗忘: 攻击范围内干员攻击速度+16（潜能 6）(the mujica range-union clause is deliberately not implemented — owner\'s decision 2026-10-08, a second copy of her included)', () => {
  const { h, u } = field({
    tier: 5, elite: false, skill: 0, enemies: [],
    others: [{ uid: 2, chessId: 'chess_char_1_08_a', row: 10, col: 5 }],   // 德克萨斯 in her range (not another copy of her)
  });
  const texas = h.unit(2);
  h.run(3);
  const aura = texas.findBuff('sakiko:aura:aspd');
  assert.ok(aura, 'the aura reached the operator in her range');
  assert.equal(aura.mods.aspd, u.def.raw.talents[1].bb.attack_speed, 'with the blackboard\'s value (+16)');
  assert.ok(texas.s.aspd > 100, `the attack speed really moved (${texas.s.aspd})`);
  h.b.retreat(u);
  h.run(1);
  assert.equal(texas.findBuff('sakiko:aura:aspd'), null, 'and it lapses once she leaves the field');
  done(h);
});

test('every form × every skill runs a full battle without a content error, and nothing leaks', () => {
  for (const f of FORMS_ALL) {
    for (const skill of [0, 1, 2]) {
      const [tier, elite, mod] = f;
      const { h, u } = field({ tier, elite, mod, skill, seed: 13 });
      const t0 = 0;
      h.run(20);
      assert.ok(u.alive, `${label(f)} S${skill + 1}: she is still there`);
      assert.ok(hitsOf(h, u).length > 0, `${label(f)} S${skill + 1}: she dealt damage (${hitsOf(h, u).length})`);
      assert.ok(u.mem.sakikoFever >= 0 && u.mem.sakikoFever <= FEVER_MAX, `${label(f)} S${skill + 1}: gauge in range (${u.mem.sakikoFever})`);
      assert.ok(h.b.time > t0, 'the battle ran');
      done(h);
    }
  }
});
