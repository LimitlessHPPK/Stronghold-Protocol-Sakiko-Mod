// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 领主 (WARRIOR·lord),
// a pick of the tier-5 / tier-6 自选 slots; all three skills, both talents and the trait in every form (normal = E2 Lv1
// rank 4, elite = E2 Lv60 rank 7, module LOR-Y — the stage the slot's status ships, 1 at tier 5 / 3 at tier 6, and any
// stage the record carries, stage 2 included: LIFT_RANGED_CLAUSE — or none). Kit contract, the 自选 rules and the
// fidelity checklist: ../README.md ("How to add an operator (自选)"). Test: test/content/op_oblvns.test.js.
//
// Sources: her own official rows (character_table / skill_table, zh_CN, as built into data/backups.json `units`) and
// PRTS 丰川祥子, all quoted with their wording in docs/research/12-sakiko.md: §2–§4 (numbers / skills), §16 (the Fever
// specification, the owner's official note of 2026-10-07) and §17 (one note-parameter row per skill). This file is the
// kit of the 0.1.4 tree (server/sim/content/kits/collab.js, where she had an injected chess record) ported to the 0.2.0
// 自选 contract: registry key = the charId, every skill under `skills` (a pick chooses any of the three, there is no
// default skill), every number read from `chess` / `bb` so one file serves both tiers, both forms and both module stages.
//
// 1. Ported unchanged from collab.js (逐条核对过):
//    * Fever (12-sakiko.md §16): gauge 0–450 in POINTS shared by every copy of her on that team (keyed
//      `Battle × ownerId`, so a new round / a 联防 battle starts at 0 — the owner's ruling of 2026-10-07); any skill
//      activation at a FULL gauge starts it (this mode casts automatically, so a manual press is not required), 20 s,
//      every member in the state; inside it the gauge is spent / does not accumulate, SP stops (the marker carries the
//      engine's own `noSp`), the engine's automatic casts are suspended (`rule: 'NEVER'`) and only Fever's own releases
//      fire — free («不消耗技力»), outside the SP limit («无视技力限制»), at the kit's own FEVER_CAST_GAP, with the
//      switch skill (S2) excluded; a sustained skill that ran when Fever started has its clock frozen and gets it back
//      when Fever ends; a sustained skill Fever opened is ended with it; S1's charge-cap auto release — the cap's own
//      extra effect (`chargeCapRelease`: 「可充能2次，充能至最大层数时自动释放一次」), which the engine's trigger rules
//      do NOT provide — does not trigger Fever (§17), while every other activation does (§16).
//    * The notes: one note per attack (talent 1 「攻击会演奏追踪敌人的音符」), the damage of a note is
//      `ATK × profile.dmgMul` snapshotted at LAUNCH (PRTS 「所有音符强制使用缓存攻击力与攻击倍率」), the talent's
//      DEF / RES penetration per note in flight («每存在一个音符…3% 防御力和 2% 法术抗性（最多 10 层）») written with
//      the engine's own `defIgnorePct` / `resIgnorePct` mod keys, the launch direction from `unit.fwd` (never the
//      ±1 sprite scalar `unit.facing`), S3's two notes seeking the highest-DEF / highest-RES enemy of the skill range,
//      S1's fixed 「自左 13.125° 至右 13.125°、间隔 3.75° 顺时针」 fan fired one note at a time, S2/S3's ±20° initial
//      direction, 持续攻击 (PRTS 术语「无论攻击范围内是否有攻击目标，都会持续进行攻击」) with its own cadence, its
//      「前方一格通行类型为无」 guard (only NONE / out of bounds — obstacles do block, a FLY-only tile does not) and the
//      attack-type SP refund of a note that reaches an enemy on an empty range («击中就加»: contact, not damage dealt),
//      S3's 免死 at `fatal` priority −3000 with the forced exit of anyone it saved, and the notes a departure clears.
//    * The note FLIGHT is the official 【自由移动】→【追踪移动】(→ S2 钢琴's 【已命中】) state machine, tabulated per
//      skill in the NOTE_* rows below and implemented by `noteSteer()`: the 扩张正弦 drift, the per-frame 转向速度,
//      the piano's 0.8-tile collision flying on at 3.0 for the row's own `attack@passby_delay`, and the PRTS
//      「音符位于自身攻击范围外时，若连续 `delay` 秒以上不存在追踪目标则消失」. No engine projectile move can express
//      that, so the flight is handed to the content through `projectiles.js`'s `steer(p, dt)` hook.
//    * The notes are VISIBLE: `Battle.snapshot()` publishes their authoritative positions as `snap.proj` and the client
//      draws one sprite per projectile id from that list (the kit only has to tag them — `visual: 'note'` — and report
//      her skills' notes apart from the talent's, `data.hitTag = 'skill'`). Her ordinary attack has no visual of its
//      own either (`noAttackVis`), so a note is the only projectile on screen for her.
//    * The attack CARRIER is the note: `noAttackDamage` keeps the engine's own arrow from dealing a second damage
//      instance next to the note that carries the attack, and from completing the attack itself — the note settles both
//      the damage and the 攻击回复技力 when IT reaches the enemy (`onDealt`, which fires on the CONTACT: 护盾全吃 /
//      闪避 / 无敌也算打到人, 沒打到人不加, once per note). See the ATTACK_CARRIER block below.
//    * The Fever gauge has a UI outlet: the kit keeps writing `unit.mem.gauges.fever` and the engine forwards it as
//      `snap.fever` (the client draws her model's badge and tints her SP bar; see 12-sakiko.md §16).
//    * 「其他 Ave Mujica 成员的攻击范围…视作攻击范围的延伸」 is NOT implemented — the owner's decision of 2026-10-08: no
//      range extension, the second-copy case (another 丰川祥子 on the team) included; the current behaviour is the
//      intended one. (An earlier comment called the clause inert because "no other member exists", which is wrong:
//      a second copy of her IS an Ave Mujica member whose range overlaps hers.)
//    * LOR-Y (无言的约定) stage 2 / 3: 「技能期间远程攻击不再降低攻击力」 — the only module line of hers that is neither a
//      stat nor a blackboard number: it is read out of the module's own talent sentence and lifts the 领主 ranged
//      penalty on every note launched while a skill runs (the LIFT_RANGED_CLAUSE / skillRunning blocks below).
// 2. Rewritten for 0.2.0 (the 自选 model / new module layout, not a behaviour change):
//    * every skill's numbers come from ITS OWN record (`skillRec(chess, id).bb` — the kit's `bbOf`, with the selected
//      skill's `bb` as the fallback): in 0.1.4 `bb` was the single selected skill's blackboard, which under a 自选 pick
//      (any of three) would have read the wrong row;
//    * the kit is registered by charId and authors all three skills (no `skill`);
//    * talent / module numbers come from the form's resolved record (`talentBb`), so the LOR-Y stage-2 / stage-3 talent
//      upgrade (0.04 / 0.02 / 12 and 0.05 / 0.025 / 12 instead of 0.03 / 0.02 / 10) and the tier-5 / tier-6 stat and
//      module differences need no code.
// 3. Still inert / deliberately out of scope:
//    * 「其他 Ave Mujica 成员的攻击范围…视作攻击范围的延伸」 — the owner's decision of 2026-10-08 (see item 1).
//    * during S2 / S3 an attack still plays the talent's note AND the skill's own note(s) — the same two layers 0.1.4
//      has (官方模型下这段时间的载体应当只有技能自己那只; merging them is a separate decision, not taken here).
//    * talent 2's 「攻击范围内干员攻击速度+12」 aura IS implemented here; the LOR-Y module's conditional
//      「攻击范围内存在2名及以上敌人时攻击速度+12」 (trait bb `attack_speed`) is NOT this kit's business any more — the
//      engine consumes that trait shape for every operator that carries it (content/traitMods.js, wired from
//      battle/players.js `_setupUnit`; test/sim/trait_attack_speed.test.js). Implementing it here as well would
//      apply the stat twice (her +12 while 2+ enemies stand in her range is the engine's `trait:attack_speed` buff).
// [ASSUMED] markings of the ported kit: the note count / fan of S1 and the ±20° of S2/S3 come from the skill TEXT
// (their rows carry no count), 音符的伤害类型 is 法术 (§17 never names the talent note's type; 0.1.4 fired arts), and the
// timbre is chosen by form (elite = 钢琴, normal = 风琴 — the official timbre is a free switch with no data behind it).

import { num, talentBb, skillRec } from '../shared/tier1.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { bodyDist } from '../../../body.js';
import { frontOf } from '../../../dir.js';
import { COLS, FORCED_EXIT } from '../../../constants.js';

const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2';
const S3 = 'skchr_oblvns_3';
/** Her notes may hit air units (her trait is a 领主 ranged attack, `canHitFly`). */
const ANY = Object.freeze({ canHitFly: true });
/** The tag of every note projectile (`projectile.data.tag`): the kit owns them, counts them and clears them. */
const NOTE_TAG = 'sakiko:note';

