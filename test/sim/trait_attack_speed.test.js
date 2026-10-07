// test/sim/trait_attack_speed.test.js — the ENGINE-level consumption of a trait's attack-speed rider
// (server/sim/content/traitMods.js, wired from Battle._setupUnit).
//
// Background (AGENTS.md §8, docs/research/12-sakiko.md §5.4): build-data.mjs folds a module's trait blackboard into
// `trait.bb` unconditionally, so `{key:'attack_speed', value:12}` reached `resolveProfile` (professions.js:603) — and
// nothing read it. 丰川祥子's elite module LOR-Y「攻击范围内存在2名及以上敌人时攻击速度+12」
// (chess_char_6_21_b) therefore did nothing at all.
//
// The tests below pin the four things that make this a fix rather than a special case:
//   1. 祥子: no bonus with 1 enemy in range, ASPD +12 (and a measurably shorter attack interval) from 2 enemies, back
//      to base when the condition is left;
//   2. the SAME engine rule serves OFFICIAL operators (圣约送葬人 REA-Y, 隐德来希 REA-Y) — there is no operator-id
//      whitelist anywhere in the path;
//   3. operators with no such line are untouched;
//   4. the trait attack-speed lines that a hand-written kit already implemented are neither double-counted nor changed
//      (史尔特尔 / 维娜·维多利亚 / 山 / 空弦 / 斯卡蒂), and the whole shipped data set is closed against silent gaps.
//
// ASPD is a POINT score, not a percentage: `aspd = clamp(base + Σaspd, 20, 600)` and
// `interval = bat × (1 + ΣbatPct) × 100 / aspd` (units.js:6-7,126-131), so +12 means 100 → 112 (interval × 100/112),
// which is how every existing module/item/enemy implementation reads `attack_speed` too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { traitAttackSpeedRule, installTraitAttackSpeed, conditionClause, plainText, TRAIT_ASPD_BUFF } from '../../server/sim/content/traitMods.js';

