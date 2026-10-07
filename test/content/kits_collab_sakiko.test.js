// 丰川祥子 (chess_char_6_21, server/sim/content/kits/collab.js) — the locally added Ave Mujica
// collaboration operator (tools/inject-sakiko.mjs, docs/research/12-sakiko.md).
//
// Covers the three claims that matter for her being in the game at all:
//   1. her data resolves through the normal pipeline (tier 6, 领主 trait, 3 skills, elite module)
//   2. the 协防干员 fallback bond gives every operator −20 % phys/arts taken and its members
//      ×1.2 damage (elite ×1.4) — the effect the owner described, which the mode already implements
//   3. her kit is her own: talent 1 plays homing notes, talent 2 is the attack-speed aura, and each of
//      the three skills resolves to a hand-authored spec rather than the generic fallback
//
// The Fever and note-flight assertions follow the official notes quoted in `12-sakiko.md` §16 (Fever: 450
// points, a FULL gauge, any activation, no SP inside, the switch skill excluded, sustained-skill clocks) and
// §17 (one note parameter row per skill, S1's fixed fan, S2's piano 【已命中】, S3's −3000 protection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { skillSpecSource, KITS } from '../../server/sim/content/index.js';
import { frontOf } from '../../server/sim/dir.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const ds = getDefaultSource();
const BASE = 'chess_char_6_21_a';
const ELITE = 'chess_char_6_21_b';
const CHAR_ID = 'char_4182_oblvns';
/** 12-sakiko.md §16: 「Fever累计至450点时…」 — the gauge and the trigger are points, the bar is a percentage. */
const FEVER_MAX = 450;
/** §16 「在场所有 Ave Mujica 成员 20 秒内会持续释放当前技能」 — the window the release cadence is measured over. */
const FEVER_SEC = 20;
/** collab.js FEVER_CAST_GAP [ASSUMED 观感]: the kit's own seconds between two Fever-driven releases (it used to be
 *  the engine's AUTO_OP_COOLDOWN, `FEVER_CAST_GAP_OLD` = 3 s — "自动操作具有3s冷却"). */
const FEVER_CAST_GAP = 1.5;
const FEVER_CAST_GAP_OLD = 3;

const raw = (id) => ds.rawChess(id);
const rec = (id, n) => raw(id).skills.find((s) => s.skillId === `skchr_oblvns_${n}`);
const both = [BASE, ELITE];
const READY = { sp: 999 };
const HOOKS = ['damaged', 'skillStart', 'skillEnd', 'attack', 'death', 'fatal', 'deploy', 'statusApplied'];
/** `addBuff` refuses an undeployed unit (Battle.js:1228); `carryState` is the lobby's carried SP. */
const CARRY = { carryState: { sp: 999 } };

/**
 * Battle with a stationary immortal dummy right in front of the deployment tile. `pos` places the enemy
 * directly (the tier-6 kit tests do the same); a walking enemy would not reach her inside the window.
 */
function run(units, o = {}) {
  return makeBattle({
    seed: 7,
    autoFinish: false,
    timeLimit: 400,
    hooks: HOOKS,
    captureNoisy: true,
    units,
    enemies: o.enemies ?? [{ key: 'e_dummy', pos: [10, 6] }],
    defs: { enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
    ...o,
  });
}
const unitOf = (h, id) => h.unit(id);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const tagsOf = (h, source) => {
  const out = {};
  for (const c of h.hooksOf('damaged')) {
    if (source && c.source !== source) continue;
    const t = (c.dmg?.tags ?? []).join('+') || '(none)';
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
};
/**
 * Hold the engine's own automatic cast back — the very thing the kit does for a member inside Fever
 * (`rule: 'NEVER'` = "never auto-cast: the kit calls skill.activate() itself", skills.js). Tests use it to let
 * the gauge reach 450 with nothing cast, so that "what triggers Fever" is deterministic.
 */
const hold = (u) => { const rule = u.skill.rule; u.skill.rule = 'NEVER'; return rule; };
const release = (u, rule) => { u.skill.rule = rule; };
/** Step until `u` casts again (or `maxSec` runs out); returns that `skillStart` context. */
function untilCast(h, u, maxSec = 10) {
  const list = () => h.hooksOf('skillStart').filter((c) => c.unit === u);
  const n = list().length;
  const t0 = h.b.time;
  while (h.b.time - t0 < maxSec) {
    h.step(1);
    const now = list();
    if (now.length > n) return now[now.length - 1];
  }
  return null;
}

// -------------------------------------------------------------------------------------------------------------------
// 1. data

test('the injected records resolve: tier 6, 领主, three skills, elite carries the LOR-Y module', () => {
  for (const id of both) {
    const c = raw(id);
    assert.ok(c, `${id} exists`);
    assert.equal(c.name, '丰川祥子');
    assert.equal(c.charId, CHAR_ID);
    assert.equal(c.tier, 6);
    assert.equal(c.subProfessionId, 'lord');
    assert.equal(c.profession, 'WARRIOR');
    assert.equal(c.visible, true);
    // she has no faction of her own → she belongs to the 协防干员 fallback bond, and membership is the
    // record's OWN bondIds (the engine never reads config.economy.fallbackBondId — see the injector)
    assert.deepEqual(c.bonds, ['emptyShip'], `${id}: a 协防干员`);
    assert.equal(c.price, 4);
    assert.ok(Array.isArray(c.rangeGrid) && c.rangeGrid.length, `${id}: range grid`);
    assert.equal(c.skills.length, 3);
    assert.equal(c.trait.bb.atk_scale, 0.8, `${id}: 领主 远程攻击 ×0.8 trait`);
  }
  const g = raw(ELITE);
  assert.equal(g.status.equipLevel, 3, 'elite carries its module at max level');
  assert.equal(g.module.active, true, '…and the module is therefore active');
  assert.equal(g.module.type, 'LOR-Y');
  assert.ok(g.statsBase && g.traitBase && g.talentsBase, 'elite has the module-resolved bases');
});

test('she really is a 协防干员: in the bond\u2019s members and carrying its id herself', () => {
  const bonds = JSON.parse(readFileSync(new URL('../../data/bonds.json', import.meta.url), 'utf8'));
  const bond = bonds.emptyShip;
  assert.equal(bond.name, '协防干员');
  assert.equal(bond.bb.damage_resistance, 0.2);
  assert.equal(bond.bb.damage_scale_normal, 1.2);
  assert.equal(bond.bb.damage_scale_extra, 1.4);
  assert.ok(bond.members.includes(BASE), 'listed in the bond members');
  assert.ok(bond.visibleMembers.includes(BASE), 'and in the shop-visible subset');
  // the id must also be on the record: the engine counts a bond from the chess's own `bonds` only
  assert.deepEqual(raw(BASE).bonds, ['emptyShip']);
  assert.deepEqual(raw(ELITE).bonds, ['emptyShip'], 'the elite too');
  // every visible member of the bond carries it on its own record, which is the convention she has to follow
  for (const id of bond.visibleMembers) {
    assert.ok((raw(id).bonds ?? []).includes('emptyShip'), `${id} carries emptyShip`);
  }
});

// -------------------------------------------------------------------------------------------------------------------
// 2. her kit registry

test('her ordinary attack IS a note: one attack = one note, and the engine\'s own arrow neither flies nor damages', () => {
  // 所有者报告（2026-10-08）:「射击出来的是子弹不是音符」→ 上一轮只把箭「不画」（noAttackVis）。所有者随后裁定：
  // 「我只是让箭变成了音符，普通攻击的载体变成了音符而已，而不是出手就结算伤害，是攻击到敌人（无论有没有造成伤害）
  // 才结算」. 也就是：箭不再是载体 —— 引擎那支箭既不造成伤害（`noAttackDamage`，ai.js resolveHit 跳过 dealDamage，
  // 攻击也不再由引擎「演完」：`onAttackPerformed` 同样跳过），也不在客户端出现（'atk' 报 'none'），天赋一每次攻击
  // 演奏的那只音符才是这次普攻本身（伤害在音符碰到敌人时结算，见下面的普通攻击测试）。
  for (const id of both) {
    const h = run([{ chessId: id, row: 10, col: 4, ...CARRY }]);
    h.run(0.1);
    const unit = unitOf(h, id);
    assert.equal(unit.profile.attack, 'ranged', `${id}: 她还是远程攻击（伤害规则不变）`);
    // data/chess.json 是生成物（AGENTS §5），kit 不改它：覆盖只发生在 profile 上
    assert.equal(raw(id).projectile, 'arrow', `${id}: 数据里的 projectile 仍是 'arrow'（生成物，未改）`);
    assert.equal(unit.profile.projectile, 'arrow', `${id}: profile 的 projectile 也保持 'arrow'（领主/远程的规则靠它）`);
    assert.equal(unit.profile.noAttackVis, true, `${id}: kit 的 trait 挂上了 noAttackVis（引擎那支箭不画）`);
    assert.equal(unit.profile.noAttackDamage, true, `${id}: 也挂上了 noAttackDamage（它也不再造成伤害）`);
    const t0 = h.b.time;
    h.run(12);
    const atk = h.eventsOf('atk').filter((e) => e[1] === unit.id);
    assert.ok(atk.length > 3, `${id}: she attacked (${atk.length} 'atk' events)`);
    assert.deepEqual([...new Set(atk.map((e) => e[3]))], ['none'], `${id}: 每次攻击的表现都是 'none'（客户端没有箭可画）`);
    // 客户端能看到的只有音符：'atk' 那条路径不画东西，snap.proj 里全是音符（引擎那支箭的 visual 是 'arrow'，不进 snap.proj）
    assert.deepEqual([...(h.b.snapshot().proj ?? [])].map((e) => e[3]).filter((k) => k !== 'note' && k !== 'noteSkill'), [],
      `${id}: snap.proj（客户端照它画）里只有音符`);
    // 伤害只剩音符那一条：每段都带 tag（引擎那支箭的那段是无 tag 的，已经不结算了），且普通攻击的音符带 isAttack
    // （引擎原来给箭的那些「受到攻击」判定不能丢）
    const mine = h.hooksOf('damaged').filter((c) => c.source === unit);
    assert.ok(mine.length > 0, `${id}: 她造成了伤害`);
    const tags = [...new Set(mine.flatMap((c) => c.dmg?.tags ?? []))].sort();
    assert.deepEqual(tags, ['skill', 'talent'], `${id}: 伤害只有「天赋音符」与「技能音符」两种来源（实测 ${tags}）`);
    assert.ok(mine.every((c) => (c.dmg?.tags ?? []).length > 0), `${id}: 没有无 tag 的那段箭伤害了`);
    const talent = mine.filter((c) => c.dmg.tags.includes('talent'));
    assert.ok(talent.length > 0 && talent.every((c) => c.dmg.isAttack === true),
      `${id}: 普攻那只音符的伤害标记为一次「攻击」（isAttack）`);
    done(h);
  }
  // 一次普通攻击 = 一只音符：她每次普通攻击里唯一会生成的东西就是天赋那一只（S1 的 8 只属于技能，一次 8 只）。
  // 为了把「普通攻击」单独量出来，把敌人放在射程外 —— 她这时仍然「持续攻击」（PRTS: 无论范围内是否有目标都持续
  // 攻击），每 1.3 s 飘出一只天赋音符，而技能因为够不到目标不会自动释放。逐步观察，数「新出现的音符 id」而不是
  // 列表长度：音符飘出射程 1 秒后就消失（delay），长度会把「走了两只、来了一只」读成 0。
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }], {
    enemies: [{ key: 'e_out', pos: [10, 16] }],       // 她的射程是前方 3 格
    defs: { enemies: { e_out: enemyRec({ key: 'e_out', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
  });
  h.run(0.2);
  const unit = unitOf(h, BASE);
  // 只数音符：她名下的投射物现在也只有音符（引擎那支箭已经不飞了）。
  const live = () => new Set(h.b.projectiles.list.filter((p) => p.source === unit && p.visual === 'note').map((p) => p.id));
  let seen = live(), cycles = 0, maxBorn = 0, offVisual = new Set(), foreign = new Set();
  // every attack of hers, ordinary or 持续攻击: the kit emits the sim's own 'attack' hook for a drift shot too
  // (the engine emits it for a real attack), which is exactly the moment the talent's note is played.
  let attacks = 0;
  h.b.on('attack', (c) => { if (c.attacker === unit) attacks++; }, { priority: 5 });
  const casts0 = h.hooksOf('skillStart').filter((c) => c.unit === unit).length;
  for (let i = 0; i < 30 * 12; i++) {
    const a0 = attacks;
    h.step(1);
    const now = live();
    const fresh = [...now].filter((id) => !seen.has(id)).length;
    seen = now;
    // 客户端能画出来的：'atk' 的表现（远程攻击的 'none' 不是斩击）与 snap.proj 的音符，别的都没有
    for (const e of h.b.drainEvents()) if (e[0] === 'atk' && e[1] === unit.id && e[3] !== 'none') offVisual.add(`atk:${e[3]}`);
    for (const e of h.b.snapshot().proj ?? []) if (e[3] !== 'note' && e[3] !== 'noteSkill') offVisual.add(`proj:${e[3]}`);
    // 她名下不该再有任何非音符的投射物（引擎那支箭以前会挂在这里）
    for (const p of h.b.projectiles.list) if (p.source === unit && p.visual !== 'note') foreign.add(p.visual);
    if (attacks > a0) { cycles++; maxBorn = Math.max(maxBorn, fresh); }
  }
  const skillCasts = h.hooksOf('skillStart').filter((c) => c.unit === unit).length - casts0;
  assert.ok(cycles >= 8, `她一直在持续攻击（12 秒里 ${cycles} 次攻击）`);
  assert.equal(skillCasts, 0, '射程外没有目标：技能没有释放（所以新生的每一只都是普攻带出的那一只）');
  assert.equal(maxBorn, 1, `每次普通攻击恰好新生 1 只可见音符（实测最多 ${maxBorn}）`);
  assert.deepEqual([...offVisual], [], '客户端能画到的只有音符（没有箭矢的表现）');
  assert.deepEqual([...foreign], [], '她名下也没有非音符的投射物（引擎那支箭已经不飞了）');
  // 客户端画的东西（snap.proj）里没有非音符的条目 —— 改前这里会是她自己那支 'arrow'
  let seenEntries = 0;
  offVisual = new Set();
  for (let i = 0; i < 90; i++) {
    h.step(1);
    for (const e of h.b.snapshot().proj ?? []) { if (e[3] !== 'note' && e[3] !== 'noteSkill') offVisual.add(e[3]); seenEntries++; }
  }
  assert.ok(seenEntries > 0, 'snap.proj 里有音符（客户端确实画得到）');
  assert.deepEqual([...offVisual], [], 'snap.proj 里只有音符，没有别的弹道');
  done(h);
});

test('her three skills are hand-authored, not the generic fallback', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(KITS, BASE), true, 'registered under her baseId');
  for (const id of both) {
    for (const n of [1, 2, 3]) {
      const def = ds.getChess(id, { skillIndex: rec(id, n).index });
      const src = skillSpecSource(def, KITS);
      assert.equal(src, n === 3 ? 'kit' : 'skills', `${id} S${n}: got ${src}`);
    }
  }
});

// -------------------------------------------------------------------------------------------------------------------
// 3. the kit's behaviour

test('talent 1 gives her the DEF/RES penetration of the notes in flight — the engine\'s own mod keys', () => {
  // 每存在一个音符，Ave Mujica 成员无视敌人 3% 防御力和 2% 法术抗性（最多 10 层）. The kit wrote `defPen` / `resPen`,
  // which are not mod keys at all (buffs.js ADD_KEYS has defIgnorePct / resIgnorePct) and were read by nothing, so the
  // talent's whole effect was silently 0 while `findBuff('sakiko:notes')` still existed — the buff merely looked right.
  const t0 = raw(BASE).talents[0].bb;
  const perDef = t0.def_penetrate_ratio, perRes = t0.magic_resist_penetrate_ratio, cap = Math.floor(t0.max_cnt);
  assert.ok(perDef > 0 && perRes > 0 && cap > 0, `blackboards: ${perDef} / ${perRes} / ≤ ${cap}`);
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }]);
  h.run(1);
  const unit = unitOf(h, BASE);
  // the kit re-derives the stacks on its own 0.1 s timer, so a single sample can land between two refreshes
  let peak = { def: 0, res: 0 };
  for (let i = 0; i < 60; i++) {
    h.run(0.05);
    if (unit.s.defIgnorePct > peak.def) peak = { def: unit.s.defIgnorePct, res: unit.s.resIgnorePct };
  }
  assert.ok(peak.def > 0, `the DEF penetration is real (peak ${peak.def})`);
  assert.ok(Math.abs(peak.res / peak.def - perRes / perDef) < 1e-9, 'both ratios come from her own blackboards');
  assert.ok(Math.abs(peak.def / perDef - Math.round(peak.def / perDef)) < 1e-9, 'it stacks per note, not once');
  assert.ok(peak.def <= perDef * cap + 1e-9, `capped at max_cnt = ${cap} notes`);
  done(h);
});