// ---- the official note rows (PRTS 「音符的移动逻辑」 + 12-sakiko.md §17: one row per skill) ------------------------
//
//                       天赋 无目标   天赋 有目标   S1 新月      S2 钢琴       S2 风琴       S3 残月
//   更新间隔              0.4 s       0.4 s      0.2 s       0.2 s        0.4 s        0.4 s
//   最短自由移动时间        0.1 s       0.1 s      0.6 s       0.4 s        0.4 s        0.8 s
//   【自由移动】           扩张正弦      固定 2.0    固定 1.7     扩张正弦      扩张正弦       扩张正弦
//                        (0.3, 1.3)   沿当前方向   沿当前方向     (0.4, 1.9)   (0.15, 0.7)  (0.5, 0.8)
//   追踪范围半径           1.0         1.0        1.0         0.8          1.0          1.0
//   【追踪移动】速度        2.0         2.0        2.2         3.5          1.0          1.3
//   转向速度 (每帧)         7/30        1/6        1/6         1/2          1/12         1/4
//   【已命中】             不存在       不存在      不存在       0.8 半径碰撞   不存在        不存在
//                                                               3.0 速度, 0.5 s
//
// `update` = 更新间隔 (how often the note re-decides), `minFree` = 最短自由移动时间, `seekR` = 追踪范围半径,
// `trackSpeed` = 【追踪移动】速度, `turn` / `turnFree` = 转向速度 per frame for a note launched WITH / WITHOUT a target
// (the talent's two tables, PRTS 天赋备注) — the ceiling on how far the 【追踪移动】 heading may swing towards its target
// in one frame, as a fraction of the angle that is left (TRACK_HEADS_AT_THE_TARGET above explains both cases and why a
// heading pointing away from the target is not swung at that rate at all). `free: 'sine'` = the 扩张正弦 curve (基础振幅
// `sineAmp`, x 速度 `sineX` — PRTS 特殊机制: 以当前位置为原点、当前方向为 +x 轴, sin 或 −sin（各 50 %）, 第 n 周期的振幅 =
// 基础振幅 × n（n ≤ 3）), `free: 'straight'` = a fixed `freeSpeed` along the current direction; the talent's own aimed
// set moves straight instead of drifting (`straightWhenAimed`). `hit` = S2 钢琴's 【已命中】: a `radius` collision flown on
// at `speed`.
const NOTE_TALENT = Object.freeze({
  update: 0.4, minFree: 0.1, seekR: 1.0, trackSpeed: 2.0, turn: 1 / 6, turnFree: 7 / 30,
  free: 'sine', straightWhenAimed: true, sineAmp: 0.3, sineX: 1.3,
});
/** S1 新月的苏醒: 更新 0.2 s, 最短自由移动 0.6 s, 【自由移动】固定 1.7 向当前方向, 追踪 1.0 / 2.2 / 转向 1/6. */
const NOTE_S1 = Object.freeze({ update: 0.2, minFree: 0.6, seekR: 1.0, trackSpeed: 2.2, freeSpeed: 1.7, turn: 1 / 6, free: 'straight' });
/** S2 满月的舞会 · 钢琴: … + 【已命中】= 激活 0.8 半径的碰撞, 固定 3.0 速度沿当前方向移动 (`attack@passby_delay`). */
const NOTE_S2_PIANO = Object.freeze({
  update: 0.2, minFree: 0.4, seekR: 0.8, trackSpeed: 3.5, turn: 1 / 2, free: 'sine', sineAmp: 0.4, sineX: 1.9,
  hit: Object.freeze({ radius: 0.8, speed: 3.0 }),
});
/** S2 满月的舞会 · 风琴: 更新 0.4 s, 最短 0.4 s, 扩张正弦 (0.15, 0.7), 追踪 1.0 / 1.0 / 转向 1/12. */
const NOTE_S2_ORGAN = Object.freeze({ update: 0.4, minFree: 0.4, seekR: 1.0, trackSpeed: 1.0, turn: 1 / 12, free: 'sine', sineAmp: 0.15, sineX: 0.7 });
/** S3 残月的余响 (every timbre): 更新 0.4 s, 最短 0.8 s, 扩张正弦 (0.5, 0.8), 追踪 1.0 / 1.3 / 转向 1/4. */
const NOTE_S3 = Object.freeze({ update: 0.4, minFree: 0.8, seekR: 1.0, trackSpeed: 1.3, turn: 1 / 4, free: 'sine', sineAmp: 0.5, sineX: 0.8 });
/** S2/S3 音符的初始方向: 「随机在左 20° 至右 20° 范围内选择一个角度」. */
const NOTE_SPREAD = 20;
/** Fallback for the talent's own `attack@angle`: the fan a note with no target is launched into. */
const IDLE_ANGLE = 20;
/** S3 残月的余响: "各 2 个音符" — the row has no `attack@times` blackboard, so this is the skill text's own count. */
const S3_NOTES_PER_TIMBRE = 2;
// S1 新月的苏醒: 「触发技能时以自身朝向为基准，自左 13.125° 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」— the
// notes leave in a fixed fan (13.125 − 3.75·i), NOT the random angle of the row's own `angle` blackboard (15°).
const S1_FAN_HALF = 13.125;
const S1_FAN_STEP = 3.75;
/** [ASSUMED] the gap between S1's notes: the row carries no timing, the text only says 演奏出8个音符. */
const S1_STAGGER = 0.1;

// -------------------------------------------------------------------------------------------------------------------
// Fever — the Ave Mujica collaboration's TEAM gauge. The authoritative wording is the owner's official note
// (12-sakiko.md §16, 2026-10-07):
//
//   > Fever累计至450点时，任意一位 Ave Mujica 成员手动触发技能后，在场所有 Ave Mujica 成员 20 秒内会持续释放当前技能
//   > ※该进度所有成员共享，在整场战斗中保留
//   > ※Fever 状态期间：耗尽且不累积 Fever 值…所有受影响成员将无视技力限制地持续尝试开启技能（切换类技能除外），
//   >   且通过此方法开启技能时不消耗技力；通过 Fever 状态开启的持续类技能将在 Fever 状态结束时强制结束；
//   >   进入 Fever 状态前正在释放的持续类技能暂停计时，直至 Fever 状态结束
//
// In this mode she is the only mujica operator, so "all Ave Mujica characters" means "all her copies on that team".
const FEVER_MAX = 450;                              // 「Fever累计至450点时」— the gauge, and the trigger, are points
const FEVER_SEC = 20;                               // [sourced 20 s] 官方备注
/**
 * [ASSUMED 观感] Seconds between two Fever-driven releases of one member's skill. §16 only says 「无视技力限制地持续尝试
 * 开启技能」 and carries no interval; the engine's own automatic-operation cooldown (`AUTO_OP_COOLDOWN`, 3 s) would allow
 * only 6 releases in the 20 s window, which does not read as 持续释放. 1.5 s sits between it and the 0.7 s her S1's
 * eight-note volley takes (see 12-sakiko.md §16 / the 0.1.4 kit's measurement).
 */
const FEVER_CAST_GAP = 1.5;
/** The gauge is reported 0–100 (`mem.gauges.fever`); the raw 0–450 number stays on `mem.sakikoFever`. */
const FEVER_PCT = 100 / FEVER_MAX;
/** The marker every member wears while the state runs (the client turns the SP bar 玫红色 and the badge to its state
 *  look: render/units.js FEVER_ICON reads this very key through the visible buff). */
const FEVER_BUFF = Object.freeze({ key: 'sakiko:fever', visible: true, persist: true, flags: { noSp: true }, data: { label: 'Fever' } });

/**
 * Per-battle, per-player Fever record. 「每回合从 0 开始，并且协助队友的时候也要重新积累」 (owner's ruling, §16): a round
 * runs one `Battle`, a 联防 assist runs another, so a WeakMap keyed by the battle instance IS the whole lifetime — a new
 * battle has no record at all and starts at 0, while inside one battle every copy of her keeps reading the same one.
 * `paused` = the sustained skills whose clock Fever freezes (unit → { sk, timeLeft, acts }), `opened` = the sustained
 * skills Fever itself started (ended with it), `hold` = the auto-cast rules suspended for the window.
 * @type {WeakMap<object, Map<string, object>>}
 */
const FEVER_STATES = new WeakMap();
function feverState(battle, unit) {
  let byPlayer = FEVER_STATES.get(battle);
  if (!byPlayer) { byPlayer = new Map(); FEVER_STATES.set(battle, byPlayer); }
  const key = String(unit?.ownerId ?? '');
  let st = byPlayer.get(key);
  if (!st) {
    st = { gauge: 0, left: 0, saved: new Set(), members: new Set(), clock: null, paused: new Map(), opened: new Set(), hold: new Map() };
    byPlayer.set(key, st);
  }
  return st;
}

/** Her own liveness test (the engine's `up` plus the flags a kit has to respect). */
const live = (u) => !!u && u.alive && u.deployed && !u.removed && !u.hidden;
/** The value the client bar would show: the gauge while charging, the remaining Fever seconds while the state runs. */
const feverPct = (st) => (st.left > 0 ? Math.round((st.left / FEVER_SEC) * 100) : Math.round(st.gauge * FEVER_PCT));
const inFever = (battle, unit) => feverState(battle, unit).left > 0;

/** Push the shared value onto every member: `mem.gauges.fever` (0–100) is the UI outlet `Battle.snapshot()` forwards as
 *  `snap.fever` (render/interp.js sample → render/units.js FEVER_ICON). */
function syncFever(st) {
  const pct = feverPct(st);
  for (const m of st.members) {
    if (!m?.mem) continue;
    m.mem.sakikoFever = Math.round(st.gauge);      // the raw 0–450 gauge (the kit's own bookkeeping)
    m.mem.sakikoFeverLeft = st.left;
    m.mem.sakikoSaved = st.saved.has(m);
    (m.mem.gauges ?? (m.mem.gauges = {})).fever = pct;
  }
}

