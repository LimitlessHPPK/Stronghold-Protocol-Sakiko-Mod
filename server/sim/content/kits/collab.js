// server/sim/content/kits/collab.js — hand-authored kit for 丰川祥子 (chess_char_6_21), the Ave Mujica
// collaboration operator added locally by tools/inject-sakiko.mjs.
//
// She is not in the official activity_table's chess roster, so everything here is written from her own
// official rows (character_table.json / skill_table.json — quoted in docs/research/12-sakiko.md) plus the
// mode conventions of a tier-6 领主. Numbers come from the blackboards at the chess's level (normal Lv4 /
// elite Lv7) exactly like tier1..6; the few values that exist only in the skill TEXT or are not in the data
// at all are marked [ASSUMED] below.
//
// Simplifications (one line each):
//  - Fever IS implemented to the official notes (12-sakiko.md §16): talent 2 fills the TEAM gauge (0–450), ANY skill
//    activation at a FULL gauge starts it — this mode casts skills automatically, so a manual press is not required —
//    and every one of her copies on that team is in it for 20 s. During it SP stops accumulating, the engine's own
//    automatic casts are suspended and only Fever's own releases fire; those cost no SP («不消耗技力»), the switch
//    skill is excluded («切换类技能除外», hers is S2), S2 double-attacks, S3's lethal protection keeps her at 1 HP
//    with a forced exit when it ends. She is a member of Ave Mujica herself, so every "味方【Ave Mujica】" clause
//    applies to her — there is simply no OTHER member in this mode.
//  - The only part of Fever still inert is the range-union clause of talent 2: "其他 Ave Mujica 成员的攻击范围若与
//    自身原本攻击范围重合，则将其视作攻击范围的延伸" needs another mujica operator on the board to extend the
//    range of. Nothing to union with.
//  - talent 1 「颂乐音符」: "可以持续攻击" has no engine counterpart (normal attacks already keep firing);
//    "攻击会演奏追踪敌人的音符" IS her ordinary attack: one attack = ONE note, carrying that attack's own damage
//    (ATK × the profile's attack multiplier, PRTS 「所有音符强制使用缓存攻击力与攻击倍率」), settled when the note
//    reaches the enemy — not at the launch (see `fireNote` / the ATTACK_CARRIER block below). It is not an extra hit:
//    the engine's own arrow no longer deals anything (`noAttackDamage`), so the note is the attack and not a second
//    damage instance, and its damage carries the arrow's own flags (`isAttack: true`, `isSkill` from the attack) so
//    反伤 / 「受到攻击时」 / the on-hit kits still see an attack. The notes also grant the DEF/RES penetration while
//    they are in flight (to herself — she is the only mujica member). The penetration is the engine's `defIgnorePct` /
//    `resIgnorePct` (buffs.js ADD_KEYS; `defPen`/`resPen` are not mod keys and read as nothing).
//  - PRTS 「所有音符强制使用缓存攻击力与攻击倍率」 IS implemented: `fireNote` snapshots ATK × the profile's own
//    `dmgMul` at launch (lord: 阻挡或贴身 ⇒ 1, otherwise the 未阻挡 ranged 0.8 of professions.js), so a note does
//    not follow a buff that lands while it flies, and a ranged attack's note is scaled like that attack.
//  - 音符的飞行按 PRTS 的逐技能参数表实现（12-sakiko.md §17）: 【自由移动】(扩张正弦或固定速度) →【追踪移动】,
//    更新间隔 / 最短自由移动时间 / 追踪半径 / 追踪速度 / 转向速度每个技能一行, S2 的钢琴还有【已命中】态
//    (0.8 半径碰撞、3.0 速度、0.5 s) —— 见 NOTE_* 行与 noteSteer()。她的其他音符没有【已命中】状态, 命中即消失。
//  - talent 2's attack-speed aura covers "攻击范围内干员" (every operator in her range).
//  - S1 「可充能2次，充能至最大层数时自动释放一次」: modelled as `kind: 'charges'` with its two charges (the
//    engine's charge skill), which is the same shape 塑心 uses; the auto-release of the last charge is left to
//    the ordinary DEFAULT trigger.
//  - S2 「可以切换钢琴/风琴音色」 has no toggle UI in this mode, so the skill uses ONE timbre for its whole
//    cast: the elite uses 钢琴 (ATK, the pass-through timbre), the normal chess uses 风琴 (ASPD) — [ASSUMED] pick,
//    chosen so both halves of the text are reachable. Official lets the player switch freely, so WHICH tier gets
//    which timbre is ours, not the data's (the numbers of each branch are the row's own Lv4/Lv7 blackboards).
//  - S3 "分别追踪法术抗性和防御力最高的敌人": two notes per attack — one at the highest-RES, one at the
//    highest-DEF enemy of the SKILL range (`unit.rangeKeys` while the skill's `targeting.rangeGrid` is applied).
//  - §17's S2 clause 「携带此技能时，Y 模组强化后的第一天赋始终将自身视为技能期间」 is inert: talent 1 has no
//    "技能期间" branch in this kit (its only module clause is the LOR-Y attack-speed one, which the whole engine
//    ignores — AGENTS.md §8), and S2 runs as a sustained state anyway.
import { sortEnemyTargets, canTargetEnemy } from '../../targeting.js';
import { bodyDist } from '../../body.js';
import { frontOf } from '../../dir.js';
import { COLS, FORCED_EXIT } from '../../constants.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const tbb = (def, i) => (def && def.talents && def.talents[i] && def.talents[i].bb) || {};
const live = (u) => !!u && u.alive && u.deployed && !u.removed && !u.hidden;
const isElite = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
const ANY = Object.freeze({ canHitFly: true });
const NOTE_TAG = 'sakiko:note';
// ---- the official note flight (PRTS 「音符的移动逻辑」+ 12-sakiko.md §17 的逐技能参数表) ------------------------
// 【自由移动】→【追踪移动】(→【已命中】: S2's piano only). Every skill has its OWN row — the talent's two sets
// (无目标 / 有目标, PRTS 天赋备注) and then one per skill (PRTS 技能备注, quoted in 12-sakiko.md §17):
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
// `free: 'sine'` = the 扩张正弦 curve (基础振幅 sineAmp, x 速度 sineX — PRTS 特殊机制: 以当前位置为原点、当前方向为
// +x 轴, sin 或 −sin（各 50 %）, 第 n 周期的振幅 = 基础振幅 × n（n ≤ 3）), `free: 'straight'` = a fixed speed along
// the current direction. The talent's own aimed set moves straight instead of drifting (`straightWhenAimed`).
const NOTE_TALENT = Object.freeze({
  update: 0.4, minFree: 0.1, seekR: 1.0, trackSpeed: 2.0, turn: 1 / 6, turnFree: 7 / 30,
  free: 'sine', straightWhenAimed: true, sineAmp: 0.3, sineX: 1.3,
});
/** S1 新月的苏醒: 更新 0.2 s, 最短自由移动 0.6 s, 【自由移动】固定 1.7 向当前方向, 追踪 1.0 / 2.2 / 转向 1/6. */
const NOTE_S1 = Object.freeze({ update: 0.2, minFree: 0.6, seekR: 1.0, trackSpeed: 2.2, freeSpeed: 1.7, turn: 1 / 6, free: 'straight' });
/** S2 满月的舞会 · 钢琴: … + 【已命中】= 0.8 半径碰撞, 固定 3.0 速度沿当前方向移动 (`hitFor` = `attack@passby_delay`). */
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
/** Fallback for the talent's own `attack@angle`: the fan a talent note's initial direction is drawn from (左 20° 至 右 20°). */
const IDLE_ANGLE = 20;
/** S3 残月的余响: "各 2 个音符" — the row has no `attack@times` blackboard, so this is the skill text's own count. */
const S3_NOTES_PER_TIMBRE = 2;
// S1 新月的苏醒: 「触发技能时以自身朝向为基准，自左 13.125° 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」— the
// eight notes leave in a fixed fan (13.125 − 3.75·i for i = 0…7), NOT the random ±15° the kit used to draw from the
// row's own `angle` blackboard. Left first, sweeping clockwise to the right.
const S1_FAN_HALF = 13.125;
const S1_FAN_STEP = 3.75;
/** [ASSUMED] the gap between S1's notes: the row carries no timing, the text only says 演奏出8个音符 (先后顺序 is the
 *  owner's report — the eight used to leave in the same tick, which read as one blob). */