test('notes carry the cached ATK and the attack multiplier of the attack that fired them (PRTS 缓存攻击力与攻击倍率)', () => {
  /** Every talent-note damage instance of one field, where `pos` places the dummy. */
  const measure = (pos) => {
    const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }], { enemies: [{ key: 'e_dummy', pos }] });
    h.run(12);
    const unit = unitOf(h, BASE);
    const notes = h.hooksOf('damaged')
      .filter((c) => c.source === unit && (c.dmg?.tags ?? []).includes('talent')).map((c) => c.dmg.amount);
    // 引擎那条无 tag 的普通攻击伤害（原来由那支箭给出）已经不结算了：她的每一段伤害都是音符
    assert.deepEqual(h.hooksOf('damaged').filter((c) => c.source === unit && !(c.dmg?.tags ?? []).length), [],
      'no untagged (arrow) damage instance is left');
    assert.ok(notes.length > 0, `her notes landed (${notes.length})`);
    done(h);
    return { notes, atk: unit.s.atk, ranged: unit.profile.rangedScale };
  };
  // Her talent carries no `attack@atk_scale` (the row has delay / *_penetrate_ratio / attack@angle / max_cnt), so the
  // note's own scale is the kit's fallback 1: what is left is exactly the attack multiplier of the firing attack —
  // the number the engine's own arrow used to deal (ai.js resolveHit: atk × atkScale(1) × dmgMul).
  const far = measure([10, 6]);      // 未阻挡 ranged attack ⇒ the lord trait's 0.8 (professions.js lord dmgMul)
  const near = measure([10, 5]);     // blocked / on the tile in front ⇒ 近战不降攻, ×1
  assert.ok(far.ranged > 0 && far.ranged < 1, `the lord ranged penalty is a real number (${far.ranged})`);
  for (const v of far.notes) {
    assert.ok(Math.abs(v - far.atk * far.ranged) < 1e-6, `每一段音符伤害 = 缓存攻击力 ${far.atk} × 倍率 ${far.ranged}（实测 ${v}）`);
  }
  assert.ok(Math.abs(Math.max(...near.notes) - near.atk) < 1e-6,
    `贴身/阻挡时音符按 ×1 结算（${Math.max(...near.notes)} vs ${near.atk}）`);
  // the multiplier is the one cached at LAUNCH, so a note fired while the enemy was still unblocked keeps the ranged
  // 0.8 (PRTS: 阻挡期间发射的音符才不降攻) — compare the maxima of the two fields:
  assert.ok(Math.abs(Math.max(...near.notes) / Math.max(...far.notes) - 1 / far.ranged) < 0.02,
    `0.8 at range, 1.0 up close (${Math.max(...near.notes)} vs ${Math.max(...far.notes)})`);
});

test('a note keeps the ATK it was launched with — a buff that lands while it flies does not change it', () => {
  // PRTS: 所有音符强制使用**缓存**攻击力与攻击倍率 — the point of "cached" is that the note is not re-read at impact
  // (`onHit` runs when it lands; this used to read `unit.s.atk` there).
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }]);
  h.run(3);
  const unit = unitOf(h, BASE);
  const noteDamage = () => h.hooksOf('damaged').filter((c) => c.source === unit && (c.dmg?.tags ?? []).includes('talent')).map((c) => c.dmg.amount);
  const baseline = noteDamage();
  assert.ok(baseline.length > 0, 'she has already landed notes');
  const before = Math.max(...baseline);

  const flying = noteInFlight(h, unit);
  assert.ok(flying, 'a note is in flight');
  const mark = h.hooksOf('damaged').length;
  h.b.addBuff(unit, { key: 'test:atk', duration: 30, mods: { atkPct: 5 } });   // ×6 ATK, mid-flight
  for (let i = 0; i < 200 && h.b.projectiles.list.includes(flying); i++) h.step(1);
  const landed = h.hooksOf('damaged').slice(mark).filter((c) => c.source === unit && (c.dmg?.tags ?? []).includes('talent')).map((c) => c.dmg.amount);
  assert.ok(landed.some((v) => Math.abs(v - before) < 1e-6), `the note already in flight kept its own ATK (${JSON.stringify(landed)} vs ${before})`);

  h.run(4);   // notes fired from now on carry the buffed ATK
  assert.ok(Math.max(...noteDamage()) > before * 3, `a note fired after it does carry the new ATK (${Math.max(...noteDamage())} vs ${before})`);
  done(h);
});

test('S3 残月的余响 tracks the highest-DEF and the highest-RES enemy of its skill range', () => {
  // "钢琴+风琴同时演奏，各 2 个音符，物理/法术各相当于攻击力 x%，分别追踪法术抗性最高与防御力最高的敌人"
  const enemies = [{ key: 'e_soft', pos: [10, 5] }, { key: 'e_hard', pos: [10, 6] }];
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index, ...CARRY }], {
    enemies,
    defs: { enemies: { e_soft: enemyRec({ key: 'e_soft', hp: 1e7, speed: 0, def: 0, res: 90 }), e_hard: enemyRec({ key: 'e_hard', hp: 1e7, speed: 0, def: 900, res: 0 }) } },
  });
  h.run(2);
  const unit = unitOf(h, BASE);
  assert.equal(unit.skill.id, 'skchr_oblvns_3', 'S3 equipped');
  h.run(10);
  const skill = (type) => h.hooksOf('damaged').filter((c) => c.source === unit && (c.dmg?.tags ?? []).includes('skill') && c.dmg?.type === type);
  const phys = skill('phys');
  const arts = skill('arts');
  assert.ok(phys.length > 0 && arts.length > 0, `both timbres played (${phys.length} phys, ${arts.length} arts)`);
  // the row has no `attack@times`, and the kit's old `grid || unit.rangeKeys` never fell through: `grid` was an empty
  // ARRAY (truthy), so `extremeIn` searched a range of zero tiles and every note hit the ordinary attack's target.
  assert.deepEqual([...new Set(phys.map((c) => c.target.defId))], ['enemy_e_hard'], 'the physical notes seek the highest DEF');
  assert.deepEqual([...new Set(arts.map((c) => c.target.defId))], ['enemy_e_soft'], 'the arts notes seek the highest RES');
  done(h);
});

test('音符的飞行是官方的三态模型：自由移动飘出去，发现目标后转入追踪移动并命中', () => {
  // PRTS 天赋备注: 初始【自由移动】, 每隔 0.4 s 更新状态 —— 自由移动中若一定范围（半径 1.0）内出现可选目标就设为追踪
  // 目标, 过了最短自由移动时间（0.1 s）后转入【追踪移动】. 无目标时用「扩张正弦方向」飘（基础振幅 0.3, x 速度 1.3）,
  // 追踪时以 2.0 速度并受转向速度限制. 她的射程是前方 3 格, 所以第 4 格上的敌人她打不到 —— 只有音符自己能找到它.
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }], {
    enemies: [{ key: 'e_far', pos: [10, 8] }],
    defs: { enemies: { e_far: enemyRec({ key: 'e_far', hp: 1e6, speed: 0, def: 0, res: 0 }) } },
  });
  h.run(0.2);
  const u = unitOf(h, BASE);
  const [dr, dc] = u.fwd;
  let maxOff = 0, tracked = false;
  for (let i = 0; i < 480; i++) {
    h.step(1);
    const p = h.b.projectiles.list.find((x) => x.data?.tag === 'sakiko:note' && x.source === u);
    if (!p?.data?.st) continue;
    // the drift across the launch axis: for a RIGHT-facing unit the axis is +x, so this is |Δy| (and mirrored for the others)
    maxOff = Math.max(maxOff, Math.abs((p.x - u.x) * -dr + (p.y - u.y) * dc));
    if (p.data.st.state === 'track') tracked = true;
  }
  assert.ok(maxOff > 0.12, `【自由移动】 follows the 扩张正弦 curve (max ${maxOff.toFixed(2)} tiles off the launch axis)`);
  assert.ok(tracked, 'a note switched to 【追踪移动】 by itself');
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags ?? []).includes('talent'));
  assert.ok(hits.length > 0, 'the note it found on its own landed');
  for (const c of hits) assert.equal(c.target.defId, 'enemy_e_far', 'and it hit the enemy it found, not something else');
  // 用户："飘出去的音符击中敌人也算次数" —— 射程外的敌人她打不到，所以她造成的每一次伤害都来自飘过去的音符，
  // 天赋二的 Fever 必须按这些命中累积（+cnt 每次）
  assert.equal(u.mem.sakikoFever, Math.min(FEVER_MAX, hits.length * raw(BASE).talents[1].bb.cnt), 'drifted-note hits charge Fever like any other damage');
  done(h);
});

test('每一只音符都会消失：离开她的射程后连续 delay 秒没有目标就没了', () => {
  // PRTS: 音符位于自身攻击范围外时，若连续 1 s 以上不存在追踪目标则消失. The empty flat stage has nothing to find,
  // so every 持续攻击 note must leave the field — and the flight list must not grow forever.
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }], { enemies: [] });
  h.run(0.2);
  const u = unitOf(h, BASE);
  const notes = () => h.b.projectiles.list.filter((p) => p.data?.tag === 'sakiko:note' && p.source === u);
  let peak = 0, far = 0;
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    h.step(1);
    const live = notes();
    peak = Math.max(peak, live.length);
    for (const p of live) {
      seen.add(p.id);
      if (Math.abs(p.x - u.x) > 3.4) far++;
    }
  }
  assert.ok(peak >= 1 && peak <= 12, `a few notes at a time, not an armada (peak ${peak})`);
  assert.ok(far > 0, 'notes really travel past her 3-tile range');
  assert.equal(notes().every((p) => p.data.st), true, 'every note carries its flight state');
  assert.ok(seen.size > peak, `notes come and go (${seen.size} launched, ${peak} at once)`);
  done(h);
});