/** The team's damage fills the ONE gauge: talent 2 「对敌人造成伤害时使Fever+cnt」. Nothing accumulates in Fever. */
function addFever(battle, unit, amount) {
  const st = feverState(battle, unit);
  if (st.left > 0) return;                          // 「Fever 状态期间：耗尽且不累积 Fever 值」
  st.gauge = Math.max(0, Math.min(FEVER_MAX, st.gauge + amount));
  syncFever(st);
}

/**
 * Suspend the engine's own automatic cast of a member's skill for the Fever window («禁止常规自动发动»: the state's own
 * releases are the only ones). `'NEVER'` is the engine's own "never auto-cast: the kit calls skill.activate() itself"
 * rule (skills.js), so no engine change is needed — the original rule is put back when Fever ends.
 */
function holdAutoCast(st, unit) {
  const sk = unit?.skill;
  if (!sk || sk.noSkill || st.hold.has(unit)) return;
  st.hold.set(unit, sk.rule);
  sk.rule = 'NEVER';
}
function releaseAutoCast(st, unit) {
  const sk = unit?.skill;
  if (!st.hold.has(unit)) return;
  const was = st.hold.get(unit);
  st.hold.delete(unit);
  if (sk) sk.rule = was;
}

/**
 * One Fever-driven release: 「所有受影响成员将无视技力限制地持续尝试开启技能（切换类技能除外），且通过此方法开启技能时
 * 不消耗技力」. `activate(reason, { free: true })` is the engine's free activation — it skips the ready / charge check
 * and spends nothing. The switch skill is marked at install (`sk.toggle`) and stays out; a sustained skill Fever started
 * is remembered so it can be ended with the state.
 */
function feverCast(battle, unit, st) {
  const sk = unit.skill;
  if (!sk || sk.noSkill || !sk.manual || sk.toggle) return;
  if (sk.active && sk.isTimed) return;              // a sustained skill runs its own duration; re-activating is a no-op
  if (!unit.canAct || unit.s.flags.silence || sk.opCooling) return;
  let ok = false;
  try { ok = sk.activate('fever', { free: true }); } catch { /* a kit error here must not break the battle */ }
  if (!ok) return;
  // `activate` started the engine's AUTO_OP_COOLDOWN (3 s) on her; ours is the shorter, Fever-specific gap.
  sk.opReadyAt = battle.time + FEVER_CAST_GAP;
  if (sk.isTimed) st.opened.add(sk);
}

/**
 * The activation reason of the CAP RELEASE below. §17 S1's one exception is written against it: 「因充能到达上限自动释放
 * 时，不会触发 Fever」 — the release the charge cap itself causes is the only activation Fever leaves out; every other one
 * (the mode's own automatic cast, a manual press, a kit's activate) counts (「本模式是全自动放技能：任意一次技能发动
 * （含自动）在蓄满时即可触发」, §16).
 */
const CHARGE_FULL = 'chargeFull';

/**
 * S1 新月的苏醒 「可充能2次，充能至最大层数时自动释放一次」 — the release the CAP causes, in its own right.
 *
 * PRTS 技能 §特殊属性 / 可充能: 「一些技能中存在"可充能X次"的描述，其实际效果为当前技力上限等于该技能技力需求的X倍，
 * 从而实现可连续释放该技能的效果…部分可充能技能在技力达到上限后（即充能次数达到上限）会立刻产生额外效果，如立刻释放
 * 一次」. It is therefore an EXTRA EFFECT of reaching the cap, not one of the trigger rules:
 *   * it needs no target — her notes fly out and hunt for themselves (PRTS 天赋备注 「攻击范围内不存在敌人时…发射的音符
 *     初始不存在追踪目标」), and 持续攻击 means she may well be attacking into an empty range when the cap arrives;
 *   * it waits for nothing: no attack, no `AUTO_OP_COOLDOWN` — 「自动操作具有3s冷却，在完成一次操作…将进入冷却」 is about
 *     an OPERATION, and this release is the skill's own effect (so the operation's cooldown is left exactly as it was,
 *     which is also what lets her spend the charge that is left over right afterwards: 「从而实现可连续释放」);
 *   * it stands aside inside Fever: «Fever 期间，此技能将被持续地触发» — the state's own releases are the ones firing.
 *
 * WHY THIS HAS TO EXIST AT ALL. The kit used to leave the release to the engine's DEFAULT trigger, which requires an enemy
 * inside her INITIAL range at attack time (`skills.js` `_defaultCondition`). Her 持续攻击 keeps playing notes whose
 * contacts still pay her attack SP, so with nothing in her range the charges climbed to the cap and STAYED there: the
 * skill never released and the SP bar read full the whole time (snapshot.js publishes `sp`/`spCost`, and `gainSp` pins
 * `sp` at `spCost` exactly when `charges == maxCharges`) — 技能条满了却不发动技能，而是继续普通攻击.
 */
function chargeCapRelease(battle, unit) {
  const sk = unit?.skill;
  if (!sk || sk.noSkill || sk.kind !== 'charges' || sk.maxCharges <= 1) return false;
  if (!live(unit) || !unit.canAct || unit.s.flags.silence) return false;   // a stunned / silenced unit releases nothing
  if (sk.charges < sk.maxCharges || (sk.active && sk.isTimed)) return false;
  if (feverState(battle, unit).left > 0) return false;                     // «Fever 期间，此技能将被持续地触发»
  const opReadyAt = sk.opReadyAt;
  let ok = false;
  try { ok = sk.activate(CHARGE_FULL) === true; } catch { /* a kit error here must not break the battle */ }
  sk.opReadyAt = opReadyAt;   // the cap's extra effect is not an 自动操作: it must not spend the operation's cooldown
  return ok;
}

/**
 * Enter Fever for FEVER_SEC s, for EVERY member of that player (idempotent: a cast inside the window only refreshes the
 * countdown). Whoever triggers it, the whole team gets the state and the marker.
 */
function enterFever(battle, unit) {
  const st = feverState(battle, unit);
  const fresh = st.left <= 0;
  st.left = FEVER_SEC;
  if (fresh) {
    st.gauge = 0;                                   // 「耗尽」: the state spends the gauge it was paid with
    st.paused.clear();
    st.opened.clear();
  }
  if (!st.clock) {
    // one clock for the shared countdown — every member's own timer would tick it N times per step
    st.clock = battle.every(0.1, () => {
      // 「进入 Fever 状态前正在释放的持续类技能暂停计时」: hand the frozen clock back BEFORE the skills tick this step
      // (the scheduled phase runs before the allies phase), so the timer never advances while Fever runs.
      for (const [m, p] of st.paused) {
        if (p.sk !== m.skill || !p.sk.active || p.sk.activations !== p.acts) { st.paused.delete(m); continue; }
        p.sk.timeLeft = p.timeLeft;
      }
      if (st.left <= 0) return;
      st.left = Math.max(0, st.left - 0.1);
      if (st.left <= 0) endFever(battle, st);
      else syncFever(st);
    });
  }
  for (const m of st.members) {
    if (!live(m)) continue;
    joinFever(battle, st, m, unit, fresh);
  }
  syncFever(st);
}

/** Put one member into the running state: the visible marker, the suspended auto-cast, and the frozen clock. */
function joinFever(battle, st, m, source, announce) {
  holdAutoCast(st, m);
  // keyed passive so the client draws it (addBuff refuses a dead unit, hence the caller's `live` guard)
  battle.addBuff(m, { ...FEVER_BUFF, source });
  if (announce) battle.fx('buff', { x: m.x, y: m.y, id: m.id });
  if (st.paused.has(m)) return;
  const sk = m.skill;
  // 进入 Fever 前已在跑的持续类技能: its remaining clock is what Fever has to give back
  if (sk && sk.active && sk.isTimed && Number.isFinite(sk.timeLeft)) {
    st.paused.set(m, { sk, timeLeft: sk.timeLeft, acts: sk.activations });
  }
}

/**
 * Leave Fever: drop the marker from every member, and force out the ones the state kept alive (強制退場).
 *
 * The cleanup touches every member unconditionally, because a Fever window can outlive a member's presence on the
 * field: the marker is `persist` (Battle._remove keeps it through a retreat) and `mem` survives a redeploy, so a Fever
 * a member was retreated or knocked down inside would otherwise leave a visible Fever buff on the field for good.
 */
function endFever(battle, st) {
  st.left = 0;
  for (const m of st.members) {
    battle.removeBuff(m, 'sakiko:fever');
    releaseAutoCast(st, m);
    if (st.saved.has(m)) {
      // 強制退場 / FORCED_EXIT is the engine's "withdrawn, not knocked out" reason (constants.js)
      if (live(m)) battle.retreat(m, { reason: FORCED_EXIT });
    }
  }
  // 「通过 Fever 状态开启的持续类技能将在 Fever 状态结束时强制结束」
  for (const sk of st.opened) {
    if (!sk || !sk.active) continue;
    try { sk.end('fever'); } catch { /* a kit error here must not break the battle */ }
  }
  // …and the ones that were already running resume with the clock they had when Fever started
  for (const [m, p] of st.paused) {
    if (p.sk === m?.skill && p.sk.active && p.sk.activations === p.acts) p.sk.timeLeft = p.timeLeft;
  }
  st.saved.clear();
  st.opened.clear();
  st.paused.clear();
  syncFever(st);
}

// -------------------------------------------------------------------------------------------------------------------
// notes

/** Every note of this unit currently in the air (talent 1 counts them for its penetration stacks). */
function notesOf(battle, unit) {
  const list = battle.projectiles?.list ?? [];
  return list.filter((p) => p.data?.tag === NOTE_TAG && p.source === unit);
}