const S1_STAGGER = 0.1;

// -------------------------------------------------------------------------------------------------------------------
// Fever — the Ave Mujica collaboration's TEAM gauge. The authoritative wording is the owner's official note
// (12-sakiko.md §16, 2026-10-07), which supersedes the earlier kamigame summary:
//
//   > Fever累计至450点时，任意一位 Ave Mujica 成员手动触发技能后，在场所有 Ave Mujica 成员 20 秒内会持续释放当前技能
//   > ※Fever 值…该进度所有成员共享，在整场战斗中保留
//   > ※Fever 状态期间：耗尽且不累积 Fever 值…所有受影响成员将无视技力限制地持续尝试开启技能（切换类技能除外），
//   >   且通过此方法开启技能时不消耗技力；通过 Fever 状态开启的持续类技能将在 Fever 状态结束时强制结束；
//   >   进入 Fever 状态前正在释放的持续类技能暂停计时，直至 Fever 状态结束
//
// What that means here, line by line:
//   * the gauge runs 0–450 and only a FULL gauge can trigger (450, not the old 50 %);
//   * this mode casts skills automatically, so ANY skill activation at a full gauge triggers Fever — not only a
//     manual press (the one exception is S1's charge-full auto release, §17). Inside the state the gauge is spent
//     (0) and does not accumulate;
//   * ONE gauge per player: every copy of her on the same team reads and fills the SAME number («所有成员共享»), and
//     ANY one of them triggering puts **all** of them in for 20 s («在场所有 Ave Mujica 成员»);
//   * SP stops accumulating (the marker buff carries the engine's own `noSp` flag — 阻回 semantics) and the engine's
//     own automatic casts are suspended; the only releases inside the state are Fever's, they are FREE (`activate`'s
//     `free` option: no charge, no SP — «不消耗技力»), and the switch skill (S2, see the header) is excluded;
//   * a sustained skill that was running when Fever started has its clock FROZEN until Fever ends; one Fever opened
//     is ended when Fever ends;
//   * the state is per BATTLE and that is the owner's ruling on 「整场战斗中保留」 (12-sakiko.md §16, 2026-10-07):
//     「是一回合内，每回合从 0 开始，并且协助队友的时候也要重新积累」 — a round is one `Battle` and a 联防 assist is
//     another one, so keying the record by the battle instance gives exactly that: every new `Battle` starts at 0
//     and never inherits the previous one (see the FEVER_STATES WeakMap below).
//
// In this mode she is the only mujica operator, so "all Ave Mujica characters" means "all her copies on that team".
// The state's own effects are hers (and every copy's):
//   * S3 【Fever】状態中、味方【Ave Mujica】が致命的なダメージを受けてもHPは1以下にならず、Fever終了後に強制退場
//     (the Japanese client wording; the CN text says only 不撤退) → survive lethal damage at 1 HP, forced out at the end.
//   * S2 【Fever】状態中は現在の音色による2連撃になる → her S2 notes fire twice.
const FEVER_MAX = 450;                              // 「Fever累计至450点时」— the gauge, and the trigger, are points, not %
const FEVER_SEC = 20;                               // [sourced 20 s] 官方备注
/**
 * [ASSUMED 观感] Seconds between two Fever-driven releases of one member's skill — the owner's "一技能在 Fever 里
 * 持续释放的频次要加快一些，但不用太快" (2026-10-08).
 *
 * §16 only says 「无视技力限制地持续尝试开启技能」 and the official notes carry no interval, so the pace is ours.
 * It used to be the engine's own automatic-operation cooldown — `activate()` starts `opReadyAt = time +
 * AUTO_OP_COOLDOWN` for a MANUAL skill and `feverCast` refuses a release while `sk.opCooling` — which is
 * **3 s** (constants.js AUTO_OP_COOLDOWN, PRTS 卫戍协议/帮助「自动操作具有3s冷却」). That is the cooldown of a
 * PLAYER's automatic operation, i.e. "how often may auto-battle press this button", and it is deliberately
 * conservative: the engine also applies it to the ordinary automatic cast of every operator in the mode. Fever is
 * the opposite situation — an explicitly free, licence-free stream of casts the official text describes as
 * 持续 — so reusing it made her 20 s window contain only 6 releases (measured, see the tests below).
 *
 * Half of it: **1.5 s**, i.e. 13 releases in the 20 s window (measured) — a visibly continuous stream, still an
 * obvious beat between two casts rather than the one-per-kit-tick that 「持续尝试」 would literally allow (that
 * variant was measured too: 201 releases, ~0.6 s of wall clock between two of them at 2× speed, which reads as one
 * blob and buries S1's eight-note fan under the next fan). 1.5 s sits between the engine's 3 s and the 0.7 s her
 * S1's own eight-note volley takes to play out, so two volleys never overlap completely. Nothing else about Fever
 * changes: the release is still free, still every member, still ended when the state ends.
 */