test('\u6301\u7eed\u653b\u51fb: 空放（会发散）的音符只属于空射程 —— 射程内有敌人时不该出现', () => {
  // PRTS: 「攻击时，若攻击范围内存在目标，则将选择的目标设置为音符的追踪目标并发射音符；否则发射的音符初始不存在
  // 追踪目标」. 判据必须是「射程内有没有目标」，不能只是「距上次攻击过了多久」—— 后者在她攻速被拖慢（或只是取整误差）
  // 时会在两次攻击之间漏出一只会发散的音符，也就是玩家看到的「面前站着敌人，音符却在发散」。
  for (const aspdDown of [0, -80]) {
    const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }]);
    h.run(0.2);
    const u = unitOf(h, BASE);
    if (aspdDown) h.b.addBuff(u, { key: 'test:slow', duration: 60, mods: { aspd: aspdDown } });
    const seen = new Set();
    let aimed = 0, unaimedInRange = 0;
    for (let i = 0; i < 600; i++) {
      h.step(1);
      const inRange = (h.b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }) || []).length > 0;
      for (const p of h.b.projectiles.list) {
        if (p.data?.tag !== 'sakiko:note' || p.source !== u || seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.data.st.aimed) aimed++;
        else if (inRange) unaimedInRange++;
      }
    }
    assert.ok(aimed > 0, `aspd${aspdDown}: she attacked the enemy in range`);
    assert.equal(unaimedInRange, 0, `aspd${aspdDown}: no drifting note while an enemy stands in range`);
    done(h);
  }
});

// -------------------------------------------------------------------------------------------------------------------
// 音符的逐技能参数（12-sakiko.md §17：每个技能一行，速度/更新间隔/最短自由移动/追踪半径/转向速度都不同）

/** The first note of `u` with this `hitTag` in flight, after stepping until one shows up. */
function firstNote(h, u, hitTag) {
  for (let i = 0; i < 400; i++) {
    const p = h.b.projectiles.list.find((x) => x.source === u && x.data?.tag === 'sakiko:note' && x.data.hitTag === hitTag);
    if (p) return p;
    h.step(1);
  }
  return null;
}

/**
 * Measure a note that is still in 【自由移动】: how long it stays free (from now on) and how fast it travels.
 * @returns {{ free:number, speed:number, state:string }}
 */
function freeFlight(h, p) {
  const st = p.data.st;
  const x0 = p.x, y0 = p.y, t0 = h.b.time;
  let free = 0;
  for (let i = 0; i < 60 && st.state === 'free'; i++) { h.step(1); free = h.b.time - t0; }
  return { free, speed: free > 0 ? Math.hypot(p.x - x0, p.y - y0) / free : 0, state: st.state };
}

test('§17 每个技能的【自由移动】策略不同：S1 固定 1.7 直飞、S2 风琴/钢琴各自的扩张正弦、S3 0.8 速度', () => {
  // S1 新月的苏醒: 「【自由移动】策略：固定 1.7 速度向当前方向移动」, 最短自由移动 0.6 s
  const h1 = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }]);
  h1.run(0.2);
  const u1 = unitOf(h1, BASE);
  u1.skill.gainSp(9999);
  assert.equal(u1.skill.activate('manual'), true);
  const n1 = firstNote(h1, u1, 'skill');
  assert.ok(n1, 'S1 note in flight');
  assert.equal(n1.data.st.state, 'free', 'S1 notes start in 【自由移动】');
  const f1 = freeFlight(h1, n1);
  assert.ok(f1.free >= 0.4, `S1 的最短自由移动是 0.6 s（已经飞了 ${(0.6 - f1.free).toFixed(2)} s，还剩 ${f1.free.toFixed(2)} s 才转追踪）`);
  assert.ok(Math.abs(f1.speed - 1.7) < 0.35, `S1【自由移动】固定 1.7 速度（实测 ${f1.speed.toFixed(2)}）`);

  // S2 风琴 (normal chess): 扩张正弦 基础振幅 0.15 / x 速度 0.7; 钢琴 (elite): 0.4 / 1.9 + 【已命中】
  const speeds = {};
  for (const [id, name] of [[BASE, 'organ'], [ELITE, 'piano']]) {
    const h = run([{ chessId: id, row: 10, col: 4, skillIndex: rec(id, 2).index }]);
    h.run(0.2);
    const u = unitOf(h, id);
    u.skill.gainSp(9999);
    assert.equal(u.skill.activate('manual'), true);
    const p = firstNote(h, u, 'skill');
    assert.ok(p, `${name}: S2 note in flight`);
    const f = freeFlight(h, p);
    speeds[name] = f.speed;
    assert.ok(f.free > 0, `${name}: it drifts for its own 最短自由移动时间`);
  }
  assert.ok(Math.abs(speeds.organ - 0.7) < 0.3, `风琴【自由移动】x 速度 0.7（实测 ${speeds.organ.toFixed(2)}）`);
  assert.ok(speeds.piano > speeds.organ * 1.8, `钢琴比风琴快得多（${speeds.piano.toFixed(2)} vs ${speeds.organ.toFixed(2)}）`);

  // S3 残月的余响: 扩张正弦 基础振幅 0.5 / x 速度 0.8, 最短自由移动 0.8 s
  const h3 = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
  h3.run(0.2);
  const u3 = unitOf(h3, BASE);
  feverByHand(h3);
  const p3 = firstNote(h3, u3, 'skill');
  assert.ok(p3, 'S3 note in flight');
  const f3 = freeFlight(h3, p3);
  assert.ok(Math.abs(f3.speed - 0.8) < 0.35, `S3【自由移动】x 速度 0.8（实测 ${f3.speed.toFixed(2)}）`);
  assert.ok(f3.free >= 0.5, `S3 的最短自由移动是 0.8 s（实测还有 ${f3.free.toFixed(2)} s 才转追踪）`);
  done(h1); done(h3);
});

test('S2 钢琴的【已命中】态：0.8 半径碰撞、固定 3.0 速度沿当前方向再飞 0.5 s（风琴没有这个状态）', () => {
  // §17 钢琴: 「【已命中】= 激活 0.8 半径的碰撞，固定 3.0 速度沿当前方向移动，持续 0.5s」；风琴: 「【已命中】不存在」。
  // 旧实现是「命中瞬间在 0.9 格内补一刀」——那是另一回事（没有继续飞的时间，也没有 0.8 的碰撞半径）。
  const enemies = [{ key: 'e_a', pos: [10, 5] }, { key: 'e_b', pos: [10, 6] }];
  const defs = { enemies: { e_a: enemyRec({ key: 'e_a', hp: 1e7, speed: 0 }), e_b: enemyRec({ key: 'e_b', hp: 1e7, speed: 0 }) } };
  const h = run([{ chessId: ELITE, row: 10, col: 4, skillIndex: rec(ELITE, 2).index }], { enemies, defs });
  h.run(0.2);
  const u = unitOf(h, ELITE);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true);
  const bb = rec(ELITE, 2).bb;
  assert.equal(bb['attack@passby_delay'], 0.5, '持续 0.5 s 就写在这行的黑盒里');

  // find the note the moment it enters 【已命中】 (it lasts 0.5 s)
  let hit = null;
  for (let i = 0; i < 600 && !hit; i++) {
    h.step(1);
    hit = h.b.projectiles.list.find((x) => x.source === u && x.data?.tag === 'sakiko:note' && x.data.st.state === 'hit');
  }
  assert.ok(hit, 'a piano note entered 【已命中】');
  assert.equal(hit.data.st.hitFor0, 0.5, '…for 0.5 s');
  const t0 = h.b.time, x0 = hit.x, y0 = hit.y;
  const vx = hit.data.st.vx, vy = hit.data.st.vy;
  let life = 0;
  while (h.b.projectiles.list.includes(hit) && life < 3) { h.step(1); life = h.b.time - t0; }
  assert.ok(Math.abs(life - 0.5) < 0.12, `【已命中】持续 ${life.toFixed(2)} s`);
  const moved = Math.hypot(hit.x - x0, hit.y - y0);
  const along = (hit.x - x0) * vx + (hit.y - y0) * vy;
  assert.ok(Math.abs(along / life - 3.0) < 0.4, `固定 3.0 速度沿当前方向（实测 ${(along / life).toFixed(2)}）`);
  assert.ok(moved > 0.5, `它真的继续飞了（${moved.toFixed(2)} 格）`);
  // 0.8 半径的碰撞：它扫过路径上的第二个敌人，两个都吃到这一只音符的伤害
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags ?? []).includes('skill'));
  const kinds = [...new Set(hits.map((c) => c.target.defId))];
  assert.deepEqual(kinds.sort(), ['enemy_e_a', 'enemy_e_b'], `一只钢琴音符打到了路径上的两个敌人（${kinds.join(', ')}）`);

  // 风琴（普通棋）: 【已命中】不存在 —— 命中即消失，只打到一个敌人
  const h2 = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 2).index }], { enemies, defs });
  h2.run(0.2);
  const u2 = unitOf(h2, BASE);
  u2.skill.gainSp(9999);
  assert.equal(u2.skill.activate('manual'), true);
  let organHit = 0;
  for (let i = 0; i < 600; i++) {
    h2.step(1);
    if (h2.b.projectiles.list.some((x) => x.source === u2 && x.data?.tag === 'sakiko:note' && x.data.st.state === 'hit')) organHit++;
  }
  assert.equal(organHit, 0, '风琴音符从不进入【已命中】');
  const hits2 = h2.hooksOf('damaged').filter((c) => c.source === u2 && (c.dmg?.tags ?? []).includes('skill'));
  assert.deepEqual([...new Set(hits2.map((c) => c.target.defId))].length, 1, '…所以它只打到一个敌人');
  done(h); done(h2);
});

// -------------------------------------------------------------------------------------------------------------------
// 4. Fever（12-sakiko.md §16 的官方备注）

/**
 * Fight until the SHARED gauge is full. Fever is earned by the damage she deals (talent 2: +cnt per damage
 * instance), so tests earn it the way a battle does. Returns true once the gauge got there — or once the state
 * itself started, because an automatic release can spend the full gauge between two looks.
 */
const fever = {
  /** Deploy with no SP, so nothing has been cast yet, then hand her a full bar at will. */
  ready(o = {}, row = 10, col = 4) {
    const h = run([{ chessId: BASE, row, col, ...o }]);
    h.run(0.1);
    const unit = unitOf(h, BASE);
    assert.ok(unit?.alive && unit.deployed, 'she deployed');
    assert.equal(unit.skill.active, false, 'nothing cast yet');
    return { h, unit };
  },
  charge(unit, sp = 9999) { unit.skill.gainSp(sp); },
  /**
   * 打到 `points` 分（默认 450）。每次「对她造成一次伤害」+`cnt`（=3），而被压制技能时她只剩普通攻击那一段伤害
   * ——2026-10-08 把普攻合并成一只音符之后，一次攻击只有一段（原来箭 + 音符两段，涨一倍快），所以 450/3 = 150 次
   * 攻击 ≈ 195 秒：窗口必须够宽。
   */
  fill(h, points = FEVER_MAX, maxSec = 300) {
    const t0 = h.b.time;
    while (h.b.time - t0 < maxSec) {
      h.run(0.25);
      const u = h.b.allyUnits.find((x) => x.defId === BASE);
      if (!u) continue;
      if (u.mem.sakikoFeverLeft > 0) return true;
      if ((u.mem.sakikoFever ?? 0) >= points) return true;
    }
    return false;
  },
};

/** Her first note in flight after stepping until one shows up (a note lives `delay` = 1 s). `hitTag` picks the
 *  talent's own notes ('talent') or a skill's ('skill') — with the carried SP of `CARRY` both are in the air. */
function noteInFlight(h, u, hitTag = 'talent') {
  for (let i = 0; i < 400; i++) {
    const p = h.b.projectiles.list.find((x) => x.data?.tag === 'sakiko:note' && x.source === u && x.data.hitTag === hitTag);
    if (p) return p;
    h.step(1);
  }
  return null;
}

/**
 * Fill the shared gauge to 450 with every copy's own automatic cast held back, so the trigger is the only thing
 * that can start Fever (a full bar otherwise goes off by itself on the next automatic release — that behaviour
 * has its own test). Returns the copies; their rules are handed back unless `keep` asks otherwise.
 */
function fillHeld(h, { keep = false } = {}) {
  const units = h.b.allyUnits.filter((u) => u.defId === BASE);
  const rules = units.map((u) => [u, hold(u)]);
  assert.ok(fever.fill(h), 'the shared gauge reached 450');
  if (!keep) for (const [u, r] of rules) release(u, r);
  return units;
}

/** 450 points + a hand-pressed cast: the deterministic way into Fever. */
function feverByHand(h, { keep = false } = {}) {
  const units = fillHeld(h, { keep });
  const caster = units[0];
  if (caster.skill.active && caster.skill.isTimed) caster.skill.end('test');
  fever.charge(caster);
  assert.equal(caster.skill.activate('manual'), true, '蓄满 + 手动发动 → 进入 Fever');
  return { h, units, caster };
}