/** Drop one note from the flight list (the kit owns them; `ProjectileSystem` re-filters every tick). */
function removeNote(battle, p) {
  const list = battle.projectiles?.list;
  const i = list ? list.indexOf(p) : -1;
  if (i >= 0) list.splice(i, 1);
}

/**
 * LOR-Y (无言的约定, `uniequip_002_oblvns`) stage 2 / 3: 「技能期间远程攻击不再降低攻击力」 — while a skill of hers runs,
 * the ranged half of the 领主 trait's 「可以进行远程攻击，但此时攻击力降低至80%」 stops applying (professions.js
 * `lord` `dmgMul`: 1 for a target she blocks or that stands on her tile / the tile ahead, else `profile.rangedScale` =
 * the trait's `atk_scale` = 0.8). Ordinary ATTACKS are unaffected (her profile's `noAttackDamage` makes the note the
 * attack — the ATTACK_CARRIER block), so this is entirely about the notes' cached multiplier.
 *
 * WHY THE TEXT AND NOT A LEVEL. The clause has NO blackboard key: `battle_equip_table` phase 1 carries a single part
 * (`target: TRAIT` — the 攻击范围内存在2名及以上敌人时攻击速度+12 line the engine consumes), and phases 2 / 3 add the
 * TALENT parts, whose sentence exists only in the `TALENT_DATA_ONLY` candidate's `upgradeDescription` — the text
 * `tools/build-data.mjs moduleTalentChanges` turns into `modules[].talentChanges[0]`, which shared/loadoutRecord.js
 * `composeTalents` folds into the resolved record's `talents[0]` (the one every kit call sees as `chess`). PRTS's talent
 * table shows the same sentence on the 精英2 Y模组2级 / 3级 rows only, and stage 1 (no TALENT part at all) does not have
 * it. Reading that sentence therefore IS the "stage ≥ 2" rule, it carries the stage-2 numbers (4 % / 2 % / 12 层) with
 * it, and it stays right if a later stage words or numbers the clause differently — the same "condition lives in the
 * text" route content/traitMods.js takes for this very module's other line.
 */
const LIFT_RANGED_CLAUSE = /技能期间远程攻击不再降低攻击力/;
/**
 * Whether the resolved record's own talents carry that sentence (module-equipped forms only).
 * @param {object} chess the resolved record (the kit's second argument: `def.raw`)
 */
function liftsRangedPenalty(chess) {
  for (const t of chess?.talents ?? []) {
    const text = String(t?.descRaw ?? t?.desc ?? '').replace(/<[^>]*>/g, '').trim();
    if (text && LIFT_RANGED_CLAUSE.test(text)) return true;
  }
  return false;
}

/**
 * 「技能期间」 — the engine's own live-skill state, `unit.skill.active` (skills.js: set by `activate()`, cleared by
 * `end()`; the field snapshot.js publishes as UF.SKILL, battle/queries.js reads for the live targeting override and
 * battle/lifecycle.js reports as `skillActive`). It covers:
 *   * a sustained skill for its whole duration — S2 (the timbre switch the kit runs as a `duration` state for as long as
 *     it is switched on) and S3 (25 s);
 *   * the release of an instant / charges skill — S1: `activate()` sets `active`, runs `onStart` (where the eight-note
 *     fan is played) and ends the skill in the same call, so `lastStart === battle.time` is the release tick itself:
 *     the fan captures it ONCE for all eight notes (they leave S1_STAGGER apart, yet they are one release), and the
 *     ordinary attack the engine performs right after a cast (ai.js `onAboutToAttack` → `performAttack`) is that same
 *     tick.
 * Every activation path lands here, Fever's free releases included (`feverCast` → `sk.activate('fever', …)`), so a
 * Fever-driven cast counts exactly like the engine's own. §17 S2's 「携带此技能时，Y 模组强化后的第一天赋始终将自身视为
 * 技能期间」 is what the sustained switch state already gives: while the timbre is on, S2 IS her running skill.
 */
function skillRunning(battle, unit) {
  const sk = unit?.skill;
  if (!sk || sk.noSkill || sk.kind === 'passive') return false;
  return !!sk.active || sk.lastStart === battle.time;
}

/**
 * The attack multiplier a note carries (PRTS: 所有音符强制使用**缓存攻击力与攻击倍率**). It is the profile's own
 * `dmgMul` — the very rule the ordinary attack of this sub-profession uses (lord: 1 when the target is blocked by her or
 * stands on her tile / the tile in front, otherwise the 未阻挡 ranged `rangedScale`, 0.8 by her trait's blackboard). A
 * note with no target at all (持续攻击 into an empty range) is a ranged attack by definition, so it takes that scale.
 *
 * `liftRanged` (see LIFT_RANGED_CLAUSE / skillRunning) cancels the REDUCTION only: whatever value the profile gives
 * below 1 becomes 1, a melee-range target (already 1) and any larger value are left exactly as the engine computed
 * them. The profile's own `dmgMul` is never touched — it is the shared 领主 rule other operators fight with.
 */
function noteMul(battle, unit, target, liftRanged = false) {
  let mul = NaN;
  const d = unit?.profile?.dmgMul;
  if (target && typeof d === 'function') {
    const m = d(battle, unit, target);
    if (Number.isFinite(m)) mul = m;
  }
  if (!Number.isFinite(mul) && typeof d === 'number' && Number.isFinite(d)) mul = d;
  if (!Number.isFinite(mul)) mul = num(unit?.profile?.rangedScale, 1);
  return liftRanged && mul < 1 ? 1 : mul;
}

/**
 * How far a note may drift before the 消失 rule starts counting: 「音符位于自身攻击范围外时，若连续 `delay` 秒以上不存在
 * 追踪目标则消失」 needs "inside her range" (`inRangeOf` below, the tile the note is over).
 */
function inRangeOf(unit, x, y) {
  const key = Math.round(y) * COLS + Math.round(x);
  const set = unit.rangeKeySet ?? (unit.rangeKeySet = new Set(unit.rangeKeys ?? []));
  return set.has(key);
}

/** The nearest targetable enemy within `r` tiles of a point — the note's own 追踪范围. */
function nearestFoe(battle, unit, x, y, r) {
  let best = null, bd = Infinity;
  for (const e of battle.enemies ?? []) {
    if (!e || !e.alive || e.hidden || !e.deployed) continue;
    if (!canTargetEnemy(unit, e, ANY)) continue;
    const d = bodyDist(e, x, y);   // bodyDist(unit, x, y): distance from the enemy's BODY to the note (body.js)
    if (d <= r && d < bd) { bd = d; best = e; }
  }
  return best;
}

/**
 * TRACK_HEADS_AT_THE_TARGET — what 【追踪移动】 means, and what 转向速度 is (owner's report, 2026-10-08: 「一技能发射的
 * 音符一旦锁定敌人后应该径直冲向敌人，而不是在外部兜圈」).
 *
 * The official rows put BOTH numbers in the same 【追踪移动】策略 sentence (PRTS §17, verbatim): S1 「【追踪移动】策略：
 * 固定 2.2 速度**向目标移动**，转向速度 1/6 每帧」, S2 钢琴 「追踪 = 固定 3.5 速度，转向 1/2 每帧」, S2 风琴 「追踪 =
 * 固定 1.0 速度，转向 1/12 每帧」, S3 「追踪 = 固定 1.3 速度，转向 1/4 每帧」; the talent's two tables carry the same
 * pair per launch type (无目标发射 7/30, 有目标发射 1/6). So 转向速度 belongs to the TRACKING state (it is not the
 * free-movement turn), and the movement it limits is 「向目标移动」 — the note's velocity is aimed at its target.
 *
 * 转向速度 is therefore only the CEILING on how far the note's heading may swing towards the target in one frame, taken as
 * a fraction of the angle still left (`turn`), never a force that keeps the note off its target:
 *
 *   * forward hemisphere (dot(heading, toTarget) > 0): the heading swings by `turn` × θ towards the target, θ being
 *     what is left of the angle. The swing only ever shrinks an angle that is already < 90°, so the radial component
 *     stays positive and the distance to the target STRICTLY DECREASES every frame — no orbit radius exists;
 *   * rear hemisphere (dot ≤ 0): a capped swing would still carry the note AWAY (θ·(1−turn) > 90° for the first
 *     frames), i.e. it would trace a lap around its target — the exact 兜圈 the owner reported, and a stable limit
 *     cycle, not a passing artefact: a note whose heading sits θ off its target turns at `turn·sin θ` per frame, so
 *     it settles at the radius r where `turn·sin θ = trackSpeed·dt / r` (measured before the fix: r ≈ 0.55–0.6 tiles
 *     at S1's 2.2 / 1/6, and the note never came closer while it orbited). Such a heading is set STRAIGHT at the
 *     target instead: 锁定即径直. The cap is about how fast the note may *point* itself at the target, and it may
 *     never be satisfied by pointing away from it.
 *
 * The LOCK itself is sticky: a note that entered 【追踪移动】 never goes back to 【自由移动】 and never picks another
 * enemy; if its target dies / vanishes it keeps its heading and the 「音符位于自身攻击范围外时，若连续 `delay` 秒以上不
 * 存在追踪目标则消失」 rule retires it (the `noneFor` bookkeeping below). A note launched with no target at all
 * (持续攻击 on an empty range) still hunts for itself — 追踪范围半径 `cfg.seekR` — until its first lock.
 *
 * `st` is the note's own state, shared with `onHit`: 【自由移动】 until an update finds a targetable enemy within
 * `cfg.seekR`, then 【追踪移动】 for good. A note in 【自由移动】 either follows the 扩张正弦 curve (cfg.free 'sine') or
 * runs straight along its launch direction (cfg.free 'straight', the talent's aimed set and S1) — it drifts out of her
 * range and, per PRTS 「音符位于自身攻击范围外时，若连续 1 s 以上不存在追踪目标则消失」, is gone `delay` s after it
 * last had a target.
 *
 * S2's piano is the one note with an 【已命中】 state: reaching its target does not end it — it switches to a 0.8-tile
 * collision that keeps flying straight at 3.0 for `hitFor` s (the row's own `attack@passby_delay`), damaging every
 * enemy it sweeps. `strike` is the damage of this note (the ATK it cached at launch); `st.resolved` tells `onHit` the
 * impact was already dealt with.
 *
 * @param {object} cfg a NOTE_* row
 * @param {(e: object) => void} strike deals this note's damage to one enemy
 * @returns {(p: object, dt: number) => boolean} the projectile `steer` hook: true = it is done (→ onHit).
 */