const FEVER_CAST_GAP = 1.5;
/** The bar the client draws is still 0–100 (`mem.gauges.fever` → `snap.fever`), so the gauge is reported as a share. */
const FEVER_PCT = 100 / FEVER_MAX;
/** The marker every member wears while the state runs (the client turns the SP bar 玫红色 and the icon active). */
const FEVER_BUFF = Object.freeze({ key: 'sakiko:fever', visible: true, persist: true, flags: { noSp: true }, data: { label: 'Fever' } });

/**
 * Per-battle, per-player Fever record. 「每回合从 0 开始，并且协助队友的时候也要重新积累」 (owner's ruling, §16): a
 * round runs one `Battle`, a 联防 assist runs another, so a WeakMap keyed by the battle instance IS the whole
 * lifetime — a new battle (new round, or the battle she is called into) has no record at all and starts at 0, while
 * inside one battle every copy of her keeps reading the same one.
 * `paused` = the sustained skills whose clock Fever freezes (unit → { sk, timeLeft, acts }), `opened` = the sustained
 * skills Fever itself started (ended when Fever ends), `hold` = the auto-cast rules suspended for the window.
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

/** The value the client bar shows: the gauge while charging, the remaining Fever time while the state runs (100 → 0). */
const feverPct = (st) => (st.left > 0 ? Math.round((st.left / FEVER_SEC) * 100) : Math.round(st.gauge * FEVER_PCT));
const inFever = (battle, unit) => feverState(battle, unit).left > 0;

/** Push the shared value onto every member (the bar reads `mem.gauges.fever` through Battle.snapshot's `snap.fever`). */
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
 * Suspend the engine's own automatic cast of a member's skill for the Fever window («禁止常规自动发动»: the state's
 * own releases are the only ones). `'NEVER'` is the engine's own "never auto-cast: the kit calls skill.activate()
 * itself" rule (skills.js:89, checked by tick / onAboutToAttack / onDamaged), so no engine change is needed — the
 * original rule is put back when Fever ends.
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
 * 不消耗技力」. `activate(reason, { free: true })` is the engine's free activation — it skips the ready / charge
 * check and spends nothing. The pace is this kit's own FEVER_CAST_GAP (see the constant: the engine would apply its
 * 3 s automatic-operation cooldown here, which is too slow for 持续释放), so "持续尝试" reads as a steady stream
 * rather than one release per tick — or per button press. The switch skill is marked at install (`sk.toggle`) and
 * stays out; a sustained skill Fever started is remembered so it can be ended with the state.
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
 * Enter Fever for FEVER_SEC s, for EVERY member of that player (idempotent: a cast inside the window only refreshes
 * the countdown). Whoever triggers it, the whole team gets the state and the marker.
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
      // 「进入 Fever 状态前正在释放的持续类技能暂停计时」: hand the frozen clock back BEFORE the skills tick this
      // step (the scheduled phase runs before the allies phase), so the timer never advances while Fever runs.
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
  // keyed passive so the client draws it (addBuff refuses a dead / undeployed unit, hence the caller's `live` guard)
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
 * The cleanup touches every member and is unconditional, because a Fever window can outlive a member's presence on the
 * field: the marker is `persist` (Battle._remove keeps it through a retreat) and `mem` survives a redeploy, so a Fever
 * a member was retreated or knocked down inside used to leave a visible Fever buff on the field for the rest of the
 * match. `Battle.removeBuff` only checks that the unit exists, and `retreat` itself refuses a unit that is not alive.
 */