test('Fever 计量是 450 点：0–450 累积、快照给 0–100、不到 450 发动技能进不去', () => {
  // 旧实现是 0–100 且 50 % 就够；§16 是「Fever累计至450点时」+「耗尽」。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
  h.run(0.2);
  const unit = unitOf(h, BASE);
  const rule = hold(unit);                       // nothing may cast while the gauge climbs
  h.run(6);
  const gauge = unit.mem.sakikoFever;
  assert.ok(gauge > 0 && gauge < FEVER_MAX, `每次造成伤害 +3，计量在 0–450 之间累积（${gauge}）`);
  assert.equal(unit.mem.gauges.fever, Math.round(gauge / FEVER_MAX * 100), 'snap.fever 给的是 450 的百分比（0–100 的整数）');
  assert.deepEqual(h.b.snapshot().fever, [[unit.id, unit.mem.gauges.fever]], '…并且由 Battle.snapshot 转发');
  release(unit, rule);
  fever.charge(unit);
  assert.equal(unit.skill.activate('manual'), true, '技能本身照常发动');
  assert.equal(unit.mem.sakikoFeverLeft, 0, '没蓄满（遠低于 450）：不进入 Fever');
  assert.equal(unit.findBuff('sakiko:fever'), null, '也不会有可见标记');

  // …蓄满之后同样的手动发动就进去了
  if (unit.skill.active) unit.skill.end('test');
  unit.skill.rule = 'NEVER';                     // hold it again: the manual press below must be the trigger
  assert.ok(fever.fill(h), '继续打，计量蓄满 450');
  unit.skill.rule = rule;
  fever.charge(unit);
  assert.equal(unit.skill.activate('manual'), true, '蓄满后发动');
  assert.ok(Math.abs(unit.mem.sakikoFeverLeft - 20) < 0.2, `进入 Fever，持续 20 秒（${unit.mem.sakikoFeverLeft}）`);
  assert.equal(unit.mem.sakikoFever, 0, '进入时计量清零（耗尽）');
  assert.deepEqual(h.b.snapshot().fever, [[unit.id, 100]], 'Fever 期间条走倒计时：刚开始是 100');
  assert.ok(unit.findBuff('sakiko:fever'), '每只在场成员身上都有可见标记');
  h.run(10);
  const left = h.b.snapshot().fever?.[0]?.[1] ?? 0;
  assert.ok(left > 30 && left < 70, `倒计时随时间减少（10 秒后 ${left}）`);
  done(h);
});

test('蓄满时任意一次技能发动都能触发 Fever —— 本模式是全自动放技能，不是只有手动', () => {
  // §16:「任意一位 Ave Mujica 成员手动触发技能后」+ 所有者裁定：本模式全自动放技能，任意一次技能发动即可。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
  h.run(0.2);
  const unit = unitOf(h, BASE);
  const rule = hold(unit);
  assert.ok(fever.fill(h), '把计量打到 450（期间技能被压住，没有任何发动）');
  assert.equal(unit.mem.sakikoFeverLeft, 0, '还没有触发');
  assert.deepEqual(h.hooksOf('skillStart').filter((c) => c.unit === unit), [], '…因为一次技能都没发动过');
  release(unit, rule);
  fever.charge(unit);                            // the SP the engine's own cast needs
  const cast = untilCast(h, unit, 10);
  assert.ok(cast, '引擎自己发动了技能');
  assert.notEqual(cast.reason, 'manual', `这是自动发动（reason = ${cast.reason}）`);
  assert.ok(unit.mem.sakikoFeverLeft > 0, '自动发动在蓄满时同样进入 Fever');
  assert.ok(unit.findBuff('sakiko:fever'), '标记也挂上了');
  done(h);
});

test('S1 的充能满自动释放不触发 Fever，普通的自动发动会', () => {
  // §17 S1:「※因充能到达上限自动释放时，不会触发 Fever…自动释放始终不改变技能为手动触发的本质」。
  // 引擎里这两件事要分开认：`wasFull`（发动前充能已经是上限）才是「充能到达上限自动释放」，其余自动发动是本模式的
  // 自动作战，照 §16 触发 Fever。
  const s1 = rec(BASE, 1);
  /** Fill the gauge with S1 held back, then let the engine's own release fire and report what it was. */
  const autoRelease = (sp) => {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: s1.index }]);
    h.run(0.2);
    const unit = unitOf(h, BASE);
    const rule = hold(unit);
    assert.ok(fever.fill(h), 'the gauge reached 450');
    // the gauge filling does not block SP gains, so the held-back skill has been charging all along: the charges
    // below are what the release starts from (max = 2 for 可充能2次)
    unit.skill.charges = 0;
    unit.skill.sp = 0;
    release(unit, rule);
    fever.charge(unit, sp);
    const cast = untilCast(h, unit, 10);
    assert.ok(cast, '引擎自己释放了技能');
    assert.notEqual(cast.reason, 'manual');
    done(h);
    return { unit, cast };
  };
  const full = autoRelease(9999);
  assert.equal(full.unit.skill.chargeFull, true, '这次发动前充能就是满的（2/2）');
  assert.equal(full.unit.mem.sakikoFeverLeft, 0, '充能满自动释放：不触发 Fever');
  const one = autoRelease(full.unit.skill.spCost);       // exactly one charge → 1/2, not the cap
  assert.equal(one.unit.skill.chargeFull, false, '这次不是充能满释放');
  assert.ok(one.unit.mem.sakikoFeverLeft > 0, '普通的自动发动在蓄满时触发 Fever');
});

test('Fever 期间：SP 不涨、常规自动发动被禁止、只有 Fever 自己的释放（且不花技力）', () => {
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }]);
  h.run(0.2);
  const unit = unitOf(h, BASE);
  const rule = hold(unit);
  assert.ok(fever.fill(h), 'the gauge reached 450');
  release(unit, rule);
  fever.charge(unit);
  assert.equal(unit.skill.activate('manual'), true, '手动发动 → 进入 Fever');
  assert.ok(unit.mem.sakikoFeverLeft > 0, 'in Fever');

  // 「无视技力限制地持续尝试开启技能…且通过此方法开启技能时不消耗技力」: take the SP and the charges away
  unit.skill.charges = 0;
  unit.skill.sp = 0;
  const sp0 = unit.skill.sp, ch0 = unit.skill.charges;
  const atk0 = h.hooksOf('attack').filter((c) => c.attacker === unit && (c.targets ?? []).length > 0).length;
  const n0 = h.hooksOf('skillStart').filter((c) => c.unit === unit).length;
  h.run(12);
  const atk1 = h.hooksOf('attack').filter((c) => c.attacker === unit && (c.targets ?? []).length > 0).length;
  const casts = h.hooksOf('skillStart').filter((c) => c.unit === unit).slice(n0);
  assert.ok(atk1 > atk0 + 3, `她一直在攻击（${atk0} → ${atk1}），所以技力本来会涨`);
  assert.equal(unit.skill.sp, sp0, 'SP 不涨（Fever 期间停止积累）');
  assert.equal(unit.skill.charges, ch0, '充能也不涨');
  assert.equal(unit.mem.sakikoFever, 0, '计量同样耗尽且不累积（她这 12 秒一直在造成伤害）');
  assert.equal(unit.s.flags.noSp, true, '标记 buff 带的是引擎自己的 noSp（阻回）标志');
  assert.ok(casts.length >= 2, `20 秒内持续触发（12 秒里 ${casts.length} 次）`);
  assert.deepEqual([...new Set(casts.map((c) => c.reason))], ['fever'], '全部来自 Fever');
  assert.equal(unit.skill.charges, ch0, '而且这些释放不消耗技力（charges 是 0 也照放）');
  assert.equal(unit.skill.rule, 'NEVER', '常规自动发动在 Fever 期间被压住（NEVER = 引擎的「不自动发动」）');
  done(h);
});

test('Fever 结束时，凭 Fever 开启的持续类技能被强制结束', () => {
  // §16:「通过 Fever 状态开启的持续类技能将在 Fever 状态结束时强制结束」。两只祥子各带一个技能：S1 那只手动触发
  // Fever，S3 那只的 25 秒持续技能由 Fever 自己开启（free），它必须在 20 秒时被 Fever 结束（而不是走完 25 秒）。
  const h = run([
    { chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index },   // A: S1 (charges)
    { chessId: BASE, row: 11, col: 4, skillIndex: rec(BASE, 3).index },   // B: S3 (duration 25 s)
  ]);
  h.run(0.2);
  const a = h.b.allyUnits.find((u) => u.skill.id === 'skchr_oblvns_1');
  const b = h.b.allyUnits.find((u) => u.skill.id === 'skchr_oblvns_3');
  assert.ok(a && b, '两只不同类型的祥子在场上');
  const ra = hold(a), rb = hold(b);
  assert.ok(fever.fill(h), 'the shared gauge reached 450');
  release(a, ra); release(b, rb);
  fever.charge(a);
  assert.equal(a.skill.activate('manual'), true, 'A 手动发动 → 全员进入');
  assert.ok(a.mem.sakikoFeverLeft > 0 && b.mem.sakikoFeverLeft > 0, '两只都进入 Fever（任一只触发即全员）');
  h.run(1);
  assert.equal(b.skill.active, true, 'Fever 替 B 开启了 S3');
  const start = h.hooksOf('skillStart').find((c) => c.unit === b && c.reason === 'fever');
  assert.ok(start, '这次发动来自 Fever');
  const n = h.hooksOf('skillEnd').length;
  h.run(21);
  assert.equal(a.mem.sakikoFeverLeft, 0, 'Fever 结束');
  const ends = h.hooksOf('skillEnd').slice(n).filter((c) => c.unit === b);
  assert.ok(ends.some((c) => c.reason === 'fever'), `S3 被 Fever 强制结束（reasons: ${JSON.stringify(ends.map((c) => c.reason))}）`);
  assert.equal(b.skill.active, false, '而不是继续跑完它自己的 25 秒');
  done(h);
});

test('进入 Fever 前已在跑的持续类技能：计时被暂停，Fever 结束后从暂停处继续', () => {
  // §16:「进入 Fever 状态前正在释放的持续类技能暂停计时，直至 Fever 状态结束」。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
  h.run(0.2);
  const u = unitOf(h, BASE);
  const rule = hold(u);
  assert.ok(fever.fill(h), '把计量打到 450（S3 一直被压住，所以还没有技能在跑）');
  release(u, rule);
  fever.charge(u);
  const cast = untilCast(h, u, 10);
  assert.ok(cast, '引擎发动了 S3');
  assert.notEqual(cast.reason, 'fever', 'S3 不是 Fever 开启的，是它自己那一发（顺带触发了 Fever）');
  assert.ok(u.skill.active, 'S3 正在跑');
  assert.ok(u.mem.sakikoFeverLeft > 0, '那一发同时把 Fever 点了（蓄满 + 任意一次发动）');
  const frozen = u.skill.timeLeft;
  h.run(10);
  assert.ok(Math.abs(u.skill.timeLeft - frozen) < 0.05, `10 秒 Fever 里计时没走（${frozen.toFixed(2)} → ${u.skill.timeLeft.toFixed(2)}）`);
  assert.equal(u.skill.active, true, '…所以它没有在 Fever 里自然结束（25 秒的技能早就该结束了）');
  h.run(11);
  assert.equal(u.mem.sakikoFeverLeft, 0, 'Fever 结束');
  assert.equal(u.skill.active, true, 'Fever 前就在跑的持续类技能不会被 Fever 结束');
  assert.ok(u.skill.timeLeft > 20, `结束后从暂停处继续（还剩 ${u.skill.timeLeft.toFixed(2)} 秒，暂停前是 ${frozen.toFixed(2)}）`);
  const after = u.skill.timeLeft;
  h.run(2);
  assert.ok(u.skill.timeLeft < after - 1, '计时重新开始走');
  done(h);
});

test('S2 是切换类技能：Fever 期间无法开启，可以触发 Fever 时只触发 Fever、不切换形态', () => {
  // §16:「无视技力限制地持续尝试开启技能（切换类技能除外）」；§17:「Fever 期间，此技能无法手动开启；可以触发
  // Fever 时，触发技能将仅触发 Fever，不进行技能形态切换」。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 2).index }]);
  h.run(0.2);
  const u = unitOf(h, BASE);
  const rule = hold(u);
  assert.ok(fever.fill(h), 'the gauge reached 450（形态切换一直被压住）');
  release(u, rule);
  assert.equal(u.skill.active, false, '还没切换过形态');
  assert.equal(u.skill.activate('manual'), false, '蓄满时发动只触发 Fever，切换本身不发生');
  assert.equal(u.skill.activations, 0, '…所以一次形态切换都没有');
  assert.equal(u.skill.active, false, 'S2 仍然没开');
  assert.ok(u.mem.sakikoFeverLeft > 0, '但 Fever 进了');
  // Fever 期间既不能手动开启，也不会被 Fever 开启
  const n0 = u.skill.activations;
  assert.equal(u.skill.activate('manual'), false, 'Fever 期间此技能无法手动开启');
  h.run(6);
  assert.equal(u.skill.active, false, 'Fever 也不会开启它（切换类技能除外）');
  assert.equal(u.skill.activations, n0, '一次都没有发动');
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u && c.reason === 'fever').length, 0, '没有任何 Fever 释放');
  done(h);
});