function noteSteer(battle, unit, st, cfg, strike) {
  const freeSpeed = num(cfg.freeSpeed, cfg.trackSpeed);
  const straight = cfg.free === 'straight' || (cfg.straightWhenAimed && st.aimed);
  return (p, dt) => {
    // --- 【已命中】 (S2 钢琴): 激活 0.8 半径的碰撞, 固定 3.0 速度沿当前方向移动, 持续 0.5 s --------------------
    if (st.state === 'hit') {
      st.hitFor += dt;
      p.x += st.vx * cfg.hit.speed * dt;
      p.y += st.vy * cfg.hit.speed * dt;
      for (const e of battle.foesInRadius(p.x, p.y, cfg.hit.radius, true)) {
        if (!e || !e.alive || st.hitSet.has(e)) continue;
        st.hitSet.add(e);
        strike(e);                                   // 穿过敌人: everything the pass catches takes the note's damage
      }
      return st.hitFor >= st.hitFor0;
    }
    st.freeFor = st.state === 'free' ? st.freeFor + dt : 0;
    st.sinceUpdate += dt;
    // --- 每隔 `update` 秒更新行动状态 -------------------------------------------------------------------
    if (st.sinceUpdate >= cfg.update) {
      st.sinceUpdate = 0;
      if (st.state === 'free') {
        if (!st.target || !st.target.alive) st.target = nearestFoe(battle, unit, p.x, p.y, cfg.seekR);
        if (st.target && st.freeFor >= cfg.minFree) st.state = 'track';   // 锁定 (sticky — see the header above)
      } else if (st.target && (!st.target.alive || st.target.hidden)) {
        // 【追踪移动】 with the locked target gone: NOT back to 【自由移动】, and no other enemy is ever picked
        // (the lock is sticky — see the header above): the note keeps its heading and the 「范围外连续 delay 秒不存在
        // 追踪目标」 rule below ends it
        st.target = null;
      }
    }
    // --- 运动 -----------------------------------------------------------------------------------------
    if (st.state === 'track') {
      const step = cfg.trackSpeed * dt;
      if (st.target) {
        // 【追踪移动】: 固定 `trackSpeed` 速度向目标移动 (§17) — the heading IS the direction to the target, and
        // 转向速度 (cfg.turn / cfg.turnFree) is only the ceiling on this frame's swing, a `turn` fraction of the
        // angle that is left. See TRACK_HEADS_AT_THE_TARGET for the two cases and why the rear one is not capped.
        const dx = st.target.x - p.x, dy = st.target.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const ux = dx / d, uy = dy / d;
        const dot = st.vx * ux + st.vy * uy;             // the radial component of the current heading
        if (dot <= 0) {
          st.vx = ux; st.vy = uy;                        // rear hemisphere: 径直, never a lap around the target
        } else {
          const turn = st.aimed ? cfg.turn : num(cfg.turnFree, cfg.turn);
          const cross = st.vx * uy - st.vy * ux;         // the sign of the swing towards the target
          const a = Math.atan2(Math.abs(cross), dot) * turn * (cross < 0 ? -1 : 1);
          const ca = Math.cos(a), sa = Math.sin(a);
          const vx = st.vx * ca - st.vy * sa, vy = st.vx * sa + st.vy * ca;
          const n = Math.hypot(vx, vy) || 1e-6;
          st.vx = vx / n; st.vy = vy / n;
        }
        p.x += st.vx * step;
        p.y += st.vy * step;
        if (d <= Math.max(0.25, step)) {
          if (!cfg.hit) return true;                                     // 命中 (no 【已命中】 state: the note is spent)
          // S2 钢琴: the impact starts the pass — the target takes the damage now, the note flies on for `passby` s
          st.state = 'hit';
          st.hitFor = 0;
          st.hitSet = new Set();
          st.resolved = true;
          if (st.target) { st.hitSet.add(st.target); strike(st.target); }
          return false;
        }
      } else {
        // locked, but its target is gone: it runs on along its heading (no re-steering, no new target) and the
        // 「范围外连续 delay 秒无追踪目标」 rule below retires it
        p.x += st.vx * step;
        p.y += st.vy * step;
      }
    } else if (straight) {
      p.x += st.vx * freeSpeed * dt;                        // 【自由移动】固定速度沿当前方向 (S1 1.7 / 天赋 2.0)
      p.y += st.vy * freeSpeed * dt;
    } else {
      st.u += cfg.sineX * dt;                               // 【自由移动】扩张正弦
      const amp = cfg.sineAmp * Math.min(3, Math.floor(st.u / (2 * Math.PI)) + 1) * st.sign;
      const off = amp * Math.sin(st.u);
      const px = -st.ay, py = st.ax;                        // the curve's perpendicular
      p.x = st.ox + st.ax * st.u + px * off;
      p.y = st.oy + st.ay * st.u + py * off;
    }
    // --- 消失: 位于自身攻击范围外 且 连续 delay 秒没有追踪目标 ------------------------------------------
    if ((st.state === 'track' && st.target) || inRangeOf(unit, p.x, p.y)) st.noneFor = 0;
    else st.noneFor += dt;
    if (st.noneFor >= st.delay) { st.expired = true; return true; }
    return false;
  };
}

/**
 * Fire one note: `scale` × the ATK cached at launch as `type`, times the attack multiplier above, flown by the state
 * machine in `noteSteer`. `target` = the enemy the attack picked (PRTS: 若攻击范围内存在目标，则将选择的目标设置为
 * 音符的追踪目标); without one the note starts with no target at all and hunts for itself — which is what makes
 * 持续攻击 visible on an empty field. `onImpact` runs once, before the first damage, so the landing note can count
 * towards the talent's penetration stacks (PRTS: 命中目标的当个音符可计入音符数量).
 *
 * For her ORDINARY attack this note is not decoration: it is the attack itself. The engine's own arrow deals no
 * damage any more (the ATTACK_CARRIER block below, ai.js `noAttackDamage`), so this note's `strike` is the one damage
 * instance of that attack — and it lands when the note reaches the enemy, not when she plays it.
 *
 * The initial direction is her facing turned by `aim` degrees (S1's fixed fan: 自左 13.125° 至右 13.125°, 间隔 3.75°)
 * or by a random angle inside ±`spread` (PRTS 左 20° 至右 20°, §17 S2/S3 and the talent's own `attack@angle`).
 *
 * The ATK snapshot is the whole point of 「强制使用缓存攻击力与攻击倍率」: `onHit` runs when the note lands, so
 * reading `unit.s.atk` there (as an earlier version did) let a note follow stats it was never fired with.
 *
 * `liftRanged` is the caller's answer to the LOR-Y ≥2 clause for THIS note (see LIFT_RANGED_CLAUSE / skillRunning): the
 * fan of an instant skill passes the one value it captured at the release, everything else asks `skillRunning` at the
 * moment it fires.
 */
function fireNote(battle, unit, { target = null, scale, type, cfg, tag, aim = null, spread = IDLE_ANGLE, delay, passby = 0.5, dmgFlags = null, liftRanged = false, onImpact = null, onDealt = null }) {
  if (target && !target.alive) return null;
  const damage = num(unit.s?.atk) * noteMul(battle, unit, target, liftRanged) * scale;
  const deg = Number.isFinite(aim) ? aim : (battle.rng() * 2 - 1) * num(spread, 0);
  const a = deg * (Math.PI / 180);
  const [dr, dc] = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
  const st = {
    aimed: !!target, state: 'free', target: target && target.alive ? target : null,
    freeFor: 0, sinceUpdate: 0, noneFor: 0, expired: false, sign: battle.rng() < 0.5 ? 1 : -1,
    hitFor: 0, hitFor0: num(passby, 0.5), hitSet: null, resolved: false, delay: num(delay, 1),
    // the launch direction: her facing (unit.fwd, never the ±1 sprite scalar unit.facing) turned by the angle above
    vx: dc * Math.cos(a) + dr * Math.sin(a), vy: dr * Math.cos(a) - dc * Math.sin(a),
    ox: unit.x, oy: unit.y, ax: 0, ay: 0, u: 0,
  };
  st.ax = st.vx; st.ay = st.vy;
  // `strike` deals this note's damage and reports what the engine's own pipeline actually removed (damage.js
  // `dealDamage`: 0 for a dodge, a shield that ate the whole hit, or an invulnerable target). `onDealt` therefore means
  // "this note REACHED an enemy" — the hit itself, not the damage: it fires on the contact whatever the damage
  // pipeline did with it (護盾全吃 / 閃避 / 無敵也算打到人, 沒打到人不加), and it is where a note that IS an attack
  // reports that attack (talent 1's ordinary-attack note and its 持续攻击 note both hand it to the engine's own
  // `onAttackPerformed`). At most once per note, however many enemies S2's piano 【已命中】 pass sweeps: one note is
  // one attack, and an attack recovers its SP once (skills.js:501).
  let landed = false;
  const strike = (e) => {
    if (!e || !e.alive) return 0;
    // `dmgFlags` lets the note that carries an ORDINARY attack mark its damage the way the arrow used to
    // (`isAttack: true` — the flag every 反伤 / 「受到攻击时」 / 盟约追加 hit and the kits' own on-hit effects are
    // gated on, ai.js `resolveHit`; without it her attack would stop being an attack for the rest of the game).
    const dealt = battle.dealDamage(unit, e, { amount: damage, type, isSkill: true, tags: [tag], ...(dmgFlags || {}) });
    if (!landed) { landed = true; if (onDealt) onDealt(e); }   // 击中就加：护盾全吃 / 闪避 / 无敌也算打到人；一只音符只报一次
    return dealt;
  };
  return battle.addProjectile({
    from: unit,
    speed: cfg.trackSpeed,
    visual: 'note',                               // the client draws her notes from `snap.proj` (one sprite per id)
    source: unit,
    maxAge: 30,                                   // a note's own life is the range/no-target rule below, not a clock
    steer: noteSteer(battle, unit, st, cfg, strike),
    data: { tag: NOTE_TAG, hitTag: tag, st },
    onHit: () => {
      if (st.resolved || st.expired || !st.target || !st.target.alive) return;
      if (onImpact) onImpact();
      strike(st.target);
    },
  });
}