const ds = getDefaultSource();
const HOOKS = ['attack', 'damaged', 'deploy', 'skillStart', 'skillEnd', 'tick'];
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const DEFS = { enemies: { enemy_dummy: dummy('enemy_dummy') } };
/** Battle + one tick (t = 0 spawns exist afterwards). `autoFinish:false`: the battles below outlive their enemies. */
const run = (o) => makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o }).step();
/** No skill casts while a window is measured (a silence buff, as the other kit tests do). */
const mute = (h, u) => h.b.addBuff(u, { key: 'test:mute', flags: { silence: true } });
const approx = (a, b, msg = '', rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
/** Run `seconds` and return the gaps (s) between `u`'s consecutive ordinary attacks inside that window. */
function attackGaps(h, u, seconds) {
  const t0 = h.b.time;
  h.run(seconds);
  const ts = h.hooksOf('attack').filter((c) => c.attacker === u && c.t >= t0 - 1e-9).map((c) => c.t);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  return gaps;
}
/** `chessId` on the board with `moduleId`, 1 dummy in range (the placement every REA-Y module test uses). */
function board(id, o = {}) {
  return run({ defs: DEFS, units: [{ chessId: id, row: 10, col: 4, ...o }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

// =================================================================================================================
// 1. 丰川祥子 — the gap this change closes

test('丰川祥子 LOR-Y: 范围内 1 名敌人时模组的 +12 不生效、2 名起生效（点数），进出条件实时增减，间隔真的变短', () => {
  const h = board('chess_char_6_21_b');
  const u = h.unit('chess_char_6_21_b');
  const rule = traitAttackSpeedRule(u.def);
  assert.equal(u.def.traitBb.attack_speed, 12, 'the LOR-Y module line carries 12 (build-data folds it into trait.bb)');
  assert.equal(rule.value, 12);
  assert.equal(rule.reason, 'ok');
  assert.equal(u.base.aspd, 107, 'base ASPD = 100 + the module attributeBlackboard aspd 7 (MODULE_ATTR_MAP)');
  mute(h, u);   // her S3 (attack SP) would widen her range mid-measurement

  // --- one enemy in range: the module's 「存在2名及以上敌人」 does not hold
  h.run(1);
  assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, '1 enemy: the module line is NOT installed');
  // Her talent 2 毋畏遗忘「攻击范围内干员攻击速度+12」 is a SEPARATE, pre-existing kit effect (kits/collab.js
  // `sakiko:aura:aspd`) and it lands on her too — she stands in her own range — so the baseline used below contains
  // it. It is not this engine rule and this change does not touch it; that is why the assertions compare the engine
  // rule's own delta (+12) against this baseline instead of against `u.base.aspd`.
  assert.ok(u.findBuff('sakiko:aura:aspd'), 'the talent-2 aura (a different effect) is on');
  const baseline = u.s.aspd;
  assert.equal(baseline, u.base.aspd + 12, 'baseline = base + the talent-2 aura only');
  approx(u.s.interval, u.base.bat * 100 / baseline, 'interval = bat × 100 / aspd');
  const g1 = attackGaps(h, u, 8);
  assert.ok(g1.length >= 4, `enough attacks to measure (${g1.length})`);
  approx(median(g1), u.s.interval, 'baseline cadence matches the interval', 0.02);

  // --- a second enemy walks in: the stat is on within one tick
  const interval0 = u.s.interval;
  h.spawn('enemy_dummy', { pos: [11, 5] });
  h.step();
  assert.equal(u.s.aspd, baseline + 12, '2 enemies: +12 ASPD points (not +12 %), on top of the aura');
  approx(u.s.interval, u.base.bat * 100 / (baseline + 12), 'the shortened interval');
  assert.ok(u.s.interval < interval0 - 1e-9, 'the attack interval really shrank');
  const buff = u.findBuff(TRAIT_ASPD_BUFF);
  assert.ok(buff, 'the engine rule installed the buff');
  assert.equal(buff.mods.aspd, 12);
  const g2 = attackGaps(h, u, 8);
  approx(median(g2), u.s.interval, 'buffed cadence matches the shortened interval', 0.02);
  // the measured cadence really changed, by the ASPD ratio (119 → 131 ⇒ ×1.1008, not a field-only change)
  assert.ok(median(g2) < median(g1) - 0.02, `measured gaps shrank (${median(g2).toFixed(4)} < ${median(g1).toFixed(4)})`);
  approx(median(g1) / median(g2), (baseline + 12) / baseline, 'the measured cadence ratio is the ASPD ratio', 0.03);

  // --- the condition is left: the stat goes away again
  const extra = h.enemies().find((e) => e !== u && Math.round(e.x) === 5 && Math.round(e.y) === 11);
  assert.ok(extra, 'the second dummy is the one at (11,5)');
  h.b.dealDamage(null, extra, { type: 'true', amount: 1e9 });
  h.step();
  assert.equal(u.s.aspd, baseline, 'back to the baseline');
  assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'buff removed');
  const g3 = attackGaps(h, u, 8);
  approx(median(g3), u.s.interval, 'cadence back to the baseline interval', 0.02);
  approx(median(g3), median(g1), 'and back to the measured baseline cadence', 0.03);

  // --- and it comes back on a new enemy
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  assert.equal(u.s.aspd, baseline + 12, 're-entering the condition re-applies it');
  done(h);
});

// =================================================================================================================
// 2. the same rule serves official operators (no operator-id whitelist)

test('同一引擎规则也服务官方干员: 圣约送葬人 / 隐德来希 REA-Y 各自 +12（与她们原来的手写实现同值）', () => {
  for (const [id, moduleId] of [['chess_char_5_01_b', 'uniequip_003_excu2'], ['chess_char_5_06_b', 'uniequip_003_etlchi']]) {
    const h = board(id, { moduleId });
    const u = h.unit(id);
    const rule = traitAttackSpeedRule(u.def);
    assert.equal(rule.value, 12, `${id}: REA-Y line is +12`);
    assert.equal(rule.reason, 'ok', `${id}: the engine owns it`);
    assert.equal(rule.clause, '攻击范围内存在2名及以上敌人时', `${id}: read from the module sentence`);
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd, `${id}: 1 enemy → no bonus`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, `${id}: nothing installed`);
    h.spawn('enemy_dummy', { pos: [11, 5] });
    h.step();
    assert.equal(u.s.aspd, u.base.aspd + rule.value, `${id}: 2 enemies → +12`);
    const b = u.findBuff(TRAIT_ASPD_BUFF);
    assert.ok(b, `${id}: installed by the ENGINE rule, not the kit (the kit no longer implements this line)`);
    assert.equal(b.mods.aspd, 12);
    done(h);
  }
});

test('隐德来希 REA-Y: 只有 1 名敌人时是 base（不会因为 kit 与引擎各加一次而变成 +24）', () => {
  const h = board('chess_char_5_06_b', { moduleId: 'uniequip_003_etlchi' });
  const u = h.unit('chess_char_5_06_b');
  h.run(1.5);
  assert.equal(u.s.aspd, u.base.aspd, 'one enemy: exactly the base, no rider');
  assert.equal(u.findBuff('etlchi:module'), null, 'the old kit buff key is gone (single source now)');
  assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null);
  done(h);
});

// =================================================================================================================
// 3. regression — operators without the line

test('回归: 没有该词条的干员完全不变（3 名敌人也不动）', () => {
  for (const id of ['chess_char_1_01_a', 'chess_char_6_21_a']) {   // 隐现; 祥子的 NORMAL 棋子（无模组）
    const def = ds.getChess(id);
    assert.equal(traitAttackSpeedRule(def), null, `${id}: no trait attack-speed line`);
    const h = board(id);
    const u = h.unit(id);
    h.run(0.5);
    const as0 = u.s.aspd;
    h.spawn('enemy_dummy', { pos: [11, 5] });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(0.5);
    assert.equal(u.s.aspd, as0, `${id}: ASPD unchanged with 3 enemies in range`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, `${id}: no engine buff`);
    done(h);
  }
});

test('回归: 手写实现的那几条特性词条，引擎显式拒绝接管（防止二次加成）', () => {
  const cases = [
    ['chess_char_3_05_b', null, 30, 'kit'],                     // DRE-Y 复活后 +30（kit: tier3.js 潮涌悲歌）
    ['chess_char_6_17_b', 'uniequip_003_nearl2', 30, 'kit'],    // DRE-Y 耀骑士临光
    ['chess_char_5_07_b', null, 8, 'kit'],                      // AFT-X 未阻挡 +8
    ['chess_char_6_07_b', null, 8, 'kit'],                      // AFT-X 维娜·维多利亚
    ['chess_char_5_08_b', 'uniequip_003_horn', 10, 'kit'],      // FOR-Y 号角 不阻挡敌人时 +10
    ['chess_char_5_17_b', null, 10, 'kit'],                     // FGT-Y 生命值高于50% +10
    ['chess_char_3_21_b', null, 8, 'kit'],                      // MAR-Y 空弦 范围内地面敌人 +8
    ['chess_char_3_01_b', 'uniequip_003_angel', 8, 'kit'],      // MAR-Y 能天使
    ['chess_char_6_20_b', 'uniequip_003_agoat2', 8, 'kit'],     // WDM-Y 纯烬艾雅法拉
    ['chess_char_4_09_b', 'uniequip_004_mizuki', 50, 'mode'],   // ISW-A 水月（集成战略专用，本模式不适用）
  ];
  for (const [id, moduleId, value, reason] of cases) {
    const def = ds.getChess(id, moduleId ? { moduleId } : null);
    const r = traitAttackSpeedRule(def);
    assert.ok(r, `${id}: carries a trait attack-speed line`);
    assert.equal(r.value, value, `${id}: value`);
    assert.equal(r.condition, null, `${id}: the engine installs nothing`);
    assert.equal(r.reason, reason, `${id}: refused as '${reason}'`);
    assert.ok(r.clause.length > 0, `${id}: the clause it read is reported (${JSON.stringify(r.clause)})`);
  }
});

test('回归: 史尔特尔 / 维娜·维多利亚 / 山 / 空弦 / 斯卡蒂 的数值与改动前一致（各自的 kit 路径照旧）', () => {
  // 史尔特尔 AFT-X: 未阻挡敌人时 +8 (kits/tier5.js, 0.2 s 轮询)
  {
    const h = run({ defs: DEFS, units: [{ chessId: 'chess_char_5_07_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
    const u = h.unit('chess_char_5_07_b');
    const as = u.def.traitBb.attack_speed;
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd + as, '未阻挡: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 山 FGT-Y: 生命值高于 50% 时 +10
  {
    const h = board('chess_char_5_17_b');
    const u = h.unit('chess_char_5_17_b');
    const as = u.def.traitBb.attack_speed;
    h.run(0.5);
    assert.ok(u.hpRatio > 0.5, 'full HP');
    assert.equal(u.s.aspd, u.base.aspd + as, 'HP > 50 %: kit 的 +10');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 维娜·维多利亚 AFT-X: 未阻挡敌人时 +8 (kit 的 0.25 s aura)
  {
    const h = run({ defs: DEFS, units: [{ chessId: 'chess_char_6_07_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
    const u = h.unit('chess_char_6_07_b');
    const as = u.def.traitBb.attack_speed;
    h.run(0.6);
    assert.equal(u.s.aspd, u.base.aspd + as, '未阻挡: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 空弦 MAR-Y: 范围内存在地面敌人时 +8 (kits/tier3.js groundAspd)
  {
    const h = board('chess_char_3_21_b');
    const u = h.unit('chess_char_3_21_b');
    const as = u.def.raw.talents.find((t) => t.index === -1)?.bb.attack_speed;
    assert.equal(as, 8, 'MAR-Y 的 +8 在隐藏天赋 (index −1) 上');
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd + as, '地面敌人在范围内: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 斯卡蒂 DRE-Y: 被击倒时不撤退 + 攻击速度 +30（kit 的 trait:skadi_tide）
  {
    const h = board('chess_char_3_05_b');
    const u = h.unit('chess_char_3_05_b');
    const as = u.def.traitBb.attack_speed;
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd, 'before the lethal blow');
    h.b.dealDamage(null, u, { type: 'true', amount: 1e9 });
    h.step();
    assert.equal(u.alive, true, 'DRE-Y 不撤退');
    assert.ok(u.findBuff('trait:skadi_tide'), 'kit 的复活 buff');
    assert.equal(u.s.aspd, u.base.aspd + as, '复活后 +30（只有 kit 这一份）');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
});

// =================================================================================================================
// 4. the rule itself: what it reads, and that it installs nothing when unsure

test('规则解析: 条件子句 + 取值被显式报出；读不出条件 / 不认识的形状 → 什么都不装', () => {
  const def = ds.getChess('chess_char_6_21_b');
  const r = traitAttackSpeedRule(def);
  assert.equal(r.value, 12);
  assert.equal(r.reason, 'ok');
  assert.equal(r.clause, '攻击范围内存在2名及以上敌人时');
  assert.equal(typeof r.condition, 'function');
  assert.equal(plainText(r.source), '攻击范围内存在2名及以上敌人时攻击速度+12');
  assert.equal(conditionClause(r.source), '攻击范围内存在2名及以上敌人时');

  // a line whose 「攻击速度」 comes first is unconditional → no clause → nothing installed (never a permanent stat)
  const tail = { ...def, raw: { ...def.raw, trait: { desc: '攻击速度+9，攻击力+1%', bb: { attack_speed: 9 } } } };
  assert.deepEqual(
    { ...traitAttackSpeedRule(tail), condition: null, source: null },
    { value: 9, clause: '', reason: 'no-text', condition: null, source: null });
  assert.equal(traitAttackSpeedRule(tail).condition, null);

  // an unknown clause shape
  const odd = { ...def, raw: { ...def.raw, trait: { desc: '心情好的时候攻击速度+9', bb: { attack_speed: 9 } } } };
  const ro = traitAttackSpeedRule(odd);
  assert.equal(ro.value, 9);
  assert.equal(ro.reason, 'unknown');
  assert.equal(ro.condition, null);

  // no trait attack-speed line at all
  assert.equal(traitAttackSpeedRule(ds.getChess('chess_char_1_01_a')), null);
  // tokens are never touched
  assert.equal(installTraitAttackSpeed({}, { kind: 'token' }), null);
});

test('覆盖锁定: 全数据 268 个棋子 × 全部模组选择里，只有祥子与两位 REA-Y 干员由引擎接管，其余都显式拒绝', () => {
  const installed = [];
  const refused = [];
  for (const id of ds.chessIds()) {
    const rec = ds.rawChess(id);
    if (!rec) continue;
    const choices = [null, ...(rec.modules || []).map((m) => ({ moduleId: m.uniEquipId })), { moduleId: 'none' }];
    for (const lo of choices) {
      let d = null;
      try { d = ds.getChess(id, lo); } catch { continue; }
      const r = d ? traitAttackSpeedRule(d) : null;
      if (!r) continue;
      const tag = `${id}|${lo?.moduleId ?? 'default'}|${r.value}|${r.reason}`;
      (r.condition ? installed : refused).push(tag);
    }
  }
  assert.deepEqual(installed.sort(), [
    'chess_char_5_01_b|uniequip_003_excu2|12|ok',   // 圣约送葬人 REA-Y
    'chess_char_5_06_b|uniequip_003_etlchi|12|ok',  // 隐德来希 REA-Y
    'chess_char_6_21_b|default|12|ok',              // 丰川祥子 LOR-Y（默认模组）
    'chess_char_6_21_b|uniequip_002_oblvns|12|ok',  // 丰川祥子 LOR-Y（显式选择）
  ]);
  assert.ok(refused.length >= 13, `every other carrier is refused explicitly (${refused.length})`);
  for (const t of refused) {
    assert.ok(/\|(kit|mode)$/.test(t), `no silent gap — refused with a known reason: ${t}`);
  }
  assert.ok(refused.some((t) => t.startsWith('chess_char_3_05_b|default|30|kit')), '斯卡蒂 DRE-Y is in the list');
  assert.ok(refused.some((t) => t.startsWith('chess_char_3_21_b|default|8|kit')), '空弦 MAR-Y is in the list');
});