test('S2 的【Fever】二连击：Fever 前开着 S2，Fever 期间每次攻击两只音符', () => {
  // S2 文案:「Fever 期间变为当前音色的二连击」。它要求 S2 在 Fever 期间是开着的 —— 而 S2 只能在 Fever 之前开
  // （Fever 期间无法开启、蓄满时发动只触发 Fever），所以这里先开 S2、再打满计量、再触发 Fever。
  const s2 = rec(BASE, 2);
  /** S2 skill-note damage over a fixed window, with and without Fever. */
  const skillHits = (withFever) => {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: s2.index }]);
    h.run(0.2);
    const unit = unitOf(h, BASE);
    unit.skill.gainSp(9999);
    assert.equal(unit.skill.activate('manual'), true, '在计量还空着的时候开 S2（形态切换）');
    assert.equal(unit.skill.active, true);
    if (withFever) {
      unit.skill.rule = 'NEVER';                // hold the engine's own cast so the manual press is the trigger
      assert.ok(fever.fill(h), 'the gauge reached 450');
      unit.skill.rule = s2.trigger.rule;
      assert.equal(unit.skill.activate('manual'), false, '蓄满时发动只触发 Fever（S2 保持开着）');
      assert.ok(unit.mem.sakikoFeverLeft > 0, 'in Fever');
      assert.equal(unit.skill.active, true, 'S2 仍然是开着的（形态不变）');
    }
    const n0 = h.hooksOf('damaged').filter((c) => c.source === unit && (c.dmg?.tags || []).includes('skill')).length;
    h.run(12);
    const n = h.hooksOf('damaged').filter((c) => c.source === unit && (c.dmg?.tags || []).includes('skill')).length - n0;
    done(h);
    return n;
  };
  const plain = skillHits(false);
  const fevered = skillHits(true);
  assert.ok(plain > 0, `S2 deals skill damage outside Fever (${plain})`);
  assert.ok(fevered > plain * 1.5, `二連撃: ${fevered} S2 notes in Fever vs ${plain} outside`);
});

test('两/三只祥子共用一条 Fever：谁的伤害都进同一条，任一只触发全员进入', () => {
  // 所有者："fever的数值是共享的…fever数达到后其中一个开技能都会使得全员进入fever状态"；§16:「该进度所有成员共享」。
  const h = run([
    { chessId: BASE, row: 10, col: 3 },
    { chessId: BASE, row: 10, col: 4 },
    { chessId: BASE, row: 11, col: 4 },
  ]);
  h.run(0.2);
  const three = h.b.allyUnits.filter((u) => u.defId === BASE);
  assert.equal(three.length, 3, '三只在场上');
  const rules = three.map((u) => [u, hold(u)]);
  assert.ok(fever.fill(h), '三只的伤害把同一条计量打满 450');
  for (const [u, r] of rules) release(u, r);
  const readings = three.map((u) => u.mem.sakikoFever);
  assert.equal(new Set(readings).size, 1, `三只读到同一个数（${readings.join(' / ')}）`);
  assert.deepEqual([...new Set(h.b.snapshot().fever.map((r) => r[1]))], [100], '快照里也是同一个数（蓄满 = 100）');
  assert.equal(h.b.snapshot().fever.length, 3, '没有计量的单位不出现在 snap.fever 里（这里正好三只）');

  // 只让中间那只发动 —— 三只必须一起进入
  const caster = three[1];
  fever.charge(caster);
  assert.equal(caster.skill.activate('manual'), true, '任一只都能触发');
  for (const u of three) {
    assert.ok(u.mem.sakikoFeverLeft > 0, '每一只都进入了 Fever');
    assert.ok(u.findBuff('sakiko:fever'), '每一只身上都有可见的 Fever 标记');
  }
  const counts = new Set(h.b.snapshot().fever.map((r) => r[1]));
  assert.equal(counts.size, 1, '开始倒计时后它们仍是同一个数');
  h.run(25);
  for (const u of three) {
    assert.equal(u.mem.sakikoFeverLeft, 0, '一起结束');
    assert.equal(u.findBuff('sakiko:fever'), null, '标记一起消失');
    assert.equal(u.skill.rule, 'DEFAULT', '常规自动发动在结束时恢复');
  }
  done(h);
});

test('Fever 驱动的释放频次：kit 自己的 FEVER_CAST_GAP（1.5 s），不是引擎的 3 s 自动操作冷却', () => {
  // 所有者（2026-10-08）:「一技能在 Fever 里的持续释放频次要加快一些，但不用太快」. §16 只说「持续尝试开启技能」，
  // 官方备注里没有间隔，所以这个节奏是我们的选择：[ASSUMED 观感] collab.js `FEVER_CAST_GAP = 1.5`.
  // 改之前它用的是引擎的 `AUTO_OP_COOLDOWN`（3 s，「自动操作具有3s冷却」）—— 那是玩家自动操作的冷却，不是「持续释放」，
  // 20 秒里只有 6 次（下面量出来）.
  const was = (u) => {                    // 复现改前：把 opReadyAt 的门限放宽回 +3 s 再读一次
    const sk = u.skill;
    const cooling = sk._opCooling.bind(sk);
    sk._opCooling = function () { return this.manual && this.battle.time < this.opReadyAt + (FEVER_CAST_GAP_OLD - FEVER_CAST_GAP) - 1e-9; };
    return () => { sk._opCooling = cooling; };
  };
  /** One 20 s Fever window on S1 (the charges skill she 持续释放), returning every release inside it. */
  const window = (patch) => {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }]);
    h.run(0.2);
    const u = unitOf(h, BASE);
    const rule = hold(u);
    assert.ok(fever.fill(h), 'the shared gauge reached 450');
    u.skill.rule = rule;
    u.skill.charges = 0;
    u.skill.sp = 0;
    if (u.skill.active && u.skill.isTimed) u.skill.end('test');
    u.skill.gainSp(9999);
    const undo = patch ? patch(u) : null;
    assert.equal(u.skill.activate('manual'), true, '蓄满 + 手动发动 → 进入 Fever');
    const t0 = h.b.time;
    h.run(FEVER_SEC + 0.4);
    if (undo) undo();
    const rel = h.hooksOf('skillStart').filter((c) => c.unit === u && c.t > t0 + 1e-6);
    assert.deepEqual([...new Set(rel.map((c) => c.reason))], ['fever'], '全部来自 Fever（不花技力、无视技力限制）');
    done(h);
    return rel.map((c) => c.t - t0);
  };

  const now = window(null);
  const old = window(was);
  // 20 秒窗口内的释放次数（实测）：改前 6 次（3/6/9/12/15/18 s），改后 12 次（3 之后每 1.5 s 一次）
  assert.equal(old.length, 6, `改前 = 引擎 3 s 冷却：6 次（实测 ${old.length}: ${JSON.stringify(old.map((t) => +t.toFixed(1)))}）`);
  assert.ok(now.length >= 11, `改后 20 秒内至少 11 次（实测 ${now.length}: ${JSON.stringify(now.map((t) => +t.toFixed(1)))}）`);
  assert.ok(now.length > old.length * 1.5, `明显更快（${old.length} → ${now.length}）`);
  // …而且不是「不用太快」的反面：间隔不小于 FEVER_CAST_GAP，也远小于引擎原来的 3 s
  for (let i = 1; i < now.length; i++) {
    const d = now[i] - now[i - 1];
    assert.ok(d >= FEVER_CAST_GAP - 1e-6, `第 ${i} 次释放距上一次 ${d.toFixed(2)} s ≥ ${FEVER_CAST_GAP} s`);
  }
  const first = now[0], second = now[1] - now[0];
  assert.ok(second <= 2.0, `节奏是 1.5 s 一档（第二次在 ${second.toFixed(2)} s）`);
  // 第一次释放仍要等引擎那次「手动发动」留下的 3 s 自动操作冷却过期（kit 只在冷却之后接手自己的 1.5 s 档），而
  // Fever 的检查跑在 0.1 s 的刻度上，所以允许多一个刻度：3.0 + 0.1。
  assert.ok(first <= FEVER_CAST_GAP_OLD + 0.1 + 1e-6, `第一次释放不晚于引擎原来的 3 s + 一个刻度（${first.toFixed(2)} s）`);
});

test('Fever 计量只在本回合这一场战斗内保留：同场内延续，换一场战斗重新从 0 开始', () => {
  // 所有者裁定（§16）:「是一回合内，每回合从 0 开始，并且协助队友的时候也要重新积累」——即按 `Battle` 实例存记录：
  // 每回合一场战斗、每次联防协助也是一场战斗，各自从 0 起（实现是模块级 WeakMap 以 battle 为键）。
  // (1) 同一场战斗内：她退场、再部署、第二只祥子上场，读数都延续（不清零）
  const h = run([{ chessId: BASE, row: 10, col: 4 }, { chessId: BASE, row: 11, col: 4 }]);
  h.run(0.3);
  const [a, b] = h.b.allyUnits.filter((u) => u.defId === BASE);
  assert.ok(a && b, '两只在场上');
  const ra = hold(a), rb = hold(b);
  h.run(8);
  const gauge = a.mem.sakikoFever;
  assert.ok(gauge > 0, `计量攒到 ${gauge}`);
  assert.equal(a.mem.sakikoFever, b.mem.sakikoFever, '同一条');
  h.b.retreat(a, { reason: 'retreat' });            // 退场…
  h.run(4);
  assert.equal(a.mem.sakikoFever, b.mem.sakikoFever, '退场后她读到的还是同一条（不清零）');
  assert.ok(a.mem.sakikoFever > gauge, `而且继续往上涨（${gauge} → ${a.mem.sakikoFever}）`);
  assert.equal(h.b.redeploy(a, { free: true }), true, '再部署回来');
  h.run(4);
  assert.equal(a.mem.sakikoFever, b.mem.sakikoFever, '再部署后仍然是同一条');
  assert.ok(a.mem.sakikoFever > gauge, '没有清零');
  release(a, ra); release(b, rb);

  // (2) 换一场战斗（新回合 / 去协助队友的联防战斗都是另一个 Battle 实例）：从 0 开始，不继承
  const h2 = run([{ chessId: BASE, row: 10, col: 4 }], { kind: 'unite' });
  const fresh = unitOf(h2, BASE);
  assert.ok(fresh?.mem, '她在联防战斗里登场');
  assert.ok(!fresh.mem.sakikoFever, `新的一场战斗：还没有任何计量（读到 ${fresh.mem.sakikoFever}）`);
  assert.ok(!fresh.mem.gauges?.fever, '条也还没有数');
  h2.run(4);
  const c = unitOf(h2, BASE);
  assert.ok(c.mem.sakikoFever > 0, '重新积累');
  assert.ok(c.mem.sakikoFever < gauge, `不是继承上一场战斗的数值（重攒 ${c.mem.sakikoFever} < 上一场 ${gauge}）`);
  done(h); done(h2);
});

test('talent 1 plays a note on every attack and they deal talent-tagged damage', () => {
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }]);
  h.run(10);
  const unit = unitOf(h, BASE);
  assert.ok(unit?.alive && unit.deployed, 'she deployed');
  // only the attacks that actually had a target: 持续攻击 fires extra empty-range `attack` events
  const aimed = h.hooksOf('attack').filter((c) => c.attacker === unit && (c.targets ?? []).length > 0).length;
  assert.ok(aimed > 0, 'she attacked a target');
  const tags = tagsOf(h, unit);
  // one note per aimed attack, minus the newest one, which may still be in flight: a note now flies the official
  // 【自由移动】(≥ 0.1 s) → 【追踪移动】 route instead of teleporting onto its target
  assert.ok(tags.talent >= aimed - 1, `at least one talent note per aimed attack (${aimed} attacks, ${JSON.stringify(tags)})`);
  assert.ok(unit.findBuff('sakiko:notes'), 'talent 1 keeps its penetration buff up while she lives');
  done(h);
});

test('\u6301\u7eed\u653b\u51fb: she keeps playing notes with nothing in range and deals no damage', () => {
  // PRTS 术语「持续攻击」: 无论攻击范围内是否有攻击目标，都会持续进行攻击. The engine only fires `attack`
  // when it has a target, so this is the kit's own cadence: one note per base attack interval, out along her
  // facing, landing and vanishing after `delay`.
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }], { enemies: [] });
  h.run(0.2);
  const unit = unitOf(h, BASE);
  assert.ok(unit?.alive && unit.deployed, 'she deployed');
  const bat = unit.s.bat;
  assert.ok(bat > 0, `base attack interval ${bat}`);
  h.run(bat * 5);
  const empty = h.hooksOf('attack').filter((c) => c.attacker === unit && (c.targets ?? []).length === 0).length;
  assert.ok(empty >= 3, `she kept attacking with no target (${empty} empty-range attacks in ${(bat * 5).toFixed(1)} s)`);
  // and nothing was damaged: there is nothing to damage
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === unit).length, 0, 'no damage without a target');
  done(h);
});

/** Empty-range `attack` events of `u` (the kit's own 持续攻击 cadence), as an absolute count. */
const emptyAttacks = (h, u) => h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length === 0).length;
/** `attack` events of `u` that had a target (the engine's own attack loop), as an absolute count. */
const aimedAttacks = (h, u) => h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0).length;