/**
 * Re-derive talent 1's penetration from the notes in flight: 每存在一个音符，Ave Mujica 成员无视敌人 3% 防御力和 2% 法术抗性
 * （最多 10 层, `max_cnt`）. `extra` counts a note that is landing right now (PRTS: 丰川祥子命中目标的当个音符可计入音符数量).
 * The mod keys are the engine's own `defIgnorePct` / `resIgnorePct` (buffs.js ADD_KEYS → units.js → damage.js mitigate).
 */
function applyNotePen(battle, unit, cfg, extra = 0) {
  if (!live(unit)) return;
  const n = Math.min(cfg.maxNotes, notesOf(battle, unit).length + extra);
  battle.addBuff(unit, {
    key: 'sakiko:notes',
    duration: 0.35,
    refresh: 'replace',
    source: unit,
    mods: n > 0 ? { defIgnorePct: cfg.defPen * n, resIgnorePct: cfg.resPen * n } : {},
  });
}

/**
 * Her ordinary attack is a NOTE, not a bullet. Official: 攻击会演奏追踪敌人的音符 — a normal attack plays a homing note
 * (天赋一「颂乐音符」), and PRTS 「所有音符强制使用缓存攻击力与攻击倍率」 says what that note carries: the attack's own
 * cached ATK and attack multiplier — i.e. the note IS the normal attack, not a second hit next to it. The engine,
 * however, draws every ranged operator's attack from the profile's projectile — data/backups.json gives her
 * `projectile: 'arrow'` (the build-data default for a ranged operator) and applies that attack's damage where the arrow
 * lands (`resolveHit` on impact, ai.js) — so her attacks used to be TWO damage instances of the same size: the arrow's
 * (ATK × the attack multiplier, ~0.13 s after the attack) and talent 1's own note (`noteMul`, ~0.9 s after it). The
 * talent fires one note per attack and its blackboard carries no damage ratio at all (`delay` /
 * `def_penetrate_ratio` / `magic_resist_penetrate_ratio` / `attack@angle` / `max_cnt`), so the note can only be the
 * carrier of that attack: the arrow is the duplicate.
 *
 * So the arrow goes away as a carrier, not just as a picture — two flags, and the note the kit fires in the 'attack'
 * hook becomes the whole attack:
 *   * `noAttackVis`  — ai.js reports `vis = 'none'` on the 'atk' event, so the client draws neither the arrow nor
 *                      (being a ranged attacker) a melee slash for it (render/fx/projectiles.js). If it reported
 *                      'note', the client would draw a second, made-up note on top of the real one coming from
 *                      `snap.proj`.
 *   * `noAttackDamage` — that arrow applies no damage any more and the attack is no longer completed by the engine
 *                      (`onAttackPerformed`): the note does both, when it reaches the enemy. (The arrow itself still
 *                      flies and its impact still runs everything an impact runs — a skill's `attack.onHit` is what
 *                      S2/S3 hang their own notes on, ai.js `resolveHit` — it is just an invisible, damage-less
 *                      timing anchor now.) 出手不结算，音符攻击到敌人（无论有没有造成伤害）才结算 — the hit is the
 *                      CONTACT, so a shield that ate the whole note, a dodge, an invulnerable target or the killing
 *                      blow all count (fireNote's `onDealt`).
 * Everything else about the attack stays the engine's: target selection (blocked-first, priority, stealth, flying),
 * the cooldown, `beforeAttack` hooks, the 'atk' animation event, the 'attack' hook the note is fired from, the stats
 * and the engage voice line.
 */
const ATTACK_CARRIER = Object.freeze({ noAttackVis: true, noAttackDamage: true });

/** The enemy of `keys` with the highest `key` stat (S3's two tracking notes). */
function extremeIn(battle, unit, keys, key) {
  let best = null, bv = -Infinity;
  for (const e of battle.enemiesInKeys(keys || [], unit, ANY)) {
    if (!canTargetEnemy(unit, e, ANY)) continue;
    const v = num(e.s?.[key]);
    if (v > bv + 1e-9) { bv = v; best = e; }
  }
  return best;
}