function endFever(battle, st) {
  st.left = 0;
  for (const m of st.members) {
    battle.removeBuff(m, 'sakiko:fever');
    releaseAutoCast(st, m);
    if (st.saved.has(m)) {
      // 強制退場 / FORCED_EXIT is the engine's "withdrawn, not knocked out" reason (constants.js:171, 联防 uses it)
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

/** Every note of this unit currently in the air (talent 1 counts them for its penetration stacks). */
function notesOf(battle, unit) {
  const list = battle.projectiles?.list ?? [];
  return list.filter((p) => p.data?.tag === NOTE_TAG && p.source === unit);
}

/**
 * The attack multiplier a note carries (PRTS: 所有音符强制使用**缓存攻击力与攻击倍率**). It is the profile's own
 * `dmgMul` — the very rule the ordinary attack of this sub-profession uses (lord: 1 when the target is blocked by her
 * or stands on her tile / the tile in front, otherwise the 未阻挡 ranged `rangedScale`, 0.8 by her trait's blackboard).
 * A note with no target at all (持续攻击 into an empty range) is a ranged attack by definition, so it takes that scale.
 */
function noteMul(battle, unit, target) {
  const d = unit?.profile?.dmgMul;
  if (target && typeof d === 'function') {
    const m = d(battle, unit, target);
    if (Number.isFinite(m)) return m;
  }
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  return num(unit?.profile?.rangedScale, 1);
}

/** Is (x, y) on a tile of `unit`'s current range? (range keys are `row * COLS + col`, Battle._refreshRange.) */
function inRangeOf(unit, x, y) {
  const key = Math.round(y) * COLS + Math.round(x);
  const set = unit.rangeKeySet ?? (unit.rangeKeySet = new Set(unit.rangeKeys ?? []));
  return set.has(key);
}

/** The nearest enemy (of those she may target) within `r` tiles of a point — the note's own 追踪范围. */
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

/** Drop one note from the flight list (the kit owns them; `ProjectileSystem` re-filters every tick). */
function removeNote(battle, p) {
  const list = battle.projectiles?.list;
  const i = list ? list.indexOf(p) : -1;
  if (i >= 0) list.splice(i, 1);
}

/**
 * Re-derive talent 1's penetration from the notes in flight: 每存在一个音符，Ave Mujica 成员无视敌人 3% 防御力和
 * 2% 法术抗性（最多 10 层, `max_cnt`）. `extra` counts a note that is landing right now (PRTS: 丰川祥子命中目标的当个
 * 音符可计入音符数量). The mod keys are the engine's own `defIgnorePct` / `resIgnorePct` (buffs.js ADD_KEYS →
 * units.js → damage.js mitigate) — `defPen` / `resPen` are read by nothing, so writing those left the whole talent at 0.
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
 * The official flight of one note (the per-skill parameter rows are tabulated at the NOTE_* constants).
 *
 * `st` is the note's own state, shared with `onHit`: 【自由移动】 until an update finds a targetable enemy within
 * `cfg.seekR`, then 【追踪移动】. The direction only ever turns towards the target (转向速度 is a per-frame weight:
 * `dir = dir·(1−turn) + toTarget·turn`), which is what makes the tracking visible. A note in 【自由移动】 either
 * follows the 扩张正弦 curve (cfg.free 'sine') or runs straight along its launch direction (cfg.free 'straight', the
 * talent's aimed set and S1) — it drifts out of her range and, per PRTS 「音符位于自身攻击范围外时，若连续 1 s 以上
 * 不存在追踪目标则消失」, is gone `delay` s after it last had a target.
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
        if (st.target && st.freeFor >= cfg.minFree) st.state = 'track';
      } else if (!st.target || !st.target.alive || st.target.hidden) {
        // 【追踪移动】: the target is gone — back to 【自由移动】 along the current direction
        st.target = null;
        st.state = 'free';
        st.freeFor = 0;
        st.ox = p.x; st.oy = p.y; st.ax = st.vx; st.ay = st.vy; st.u = 0;
      }
    }
    // --- 运动 -----------------------------------------------------------------------------------------
    if (st.state === 'track') {
      const dx = st.target.x - p.x, dy = st.target.y - p.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const turn = st.aimed ? cfg.turn : num(cfg.turnFree, cfg.turn);
      st.vx = st.vx * (1 - turn) + (dx / d) * turn;
      st.vy = st.vy * (1 - turn) + (dy / d) * turn;
      const n = Math.hypot(st.vx, st.vy) || 1e-6;
      st.vx /= n; st.vy /= n;
      const step = cfg.trackSpeed * dt;
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
    if (st.state === 'track' || inRangeOf(unit, p.x, p.y)) st.noneFor = 0;
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
 * or by a random angle inside ±`spread` (PRTS 左 20° 至 右 20°, §17 S2/S3 and the talent's own `attack@angle`).
 *
 * The ATK snapshot is the whole point of 「强制使用缓存攻击力与攻击倍率」: `onHit` runs when the note lands, so
 * reading `unit.s.atk` there (as this used to) let a note follow stats it was never fired with.
 */
function fireNote(battle, unit, { target = null, scale, type, cfg = NOTE_TALENT, tag = 'talent', aim = null, spread = IDLE_ANGLE, delay, passby = 0.5, dmgFlags = null, onImpact = null, onDealt = null }) {
  if (target && !target.alive) return null;
  const damage = num(unit.s?.atk) * noteMul(battle, unit, target) * scale;
  const deg = Number.isFinite(aim) ? aim : (battle.rng() * 2 - 1) * num(spread, 0);
  const a = deg * (Math.PI / 180);
  const [dr, dc] = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
  const st = {
    aimed: !!target, state: 'free', target: target && target.alive ? target : null,
    freeFor: 0, sinceUpdate: 0, noneFor: 0, expired: false, sign: battle.rng() < 0.5 ? 1 : -1,
    hitFor: 0, hitFor0: num(passby, 0.5), hitSet: null, resolved: false, delay: num(delay, 1),
    // the initial direction: her facing (unit.fwd) turned by the aim/spread angle above
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
    // (`isAttack: true` — the flag every 反伤 / 「受到攻击时」/ 盟约追加 hit and the kits' own on-hit effects are
    // gated on, ai.js `resolveHit`; without it her attack would stop being an attack for the rest of the game).
    const dealt = battle.dealDamage(unit, e, { amount: damage, type, isSkill: true, tags: [tag], ...(dmgFlags || {}) });
    if (!landed) { landed = true; if (onDealt) onDealt(e); }   // 击中就加：护盾全吃 / 闪避 / 无敌也算打到人；一只音符只报一次
    return dealt;
  };
  return battle.addProjectile({
    from: unit,
    speed: cfg.trackSpeed,
    visual: 'note',
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
 * Her ordinary attack is a NOTE, not a bullet. Official: 攻击会演奏追踪敌人的音符 — a normal attack plays a homing
 * note (天赋一「颂乐音符」), and PRTS 「所有音符强制使用缓存攻击力与攻击倍率」 says what that note carries: the
 * attack's own cached ATK and attack multiplier — i.e. the note IS the normal attack, not a second hit next to it.
 * The engine, however, draws every ranged operator's attack from the profile's projectile — `data/chess.json` gives
 * her `projectile: 'arrow'` (the build-data default for a ranged chess) and applies that attack's damage where the
 * arrow lands (`resolveHit` on impact, ai.js) — so her attacks used to be TWO damage instances of the same size:
 * the arrow's (ATK × the attack multiplier, ~0.13 s after the attack) and talent 1's own note (`noteMul`, ~0.9 s
 * after it). The talent fires one note per attack and its blackboard carries no damage ratio at all
 * (`delay` / `def_penetrate_ratio` / `magic_resist_penetrate_ratio` / `attack@angle` / `max_cnt`), so the note can
 * only be the carrier of that attack: the arrow is the duplicate.
 *
 * So the arrow goes away as a carrier, not just as a picture — two flags, and the note the kit fires in the 'attack'
 * hook becomes the whole attack:
 *   * `noAttackVis`  — ai.js reports `vis = 'none'` on the 'atk' event, so the client draws neither the arrow nor
 *                      (being a ranged attacker) a melee slash for it (render/fx.js). If it reported 'note', the
 *                      client would draw a second, made-up note on top of the real one coming from `snap.proj`.
 *   * `noAttackDamage` — that arrow applies no damage any more and the attack is no longer completed by the engine
 *                      (`onAttackPerformed`): the note does both, when it reaches the enemy. (The arrow itself still
 *                      flies and its impact still runs everything an impact runs — a skill's `attack.onHit` is what
 *                      S2/S3 hang their own notes on, ai.js `resolveHit` — it is just an invisible, damage-less
 *                      timing anchor now.) That is the owner's rule of 2026-10-08: 出手不结算，
 *                      音符攻击到敌人（无论有没有造成伤害）才结算 — the hit is the CONTACT, so a shield that ate the
 *                      whole note, a dodge, an invulnerable target or the killing blow all count (collab.js
 *                      `fireNote.onDealt`).
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

export function sakiko(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1);
  const delay = num(t0.delay, 1);                              // 音符飘出攻击范围一段时间后消失
  const defPen = num(t0.def_penetrate_ratio);                  // per note, 10 notes max
  const resPen = num(t0.magic_resist_penetrate_ratio);
  const maxNotes = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
  const feverAdd = num(t1.cnt, 1);                             // 毋畏遗忘: +cnt per damage instance
  const auraAspd = num(t1.attack_speed);                       // 攻击范围内干员攻击速度+cnt
  const elite = chess?.status?.phase === 2 && !!chess?.module?.active || chess?.isGolden === true;
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;

  // --- skill blackboards -------------------------------------------------------------------------
  const s1Scale = (i) => num(bb[`atk_scale${i === 0 ? '' : '_' + (i + 1)}`], num(bb.atk_scale, 1));
  // S1 fires one note per `atk_scale*` entry of its own blackboard, which IS the data's note count: the row carries
  // atk_scale, atk_scale_2 … atk_scale_8 (the text's 8 notes) and has no `attack@max_target` at all — reading that key
  // silently returned its default, so a skill that changed its note count would have kept firing eight.
  const s1Count = Math.max(1, Object.keys(bb).filter((k) => /^atk_scale(_\d+)?$/.test(k)).length);
  const s2Atk = num(bb['attack@atk']);
  const s2Aspd = num(bb['attack@attack_speed']);
  const s3Scale = num(bb['attack@atk_scale'], 1);
  const s3Notes = S3_NOTES_PER_TIMBRE;                          // "各 2 个音符" — no `attack@times` in the row either
  const idleAngle = num(t0['attack@angle'], IDLE_ANGLE);        // the talent's own fan for a note with no target
  const penCfg = { defPen, resPen, maxNotes };                   // talent 1 penetration (applyNotePen)

  const piano = elite; // [ASSUMED] elite plays 钢琴 (ATK + pass-through), normal plays 风琴 (ASPD) — see header
  // §17: each timbre has its own note parameter row (speeds included), so nothing scales a shared base any more.
  const noteCfg = piano ? NOTE_S2_PIANO : NOTE_S2_ORGAN;
  const noteType = piano ? 'phys' : 'arts';
  const passby = num(bb['attack@passby_delay'], 0.5);            // S2: 【已命中】持续 0.5 s (the row's own blackboard)
  const skId = (n) => `skchr_oblvns_${n}`;

  return {
    // the profile override that makes her attack a note and not an arrow (ATTACK_CARRIER above)
    trait: ATTACK_CARRIER,
    skill: {
      // default = S3 残月的余响
      kind: 'duration',
      mods: {},
      // The skill's own range for its duration (`Battle._refreshRange` rotates `rangeGrid` itself — building absolute
      // keys here would bake in tile numbers from before she was deployed).
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      attack: {
        onHit({ battle, unit, target }) {
          if (!target) return;
          // `unit.rangeKeys` IS the skill range while this skill runs: the targeting above switched it. The old
          // `grid || unit.rangeKeys` never fell through — `grid` was an empty ARRAY (truthy), so both notes lost their
          // highest-DEF / highest-RES target and every S3 cast hit the ordinary attack target twice.
          const keys = unit.rangeKeys;
          // one physical note at the highest-DEF enemy, one arts note at the highest-RES one
          const byDef = extremeIn(battle, unit, keys, 'def') ?? target;
          const byRes = extremeIn(battle, unit, keys, 'res') ?? target;
          for (let i = 0; i < s3Notes; i++) {
            fireNote(battle, unit, { target: byDef, scale: s3Scale, type: 'phys', cfg: NOTE_S3, spread: NOTE_SPREAD, tag: 'skill', delay, onImpact: () => applyNotePen(battle, unit, penCfg, 1) });
            fireNote(battle, unit, { target: byRes, scale: s3Scale, type: 'arts', cfg: NOTE_S3, spread: NOTE_SPREAD, tag: 'skill', delay, onImpact: () => applyNotePen(battle, unit, penCfg, 1) });
          }
        },
      },
    },
    skills: {
      // S1 新月的苏醒 — 8 notes, the i-th dealing atk_scale_i × ATK as arts. 「触发技能时以自身朝向为基准，自左 13.125°
      // 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）」: the i-th note leaves on the fixed ray `S1_FAN_HALF − 3.75·i`
      // (left first, clockwise to the right) — NOT the row's `angle` blackboard (15°), which the kit used to draw a
      // random direction from. 演奏出8个音符: the eight leave one after another (`S1_STAGGER`). Targets are picked at the
      // moment each note leaves her, so a note fired later follows the field as it is then, and with nothing in range
      // the whole run still plays out (each note flying straight 1.7 out of her range, then hunting on its own).
      [skId(1)]: {
        kind: 'charges',
        onStart({ battle, unit }) {
          for (let i = 0; i < s1Count; i++) {
            const shot = () => {
              if (!unit.alive || !live(unit)) return;
              const cands = (battle.enemiesInKeys(unit.rangeKeys, unit, ANY) || []).filter((e) => canTargetEnemy(unit, e, ANY));
              const list = sortEnemyTargets(battle, unit, cands, unit.profile?.targetPriority ?? null) || [];
              // [ASSUMED] the fan targets successive enemies and wraps, as this kit always did; the fan itself is the change
              const t = list.length ? list[i % list.length] : null;
              fireNote(battle, unit, { target: t, scale: s1Scale(i), type: 'arts', cfg: NOTE_S1, tag: 'skill', delay, aim: S1_FAN_HALF - i * S1_FAN_STEP, onImpact: () => applyNotePen(battle, unit, penCfg, 1) });
            };
            if (i === 0) shot();
            else battle.after(i * S1_STAGGER, shot, { owner: unit });
          }
        },
      },
      // S2 满月的舞会 — one timbre for the whole cast (see header). 【Fever】状態中は現在の音色による2連撃。
      //
      // The official row has `duration: -1` / `durationType: NONE` (a toggle that lasts until it is switched
      // off), which build-data normalises to 0; the engine then clamps the state to one tick (skills.js:432,
      // `Math.max(0.01, this.duration)`) and the note-on-attack below would never run. `Infinity` is not an
      // option either — skills.js:74 rejects a non-finite spec duration and falls back to the def's. A timbre
      // switch is a sustained state, so it gets a large finite duration (longer than any battle).
      //
      // It is also the 切换类技能 §16/§17 exclude from Fever: it is never opened by Fever and cannot be opened
      // inside the state, and a cast at a full gauge only triggers Fever without switching the timbre. All three
      // live in the `activate` guard talent 1 installs (the only interception point before the switch happens).
      [skId(2)]: {
        kind: 'duration',
        duration: 9999,
        mods: piano ? { atkPct: s2Atk } : { aspd: s2Aspd },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target) return;
            const shots = inFever(battle, unit) ? 2 : 1; // 【Fever】状態中は現在の音色による2連撃
            for (let i = 0; i < shots; i++) {
              fireNote(battle, unit, { target, scale: 1, type: noteType, cfg: noteCfg, spread: NOTE_SPREAD, tag: 'skill', delay, passby, onImpact: () => applyNotePen(battle, unit, penCfg, 1) });
            }
          },
        },
      },
    },
    talents: [
      // 颂乐音符 — an attack plays a homing note; while notes are in flight she ignores DEF/RES
      { install(battle, unit) {
        const noteAtk = num(t0['attack@atk_scale']);
        const noteScale = noteAtk > 0 ? noteAtk : 1;
        const impact = () => applyNotePen(battle, unit, penCfg, 1);   // PRTS: 命中目标的当个音符可计入音符数量
        // Every copy of her on this team joins the ONE Fever record: they share the gauge, any of them can start the
        // state, and the state then covers all of them (kamigame 「キャラ全員で共有」).
        feverState(battle, unit).members.add(unit);

        // S2 is her 切换类技能, and §16/§17 give it three rules that all have to be decided BEFORE the switch happens
        // — so the runtime's own `activate` is guarded (the idiom tier2.js 莎草 uses; non-enumerable: never
        // serialised). Every activation path goes through it, the engine's own automatic cast included (an automatic
        // cast is still a skill use: 「自动释放始终不改变技能为手动触发的本质」).
        //   * 「Fever 期间，此技能无法手动开启」                              → refused while the state runs
        //   * 「可以触发 Fever 时，触发技能将仅触发 Fever，不进行技能形态切换」  → a full gauge turns the cast into Fever
        //   * Fever never opens it either («切换类技能除外», feverCast skips it)
        // The frozen `sk.toggle` marker lets feverCast recognise the switch skill without hard-coding the id there.
        const ownSkill = unit.skill;
        // §17 S1: 「因充能到达上限自动释放时，不会触发 Fever」 — the release the *charge cap* causes is the exception, so
        // the one thing that has to be known before the cast is whether the charge was already at max (the engine's own
        // `wasFull`, skills.js:443). The wrapper reads it while the charge is still there; the skillStart handler below
        // decides. `maxCharges > 1` because the mechanic only exists for a 可充能X次 skill (S1 is 2).
        if (ownSkill && ownSkill.kind === 'charges' && ownSkill.maxCharges > 1 && !Object.prototype.hasOwnProperty.call(ownSkill, 'activate')) {
          const activate = ownSkill.activate;
          Object.defineProperty(ownSkill, 'activate', {
            configurable: true, writable: true, enumerable: false,
            value(reason, opts) { ownSkill.chargeFull = this.charges >= this.maxCharges; return activate.call(this, reason, opts); },
          });
        }
        if (ownSkill && ownSkill.id === skId(2) && !Object.prototype.hasOwnProperty.call(ownSkill, 'activate')) {
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
        // the engine's `attack` payload is { attacker, targets, isSkill } (server/sim/ai.js:188)
        //
        // This is where her ordinary attack is DELIVERED: the arrow is gone from the engine's side (ATTACK_CARRIER),
        // so this note is the attack — one attack, one note, its damage and its 攻击回复技力 both settled by the
        // note's own landing (`onDealt` below), exactly like the 持续攻击 note further down. The engine's SP for the
        // attack is gone with the arrow (ai.js `onAttackPerformed` is skipped for a `noAttackDamage` profile), so
        // nothing is counted twice: `onDealt` fires at most once per note (fireNote's `landed`).
        battle.on('attack', (ctx) => {
          if (ctx.attacker !== unit || !unit.alive) return;
          const t = (ctx.targets ?? [])[0];
          if (!t || !t.alive) return;
          unit.mem.sakikoLastNoteAt = battle.time;   // the 持续攻击 timer below defers to a real attack
          fireNote(battle, unit, {
            target: t, scale: noteScale, type: 'arts', cfg: NOTE_TALENT, spread: idleAngle, tag: 'talent', delay,
            // 这是她的普通攻击：伤害按引擎自己的判据打成「一次攻击」（`isAttack`，技能期间的攻击照抄引擎给的 isSkill）
            dmgFlags: { isAttack: true, isSkill: !!ctx.isSkill },
            onImpact: impact,
            // 击中就加，且只看「碰到」不看伤害量：护盾全吃 / 闪避 / 无敌也算这只音符打到了人（`strike` 先结算伤害，
            // 无论结算出多少都报这一只音符的命中）。`isSkill` 照抄引擎给这次攻击的判定，别把技能期间的攻击算成攻击回复。
            onDealt: (e) => { if (live(unit)) unit.skill?.onAttackPerformed?.([e], !!ctx.isSkill); },
          });
        }, { owner: unit });

        // 自身退场时，清除所有不处于【追踪移动】状态的音符 (PRTS 天赋备注, last line of the movement notes) — and the
        // same departure satisfies S3's 免死 clause 「期间触发过此免死效果的单位将在 Fever 结束时 / 自身退场时退场」:
        // a member the state kept alive leaves as a 退场 (FORCED_EXIT), never as a plain retreat, whether Fever runs
        // out or she goes first. (§17's «自身退场时» is ambiguous — 12-sakiko.md §17 records that reading: the mark
        // makes her departure a forced exit; what it must not do is leave her on the field or un-marked.)
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

        // The penetration depends on how many notes are up, so it is re-derived on a timer. `addBuff` refuses
        // a dead/undeployed unit (Battle.js:1228), and install() runs before she is deployed, so the buff is
        // (re)applied from the timer rather than once at install time. The mod keys are the engine's own
        // `defIgnorePct` / `resIgnorePct` (buffs.js ADD_KEYS → units.js → damage.js mitigate): `defPen` / `resPen`
        // are read by nothing, so talent 1's whole penetration was silently 0 while the buff itself showed up.
        battle.every(0.1, () => {
          // --- Fever: the marker, the suspended auto-cast, and the state's own (free) releases ------------
          // Real time, whether she stands on the field or not. A retreat inside the window (an item, 联防, another
          // kit) used to freeze the countdown at the `!live` guard below and, because the marker is `persist` and
          // `mem` survives a redeploy, leave the visible Fever buff on a unit that was no longer there. The COUNTDOWN
          // itself lives in the shared record (`st.clock`, one tick per step for the whole team — N copies must not
          // tick it N times); here each member joins, holds and auto-casts.
          const st = feverState(battle, unit);
          if (st.left > 0) {
            if (live(unit)) {
              if (!unit.findBuff?.('sakiko:fever')) joinFever(battle, st, unit, unit, true);  // (re)deployed mid-window
              else holdAutoCast(st, unit);                                                  // …or already marked
              feverCast(battle, unit, st);   // 「无视技力限制地持续尝试开启技能」, and these casts 不消耗技力
            }
          } else if (unit.findBuff?.('sakiko:fever')) {
            battle.removeBuff(unit, 'sakiko:fever');   // a marker left by an earlier window (or by a bug): never keep it
            releaseAutoCast(st, unit);
          }

          if (!live(unit)) return;
          applyNotePen(battle, unit, penCfg);

          // --- 持续攻击: she attacks on her own cadence even with nothing in range (PRTS 术语「持续攻击」:
          // 「无论攻击范围内是否有攻击目标，都会持续进行攻击」). The engine only fires `attack` when it has a
          // target, so the empty-range case is driven here: one note per base attack interval, aimed out along
          // her facing. PRTS: 攻击范围内不存在敌人时，若自身朝向的前方一格地块的通行类型为无，持续攻击无法
          // 发射音符 — so the tile straight ahead must be passable AND free of obstacles. That tile comes from
          // frontOf(unit.tileR, unit.tileC, unit.dir), the engine's own 前方一格 (dir.js; professions.js uses the very
          // same call for the lord's melee rule); the old expression added +1 to x for EVERY facing, because
          // `unit.facing` is the ±1 sprite-flip scalar and never 0.
          //
          // PRTS: 「攻击时，若攻击范围内存在目标，则将选择的目标设置为音符的追踪目标并发射音符；否则发射的音符初始
          // 不存在追踪目标」 — the drifting note belongs to an EMPTY range. Deciding it by "time since the last attack"
          // alone slipped one out between two attacks whenever her interval ran a hair longer than the timer (an ASPD
          // slow, or plain rounding), i.e. the drift the user saw with enemies standing right in front of her.
          const bat = Math.max(0.2, num(unit.s?.interval, num(unit.s?.bat, 1.3)));
          const since = battle.time - num(unit.mem.sakikoLastNoteAt, -Infinity);
          const foes = battle.enemiesInKeys(unit.rangeKeys, unit, ANY) || [];
          if (since >= bat - 1e-6 && !foes.some((e) => canTargetEnemy(unit, e, ANY))) {
            const g = battle.grid;
            const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
            // PRTS 只说「通行类型为**无**」才不能发射，而 `walkable()` 还要求 `pass === 'ALL'`（只走不飞）——
            // 于是"只能飞过"的地块（深水区/沟壑，`pass === 'FLY'`）也被当成"无"，她一旦朝它就**永久停火**
            // （所有者 2026-10-08：「没敌人有概率不会持续攻击，两只只有一只会持续攻击」——她打完目标后的朝向由最后
            // 的目标决定，两只朝向不同）。现在按原文只挡「无」，**障碍物仍然挡**（既有测试就是这么挡的）：
            //   flyPassable=false        → 通行类型为无 / 越界 → 挡
            //   能走但 walkable=false    → 有障碍物/工事 → 挡（`walkable(r,c,true)` 忽略障碍，两者不等即说明有障碍）
            //   只能飞（pass==='FLY'）   → 不是"无" → 放行
            const terrainWalk = g ? g.walkable(fr, fc, true) : true;      // 忽略障碍的地形可走性
            const hardBlocked = terrainWalk && !g.walkable(fr, fc);        // 地形能走却被障碍物挡住
            const aheadOk = !g || (g.flyPassable(fr, fc) && !hardBlocked);
            if (aheadOk) {
              // No target at all: the note starts in 【自由移动】 (扩张正弦 drift) and hunts for itself, which is what
              // makes 持续攻击 visible on an empty field — it lives until it leaves her range without a target for `delay`.
              //
              // 空转 ≠ 空放: with nothing in range the engine never performs an attack (ai.js:84 returns before
              // `performAttack`), so this note IS her attack for this cycle — and it was the one attack of hers that
              // recovered no SP at all (owner's report 2026-10-08: 「空转也就是敌人不在范围内祥子打出去的音符伤害到敌人
              // 时…没有把他计算到 1 技能的技能条里」; S1 is 攻击回复 — `spType: 'attack'`, 4 SP per charge).
              //
              // It cannot pay at launch: the note has no target yet, so "did this attack land" is only known where it
              // lands. `onDealt` fires the moment it REACHES an enemy (a note that drifts off and expires pays
              // nothing), and the gain goes through the engine's own attack-completion entry — the one every attack's
              // SP comes from (skills.js:479 → skills.js:501, `spType: 'attack'` ⇒ gainSp(1, 'attack')): the amount,
              // 阻回, the charge/cost rules and the "attacks made by a skill recover no SP" rule (skills.js:484) all
              // stay the engine's, and no number is written here. `isSkill: false` = it is her ordinary attack. The
              // AIMED note of a real attack pays through the very same hook (the 'attack' listener above) — since the
              // engine stopped completing a `noAttackDamage` attack itself, every one of her attacks is paid exactly
              // once, by the note that carries it, at the instant that note touches someone.
              fireNote(battle, unit, {
                scale: noteScale, type: 'arts', cfg: NOTE_TALENT, spread: idleAngle, tag: 'talent', delay, onImpact: impact,
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
        // manual press; §17's one exception is S1 below). Whoever casts it, every member of that player enters the state.
        battle.on('skillStart', (ctx) => {
          if (ctx.unit !== unit || ctx.reason === 'fever') return;   // Fever's own releases never re-trigger it
          const sk = unit.skill;
          // §17 S1: 「因充能到达上限自动释放时，不会触发 Fever。不论是因 Fever 还是因满充能，自动释放始终不改变技能为
          // 手动触发的本质」 — only the release the charge cap itself causes stays out (the flag the wrapper above left);
          // every OTHER automatic cast is this mode's own 自动作战 and does trigger Fever, and a manual press always does.
          if (sk?.kind === 'charges' && sk.chargeFull && ctx.reason !== 'manual') return;
          if (feverState(battle, unit).gauge < FEVER_MAX) return;    // 蓄满（450）才可触发
          enterFever(battle, unit);
        }, { owner: unit });

        // S3 【Fever】状態中、味方【Ave Mujica】が致命的なダメージを受けてもHPは1以下にならず、
        // 【Fever】終了後に強制退場 — she is an Ave Mujica member herself, so this covers her (and every copy).
        // §17: 「优先级 −3000」 — a last-resort protection: the engine runs `fatal` handlers by descending priority
        // (Battle.js:588), so every other protection gets its say first and this one only saves what is left.
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || !inFever(battle, unit)) return;
          ctx.prevented = true;
          feverState(battle, unit).saved.add(unit);
          unit.mem.sakikoSaved = true;
          unit.hp = Math.max(1, unit.hp);
        }, { owner: unit, priority: -3000 });
      } },
      // 毋畏遗忘 — attack-speed aura over her range (the mujica range-union clause is inert)
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
}

export default { chess_char_6_21_a: sakiko };