// -------------------------------------------------------------------------------------------------------------------
// 空转音符的攻击回复：S1 是「攻击回复」（spType 'attack'，4 点一充能），而空射程的持续攻击音符也是她的一次攻击。
// 所有者报告（2026-10-08）:「还有空转也就是敌人不在范围内祥子打出去的音符伤害到敌人时你似乎没把他计算到 1 技能的
// 技能条里」。引擎的加 SP 入口是「一次攻击演完」那一步：ai.js:189 → skills.js:479 `onAttackPerformed` →
// skills.js:501（`spType === 'attack'` ⇒ `gainSp(1, 'attack')`）。射程内有敌人时引擎自己会走这条路；射程为空时
// 引擎连攻击都不会发起（ai.js:84 在 acquireTargets 空时直接 return），所以那只音符只能在自己真的打到人时报一次。

/** Talent-note damage instances of `u` that landed on the enemy `defId` (空转音符的命中数). */
const noteHits = (h, u, defId) => h.hooksOf('damaged')
  .filter((c) => c.source === u && (c.dmg?.tags ?? []).includes('talent') && (!defId || c.target?.defId === defId));
/** `spGain` contexts of `u` with a reason (the file's `HOOKS` needs 'spGain' added by the caller). */
const spGains = (h, u, reason) => h.hooksOf('spGain').filter((c) => c.unit === u && (!reason || c.reason === reason));

test('空转音符命中敌人 = 一次攻击回复：S1 的技力与充能按命中数涨（每次 +1，4 点一充能）', () => {
  // 她在 [10,4]，敌人放在第 4 格 [10,8] —— 她的射程是前方 3 格，所以引擎不会替她发起任何一次攻击；打出去的都是
  // 持续攻击的空转音符，靠自己的【追踪移动】找到敌人。修复前实测：6 次命中，sp/charges 全程 0、spGain 一条都没有。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
    enemies: [{ key: 'e_out', pos: [10, 8] }],
    defs: { enemies: { e_out: enemyRec({ key: 'e_out', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
    hooks: [...HOOKS, 'spGain'],
  });
  h.run(0.2);
  const u = unitOf(h, BASE);
  const sk = u.skill;
  assert.equal(sk.id, 'skchr_oblvns_1', 'S1 equipped');
  assert.equal(sk.spType, 'attack', "S1 是攻击回复（引擎的 'attack' 档）");
  assert.equal(sk.spCost, 4, '每次攻击 +1，4 点攒一层充能');
  assert.equal(sk.maxCharges, 2, '可充能 2 次');
  assert.equal(sk.sp, 0);
  assert.equal(sk.charges, 0);

  while (noteHits(h, u, 'enemy_e_out').length < 3 && h.b.time < 60) h.step(1);
  const hit3 = noteHits(h, u, 'enemy_e_out').length;
  assert.equal(hit3, 3, `空转音符已经打中敌人 3 次（实际 ${hit3}）`);
  assert.equal(sk.sp, 3, '三次命中 = 3 点技力（每次命中 +1：引擎自己的攻击回复入口）');
  assert.equal(sk.charges, 0, '还不够一层充能');
  assert.equal(spGains(h, u, 'attack').length, 3, '每次命中恰好一条 spGain（reason = attack），不多不少');

  // 第 4 次命中：4 点 = spCost ⇒ 攒出第 1 层充能，技力归零（gainSp 的 4 点语义）
  while (noteHits(h, u, 'enemy_e_out').length < 4 && h.b.time < 90) h.step(1);
  assert.equal(noteHits(h, u, 'enemy_e_out').length, 4, '第 4 次命中');
  assert.equal(sk.charges, 1, '4 点技力 = 第 1 层充能');
  assert.equal(sk.sp, 0, '…技力从 0 重新计');
  assert.equal(spGains(h, u, 'attack').length, 4, '第 4 次命中同样只给一条');
  assert.equal(spGains(h, u, 'attack').reduce((s, c) => s + c.amount, 0), 4, '四只音符一共 4 点，没有重复计（每只音符只算一次攻击）');

  // 这些技力只可能来自音符：敌人一直在射程外，引擎一次攻击都没发起过
  assert.equal(aimedAttacks(h, u), 0, '敌人始终在射程外 —— 引擎没有发起过任何一次带目标的攻击');
  assert.ok(emptyAttacks(h, u) > 0, '她一直在空转（持续攻击）');
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u).length, 0, '期间没有技能释放（射程外不自动发动）');
  done(h);
});

test('空转但没打到人：不涨技力（空放不是攻击回复）', () => {
  // 约束：只有真的造成伤害才算一次攻击回复。场上完全没敌人时空放 25 秒；有敌人但音符够不到（它在音符的飞行范围
  // 之外、追踪半径 1.0 内一直没出现过）时同样不涨 —— 音符飘出射程 delay(1 s) 后自己消失。
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], { enemies: [], hooks: [...HOOKS, 'spGain'] });
    h.run(0.2);
    const u = unitOf(h, BASE);
    h.run(25);
    assert.ok(emptyAttacks(h, u) >= 10, `她一直在空转（25 秒里 ${emptyAttacks(h, u)} 只音符）`);
    assert.equal(h.hooksOf('damaged').filter((c) => c.source === u).length, 0, '一只都没打到（场上没东西可打）');
    assert.equal(u.skill.sp, 0, '空放不涨技力');
    assert.equal(u.skill.charges, 0, '也不涨充能');
    assert.deepEqual(spGains(h, u), [], '一条 spGain 都没有');
    done(h);
  }
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
      enemies: [{ key: 'e_far', pos: [10, 14] }],       // 8 格之外：音符自己的追踪半径够不到
      defs: { enemies: { e_far: enemyRec({ key: 'e_far', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
      hooks: [...HOOKS, 'spGain'],
    });
    h.run(0.2);
    const u = unitOf(h, BASE);
    assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).length, 0, '敌人在她的射程之外');
    h.run(25);
    assert.ok(emptyAttacks(h, u) >= 10, `照常空转（${emptyAttacks(h, u)} 只）`);
    assert.equal(noteHits(h, u).length, 0, '音符一只都没够到它');
    assert.equal(u.skill.sp, 0, '没命中就没有攻击回复');
    assert.equal(u.skill.charges, 0);
    assert.deepEqual(spGains(h, u), [], '一条 spGain 都没有');
    done(h);
  }
});

test('射程内有敌人时的普通攻击恰好 +1 技力，而且那 1 点也在音符命中时结算（不是出手就给、也不重复计）', () => {
  // 回归：这条本来守的是「引擎的 +1 在 ai.js:189，音符不重复计」。所有者 2026-10-08 裁定之后，那只音符就是这次
  // 普攻本身（引擎那支箭不再结算：不造成伤害，也不再 `onAttackPerformed`），所以同一次攻击的 +1 改由音符命中给出
  // —— 保住的仍然是「一次攻击只给一次」。实测：出手当帧 sp 还是 0，音符碰到敌人那一刻才 +1（飞行约 0.93 s）。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], { hooks: [...HOOKS, 'spGain'] });
  h.step(1);
  const u = unitOf(h, BASE);
  assert.equal(u.skill.id, 'skchr_oblvns_1', 'S1 equipped (攻击回复)');
  assert.equal(u.skill.sp, 0, 't ≈ 0：第一次攻击已经出手，但技力还是 0（出手不结算）');
  // 每只音符的飞行约 0.93 s：等三次攻击的音符都落地（sp 涨到 3）
  while (u.skill.sp < 3 && h.b.time < 30) h.step(1);
  const launched = h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0);
  assert.equal(launched.length, 3, `正好三次带目标的攻击（实测 ${launched.length}）`);
  assert.equal(u.skill.charges, 0, '还不够一层充能');
  assert.equal(spGains(h, u, 'attack').length, 3, '三次命中 = 三条 spGain，不多不少');
  assert.ok(noteHits(h, u).length >= 3, `这三次攻击带出的音符确实打到了敌人（${noteHits(h, u).length} 次命中）`);
  // 每一次的 +1 都落在自己那只音符飞完之后，而且一次攻击只有一条
  for (const a of launched) {
    const mine = spGains(h, u, 'attack').filter((g) => g.t >= a.t && g.t - a.t < 1.2);
    assert.equal(mine.length, 1, `t=${a.t.toFixed(3)} 的那次攻击恰好一条攻击回复`);
    assert.ok(mine[0].t - a.t > 0.2, `…而且是在音符飞到之后（${(mine[0].t - a.t).toFixed(3)} s，不是出手那一帧）`);
    assert.equal(mine[0].amount, 1, '一次攻击 +1 点');
  }
  // 第 4 次攻击：仍然只 +1 —— 攒出第 1 层充能（普通攻击的技力与空转音符走的是同一条语义）
  while (u.skill.charges < 1 && h.b.time < 30) h.step(1);
  assert.equal(u.skill.charges, 1, '第 4 次攻击攒出第 1 层充能');
  assert.equal(u.skill.sp, 0, '技力从 0 重新计');
  assert.equal(spGains(h, u, 'attack').length, 4, '四次攻击四条 spGain');
  done(h);
});

test('一次普通攻击只有一段伤害：伤害在音符碰到敌人时才结算（出手后、命中前目标血量一动不动）', () => {
  // 所有者: 「而不是出手就结算伤害，是攻击到敌人（无论有没有造成伤害）才结算」. 改前每次普攻有两段：
  // 引擎那支箭（出手 ~0.13 s 后落地）与天赋那只音符（~0.9 s 后落地），两段一样大 —— 重复计算。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }]);
  h.step(1);
  const u = unitOf(h, BASE);
  const e = h.enemies()[0];
  const hp0 = e.hp;
  const dealt = () => h.hooksOf('damaged').filter((c) => c.source === u);
  assert.equal(aimedAttacks(h, u), 1, '第一次普通攻击在 t ≈ 0 已经出手');
  assert.equal(hp0, e.s.maxHp, '目标满血');
  assert.equal(dealt().length, 0, '出手当帧：一段伤害都没有（没有「出手就结算」）');
  assert.equal(e.hp, hp0, '出手当帧：目标血量不变');
  // 引擎那支箭原来的落地时刻是 ~0.13 s：走到出手后 0.25 s，仍然一段伤害都没有
  const tAtk = h.b.time;
  h.runUntil(() => h.b.time >= tAtk + 0.25, 2);
  assert.equal(dealt().length, 0, '命中前她一段伤害都没造成（那支箭不再结算）');
  assert.equal(e.hp, hp0, '命中前目标血量不变');
  // 音符飞到（约 0.93 s）才结算，而且恰好一段：数值 = 缓存攻击力 × 领主远程倍率 0.8
  h.runUntil(() => dealt().length > 0, 5);
  const hits = dealt();
  assert.equal(hits.length, 1, `一次普通攻击 = 一段伤害（实测 ${hits.length} 段）`);
  const expected = u.s.atk * u.profile.dmgMul(h.b, u, e);
  assert.ok(Math.abs(hits[0].amount - expected) < 1e-6, `那一段就是这次攻击的伤害 ${expected}（实测 ${hits[0].amount}）`);
  assert.equal(hits[0].dmg.type, 'arts', '音符的伤害类型是法术（天赋一）');
  assert.deepEqual(hits[0].dmg.tags, ['talent'], '它由音符给出（tag = talent）');
  assert.ok(hits[0].t - tAtk > 0.3, `结算时刻在音符飞行之后（出手后 ${(hits[0].t - tAtk).toFixed(3)} s）`);
  assert.ok(Math.abs((hp0 - e.hp) - expected) < 1e-6, `目标恰好掉了这一段血（${hp0 - e.hp}）`);
  // 第二次攻击出手后（约 1.3 s）、它的音符落地前，总伤害仍然只有那一段
  h.runUntil(() => aimedAttacks(h, u) >= 2, 5);
  assert.equal(dealt().length, 1, '第二次攻击命中前，总伤害段数仍然是 1');
  assert.ok(Math.abs((hp0 - e.hp) - expected) < 1e-6, '血量也还是只掉了一段');
  done(h);
});