export default {
  // 丰川祥子 S1 新月的苏醒 / S2 满月的舞会 / S3 残月的余响: a note per attack (talent 1), the shared Fever gauge
  // (talent 2's +cnt per damage instance, §16), S1's eight-note fan, S2 the sustained timbre state, S3 the widened
  // range with two notes per timbre seeking the highest-DEF / highest-RES enemy. All numbers from `chess` / each
  // skill's own record, so both tiers, both forms and the module stages are the same file.
  char_4182_oblvns: (bb, chess, def) => {
    // `bb` is the SELECTED skill's blackboard, and a 自选 pick chooses any of the three, so every skill below reads its
    // OWN record (`skillRec(chess, id).bb`, the kit's `bbOf`); `bb` is the fallback for a record without them.
    const selId = def?.skill?.id ?? chess?.skill?.skillId ?? null;
    const bbOf = (id) => skillRec(chess, id)?.bb ?? (id === selId ? (bb ?? {}) : {});
    const t0 = talentBb(chess, 0);                                // 颂乐音符 (the form's own numbers: LOR-Y stage 3 = 0.05 / 0.025 / 12)
    const t1 = talentBb(chess, 1);                                // 毋畏遗忘
    const delay = num(t0.delay, 1);                               // 音符飘出攻击范围一段时间后消失
    const defPen = num(t0.def_penetrate_ratio);                   // per note, `max_cnt` notes at most
    const resPen = num(t0.magic_resist_penetrate_ratio);
    const maxNotes = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
    const feverAdd = num(t1.cnt, 1);                              // 毋畏遗忘: +cnt per damage instance
    const auraAspd = num(t1.attack_speed);                        // 攻击范围内干员攻击速度+cnt
    const idleAngle = num(t0['attack@angle'], IDLE_ANGLE);        // the talent's own fan for a note with no target
    const penCfg = { defPen, resPen, maxNotes };                  // talent 1 penetration (applyNotePen)
    const noteScale = num(t0['attack@atk_scale'], 0) > 0 ? num(t0['attack@atk_scale']) : 1;   // the row has none ⇒ 1
    // LOR-Y (无言的约定) stage 2 / 3 only: 「技能期间远程攻击不再降低攻击力」 (LIFT_RANGED_CLAUSE above reads the clause out
    // of this record's own talent sentence, so no module stage is hard-coded here). `liftNow` is the per-note answer —
    // the skill state is the engine's (`skillRunning`).
    const liftModule = liftsRangedPenalty(chess);
    const liftNow = (battle, unit) => liftModule && skillRunning(battle, unit);

    // --- the three skills' own blackboards (a 自选 pick chooses any of them) --------------------------------------
    const b1 = bbOf(S1), b2 = bbOf(S2), b3 = bbOf(S3);
    // S1 fires one note per `atk_scale*` entry of its own blackboard, which IS the data's note count: the row carries
    // atk_scale, atk_scale_2 … atk_scale_8 (the text's 8 notes) and no `attack@max_target` at all — reading that key
    // would silently return its default, so a skill that changed its note count would have kept firing eight.
    const s1Count = Math.max(1, Object.keys(b1).filter((k) => /^atk_scale(_\d+)?$/.test(k)).length);
    const s1Scale = (i) => num(b1[`atk_scale${i === 0 ? '' : '_' + (i + 1)}`], num(b1.atk_scale, 1));
    const s2Atk = num(b2['attack@atk']);                          // 钢琴: 攻击力+
    const s2Aspd = num(b2['attack@attack_speed']);                // 风琴: 攻击速度+ (points, 80 / 110)
    const s3Scale = num(b3['attack@atk_scale'], 1);
    const s3Notes = S3_NOTES_PER_TIMBRE;                          // "各 2 个音符" — no `attack@times` in the row either
    const skillGrid = skillRec(chess, S3)?.rangeGrid ?? def?.skill?.rangeGrid ?? null;   // S3 3-21 while it runs
    // The official row has `duration: -1` / `durationType: NONE` (a switch that lasts until it is switched off), which
    // build-data normalises to 0; the engine then clamps the state to one tick (`Math.max(0.01, this.duration)`) and the
    // note-on-attack below would never run. A timbre switch is a sustained state, so it gets a duration longer than any
    // battle. `Infinity` is not an option (a non-finite spec duration is rejected and falls back to the def's).
    const s2Duration = 9999;
    // [ASSUMED] elite (`_b` slot form) plays 钢琴 (ATK + pass-through), the normal form 风琴 (ASPD). The official lets
    // the player switch freely: WHICH form gets which timbre is ours, the numbers of each branch are the row's own.
    const piano = def?.golden === true || chess?.isGolden === true;
    const noteCfg = piano ? NOTE_S2_PIANO : NOTE_S2_ORGAN;
    const noteType = piano ? 'phys' : 'arts';
    const passby = num(b2['attack@passby_delay'], 0.5);          // S2: 【已命中】持续 0.5 s (the row's own blackboard)

    return {
      // the profile override that makes her attack a note and not an arrow (the ATTACK_CARRIER block below)
      trait: ATTACK_CARRIER,
      skills: {
        // S1 新月的苏醒 — 8 notes, the i-th dealing atk_scale_i × ATK as arts. 「触发技能时以自身朝向为基准，自左 13.125°
        // 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」: the i-th note leaves on the fixed ray `S1_FAN_HALF − 3.75·i`
        // (left first, clockwise to the right). Targets are picked as each note leaves her, so a later note follows the
        // field as it is then; with nothing in range the whole run still plays out (each note flying out and hunting).
        // 可充能 2 次 (`maxChargeTime`) — 「充能至最大层数时自动释放一次」 is the CAP's own extra effect, not a trigger
        // rule, so the kit releases it itself (`chargeCapRelease`, registered in the talent below).
        [S1]: {
          kind: 'charges',
          onStart({ battle, unit }) {
            // 「技能期间」 for the LOR-Y ≥2 clause, captured ONCE for the whole fan: S1 is an instant (charges) skill, so
            // the engine's `active` only spans this synchronous call while the eight notes leave S1_STAGGER apart — they
            // are one release, and every one of them carries the release's multiplier (skillRunning).
            const liftRanged = liftNow(battle, unit);
            for (let i = 0; i < s1Count; i++) {
              const shot = () => {
                if (!unit.alive || !live(unit)) return;
                const cands = (battle.enemiesInKeys(unit.rangeKeys, unit, ANY) || []).filter((e) => canTargetEnemy(unit, e, ANY));
                const list = sortEnemyTargets(battle, unit, cands, unit.profile?.priority ?? null) || [];
                // [ASSUMED] the fan targets successive enemies and wraps; the fan itself is the sourced part
                const t = list.length ? list[i % list.length] : null;
                fireNote(battle, unit, { target: t, scale: s1Scale(i), type: 'arts', cfg: NOTE_S1, tag: 'skill', aim: S1_FAN_HALF - i * S1_FAN_STEP, delay, liftRanged, onImpact: () => applyNotePen(battle, unit, penCfg, 1) });
              };
              if (i === 0) shot();
              else battle.after(i * S1_STAGGER, shot, { owner: unit });
            }
          },
        },
        // S2 满月的舞会 — one timbre for the whole cast (see the header: the timbre is a free switch with no data behind
        // it). 「【Fever】状態中は現在の音色による2連撃」: 攻击.onHit fires the timbre's notes, twice inside Fever.
        [S2]: {
          kind: 'duration',
          duration: s2Duration,
          mods: piano ? { atkPct: s2Atk } : { aspd: s2Aspd },
          attack: {
            onHit({ battle, unit: u, target }) {
              if (!target) return;
              const shots = inFever(battle, u) ? 2 : 1;             // 【Fever】状態中は現在の音色による2連撃
              for (let i = 0; i < shots; i++) {
                fireNote(battle, u, { target, scale: 1, type: noteType, cfg: noteCfg, tag: 'skill', spread: NOTE_SPREAD, delay, passby, liftRanged: liftNow(battle, u), onImpact: () => applyNotePen(battle, u, penCfg, 1) });
              }
            },
          },
        },
        // S3 残月的余响 — the skill range while it runs, and per attack 钢琴 + 风琴 each playing "各 2 个音符": one
        // physical note at the highest-DEF enemy of the range and one arts note at the highest-RES one (falling back to
        // the ordinary attack's target). `unit.rangeKeys` IS the skill range while this skill runs (`targeting` below).
        [S3]: {
          kind: 'duration',
          ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
          attack: {
            onHit({ battle, unit: u, target }) {
              if (!target) return;
              const keys = u.rangeKeys;
              const byDef = extremeIn(battle, u, keys, 'def') ?? target;
              const byRes = extremeIn(battle, u, keys, 'res') ?? target;
              for (let i = 0; i < s3Notes; i++) {
                fireNote(battle, u, { target: byDef, scale: s3Scale, type: 'phys', cfg: NOTE_S3, tag: 'skill', spread: NOTE_SPREAD, delay, liftRanged: liftNow(battle, u), onImpact: () => applyNotePen(battle, u, penCfg, 1) });
                fireNote(battle, u, { target: byRes, scale: s3Scale, type: 'arts', cfg: NOTE_S3, tag: 'skill', spread: NOTE_SPREAD, delay, liftRanged: liftNow(battle, u), onImpact: () => applyNotePen(battle, u, penCfg, 1) });
              }
            },
          },
        },
      },
      talents: [
        // 颂乐音符 — an attack plays a homing note; while notes are in flight she ignores DEF / RES; the notes carry the
        // Fever state machine (§16) and S3's 免死.
        { install(battle, unit) {
          const impact = () => applyNotePen(battle, unit, penCfg, 1);   // PRTS: 命中目标的当个音符可计入音符数量
          // Every copy of her on this team joins the ONE Fever record: they share the gauge, any of them can start the
          // state, and the state then covers all of them (kamigame 「キャラ全員で共有」).
          feverState(battle, unit).members.add(unit);

          // S2 is her 切换类技能, and §16/§17 give it three rules that all have to be decided BEFORE the switch happens
          // — so the runtime's own `activate` is guarded (non-enumerable: never serialised). Every activation path goes
          // through it, the engine's own automatic cast included (「自动释放始终不改变技能为手动触发的本质」).
          //   * 「Fever 期间，此技能无法手动开启」                              → refused while the state runs
          //   * 「可以触发 Fever 时，触发技能将仅触发 Fever，不进行技能形态切换」  → a full gauge turns the cast into Fever
          //   * Fever never opens it either («切换类技能除外», feverCast skips it)
          // The frozen `sk.toggle` marker lets feverCast recognise the switch skill without hard-coding the id there.
          const ownSkill = unit.skill;
          // S1's 充能 cap (`chargeCapRelease` above): 「充能至最大层数时自动释放一次」. Registered in TWO places, because
          // the SP that reaches the cap can arrive in either half of a step and the release has to beat the engine's own
          // cast to it: the `tick` hook (after the projectiles — where one of her notes LANDING pays her attack SP) fires
          // it the moment the cap is reached, and the member timer below runs before the allies phase of the next step,
          // so the operation can never cast at the cap first (that cast would be an operation's, and §17's exception is
          // about the CAP's own release — see the skillStart handler below).
          if (ownSkill && ownSkill.kind === 'charges' && ownSkill.maxCharges > 1) {
            battle.on('tick', () => { chargeCapRelease(battle, unit); }, { owner: unit });
          }
          if (ownSkill && ownSkill.id === S2 && !Object.prototype.hasOwnProperty.call(ownSkill, 'activate')) {
            const activate = ownSkill.activate;
            Object.defineProperty(ownSkill, 'toggle', { configurable: true, writable: true, enumerable: false, value: true });
            Object.defineProperty(ownSkill, 'activate', {
              configurable: true, writable: true, enumerable: false,
              value(reason, opts) {
                if (reason === 'fever') return false;
                const st = feverState(battle, unit);
                if (st.left > 0) return false;
                if (live(unit) && st.gauge >= FEVER_MAX) { enterFever(battle, unit); return false; }
                return activate.call(this, reason, opts);
              },
            });
          }

          // the engine's `attack` payload is { attacker, targets, isSkill } (server/sim/ai.js performAttack) — one
          // attack, one talent note (PRTS 天赋一: 攻击会演奏追踪敌人的音符).
          //
          // This is where her ordinary attack is DELIVERED: the arrow carries nothing any more (ATTACK_CARRIER below),
          // so this note is the attack — one attack, one note, its damage and its 攻击回复技力 both settled by the
          // note's own landing (`onDealt`). The engine's SP for the attack is gone with the arrow (ai.js skips
          // `onAttackPerformed` for a `noAttackDamage` profile), so nothing is counted twice: `onDealt` fires at most
          // once per note (fireNote's `landed`), on the CONTACT whatever the damage pipeline made of it.
          battle.on('attack', (ctx) => {
            if (ctx.attacker !== unit || !unit.alive) return;
            const t = (ctx.targets ?? [])[0];
            if (!t || !t.alive) return;
            unit.mem.sakikoLastNoteAt = battle.time;   // the 持续攻击 timer below defers to a real attack
            fireNote(battle, unit, {
              target: t, scale: noteScale, type: 'arts', cfg: NOTE_TALENT, tag: 'talent', spread: idleAngle, delay,
              liftRanged: liftNow(battle, unit),   // LOR-Y ≥2: a note launched while one of her skills runs carries the full multiplier
              dmgFlags: { isAttack: true, isSkill: !!ctx.isSkill },   // 这是她的一次普通攻击（技能期间的照抄引擎给的 isSkill）
              onImpact: impact,
              onDealt: (e) => { if (live(unit)) unit.skill?.onAttackPerformed?.([e], !!ctx.isSkill); },
            });
          }, { owner: unit });

          // 自身退场时，清除所有不处于【追踪移动】状态的音符 (PRTS 天赋备注, last line of the movement notes) — and the
          // same departure satisfies S3's 免死 clause 「期间触发过此免死效果的单位将在 Fever 结束时 / 自身退场时退场」:
          // a member the state kept alive leaves as a 退场 (FORCED_EXIT), never as a plain retreat, whether Fever runs
          // out or she goes first.
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            for (const p of notesOf(battle, unit)) if (p.data?.st?.state !== 'track') removeNote(battle, p);
            const st = feverState(battle, unit);
            if (st.left > 0 && st.saved.has(unit) && ctx.reason !== FORCED_EXIT) unit.removeReason = FORCED_EXIT;
          }, { owner: unit });

          // 毋畏遗忘 "对敌人造成伤害时使 Fever +cnt" — the gauge that feeds the Fever state (see the header).
          battle.on('damaged', (ctx) => {
            if (ctx.source !== unit) return;
            addFever(battle, unit, feverAdd);   // the ONE team gauge: any copy's damage fills it for all of them
          }, { owner: unit });

          battle.every(0.1, () => {
            // --- Fever: the marker, the suspended auto-cast, and the state's own (free) releases ------------------
            // Real time, whether she stands on the field or not (a retreat inside the window must not freeze the
            // countdown, and the `persist` marker must not outlive it on a unit that is gone). The COUNTDOWN itself
            // lives in the shared record (`st.clock`, one tick per step for the whole team); here each member joins,
            // holds and auto-casts.
            const st = feverState(battle, unit);
            if (st.left > 0) {
              if (live(unit)) {
                if (!unit.findBuff?.('sakiko:fever')) joinFever(battle, st, unit, unit, true);  // (re)deployed mid-window
                else holdAutoCast(st, unit);                                                   // …or already marked
                feverCast(battle, unit, st);   // 「无视技力限制地持续尝试开启技能」, and these casts 不消耗技力
              }
            } else if (unit.findBuff?.('sakiko:fever')) {
              battle.removeBuff(unit, 'sakiko:fever');   // a marker left by an earlier window (or by a bug): never keep it
              releaseAutoCast(st, unit);
            }

            if (!live(unit)) return;
            chargeCapRelease(battle, unit);   // 「充能至最大层数时自动释放一次」, before this step's attack can be cast instead
            applyNotePen(battle, unit, penCfg);

            // --- 持续攻击: she attacks on her own cadence even with nothing in range (PRTS 术语「持续攻击」:
            // 「无论攻击范围内是否有攻击目标，都会持续进行攻击」). The engine only fires `attack` when it has a
            // target, so the empty-range case is driven here: one note per base attack interval, aimed out along her
            // facing. PRTS: 攻击范围内不存在敌人时，若自身朝向的前方一格地块的通行类型为无，持续攻击无法发射音符 —
            // so only 「通行类型为无」 blocks: out of bounds / `pass === 'NONE'`, and a tile that is walkable terrain
            // but carries an obstacle. A FLY-only tile (深水区 / 沟壑: flyPassable, not walkable) is NOT 「无」 and does
            // not stop her — the guard used to require `walkable`, which left her silent forever once she faced one.
            // The tile comes from frontOf(unit.tileR, unit.tileC, unit.dir), the engine's own 前方一格 (dir.js).
            //
            // PRTS: 「攻击时，若攻击范围内存在目标，则将选择的目标设置为音符的追踪目标并发射音符；否则发射的音符初始
            // 不存在追踪目标」 — the drifting note belongs to an EMPTY range. Deciding it by "time since the last attack"
            // alone would slip one out between two attacks whenever her interval ran a hair longer than the timer.
            const bat = Math.max(0.2, num(unit.s?.interval, num(unit.s?.bat, 1.3)));
            const since = battle.time - num(unit.mem.sakikoLastNoteAt, -Infinity);
            const foes = battle.enemiesInKeys(unit.rangeKeys, unit, ANY) || [];
            if (since >= bat - 1e-6 && !foes.some((e) => canTargetEnemy(unit, e, ANY))) {
              const g = battle.grid;
              const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
              const terrainWalk = g ? g.walkable(fr, fc, true) : true;      // 忽略障碍的地形可走性
              const hardBlocked = terrainWalk && !g.walkable(fr, fc);        // 地形能走却被障碍物挡住
              const aheadOk = !g || (g.flyPassable(fr, fc) && !hardBlocked);
              if (aheadOk) {
                // No target at all: the note starts in 【自由移动】 (扩张正弦 drift) and hunts for itself, which is what
                // makes 持续攻击 visible on an empty field — it lives until it leaves her range without a target for `delay`.
                //
                // 空转 ≠ 空放: with nothing in range the engine never performs an attack, so this note IS her attack for
                // this cycle. It cannot pay at launch (it has no target yet): `onDealt` fires the moment it REACHES an
                // enemy — a note that drifts off and expires pays nothing — through the engine's own attack-completion
                // entry (`spType: 'attack'` ⇒ +1 per attack, 阻回 and the "no SP for a skill's attacks" rule included).
                // The AIMED note of a real attack pays through the very same hook (the 'attack' listener above): since
                // the engine stopped completing a `noAttackDamage` attack itself, every one of her attacks is paid
                // exactly once, by the note that carries it, at the instant that note touches someone.
                fireNote(battle, unit, {
                  scale: noteScale, type: 'arts', cfg: NOTE_TALENT, spread: idleAngle, tag: 'talent', delay,
                  liftRanged: liftNow(battle, unit),   // LOR-Y ≥2: this note is an attack of hers like any other
                  onImpact: impact,
                  dmgFlags: { isAttack: true, isSkill: false },   // 同样是她的一次普通攻击（只是引擎没替她发起）
                  onDealt: (e) => { if (live(unit)) unit.skill?.onAttackPerformed?.([e], false); },
                });
                unit.mem.sakikoLastNoteAt = battle.time;
                if (battle.hasHook?.('attack')) battle.emit('attack', { attacker: unit, targets: [], isSkill: false });
              }
            }
          }, { owner: unit });

          // Fever is triggered by a skill activation made while the TEAM gauge is FULL (「Fever累计至450点时，任意一位 Ave
          // Mujica 成员手动触发技能后」 — and this mode casts skills automatically, so ANY activation counts, not only a
          // manual press; §17's one exception is S1's cap release below). Whoever casts it, every member of that player enters.
          battle.on('skillStart', (ctx) => {
            if (ctx.unit !== unit || ctx.reason === 'fever') return;   // Fever's own releases never re-trigger it
            // §17 S1: 「因充能到达上限自动释放时，不会触发 Fever。不论是因 Fever 还是因满充能，自动释放始终不改变技能为
            // 手动触发的本质」 — the release the charge cap ITSELF causes (chargeCapRelease) is the one activation that stays
            // out. Everything else counts, the engine's own automatic cast (this mode's 自动作战, the stand-in for the
            // manual press the official 备注 asks for) and a manual press alike: the old charge-STATE test could not tell
            // 「the cap released it」 from 「the operation pressed while the charges happened to be full」, and at any real
            // 攻速 (4 attacks per charge faster than the operation's 3 s cooldown, i.e. an attack interval under 0.75 s /
            // ASPD ≳ 173 — her own talent aura +16 and module +12 plus one 攻速 item already cross it) that swallowed EVERY
            // release and left S1 unable to trigger Fever at all — see 12-sakiko.md §16/§17.
            if (ctx.reason === CHARGE_FULL) return;
            if (feverState(battle, unit).gauge < FEVER_MAX) return;    // 蓄满（450）才可触发
            enterFever(battle, unit);
          }, { owner: unit });

          // S3 【Fever】状態中、味方【Ave Mujica】が致命的なダメージを受けてもHPは1以下にならず、
          // 【Fever】終了後に強制退場 — she is an Ave Mujica member herself, so this covers her (and every copy).
          // §17: 「优先级 −3000」 — a last-resort protection: the engine runs `fatal` handlers by descending priority,
          // so every other protection gets its say first and this one only saves what is left.
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented || !inFever(battle, unit)) return;
            ctx.prevented = true;
            feverState(battle, unit).saved.add(unit);
            unit.mem.sakikoSaved = true;
            unit.hp = Math.max(1, unit.hp);
          }, { owner: unit, priority: -3000 });
        } },
        // 毋畏遗忘 — attack-speed aura over her range. The 「其他 Ave Mujica 成员的攻击范围…视作攻击范围的延伸」 clause is NOT
        // implemented, by the owner's decision of 2026-10-08 (the current behaviour is the intended one): a second copy of
        // her would satisfy its condition (another Ave Mujica member whose range overlaps hers), so "nobody to extend to"
        // is not the reason — the extension itself is out of scope.
        { install(battle, unit) {
          if (!auraAspd) return;
          battle.every(0.5, () => {
            if (!live(unit)) return;
            for (const a of battle.alliesInGrid(unit)) {
              if (!live(a)) continue;
              battle.addBuff(a, { key: 'sakiko:aura:aspd', mods: { aspd: auraAspd }, source: unit, duration: 0.75, refresh: 'replace' });
            }
          }, { owner: unit });
        } },
      ],
    };
  },
};