test('命中判定与伤害量无关：护盾全吃 / 闪避 / 无敌也算「击中」，音符照样报一次攻击（攻回技力照给）', () => {
  // 所有者 2026-10-08:「是攻击到敌人（无论有没有造成伤害）才结算」. `strike` 先走引擎的 dealDamage（护盾全吃 /
  // 闪避 / 无敌都会让它返回 0），然后**无条件**报一次「这只音符碰到了敌人」—— 与空转音符的「击中就加」同口径
  // （AGENTS §6.9 第②条）。三段的观测量都是「伤害为 0 但仍然给了攻击回复技力」。
  //
  // (a) 射程内 + 护盾全吃：血量一动不动，每次攻击仍然给 S1 一点技力
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
      hooks: [...HOOKS, 'spGain'],
      setup: (b) => b.on('enemySpawn', ({ enemy }) => b.addBuff(enemy, { key: 'test:shield', shield: 1e9 }), { priority: 100 }),
    });
    h.step(1);
    const u = unitOf(h, BASE);
    const e = h.enemies()[0];
    assert.ok(e.s.shield >= 1e9, '护盾挂上了');
    assert.equal(aimedAttacks(h, u), 1, '第一次普通攻击已经出手');
    while (u.skill.sp < 3 && h.b.time < 30) h.step(1);        // 三次攻击的音符都「打到」了（伤害被护盾吃掉）
    assert.equal(aimedAttacks(h, u), 3, '三次带目标的攻击');
    assert.equal(e.hp, e.s.maxHp, '护盾把伤害全吃了：血量一点没掉');
    assert.equal(h.hooksOf('damaged').filter((c) => c.source === u && c.amount > 0).length, 0, '她一段有效伤害都没造成');
    assert.equal(spGains(h, u, 'attack').length, 3, '每次击中恰好一条 spGain（不看伤害量）');
    assert.equal(u.skill.sp, 3, '三次击中 = 3 点攻击回复技力');
    assert.equal(u.skill.charges, 0);
    done(h);
  }
  // (b) 射程外（持续攻击）+ 闪避：闪避让 dealDamage 直接返回 0（连 damaged 钩子都没有），但照样算击中
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
      enemies: [{ key: 'e_out', pos: [10, 8] }],
      defs: { enemies: { e_out: enemyRec({ key: 'e_out', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
      hooks: [...HOOKS, 'spGain', 'dodge'],
      setup: (b) => b.on('enemySpawn', ({ enemy }) => b.addBuff(enemy, { key: 'test:dodge', persist: true, mods: { dodgeArts: 1 } }), { priority: 100 }),
    });
    h.run(0.2);
    const u = unitOf(h, BASE);
    const e = h.enemies()[0];
    while (spGains(h, u, 'attack').length < 3 && h.b.time < 60) h.step(1);
    assert.ok(h.hooksOf('dodge').length >= 3, `闪避真的发生了（${h.hooksOf('dodge').length} 次）`);
    assert.equal(h.hooksOf('damaged').filter((c) => c.source === u).length, 0, '闪避 ⇒ 一段伤害都没有');
    assert.equal(e.hp, e.s.maxHp, '目标满血');
    assert.equal(spGains(h, u, 'attack').length, 3, '三次「碰到敌人」= 三条攻击回复（每只音符只报一次）');
    assert.equal(u.skill.sp, 3, 'S1 的技力照涨');
    assert.equal(aimedAttacks(h, u), 0, '敌人始终在射程外（这些命中全部来自持续攻击的音符）');
    done(h);
  }
  // (c) 射程内 + 无敌（flags.invulnerable）：同样返回 0，同样算击中
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
      hooks: [...HOOKS, 'spGain'],
      setup: (b) => b.on('enemySpawn', ({ enemy }) => b.addBuff(enemy, { key: 'test:inv', persist: true, flags: { invulnerable: true } }), { priority: 100 }),
    });
    h.step(1);
    const u = unitOf(h, BASE);
    const e = h.enemies()[0];
    assert.equal(e.s.flags.invulnerable, true, '目标确实处于无敌');
    while (u.skill.sp < 2 && h.b.time < 30) h.step(1);
    assert.equal(aimedAttacks(h, u), 2, '两次带目标的攻击');
    assert.equal(e.hp, e.s.maxHp, '无敌 ⇒ 血量不动');
    assert.equal(h.hooksOf('damaged').filter((c) => c.source === u).length, 0, '无敌 ⇒ 连 damaged 钩子都没有');
    assert.equal(spGains(h, u, 'attack').length, 2, '两次击中 = 两条 spGain');
    assert.equal(u.skill.sp, 2, '两次击中 = 2 点攻击回复技力');
    done(h);
  }
});

test('回归：别人的普攻一行没变 —— 同为领主的拉普兰德照样射箭、伤害仍在箭落地时结算、atk 表现仍是 arrow', () => {
  // 范围约束（所有者 2026-10-08）:「只有祥子改载体」. kit 的 `noAttackDamage` 是**显式 opt-in**：只有她的 profile 带
  // 这个标记，别人的 profile 连一次属性读取以外都不多走（ai.js resolveHit/performAttack 的 `noDmg` / `carried`）。
  // 这里拿**同子职业、同样 `projectile: 'arrow'`、同样领主远程 0.8 规则**的官方干员拉普兰德做对照：她的普攻必须
  // 还是「一支箭 + 落地结算 + atk 报 arrow」，而且一次攻击仍然只有那一段伤害。
  const OTHER = 'chess_char_2_16_a';
  const h = run([{ chessId: OTHER, row: 10, col: 4 }]);
  h.step(1);
  const u = unitOf(h, OTHER);
  const e = h.enemies()[0];
  assert.equal(raw(OTHER).projectile, 'arrow', '官方数据里她是 arrow（与祥子同款 projectile）');
  assert.equal(raw(OTHER).subProfessionId, 'lord', '同为领主（dmgMul 规则一样）');
  assert.equal(u.profile.projectile, 'arrow', 'profile 仍是 arrow');
  assert.equal(u.profile.attack, 'ranged', '仍是远程攻击');
  assert.equal(u.profile.noAttackVis, undefined, '没有 noAttackVis（引擎照旧画箭）');
  assert.equal(u.profile.noAttackDamage, undefined, '没有 noAttackDamage（伤害仍由引擎那支箭结算）');
  // 一次普通攻击：箭先落地（约 0.13 s），伤害在那时结算 —— 不是出手即结算，也不是音符那种 0.9 s
  const dealt = () => h.hooksOf('damaged').filter((c) => c.source === u);
  const hp0 = e.hp;
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && (c.targets ?? []).length > 0), 6),
    '她出手了');
  const a = h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0)[0];
  assert.equal(dealt().length, 0, '出手当帧：还没有伤害（引擎的伤害在弹道落地时结算）');
  assert.equal(e.hp, hp0, '…目标血量不变');
  // 弹道：她这一次攻击生成的是 'arrow'（不是 'note'），而且客户端收到的也是 'arrow'
  const flight = h.b.projectiles.list.filter((p) => p.source === u);
  assert.equal(flight.length, 1, `一次攻击只有一支弹道（实测 ${flight.length}）`);
  assert.equal(flight[0].visual, 'arrow', '那支弹道是箭');
  assert.equal(flight[0].data, null, '引擎自己的箭没有 data（音符才带 data.tag）');
  assert.deepEqual([...new Set(h.eventsOf('atk').filter((x) => x[1] === u.id).map((x) => x[3]))], ['arrow'],
    "'atk' 事件报的 kind 仍是 'arrow'");
  // 落地：恰好一段伤害，数值 = 缓存攻击力 × 领主远程 0.8，且带 isAttack（引擎原来的那条路）
  h.runUntil(() => dealt().length > 0, 2);
  const hit = dealt()[0];
  const expected = u.s.atk * u.profile.dmgMul(h.b, u, e);
  assert.ok(Math.abs(hit.amount - expected) < 1e-6, `箭的伤害 ${expected}（实测 ${hit.amount}）`);
  assert.ok(hit.t - a.t > 0 && hit.t - a.t < 0.25, `在箭落地时结算（出手后 ${(hit.t - a.t).toFixed(3)} s）`);
  assert.deepEqual(hit.dmg.tags, [], '引擎的攻击伤害不带 tag（与她的天赋音符不同）');
  assert.equal(hit.dmg.isAttack, true, '仍标记为一次攻击');
  // 下一次攻击落地前，总段数还是 1：没有多出第二条弹道 / 第二段伤害
  h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === u && (c.targets ?? []).length > 0).length >= 2, 5);
  assert.equal(dealt().length, 1, '第二次攻击命中前仍只有一段伤害');
  assert.equal(h.b.projectiles.list.filter((p) => p.source === u && p.visual !== 'arrow').length, 0, '她名下没有非箭的弹道');
  done(h);
});

test('S1 自己的 8 只音符命中不给攻击回复技力（技能的攻击不给攻击回复）', () => {
  // 只有「她的普通攻击」才是攻击回复：技能打出去的音符是技能的伤害，引擎对技能期间的攻击一样不给攻击回复
  // （skills.js:484「attacks made by the skill … never recover attack-type SP」）。这条必须守住，否则 S1 一发动就能
  // 用自己的 8 只音符把自己充满（8 只 × 1 点 = 两层充能），变成自我循环。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
    enemies: [{ key: 'e_out', pos: [10, 8] }],
    defs: { enemies: { e_out: enemyRec({ key: 'e_out', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
    hooks: [...HOOKS, 'spGain'],
  });
  h.b.grid.setObstacle(10, 5, true);      // 前方一格通行类型为无 → 持续攻击发不出音符，场上只剩 S1 自己的那 8 只
  h.run(0.2);
  const u = unitOf(h, BASE);
  u.skill.gainSp(9999);
  assert.equal(u.skill.activate('manual'), true, '手动发动 S1');
  u.skill.sp = 0;
  u.skill.charges = 0;                    // 清空：之后涨的每一点都只可能来自这次技能的 8 只音符
  const hits = (tag) => h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags ?? []).includes(tag));
  for (let i = 0; i < 30 * 12 && hits('skill').length < 8; i++) h.step(1);
  assert.equal(emptyAttacks(h, u), 0, '前方一格被挡：一只空转音符都没有');
  assert.equal(hits('talent').length, 0, '所以场上只有技能的音符（没有天赋音符混进来）');
  assert.ok(hits('skill').length >= 4, `S1 的音符打到了敌人 ${hits('skill').length} 次`);
  assert.equal(u.skill.sp, 0, '技力一点没涨');
  assert.equal(u.skill.charges, 0, '充能也没涨');
  assert.deepEqual(spGains(h, u, 'attack'), [], '没有一条 attack 的 spGain');
  done(h);
});

test('Fever 期间空转音符命中也不涨技力（§16「技力不积累」/ 引擎自己的 noSp 阻回）', () => {
  // 新加的那条路必须服从 Fever 的规则：§16「Fever 状态期间…不累积」+「停止 SP 积累」在 kit 里是标记 buff 的
  // `flags.noSp`（引擎的阻回语义，skills.js:261），gainSp 在它面前一律返回 0 —— 技力来源换成「攻击回复」也一样。
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 1).index }], {
    enemies: [{ key: 'e_out', pos: [10, 8] }],
    defs: { enemies: { e_out: enemyRec({ key: 'e_out', hp: 1e7, speed: 0, def: 0, res: 0 }) } },
    hooks: [...HOOKS, 'spGain'],
  });
  h.run(0.2);
  const u = unitOf(h, BASE);
  const far = h.b.enemies[0];
  assert.equal(far?.defId, 'enemy_e_out', 'the enemy out of her range');
  // 计量按「对敌人造成伤害」累积（天赋二 +3），所以 450 点 = 150 次伤害；这里直接把计量喂满，省下 180 秒的仗
  const per = raw(BASE).talents[1].bb.cnt;
  for (let i = 0; i < FEVER_MAX / per; i++) h.b.dealDamage(u, far, { amount: 1, type: 'true' });
  assert.equal(u.mem.sakikoFever, FEVER_MAX, `计量蓄满（${FEVER_MAX}）`);
  fever.charge(u);
  assert.equal(u.skill.activate('manual'), true, '蓄满 + 发动 → 进入 Fever');
  assert.ok(u.mem.sakikoFeverLeft > 0, 'in Fever');
  assert.equal(u.s.flags.noSp, true, '标记 buff 带的是引擎自己的 noSp（阻回）');
  const mark = noteHits(h, u, 'enemy_e_out').length;
  const sp0 = u.skill.sp, ch0 = u.skill.charges;
  h.run(FEVER_SEC - 1);
  const inside = noteHits(h, u, 'enemy_e_out').length - mark;
  assert.ok(u.mem.sakikoFeverLeft > 0, `Fever 还在跑（剩 ${u.mem.sakikoFeverLeft.toFixed(1)} s）`);
  assert.ok(inside > 0, `Fever 里的空转音符照样命中了敌人 ${inside} 次`);
  assert.equal(u.skill.sp, sp0, '但技力不涨');
  assert.equal(u.skill.charges, ch0, '充能也不涨');
  assert.deepEqual(spGains(h, u, 'attack'), [], '没有一条 attack 的 spGain');
  done(h);
});

test('\u6301\u7eed\u653b\u51fb: the note flies to the side she faces — all four directions', () => {
  // `unit.facing` is the ±1 sprite-flip scalar (dir.js: "the legacy scalar facing survives only as hSign"), never 0 —
  // so the old `(unit.facing || 1) >= 0 ? 1 : -1` was +1 for every direction and a LEFT-facing unit fired to the right.
  // The note now owns its flight (`noteSteer`), so the direction lives in its state (`data.st.vx/vy`).
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const h = run([{ chessId: BASE, row: 10, col: 4, dir, ...CARRY }], { enemies: [] });
    h.run(0.2);
    const u = unitOf(h, BASE);
    assert.equal(u.dir, dir, `${dir}: deployed facing ${dir}`);
    const note = noteInFlight(h, u);
    assert.ok(note, `${dir}: a note is in flight`);
    const [dr, dc] = u.fwd;
    const st = note.data.st;
    assert.ok(st, `${dir}: the note carries its flight state`);
    assert.ok(st.vx * dc + st.vy * dr > 0, `${dir}: the initial direction is inside ±angle of the facing (${st.vx.toFixed(2)}, ${st.vy.toFixed(2)})`);
    // and it really moves that way (存在目标时: 固定 2.0 沿当前方向; 不存在目标时: 扩张正弦沿 +x 轴)
    const x0 = note.x, y0 = note.y;
    h.step(3);
    assert.ok((note.x - x0) * dc + (note.y - y0) * dr > 0, `${dir}: the note travelled forward (Δ ${(note.x - x0).toFixed(3)}, ${(note.y - y0).toFixed(3)})`);
    done(h);
  }
});

test('\u6301\u7eed\u653b\u51fb: a non-passable tile straight ahead blocks the note', () => {
  // PRTS: 攻击范围内不存在敌人时，若自身朝向的前方一格地块的通行类型为无，持续攻击无法发射音符
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const h = run([{ chessId: BASE, row: 10, col: 4, dir, ...CARRY }], { enemies: [] });
    h.run(0.2);
    const u = unitOf(h, BASE);
    // 前方一格 is frontOf, the engine's own helper (dir.js — professions.js uses the same call for the lord melee rule)
    const [fr, fc] = frontOf(u.tileR, u.tileC, dir);
    assert.equal(h.b.grid.walkable(fr, fc), true, `${dir}: the tile ahead (${fr},${fc}) starts out passable`);
    h.b.grid.setObstacle(fr, fc, true);            // 阻隔工事 / obstacle: the tile ahead becomes impassable
    assert.equal(h.b.grid.walkable(fr, fc), false, `${dir}: the tile ahead is now 通行类型为无`);
    const before = emptyAttacks(h, u);
    h.run(u.s.bat * 4);
    assert.equal(emptyAttacks(h, u), before, `${dir}: no note was played while the tile ahead is impassable`);
    done(h);
  }
});

test('talent 2 hands the attack-speed aura to an operator in her range', () => {
  const h = run([
    { chessId: BASE, row: 10, col: 4 },
    { chessId: BASE, row: 10, col: 5 },
  ]);
  const units = h.b.allyUnits.filter((u) => u.defId === BASE);
  assert.ok(units.length >= 2, `two of her on the field (got ${units.length})`);
  h.run(3);
  const given = h.b.allyUnits.filter((u) => u.findBuff('sakiko:aura:aspd'));
  assert.ok(given.length > 0, 'the aura reached an operator');
  for (const u of given) assert.ok(u.findBuff('sakiko:aura:aspd').mods.aspd > 0, 'with a positive attack-speed value');
  done(h);
});

test('each skill runs without content errors and resolves to a hand-authored spec', () => {
  for (const n of [1, 2, 3]) {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, n).index, ...CARRY }]);
    const unit = unitOf(h, BASE);
    assert.equal(unit.skill.id, `skchr_oblvns_${n}`, `S${n} equipped`);
    h.run(10);
    assert.equal(unit.skill.id, `skchr_oblvns_${n}`, `S${n} still equipped`);
    // every skill actually connects with the dummy
    assert.ok(tagsOf(h, unit).skill > 0, `S${n} dealt skill damage`);
    done(h);
  }
});

test('Fever is counted from the damage she deals (talent 2 fills it, +3 per instance, capped at 450)', () => {
  const h = run([{ chessId: BASE, row: 10, col: 4, ...CARRY }]);
  const unit = unitOf(h, BASE);
  h.run(10);
  const hits = h.hooksOf('damaged').filter((c) => c.source === unit).length;
  assert.ok(hits > 0, 'she dealt damage');
  // 毋畏遗忘: +3 per damage instance; §16 caps the gauge at 450 points
  assert.equal(unit.mem.sakikoFever, Math.min(FEVER_MAX, hits * 3), `Fever = 3 × ${hits} hits`);
  done(h);
});

test('S1 的八个音符按【自左 13.125° 至右 13.125°、间隔 3.75°】的固定扇形顺时针发出', () => {
  // §17:「触发技能时以自身朝向为基准，自左 13.125° 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」。旧实现是
  // 「在技能自己 `angle` 黑盒（15°）里随机取方向」，与规格不符；黑盒的 15 不是扇形本身。
  const s1 = rec(BASE, 1);
  assert.equal(s1.bb.angle, 15, '行的 angle 黑盒（旧实现用它做随机扇形，规格里不是这个数）');
  const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: s1.index }]);   // 射程内有假人 → 不会有空放音符混进来
  h.run(0.2);
  const u = unitOf(h, BASE);
  u.skill.gainSp(9999);
  const seen = new Map();
  assert.equal(u.skill.activate('manual'), true);
  for (let i = 0; i < 90; i++) {
    h.step(1);
    for (const p of h.b.projectiles.list) {
      // `hitTag: 'skill'` 才是 S1 自己的音符；她同时还在用天赋音符打那个假人（`hitTag: 'talent'`）
      if (p.data?.tag !== 'sakiko:note' || p.source !== u || p.data.hitTag !== 'skill' || seen.has(p.id)) continue;
      seen.set(p.id, { t: h.b.time, vx: p.data.st.vx, vy: p.data.st.vy });
    }
  }
  const rows = [...seen.values()].sort((a, b) => a.t - b.t);
  assert.equal(rows.length, 8, `八个音符（实际 ${rows.length}）`);
  const [dr, dc] = u.fwd;
  const degs = rows.map((r) => {
    const fwd = r.vx * dc + r.vy * dr;
    const side = r.vx * dr - r.vy * dc;     // 正 = 自身左侧
    return Math.atan2(side, fwd) * (180 / Math.PI);
  });
  const want = [13.125, 9.375, 5.625, 1.875, -1.875, -5.625, -9.375, -13.125];
  degs.forEach((d, i) => assert.ok(Math.abs(d - want[i]) < 0.01, `第 ${i + 1} 只：${d.toFixed(3)}°，应为 ${want[i]}°`));
  for (let i = 1; i < degs.length; i++) {
    assert.ok(Math.abs((degs[i - 1] - degs[i]) - 3.75) < 0.01, `相邻间隔 3.75°（${degs[i - 1].toFixed(3)} → ${degs[i].toFixed(3)}）`);
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t - rows[i - 1].t > 0.05, '依次发出，不是同一 tick 挤在一起');
  done(h);
});

test('S3 的免死：优先级 −3000（让位给别的保护），且「自身退场时」也按退场走', async () => {
  // §17:「免死效果需要处于技能期间生效，优先级 −3000，期间触发过此免死效果的单位将在 Fever 结束时 / 自身退场时退场」。
  {
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
    h.run(0.2);
    const unit = unitOf(h, BASE);
    const mine = (h.b._hooks.fatal ?? []).filter((x) => x.owner === unit);
    assert.equal(mine.length, 1, '她注册了一条 fatal');
    assert.equal(mine[0].priority, -3000, '优先级 −3000（引擎按优先级降序跑 fatal：别的保护先说话）');
    // 行为上的对照：另一个优先级 −1000 的保护先一步接管 → 她的 −3000 什么都不做
    h.b.on('fatal', (ctx) => { if (ctx.unit === unit) ctx.prevented = true; }, { priority: -1000 });
    const { caster } = feverByHand(h);
    assert.equal(caster, unit);
    h.b.dealDamage(null, unit, { amount: 1e9, type: 'true' });
    assert.equal(unit.alive, true, '有人保住了她');
    assert.ok(!unit.mem.sakikoSaved, '−3000 的那条排在后面，看到 prevented 就不再认领');
    h.run(21);
    assert.equal(unit.alive, true, '所以 Fever 结束时也没有她的强制退场');
    done(h);
  }
  {
    // 没有别的保护时：保到 1 HP，并且在 Fever 结束 / 自身退场时都按【退场】离场
    const h = run([{ chessId: BASE, row: 10, col: 4, skillIndex: rec(BASE, 3).index }]);
    h.run(0.2);
    const unit = unitOf(h, BASE);
    feverByHand(h);
    h.b.dealDamage(null, unit, { amount: 1e9, type: 'true' });
    assert.equal(unit.alive, true, '致命的なダメージを受けてもHPは1以下にならず');
    assert.equal(unit.hp, 1, 'held at exactly 1 HP');
    assert.equal(unit.mem.sakikoSaved, true, 'marked for the exit');
    // 「自身退场时」：Fever 还没结束，别的机制（道具 / 联防 / 别的 kit）把她请下场 —— 她仍然按【退场】走
    h.b.retreat(unit, { reason: 'retreat' });
    assert.equal(unit.alive, false, 'off the field');
    assert.equal(unit.removeReason, FORCED_EXIT, '被免死救过的成员，离场就是退场（不是普通撤退）');
    h.run(21);
    assert.equal(unit.mem.sakikoFeverLeft, 0, 'Fever 走完自己的 20 秒');
    assert.equal(unit.findBuff('sakiko:fever'), null, '标记清理干净');
    done(h);
  }
});

test('without Fever a lethal hit kills her normally', () => {
  const { h, unit } = fever.ready();
  h.b.dealDamage(null, unit, { amount: 1e9, type: 'true' });
  assert.equal(unit.alive, false, 'no protection outside Fever');
  assert.equal(unit.removeReason, 'killed');
  done(h);
});

test('Fever: a retreat inside the window still ends it — no marker left on a unit that is gone', () => {
  // The window is a duration, not a presence: another mechanism (an item, 联防, a tier kit) can take her off the field
  // inside it. The marker is `persist` (Battle._remove keeps it) and `mem` survives a redeploy, so a countdown frozen
  // at the kit's own `!live` guard left a visible Fever buff on the field for the rest of the match.
  const { h, unit } = fever.ready();
  feverByHand(h);
  assert.ok(unit.findBuff('sakiko:fever'), 'in Fever, marker up');

  h.b.retreat(unit, { reason: 'retreat' });
  assert.equal(unit.alive, false, 'taken off the field by something else');
  assert.equal(unit.removeReason, 'retreat', 'not the forced exit — she was never saved by the protection');

  h.run(25);
  assert.equal(unit.mem.sakikoFeverLeft, 0, 'the 20 s ran out while she was off the field');
  assert.equal(unit.findBuff('sakiko:fever'), null, 'and the marker went with it');
  assert.equal(unit.removeReason, 'retreat', 'the reason stays hers');
  done(h);
});

test('the elite runs its LOR-Y module and beats the normal record on ATK and damage', () => {
  const measure = (id) => {
    const h = run([{ chessId: id, row: 10, col: 4, ...CARRY }]);
    h.run(30);
    const unit = unitOf(h, id);
    const total = h.hooksOf('damaged').filter((c) => c.source === unit)
      .reduce((s, c) => s + (c.dmg?.amount ?? 0), 0);
    done(h);
    return { total, atk: unit.s.atk };
  };
  const normal = measure(BASE);
  const elite = measure(ELITE);
  assert.ok(elite.atk > normal.atk, `elite ATK ${elite.atk} > normal ${normal.atk}`);
  assert.ok(elite.total > normal.total, `elite damage ${elite.total} > normal ${normal.total}`);
});

test('持续攻击只受「前方一格通行类型为无」限制：只能飞过的地块照样发射（PRTS）', () => {
  // 所有者 2026-10-08：「没敌人有概率不会持续攻击，两只只有一只会持续攻击」。根因是守卫写成
  // `flyPassable && walkable`，比原文更严 —— PRTS 只说「若自身朝向的前方一格地块的**通行类型为无**，
  // 持续攻击无法发射音符」，而通行类型为 FLY 的地块（深水区/沟壑：能飞过、不能走）并不是「无」，
  // 于是她一旦朝它就永久停火；她打完目标后的朝向由最后的目标决定，两只朝向不同 → 只有一只在打。
  // 现在：无 / 越界 → 挡；能走但被障碍物挡住 → 挡（既有的 setObstacle 测试就是这条）；只能飞 → 放行。
  // 两步：先在一场探针战斗里找地块，再用正规部署把她摆到它左边朝右（直接改 tileR/tileC 会让占位表失同步，
  // 那正是第一次写这个测试时踩到的 invariant: occupancy map out of sync）。
  const colFor = (want) => {
    const probe = run([{ chessId: BASE, uid: 1, row: 10, col: 4 }], { enemies: [] });
    const g = probe.b.grid;
    for (let r = 1; r < 19; r++) {
      for (let c = 1; c < 21; c++) {
        const fly = g.flyPassable(r, c), walk = g.walkable(r, c);
        if (want === 'walk' ? fly && walk : want === 'flyOnly' ? fly && !walk : !fly) return [r, c];
      }
    }
    throw new Error(`场地里应当存在「${want}」的地块`);
  };
  const spot = (want) => {
    const [r, fc] = colFor(want);
    const h = run([{ chessId: BASE, uid: 1, row: r, col: fc - 1, dir: 'RIGHT' }], { enemies: [] });
    h.run(20);
    const u = unitOf(h, BASE);
    return { h, u, front: frontOf(u.tileR, u.tileC, u.dir), last: u.mem.sakikoLastNoteAt };
  };

  const walk = spot('walk');
  assert.ok(walk.last !== undefined, '前方可行走：持续攻击照常（回归基线）');
  assert.ok(walk.h.b.time - walk.last < 3, `…且节奏正常（最后 ${walk.last?.toFixed(2)}）`);

  const fly = spot('flyOnly');
  assert.ok(fly.last !== undefined,
    `前方一格 ${fly.front} 的通行类型是 FLY（flyPassable=true / walkable=false），不是「无」，应当照样发射`);
  assert.ok(fly.h.b.time - fly.last < 3, `…且节奏正常（最后 ${fly.last?.toFixed(2)}）`);

  const none = spot('none');
  assert.equal(none.last, undefined, '前方一格通行类型为无：按官方规则不发射');

  for (const s of [walk, fly, none]) done(s.h);
});
