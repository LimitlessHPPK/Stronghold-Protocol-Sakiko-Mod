# 加入丰川祥子（char_4182_oblvns）调研结论

> 状态：**已实现**。本文记录事实与出处。她先在 0.1.4 的 server/sim/content/kits/collab.js 里实现（该树的测试
> 是 	est/content/kits_collab_sakiko.test.js），随后按 0.2.0 的自选（DIY）契约移植到本树的
> server/sim/content/kits/ops/op-oblvns.js：注册键是 charId、三个技能都写在 skills 里、每个数字都读 chess / 各技能
> 自己的记录，所以一个文件同时服务 tier5/tier6、普通/精锐与各种模组档。客户端的音符精灵与 Fever 图标见
> public/js/render/fx/notes.js 与 public/js/render/units.js FEVER_ICON。

## 1. 身份确认

| 项 | 值 | 出处 |
|---|---|---|
| 干员 ID | `char_4182_oblvns` | character_table.json |
| 中文名 / 英文名 | 丰川祥子 / Togawa Sakiko | character_table.json |
| 联动代号 | Oblivionis | 维基 `char_v3/char_4182_oblvns.md`、PRTS 剧情槽位 `avg_4182_oblvns`、信物 `p_char_4182_oblvns` |
| 归属 | `teamId: mujica`，`displayNumber: AM01` | character_table.json |
| 稀有度 / 职业 | TIER_6 / WARRIOR·`lord`（领主） | character_table.json |

## 2. 官方数值（Lv90 / 精英2）

```
maxHp 2056   atk 725   def 425   res 10
cost 20      blockCnt 2   baseAttackTime 1.3   respawnTime 70
attackSpeed 100   moveSpeed 1.0   部署位 MELEE
```

`lord` 职业特性：`atk_scale 0.8`（非近战时攻击力 ×0.8）。

## 3. 天赋

**颂乐音符**（PHASE_2）：可以持续攻击（`<$ba.permanentatk>`）且攻击会演奏追踪敌人的音符，
音符飘出攻击范围一段时间后消失。每存在一个音符，Ave Mujica 成员无视敌人 **3% 防御力和 2% 法术抗性**
（最多 10 层）。

```
bb: delay 1.0 · def_penetrate_ratio 0.03 · magic_resist_penetrate_ratio 0.02
    attack@angle 20.0 · max_cnt 10.0
```

**LOR-Y「无言的约定」强化后的第一天赋**（PRTS 天赋表：只有**精英2 Y模组2级 / 3级**的行多出末句，
base 精英2 与 1 级都没有；已实现，见 §5.4）：

> …每存在一个音符，Ave Mujica 成员无视敌人 **4%**（2 级）/ **5%**（3 级）的防御力和 **2% / 2.5%** 法术抗性
> （最多可叠加 **12** 层）；**技能期间远程攻击不再降低攻击力**

最后那句**没有黑盒键**：`battle_equip_table uniequip_002_oblvns` 的 1 级只有一个 `TRAIT` 部件，2 / 3 级才多出
`TALENT` 部件，而句子只在 `TALENT_DATA_ONLY` 候选的 `upgradeDescription` 里（→ `modules[].talentChanges[0]` →
解析后的 `talents[0].descRaw`）。kit 就是按这句话判定，不是按等级写死（`op-oblvns.js` `LIFT_RANGED_CLAUSE`）。

**毋畏遗忘**（PHASE_2）：对敌人造成伤害时使 Fever **+3**；其他 Ave Mujica 成员的攻击范围若与自身
原本攻击范围重合，则将其视作攻击范围的延伸；攻击范围内干员攻击速度 **+12**（满潜 +16）。

```
bb: enable 1.0 · attack_speed 12.0 · cnt 3.0
```

## 4. 技能（Lv7 = 精锐档，Lv4 = 普通档，与项目取值一致）

| 技能 | Lv4 | Lv7 | SP | 时长 | 范围 |
|---|---|---|---|---|---|
| **S1 新月的苏醒** | 8 个音符，法术伤害从 65% 递减到 4% | 从 80% 递减到 4% | 4 | — | — |
| **S2 满月的舞会** | 钢琴：攻击力 +60%、音符穿过敌人造成物理；风琴：攻速 +80、音符法术且减速 | 钢琴 +75% / 风琴 +110 | 5 | — | — |
| **S3 残月的余响** | 范围扩大，钢琴+风琴同时演奏，各 2 个音符，物理/法术各相当于攻击力 155%，分别追踪法术抗性最高与防御力最高的敌人 | 180% | 46 (init 30) | 25s | `3-21` |

- S1：「可充能 2 次，充能至最大层数时自动释放一次」
- S2/S3：「**Fever 期间**变为当前音色的二连击」/「**Fever 期间** Ave Mujica 成员受到致命伤害时不撤退，Fever 结束后退场」

## 5. Fever 机制（已实现，含出处）

提到 Fever 的干员**全部属于 `teamId: mujica`**：

| 干员 | ID | 职业 |
|---|---|---|
| **丰川祥子** | `char_4182_oblvns` | WARRIOR·lord |
| 祐天寺若麦 | `char_4185_amoris` | WARRIOR·hammer |
| 三角初华 | `char_4184_dolris` | SUPPORT·bard |
| 八幡海铃 | `char_4186_tmoris` | SPECIAL·stalker |
| 若叶睦 | `char_4183_mortis` | SPECIAL·dollkeeper |

### 5.1 机制细节（出处：[kamigame 豊川祥子](https://kamigame.jp/arknights/page/408700805026176761.html)，2026/08 更新）

> **Fever値は『Ave Mujica』専用の効果**だ。キャラ全員で共有し、『Ave Mujica』のコラボキャラのみが獲得・
> 使用可能。**Fever値が50%に達している状態でコラボキャラのいずれかのスキルを手動発動すると、
> 『Ave Mujica』のキャラ全員が20秒間スキルを自動発動**するようになる。

即：**攒到 50 %，手动发动任意联动干员的技能 → 全队进入 Fever 20 秒，期间技能自动发动**。
天赋「毋畏遗忘」每次造成伤害 +3 就是唯一的充能来源。

### 5.2 她是成员，所以这些效果属于她自己（所有者确认）

日文客户端 S3 原文：

> 【Fever】状態中、味方【Ave Mujica】が**致命的なダメージを受けてもHPは1以下にならず**、
> 【Fever】状態終了後に**強制退場**

「味方【Ave Mujica】」包含她自己——她本身就是 Ave Mujica 成员。CN 文案只写「不撤退」，
日文写得更明确：**HP 不会降到 1 以下**，Fever 结束后强制退场。

**已实现**（`server/sim/content/kits/collab.js`）：天赋二充能 → 手动发动且 ≥50 % 进入 Fever 20 秒
（挂可见 buff `sakiko:fever`）→ 期间自动发动手动技能 / S2 二连击 / S3 致命伤害保命至 1 HP
→ Fever 结束以 `FORCED_EXIT`（强制退场）离场。实测：

```
manual at 10 %:  inFever = false                      ← 低于阈值不进入
manual at 100 %: inFever = true  buff = true  left = 20
lethal during Fever: alive = true  hp = 1  saved = true
after Fever ended:   reason = forcedExit
auto-cast (S1, 充能型): activations 1 → 6, 全部 reason = "fever"
```

### 5.3 持续攻击与音符（PRTS 补全，2026-10-06）

出处：[PRTS 丰川祥子](https://prts.wiki/w/%E4%B8%B0%E5%B7%9D%E7%A5%A5%E5%AD%90) 天赋备注。

**持续攻击**（术语）：**无论攻击范围内是否有攻击目标，都会持续进行攻击**。
引擎只在有目标时才发 `attack` 事件，所以空范围的情形由 kit 自己的计时器驱动：
每个基础攻击间隔（`unit.s.bat`，1.3 s）沿朝向发射一个音符。

- PRTS：「攻击范围内不存在敌人时，若自身朝向的**前方一格**地块的**通行类型为无**，持续攻击无法发射音符」
  → 守卫为「**通行类型为无**才挡」（`!grid.flyPassable(fr, fc)`，即越界或 `pass === 'NONE'`）**加障碍物也挡**（地形能走却被 `OB_BLOCK` 挡住：`walkable(fr,fc,true) && !walkable(fr,fc)`），其中 `[fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir)`（`dir.js` 的引擎自有助手）。**2026-10-08 修正**：此前写成 `flyPassable && walkable`，比原文更严——`walkable()` 还要求 `pass === 'ALL'`，于是「只能飞过」的地块（深水区/沟壑，`pass === 'FLY'`）被当成「无」，**她一旦朝它就永久停止持续攻击**（所有者：「没敌人有概率不会持续攻击，两只只有一只会持续攻击」——她打完目标后的朝向由最后的目标决定，两只朝向不同）。实测：前方可行走 → 正常发射；前方只能飞过 → 旧守卫 20 s 内 **0** 只音符，新守卫正常节奏；前方为无 → 仍不发射（符合原文）；前方有障碍物 → 仍不发射（既有测试即此情形）。
  `[fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir)`（`dir.js` 的引擎自有助手，`professions.js`
  的领主近战判定用的是同一个调用）。
  **2026-10-07 修正**：此前写的是 `Math.round(unit.x) + ((unit.facing || 1) >= 0 ? 1 : -1)` —— `unit.facing`
  是 `dir.js` 里明确说明「只作为贴图翻转符号保留」的 ±1 标量，**永远不为 0**，所以那个表达式恒等于 `+1`，
  LEFT / UP / DOWN 朝向下检查的都是右边那一格、音符也飞向右边（详见 §5.5）。
- 音符移动逻辑是三态（【自由移动】→【追踪移动】→【已命中】），官方为
  「扩张正弦方向」漫游 + 转向速度；本项目投射物是直线，故简化为：无目标时沿朝向前方
  `NOTE_IDLE_DIST = 2.5` 格、在天赋 `attack@angle`（数据里为 20°）范围内随机角度落地，落地后
  `delay`（1.0 s）消失 —— 即「飘出攻击范围一段时间后消失」。散布角现已从天赋黑盒读取（此前硬编码 20°）。
- 音符**没有视觉**——这条**曾经被误记为已修**（本文档 §5.3 早期版本写「`textures.js` 已有 `note` 帧、`style.js`
  已有 `PROJ.note`」，实测都是 0 处）。真正的根因有两层，2026-10-07 才修完：
  1. `public/js/render/style.js` 的 `PROJ` 表里没有 `note`；
  2. **更根本**：客户端画投射物只有一条路——sim 的 `b.ev 'atk'` 事件 → `fx.js attack(src, tgt, kind)`，
     而那里第一句就是 `const spec = PROJ[kind]; if (!spec || !tgt) return;`。kit 自己 `addProjectile` 的音符
     **没有任何 atk 事件**，而且无目标的音符**没有目标视图**——所以只补 `PROJ.note` 也画不出来。
  修法（服务端权威位置 + 客户端照快照画）：`Battle.snapshot()` 出 `snap.proj = [[id,x,y,kind]]`；
  `interp.js projAt()` 像单位位置一样插值（音符合它造成的伤害同时到达）；`fx.js syncNotes()` 按 id 维护精灵
  （淡出后回收，`MAX_NOTES=64`）；`style.js` 两项 `PROJ.note` / `PROJ.noteSkill`（`look: 'note'`）；
  `textures.js` 程序化图集新增三个音乐字形帧：**八分音符 / 十六分音符 / 高音谱号**，每只音符出现时随机抽一个
  （客户端 `fx.js` 的 `NOTE_FRAMES`，权重可调）并在存活期间保持。特效色为用户指定的 **`rgb(197, 62, 70)`**
  （`style.js` 的 `NOTE_FX`，光晕/拖尾/命中火花都用它），字形用其浅色（`NOTE_INK`），尺寸与光晕在 `NOTE_SIZE`
  （用户反馈"太大"后收小：天赋 0.55×0.50 格 / 光晕 0.90，技能 0.68×0.62 / 1.20）。

### 5.4 仍未实现 / 有意简化的部分

| 条目 | 状态 |
|---|---|
| LOR-Y（`uniequip_002_oblvns`）2 级 / 3 级的「**技能期间远程攻击不再降低攻击力**」 | **已实现**（2026-10-08）：音符在发射时快照倍率，这一条在**发射这一处**取消领主的远程惩罚（未阻挡远程 0.8 → 1.0），其余一律不动。触发条件 = 她这一份解析后的记录**自己的天赋句子里有这句话**（2 / 3 级有、1 级与 base 没有；见 §3，数据里无黑盒键）**且当前处于自己的技能期间**。口径是引擎自己的技能状态 `unit.skill.active`（`skills.js` 的 `activate()` 置位 / `end()` 清除；`snapshot.js` 的 `UF.SKILL`、`queries.js` 的技能范围、`battle/lifecycle.js` 的 `skillActive` 读的都是它），外加**释放当 tick**：S1 是瞬发（`charges`），`active` 只覆盖同步的 `activate()`，而八只音符是一次释放（间隔 `S1_STAGGER`），所以扇形在 `onStart` 里一次性取好这个值；S2（切换类，kit 按 `duration` 持续状态跑 —— §17 那条「携带此技能时，Y 模组强化后的第一天赋始终将自身视为技能期间」就是它：音色开着的时候 S2 本来就是正在跑的技能）/ S3（25 s）在开启期间整段都算；Fever 的免费释放走同一个 `activate()`，因此同样算。回归：没模组 / 1 级 / 她的另一个模组（证章 `uniequip_001_oblvns`）技能期间仍然 ×0.8；被自己阻挡或站在前方一格的近战判定本来就是 1，不受影响。golden：只有 `diy-136` 变（6 只她里装了 LOR-Y 的 #6 S1、#7 S2 两只伤害上升，#8 S3 那一场没开出技能所以不变；没模组的 3 只一字不变） |
| 天赋二的「**其他** Ave Mujica 成员的攻击范围若与自身原本攻击范围重合，则将其视作攻击范围的延伸」 | **不做**：**所有者裁定 2026-10-08**——不实现范围延伸（含场上存在**另一只丰川祥子**的情形），现状（不延伸）即期望行为。此前这里写的「本作没有其他成员」是错的：第二只她自己就是符合条件的 Ave Mujica 成员，所以不做的原因是裁定，不是没有对象 |
| 「给 Ave Mujica 成员穿防」的受益对象只有她自己 | **已实现**（2026-10-07）：唯一受益者就是她本人，此前因 mod key 写错而恒为 0，见 §5.5 第 1 条 |
| PRTS「所有音符强制使用**缓存攻击力与攻击倍率**」（未阻挡时按远程 80% 倍率，阻挡时按近战不降攻） | **已实现**（2026-10-07）：音符在发射时快照 `ATK × profile.dmgMul`，见 §5.5 第 3 条；LOR-Y 2 / 3 级的技能期间豁免在同一个快照点上取消（见上表第一行） |
| 音符的【自由移动】正弦漫游、转向速度与【已命中】三态 | **已实现**（2026-10-07，转向速度的语义 2026-10-08 修正）：PRTS 天赋备注的两张参数表逐条落在 kit 的 `noteSteer()` 里 —— 更新间隔 0.4 s、最短自由移动 0.1 s、追踪半径 1.0、追踪速度 2.0、转向速度 7/30（无目标发射）/ 1/6（有目标发射）、无目标时「扩张正弦方向」（基础振幅 0.3、x 速度 1.3）。**转向速度是【追踪移动】态的参数**（与追踪速度同行，见 §17 的归属说明），语义 = **朝向变化速率的上限**：锁定后速度方向指向目标，每帧最多转"剩余夹角 × 转向速度"，后半球直接指向目标 —— **锁定后距离每帧严格下降，不绕圈**（§5.7 有修复前后的原始时间线）。锁定是**粘的**（不回【自由移动】、不改锁别的敌人；目标消失就按 `delay` 退场）。她的音符**没有**【已命中】状态（官方两张表都写「不存在」），命中即消失 |
| S1 的 `bb.angle = 15`（扇形角） | **不使用**：S1 的 8 个音符是**追踪**（依次指向不同目标），不按扇形散布，故该黑盒在本引擎里没有作用 |
| PRTS「自身退场时，清除所有不处于【追踪移动】状态的音符」 | **已实现**：`battle.on('death')` 里清掉自由移动中的音符 |
| PRTS「命中的当个音符可计入音符数量」（穿甲层数） | **已实现**：音符命中前用 `applyNotePen(…, 1)` 重新结算层数 |
| Fever 计量的界面出口 + 是否累积 | **已实现**（2026-10-07）：数值一直在累积（每次伤害 +天赋二 `cnt`，本模式数据 = 3、封顶 100；射程外飘过去的音符命中同样计入），此前**没有任何出口给界面看**。现在 kit 写 `unit.mem.gauges.fever`，`Battle.snapshot()` 转发成 `snap.fever = [[unitId, pct]]`，客户端画成她专属状态条。**图标上没有 50% 刻度**（2026-10-08 所有者确认：进度只有一个 0–100 的填充，蓄满时光效提示）——旧文里「50 % 处是开 Fever 的阈值刻度」是错的，且与 0–450 蓄满才触发的规格（§16）矛盾。**进入 Fever 时计量清零**（`[ASSUMED]`：kamigame 只说该值由联动干员 獲得・使用，未说是否重置） |
| S1 八只音符的**先后顺序**与**朝向** | **已实现**（2026-10-07）：按 `S1_STAGGER`(0.1 s) 依次发出（原来同一 tick 全出，看起来是一团），每只的初始方向取自 S1 自己的 `angle` 黑盒（**15°**，左 15° 至 右 15°）—— 这条黑盒此前无人读 |
| LOR-Y 模组的「攻击范围内存在 2 名及以上敌人时攻击速度 +12」 | **已实现（引擎级，两棵树都有）**：`server/sim/content/traitMods.js` 通用消费这条特性词条——条件是句子里那句「攻击范围内存在N名及以上敌人时」，用引擎自己的索敌（`battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile)`）每 tick 判定，命中期间挂 `trait:attack_speed`（+12 点），她的 kit **不实现第二遍**（否则就是 +24）。她这条落在 `trait.bb.attack_speed` 上（与隐德来希 REA-Y 同路），因为该模组的 `TRAIT` 部件把 `attack_speed 12` 与 `atk_scale 0.8` 一起写进特性黑盒。测试：`test/sim/trait_attack_speed.test.js`（引擎侧）与 `test/content/op_oblvns.test.js`（她本人：1 名敌人正好 base+光环、2 名 +12、离开即摘）。**旧文写「引擎级缺口，未实现」已过时** |
| S3 每个攻击周期放 4 个音符（钢琴 2 + 风琴 2，各 180%）是否与官方一致 | **待确认**：`skchr_oblvns_3` 只有 `attack@attack_speed: 0` / `attack@atk_scale` / `duration: 25` / `spCost: 46`，看不出官方是否限制「每次攻击都演奏」。本机抓不到 PRTS 的 S3 逐条备注，需要在能直连的机器上核对 |

**她是一个队伍增幅位，而项目里那支队伍不存在**（唯一的例外是她自己：场上第二只丰川祥子就是「其他 Ave Mujica 成员」，
所以范围延伸那条不做是裁定，不是没有对象 —— 见上表）。

### 5.5 2026-10-07 修掉的缺陷（每条都在真实引擎上验证过）

| # | 缺陷 | 证据 / 修法 |
|---|---|---|
| 1 | **天赋一的穿甲完全没生效**：`mods: { defPen, resPen }` 不是引擎的 mod key（`buffs.js ADD_KEYS` 里是 `defIgnorePct` / `resIgnorePct`，全项目只有这一处写 `defPen`），`aggregateMods` 对未知 key 不报错，于是 `unit.s.defIgnorePct` 恒为 0，而 buff 本身存在、测试因此看不出问题 | 改为 `defIgnorePct` / `resIgnorePct`；实测峰值 `0.03 × 6 个音符 = 0.18`，与 `0.02 × 6 = 0.12` 成 2:3，符合两个黑盒 |
| 2 | **朝向判断恒为向右**：`(unit.facing \|\| 1) >= 0 ? 1 : -1` 恒为 `+1`（见 §5.3），空范围音符在 LEFT 下飞向右，且「前方一格」检查的是右边那格 | `noteAim` 用 `unit.fwd`（`[dRow, dCol]`）在 (col,row) 平面里旋转；守卫改用 `frontOf`。测试参数化到四个方向（旧测试抄了同一个坏表达式，所以结构上测不出这个 bug） |
| 3 | **音符不带攻击倍率、且在命中瞬间读 ATK**：`onHit` 才读 `unit.s.atk`，0.3 s 飞行期间的任何 ATK 变化都会改写伤害；领主「未阻挡远程 ×0.8」也从未施加到音符上（普通攻击是 ×0.8，它生出的音符却是 ×1.0） | `fireNote` 发射时快照 `atk × profile.dmgMul`（与普通攻击同一个钩子），闭包带入 `onHit`。测试：远程/贴身两种站位下音符与普通攻击的伤害比一致，且飞行途中加的 ATK buff 不影响已在空中的音符 |
| 4 | **S3 的「分别追踪法抗最高 / 防御力最高的敌人」完全退化**：`grid \|\| unit.rangeKeys` 里的 `grid` 是 `absoluteRangeKeys(def.stats, skillGrid)` 的返回值 —— 参数错位导致它**恒为空数组**，而空数组是 truthy，所以 `extremeIn` 在 0 格范围里搜索，两个音符都落回普通攻击的目标 | 删掉错位的调用，直接用 `unit.rangeKeys`（技能期间 `targeting.rangeGrid` 已把它换成技能范围）。测试：def 900 / res 90 两个敌人时，物理音符只打高防、法术音符只打高抗 |
| 5 | **读了不存在的黑盒键**：S1 音符数读 `attack@max_target`、S3 音符数读 `attack@times`，她的技能表里两个键都不存在，永远走默认值（恰好等于文案） | S1 改成数自己黑盒里 `atk_scale*` 的条目数（`atk_scale` … `atk_scale_8` = 8 个音符）；S3 用命名常量（文案「各 2 个音符」）；旧写法若遇上技能改数值会静默继续放 8 个 |
| 6 | **Fever 状态泄漏**：她在 Fever 期间被别的机制（道具 / 联防 / 其他 kit）退场或击倒时，计时器被自己的 `!live` 守卫冻住；而 `sakiko:fever` 是 `persist` buff（`Battle._remove` 会保留）、`mem` 跨再部署不重置 —— 于是可见的 Fever 标记会一直挂在一个已经不在场上的单位身上 | Fever 的倒计时与清理移到 `!live` 守卫**之前**（20 秒是真实时长，与她在不在场无关），`endFever` 里 `removeBuff` 与 `retreat` 解耦（`Battle.removeBuff` 只检查 unit 存在，`retreat` 自己会拒绝已阵亡单位） |
| 7 | 死状态 / 死代码：`mem.sakikoTwin`、`mem.sakikoPiano` 只写不读；`absoluteRangeKeys` 的错位调用（同第 4 条） | 一并删除 |
| 8 | **音符看不见、也不会飘**（2026-10-07 第二轮）：`PROJ` 无 `note` 项，且客户端只从带目标的 `atk` 事件画投射物——kit 的音符**根本没有渲染路径**；运动也只是「直线飞 2.5 格后消失」 | 见 §5.3 末条：`snap.proj` + `interp.projAt` + `fx.syncNotes` + `PROJ.note/noteSkill` + 图集音符帧；运动改为 `noteSteer()` 的官方三态模型（`projectiles.js` 新增 `steer` 钩子让内容拥有飞行） |

**改动性质**：第 1、2、3、4、6 条都会改变玩法表现，按 AGENTS.md §7 已重算 golden 基线
（`fields.json` / `roster.json`：9 个含她的场景变化，其余场景逐位不变 —— 已逐个核对，差异场景里都有
`chess_char_6_21_a/_b`）。

**另一条不成立但值得记下的怀疑**：S2 的「普通棋 = 风琴(+80 攻速) / 精锐 = 钢琴(+75% 攻击)」曾被怀疑「与官方反了」。
官方是**可自由切换**的两个音色，数据里并没有「哪一档该用哪个音色」的信息，所以按档位二选一是本项目自己的
`[ASSUMED]` 选择（两个分支的**数值**各自取自该棋等级的 Lv4 / Lv7 黑盒，正确），不是 bug，故未改动。

### 5.6 2026-10-08 修掉的缺陷（v0.2.1 实机报告：一技能不触发 Fever / 技能条满了不发动）

所有者报告两条玩法级问题（都在 `port/0.2.1-sakiko` 上用真实战斗的时间线复现过）：

| # | 缺陷 | 证据（修复前的原始时间线） | 修法 |
|---|---|---|---|
| 9 | **S1「充能至最大层数时自动释放一次」根本没有实现**：kit 把它留给引擎的 `DEFAULT` 触发（`op-oblvns.js` 旧注释「the auto-release of the last charge is left to the ordinary DEFAULT trigger」），而 `DEFAULT` 要求「即将攻击 + 初始攻击范围内有敌人」（`skills.js` `_defaultCondition`）。她的**持续攻击**会让音符打到范围**外**的敌人并照常付攻击回复技力，于是范围空着时充能一路涨到上限就**停在那里**，技能永不发动 —— 而客户端的 SP 条正好在那一刻读满（`snapshot.js` 发的是 `sp`/`spCost`，`gainSp` 在 `charges == maxCharges` 时把 `sp` 钉在 `spCost`） | 攻击范围外放一只不动敌人：`t=27.73 sp=4/4 ch=2/2 act=n n=0`，直到 40 s 采样结束都是这一行（`activations=0`），同时视界里始终有 2–4 只音符在飞（「继续普通攻击」） | 新增 `chargeCapRelease()`：充能达到 `maxCharges` 时由 kit 自己 `activate('chargeFull')` —— PRTS 技能 §特殊属性/可充能「部分可充能技能在技力达到上限后（即充能次数达到上限）会**立刻**产生额外效果，如立刻释放一次」：不需要目标、不等攻击、也**不花**自动操作的 3 s 冷却（「自动操作具有3s冷却，在完成一次操作…」管的是**操作**）；Fever 期间让位给 Fever 自己的持续触发。挂在两个地方（`tick` 钩子在弹道阶段之后立刻放；成员计时器在下一 step 的 allies 阶段之前兜底），保证引擎自己的施法抢不到它前面 |
| 10 | **`sakikoChargeFull` 把「自动作战的发动」误判成「充能满自动释放」**：旧实现用 `activate` 包装记录「施法瞬间 charges 是否已满」，`skillStart` 里据此套用 §17 的例外。但**充能满的那次施法会把充能降到 max−1**，而回满只要 4 次落点 → **4 次攻击短于自动操作的 3 s 冷却**时（攻击间隔 < 0.75 s，即攻速 ≳ 173，她自己天赋光环 +16 / 模组 +12 / 任意一件攻速装备就够了）**每一次**施法都在满充能上发生 → 每一次释放都被排除 → **S1 永远不触发 Fever** | 实机同一场景（`interval=0.65`，满槽 450）敌人进范围后连续 5 次释放全是 `sakikoChargeFull=true`、`feverLeft=0`；攻速扫描表：间隔 1.12 s / 0.78 s 时「充能满标记 0/29、0/39，Fever 2 次」，间隔 0.60 s 起变成「17/34 被标记，Fever 只剩 1 次」 | 例外先改成按**事件**判定（`ctx.reason === 'chargeFull'`），只把 `chargeCapRelease` 那一次排除；**随即按所有者 2026-10-08 的裁定把这一条例外整体取消 —— 现在没有任何一次发动被排除**（原话与理由见下方判断留档）。同时删掉 `activate` 包装 |

**为什么原来 33 项测试没抓到**：两条都只在**真实节奏**里出现 —— ①需要「范围空着但音符还能打到人」这个状态（原有测试要么一直有目标，要么整场无敌人），②需要充能回满快过自动操作的 3 s 冷却（原有测试的 `hold(u)` + `gainSp(9999)` + `activate('manual')` 都是**手动**发动，`reason === 'manual'` 直接把例外跳过了，从不经过被误判的那条路）。新增的回归测试把两条都钉住（见下），并且都验证过「在旧代码上失败」。

**Fever 期间压制常规自动发动：实现与结束路径**（所有者怀疑过「恢复没跑到，rule 永久停在 NEVER」——**实测不成立**）：
实现是 `holdAutoCast`（存原值 → `sk.rule = 'NEVER'`）／`releaseAutoCast`（取回原值），键是**单位对象**（`st.hold: Map<unit, rule>`），成员集合 `st.members` 在天赋安装时登记、按 `Battle × ownerId` 共享；倒计时挂在**无主**的 `battle.every(0.1)` 上（`_releaseRemoved` 只清理 `removed && !alive` 单位的计时器）。
逐条实测（打印 Fever 前/中/后的 `unit.skill.rule`）：正常到时间、她中途被退场、她被击倒（免死 → 强制退场）、被**永久**退场（`removed=true`）、Fever 中被再部署、两只她其中一只离场 —— **全部**在窗口结束时回到 `DEFAULT`；战斗在窗口内结束那一场留在 `NEVER`（那场不再有 step，且新一场战斗是新的 `Battle` + 新的技能运行时，实测从 `DEFAULT` 开始）。因此两条症状**同源**于缺陷 9+10，与压制机制无关（新增测试仍把这几条结束路径钉住，防止以后改坏）。

**改动性质（缺陷 9、10 那一次的重算）**：两条都改玩法表现，按 AGENTS.md §7 重算 golden：只有 `diy-135` / `diy-136` 两个含她的场景变化（`diy-136` 里连另外三名非她干员的逐条统计都没动，只有她的行与池级汇总变），其余家族逐位不变。

**判断留档（S1 充能满那一次到底该不该触发 Fever）—— 所有者 2026-10-08 裁定：应该触发，例外取消**

PRTS §17 S1 的原文（**引用保留**，它是官方对本技能的一句备注）：

> ※因**充能到达上限自动释放时，不会触发 Fever**。**Fever 期间，此技能将被持续地触发**
> ※不论是因 Fever 还是因满充能，**自动释放始终不改变技能为手动触发的本质**

注意这条明文**建立在「手动触发」这个前提上**：§16 的官方备注原文就是「任意一位 Ave Mujica 成员**手动触发技能**后」，而第二句正是它的理由 —— 只因为"手动"才是发动的本质，才需要额外声明"自动释放（充能满那一次）不算手动、所以不触发 Fever"。

**所有者的裁定（2026-10-08，原话）**：

> 原版确实不算，但这个模式是**自动触发**，也就是说**系统帮你按了技能键**，所以**应该要触发**

本模式里技能**全部自动释放**（引擎的 `DEFAULT` 自动作战、kit 自己的 `activate`），也就是"系统代按技能键" ⇒ 发动的本质**不再是手动** ⇒ PRTS 那条明文的前提**不成立** ⇒ **例外取消**。即：**任何**技能发动（`chargeFull` / `DEFAULT`（自动作战）/ `manual` / Fever 驱动等）**只要计量蓄满（450），都触发 Fever**。

**现在的实现（无例外）**：`op-oblvns.js` 的 `skillStart` 处理器只剩两条判定 —— Fever 自己的释放不套娃、计量蓄满才可触发：

```js
battle.on('skillStart', (ctx) => {
  if (ctx.unit !== unit || ctx.reason === 'fever') return;   // Fever 自己的释放不再次触发
  if (feverState(battle, unit).gauge < FEVER_MAX) return;    // 蓄满（450）才可触发
  enterFever(battle, unit);
}, { owner: unit });
```

删掉的正是 `if (ctx.reason === CHARGE_FULL) return;`（**一行**）。`CHARGE_FULL = 'chargeFull'` 作为充能满释放的 `reason` **保留**，仍用于把「充能上限自己造成的那一次」与引擎的 `DEFAULT` 分开记录/断言。`chargeCapRelease()` 的**其它行为一字未改**：充能满**立刻**释放（不等攻击、不花自动操作的 3 s 冷却、`sk.opReadyAt` 原样保留）、Fever 期间让位给 Fever 自己的持续触发（`left > 0` 时直接 `return false`）—— 于是**已经在 Fever 里时，充能满那一次既不发动、也不会重复进入**（Fever 期间计量「耗尽且不累积」，`enterFever` 无从被二次调用，窗口不会被刷新成新的 20 s）。

**测试（`test/content/op_oblvns.test.js`）**：①原「这一次**不**触发 Fever」的用例**反转**为「充能满这一次**也**触发 Fever」，并在旧代码上验证过会失败（`assert.ok(sakikoFeverLeft > 0)` 实得 `false`）；②新增边界用例「已经在 Fever 里时充能满不再发动、也不重复进入」（窗口内把充能钉在满层，断言窗口内没有 `chargeFull` 释放、计量不累积、倒计时**不回弹**、整段 Fever 恰好 20 s，且窗口内确有 Fever 自己的免费释放）；③「高攻速下常规自动发动（`DEFAULT`）在蓄满时触发 Fever」保持绿。

**改动性质（裁定这一次的重算）**：改玩法表现，按 AGENTS.md §7 重算 golden —— 只有含她的 **`diy-135`** 变化（探针实测：该场景全场 3 次充能满释放，**第 1 次**（t ≈ 58.37 s）发生时计量正好 **450**，此前被例外排除、现在触发 Fever，整条时间线随之分岔），**`diy-136` 与其余 5 个家族、其余 138 个自选场景逐位不变**（`diy-136` 里唯一一次充能满释放发生在计量 **309** 时，够不到 450，新语义在该场景是空操作 ⇒ 逐位相同）。

### 5.7 2026-10-08 修掉的缺陷（v0.2.1 实机报告：音符锁定后在敌人外围兜圈）

所有者报告（**他的描述即验收标准**）：「**一技能发射的音符一旦锁定敌人后应该径直冲向敌人，而不是在外部兜圈**」。

| # | 缺陷 | 证据（修复前的原始时间线） | 修法 |
|---|---|---|---|
| 11 | **【追踪移动】的转向写成了"按权重插值"，角速度 ∝ sin θ，θ→180° 时趋于 0**：旧代码每帧 `dir = dir·(1−turn) + to·turn` 再归一化，实际每帧转角约 `turn·sin θ`。两个后果：① 目标在正后方时几乎不转（笔直飞走）；② 更常见的是**稳定圆轨道** —— 半径 r 满足 `turn·sin θ = trackSpeed·dt / r`，音符绕着目标转、夹角不再收敛，实机观感就是"在外部兜圈"。S1 的官方参数（最短自由移动 0.6 s、固定 1.7 速度）保证音符**一定先直飞约 1.0 格**，所以贴脸敌人在它锁定之前就被飞过了 —— 八只音符全部绕回它周围转圈 | S1 八音齐射，她 (10,4) 朝右、静止敌人 (10,5)，逐帧打印（`st=track` 的 `d` = 与锁定目标距离，`aimErr` = 速度方向与"指向目标单位向量"的夹角）：`#3 t=0.933 st=track d=0.315 aimErr=126.8° → 0.354 → 0.393 → 0.430 → 0.465 → 0.497 → 0.526 → 0.550 → 0.569 → 0.583 → 0.592 → 0.594 (t=1.300) → 0.591 → 0.583 → … → 0.239 (t=1.800)`：锁定后 27 帧里 **11 帧距离在上升**（0.315 → 0.594 = 1.89 倍；连自由段最后一帧到锁定帧那一步算上是 12 帧），夹角长期钉在 127°，绕了一圈才命中（锁定 0.87 s 后才落地）。天赋音符（敌人 (9,4) 在她正上方）同样：`d=1.281 (free) → 1.520 (track, aimErr=133.6°) → 1.558 → 1.588 → 1.609 → 1.619 (t=0.600) → 1.608 → …`（这一只 4 帧上升、1.07 倍；该场景 5 只锁定音符合计 15 帧），1 格外的目标飞了 1.17 s | `noteSteer` 的【追踪移动】分支重写（判定见 `op-oblvns.js` 的 `TRACK_HEADS_AT_THE_TARGET`）：**速度方向就是指向目标的单位向量**，`转向速度` 只作**每帧朝向变化的上限**（本帧最多转"剩余夹角 × turn"）；当朝向落在目标的**后半球**（点积 ≤ 0，按上限转仍然在远离它）时**直接指向目标** —— 上限约束的是"多快把朝向对准目标"，不能用"指向远离目标"来满足它。锁定同时变**粘**：进入【追踪移动】后不再回【自由移动】、不再改锁别的敌人；目标死亡/消失则保持朝向，按「范围外连续 `delay` 秒无追踪目标即消失」退场 |

**不变式（修复后的判定）**：`dot(朝向, 指向目标) > 0` 恒成立 —— 前半球时按上限转（夹角 θ 缩到 θ·(1−turn)），后半球时直接指向目标（θ = 0）。因此**锁定后与目标的距离每帧严格下降**，不存在"圆轨道半径"，也不可能回退。`NOTE_*` 参数表的**数值一个都没改**（`update` / `minFree` / `seekR` / `trackSpeed` / `freeSpeed` / `turn` / `turnFree` / `sineAmp` / `sineX` / `hit` 全部原样），改的只有"锁定后怎么把朝向对准目标"；【自由移动】的扩张正弦漫游、S2 钢琴的【已命中】0.8 半径碰撞直飞、S1 的 ±13.125° 扇形与各技能的初始方向**都不受影响**。

**逐种音符的前后对照**（同一场景生成器，7 个站位：贴脸 (10,5)、头顶 (9,4)、脚下 (11,4)、斜上/斜下 (9,5)/(11,5)、正前 2 格 (10,6)、正前 3 格 (10,7)；`上升帧` = 锁定后距离上升的帧数合计，`回退音符` = 锁定后距离曾超过锁定瞬间的音符数）：

| 音符 | 修复前（上升帧 / 回退音符 / 最大夹角） | 修复后 |
|---|---|---|
| **S1**（更新 0.2 / 最短自由 0.6 / 追踪 2.2 / 转向 1/6） | (10,5) **44 帧 / 4 只 / 127°**，(9,4) 70 / 16 / 138°，(11,4) 70 / 16 / 138°；另 4 个站位本来就收敛 | 7 个站位**全部 0 帧 / 0 只**；(10,5)、(9,4)、(11,4) 的锁定瞬间夹角由 127–138° 变成 **0°**（径直） |
| **天赋音符**（有目标 2.0 / 转向 1/6；无目标 正弦(0.3,1.3) / 转向 7/30） | (9,4) 15 / 5 / 134°，(11,4) 15 / 5 / 133° | 0 / 0；这两处首帧夹角 134° → **0°**。**无目标发射**（持续攻击在空范围内的漫游 + 自己找人 + 转向 7/30）前后**逐位相同**（3 只锁定、7.0 帧、最大夹角 8.6°）——现在也能锁定后径直 |
| **S2 钢琴**（追踪 3.5 / 转向 1/2；【已命中】0.8 半径碰撞 + 3.0 直飞 0.5 s） | 7 个站位都**没有**上升帧（转向 1/2 太快，轨道半径 0.23 格已在 0.25 命中半径之内）；但 (9,4)/(11,4) 的锁定瞬间夹角 76–78°，是"先飞开再拐回来" | 0 / 0；(9,4)、(11,4) 首帧夹角 → **0°**，命中提前（平均锁定帧数 9.3 → 8.3 / 11.5 → 10.8）。【已命中】碰撞直飞那一段**完全没碰** |
| **S2 风琴**（追踪 1.0 / 转向 1/12） | (9,4) 30 / 6 / 119°，(11,4) 11 / 3 / 111° | 0 / 0；(9,4) 首帧 → 0° |
| **S3**（追踪 1.3 / 转向 1/4） | (9,4) 12 / 8 / 133°，(11,4) 7 / 6 / 130° | 0 / 0；(9,4)、(11,4) 首帧 → 0° |

**顺带钉住的第二条语义（锁定是粘的）**：旧代码在锁定目标死亡/隐身时把音符放回【自由移动】并在下一个更新间隔**改锁别的敌人**；现在进入【追踪移动】后不再回、【追踪移动】里也不再选新目标，失去目标就保持朝向飞，按 §17 天赋备注的「音符位于自身攻击范围外时，若连续 `delay` 秒以上不存在追踪目标则消失」退场（实现：`st.noneFor` 只在"追踪态且有活目标"或"在自身攻击范围内"时清零）。**无目标发射的音符仍然会自己找人**（追踪半径 1.0），只是**只锁一次**。

**测试**：`test/content/op_oblvns.test.js` 三条 —— ①`S1 锁定后径直冲向目标`（贴脸 = 后半球径直 + 正前 3 格 = 前半球按转向速度收敛两个场景；每个锁定帧 `dist(t+1) < dist(t)`、末帧夹角 < 5°、锁定后距离不得超过锁定瞬间）；②`天赋音符锁定后同样径直冲向目标`；③`锁定是粘的`（目标死后不回自由移动、不改锁旁边的第二只敌人、并在 `delay` 秒后离场）。三条都在旧代码上验证过会失败：旧时间线在 ①的贴脸场景里第 2 个锁定帧距离就上升（0.315 → 0.354）、首帧夹角 126.8°（断言要求 < 1°），②的首帧夹角 133.6°（要求 < 1°）且随后 4 帧距离上升。

**改动性质**：改玩法表现，按 AGENTS.md §7 重算 golden —— 只有含她的 `diy-135` / `diy-136` 变化，其余 5 个家族与其余 138 个自选场景**逐位不变**：
- `diy-135`（12 只全是她的自选，mode_single_normal R12 act1autochess_m03）：她的音符现在**真的命中**（此前贴脸/侧后方的音符要绕一圈、或在 `delay` 后消失），`events.dmg` 2860 → 2901、`events.atk` 699 → 742、`events.skill` 421 → 444、总伤害 1166379 → 1166531、我方死亡 4 → 3，战斗提前 0.6 s 结束（5406 → 5388 ticks）；逐只统计随之重排（例如 #1 持续攻击的音符命中变多 → 出手 65 → 70 次，#7 LOR-Y 那只反而少打 26578 → 23409，因为目标更早死了）。
- `diy-136`（6 只她 + cdfend / cguard / csnipe 各 2 只，mode_multi_abyss R13 act1autochess_m04）：她的伤害节奏改变 → 击杀 2 → 3、漏怪 121 → 120（`events.leak` 121 → 120）、总伤害 264986 → 258965；**同一个 `Battle` 里随机数消耗随之变化**（`rngDraws` 612 → 606），所以同场的非她棋子（csnipe 两只的伤害 35829 → 37853 / 38611 → 38203）也跟着动了 —— 这是战斗流程改变的正常连带，不是它们的数值被碰过。

## 6. 模式数据里没有她（重要）

官方 `activity_table.json` → `activity.AUTOCHESS_SEASON.act2autochess`：

```
charChessDataDict     266 条（133 个基础干员）  ← 她不在
charShopChessDatas    133 条                    ← 她不在
char_4182_oblvns                               ← 0 次
mujica / 外援 / guest                          ← 0 次
```

**交叉验证**：社区文章明确列为「外援干员」的其他人，在模式数据里同样一次都不出现：

```
维什戴尔  char_1035_wisdel  → 0
阿斯卡纶  char_4132_ascln   → 0
斩业星熊  char_1044_hsgma2  → 0
```

→ 「外援干员」**不是模式数据里的字段**。社区语境下的含义见下节。

项目 `data/chess.json` 的 133 个基础干员与该快照**完全一致**。

## 7. 社区对「外援」的说明（出处）

[明日方舟卫戍协议的外援干员可用什么](https://m.925g.com/gonglue/311973.html)（2026-03-24）：

> 卫戍协议的外援干员之中，可用的有望、火陈、斩业星熊。还有**丰川祥子**、阿斯卡纶……
> **丰川祥子属于卫戍协议里面的老牌强劲支援位，有着很强的拐力。**它在有转职的情况下，无论是阿戈尔、
> 萨尔贡还是维多利亚都可以转。唯一的不足是**祥子自身没有任何户口**（无阵营），没有转职时会很难办。

即：**没有阵营归属的泛用辅助位，靠转职道具适配任意盟约**。这解释了为什么模式数据里不需要给她
一条 chess 记录。

## 8. 美术资源（必须从本地客户端提取）

`data/assets.json` 里没有她（0 次），项目现成的 `tools/fetch-assets.mjs` 拿不到。本地客户端有：

```
chararts/char_4182_oblvns.ab          6,693,609 bytes
charpack/char_4182_oblvns.ab             57,047 bytes
skinpack/char_4182_oblvns.ab          4,254,760 bytes
battle/prefabs/effects/oblvns.ab                       ← 技能特效（音符）
```

`tools/local-extract/extract.py` 目前**只提取敌人 Spine**，不提取干员 Spine，
所以需要新增一个任务（它的 `JOBS` 表和 `export_bundle` 可复用）。

## 9. 官方数据表的获取方式（本次实测）

**不需要解密客户端**。客户端 `anon/*.bin` 里的 8 张表是**加密的**（高熵密文，zlib/deflate/gzip
均解不开；密钥在 214 MB 的 `GameAssembly.dll` 中）。

改用 jsDelivr 镜像上游仓库，**3.9 秒**即得（对比 `raw.githubusercontent` 实测 378 秒）：

```
https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@master/zh_CN/gamedata/excel/<table>.json
```

`tools/build-data.mjs` 当前只认 `raw.githubusercontent` 的 URL；要长期使用建议加入 jsDelivr fallback。

## 10. 「外援」= 项目已有的协防干员（关键结论，所有者确认 2026-10-06）

所有者的原话：「**盟约就是协防干员，特质就是原来的所有干员受到的物理和法术伤害-20%，
【协防干员】伤害提升至120%，精锐【协防】干员造成伤害提升至140%**」。

这与项目里现成的 `emptyShip` 盟约**逐字吻合**：

```json
// data/bonds.json → emptyShip
"name": "协防干员", "bondId": "emptyShip",
"desc": "所有干员受到的物理和法术伤害-20%，【协防干员】伤害提升至120%，精锐【协防】干员造成伤害提升至140%",
"bb": { "damage_resistance": 0.2, "damage_scale_normal": 1.2, "damage_scale_extra": 1.4 },
"weight": 0, "noStack": true, "activeCount": 2, "thresholds": [2]
```

而 `data/config.json` 有 `"fallbackBondId": "emptyShip"`，其 spec 说明：

> 协防干员 = **fallback bond**。**DIY/自选 6 星干员，其阵营不匹配任何核心盟约时，成为协防干员**；
> 部分预设干员（调香师、松果、瑰盐、魔王、铃兰、迷迭香、盟约·辅助干员）原生就是协防。

### ⚠️ 更正：`fallbackBondId` 是**纯文档字段，没有代码消费它**

本文档早期版本据上一条推论说「她自动落进 fallback，一行都不用写」。**这是错的**，
由所有者发现（2026-10-06：「祥子你没把他加进协防干员的盟约」）。实测根据：

- 全项目搜索 `fallbackBondId`：**服务端、客户端、构建器里 0 处使用**
- `server/match/bondsMeta.js` 的 `pieceBonds()` 只做 `c.bonds.slice()`（再叠加道具授予的盟约）
- 甄选（DIY）棋子的 `bonds` 也是 `[]` —— 它们同样**不在**任何盟约里
- **官方协防成员是靠自身记录里的 `bondIds` 归属的**：

```
chess_char_2_14_a 调香师  bondIds = ["deputShip", "emptyShip"]
chess_char_6_12_a 迷迭香  bondIds = ["preciShip", "visiShip", "emptyShip"]
chess_char_6_21_a 祥子    bondIds = []              ← 所以她不生效
```

**结论：盟约归属必须写进棋子自己的 `bonds`。** 已修正为 `bondIds: ['emptyShip']`
（`tools/inject-sakiko.mjs` 的 `BOND_IDS`），并把她的 id 加入 `emptyShip.members`
（`tools/build-data.mjs` 的 `LOCAL_BOND_MEMBERS`，因为官方 `chessIdList` 里没有她）。
核对：`emptyShip.members` 9 个、`visibleMembers` 6 个，两个列表都含她。

→ 所有者描述的那整套 -20% / 120% / 140% 机制**确实**项目里已实现（`bonds/battle.js:48-49,181-185`），
**但前提是先把她的盟约归属写对**。社区语境里的「外援」就是它。

## 11. 可行性确认（实现前实测）

| 依赖 | 状态 |
|---|---|
| `lord`（领主）子职业 | ✅ 已实现（`professions.js:447` 的 `canHitFly`，`:524` 的 `rangedScale atk_scale 0.8`）；4 个可见干员在用（拉普兰德、断崖、银灰、仇白） |
| 「追踪敌人的音符」投射物 | ✅ `ProjectileSystem` 原生 homing（`projectiles.js:3` 「A projectile homes on `target`」） |
| 盟约归属 | ⚠️ 必须自己写 `bondIds`（见 §10 的更正）；`bonds: []` 不会自动落 fallback |
| 从客户端提取干员美术 | ✅ 不需要：上游社区仓库已有她，走 `tools/add-sakiko-assets.mjs` + `fetch-assets.mjs` |

## 12. 数据接入点（已定位）

`buildChess`（`tools/build-data.mjs:754`）**完全由「数据表」驱动**：

```js
for (const chessId of Object.keys(act.charChessDataDict)) {   // 遍历 chess
  const baseId = act.chessNormalIdLookupDict[chessId];        // 取 base
  const shop   = act.charShopChessDatas[baseId];              // 取商店条目
  const char   = charTable[shop.charId];                      // 取干员数值
```

所以要加她，只需向 `act2autochess` 注入三条：

| 表 | 加什么 |
|---|---|
| `charChessDataDict` | `chess_char_X_YY_a` / `_b`：`identifier`、`isGolden`、`status`、`upgradeChessId`、`upgradeNum`、`bondIds: []`、`garrisonIds: [她的特质]` |
| `chessNormalIdLookupDict` | `chess_char_X_YY_b → chess_char_X_YY_a` |
| `charShopChessDatas` | `chessId`、`goldenChessId`、`chessLevel`（阶）、`shopLevelSortId`、`chessType`、`charId: "char_4182_oblvns"`、`isHidden: false` |

`bondIds: []` + `config.fallbackBondId` ⇒ 自动成为协防干员，**无需改 `data/bonds.json`**。

必须同步放宽的一处校验（`build-data.mjs:3131`）：

```js
if (visible.length !== 112) err(`expected 112 visible non-DIY chess, got ${visible.length}`);
```

加她后是 **113**。

## 13. 工作量评估（所有者已选：单干员实现）

| 部分 | 难度 | 说明 |
|---|---|---|
| 数值 / 技能 / 天赋数据 | 低 | 官方表全有（本文 §2–§4） |
| 数据注入（本文 §12） | 低 | 三条 + 一处计数校验 |
| 协防盟约 / -20% / 120% / 140% | **零** | 项目已实现 |
| `lord` 子职业 | **零** | 已实现 |
| 追踪音符投射物 | 中 | homing 已有；需加「飘出范围后延迟 1.0s 消失」与 `attack@angle 20` |
| S1 充能 2 次 + 自动释放 | 中 | 需确认项目的技能充能机制 |
| S2 音色切换 | 中高 | 需可切换的技能状态 |
| S3 双音色 + 按属性分别索敌 | 高 | 两套追踪 + 两种伤害类型 |
| 美术提取 | 中 | 扩展 `extract.py`：干员 Spine + `battle/prefabs/effects/oblvns.ab` |
| 测试 | 中 | 项目要求每个效果有测试 |
| **Fever / mujica 队伍效果** | **本次不做** | 需 5 名干员 + 一个盟约；所有者已确认单干员范围 |

**阶数 / 售价 / 合成数 / `identifier` 官方无 chess 记录 → 原创，需标 `[ASSUMED]`。**

## 14. 语音：上游没有中文配音，改用日语（2026-10-07 定论）

AGENTS.md §6 第 5 条曾把这件事记成「原因未定论」。现在定论了，**根因不是 `charword_table` 缺字段**：

1. 她的 `charword_table` 记录**是完整的**，「只有 voiceTitle、没有 voiceAsset」的说法来自过时的快照。
   当前缓存（`.cache/gamedata/excel/charword_table.json`，`zh_CN`）里她 38 条记录，每条都有
   `voiceAsset`，形如 `char_4182_oblvns/CN_019`。
2. 真正缺的是**上游 dump 里的文件**。逐条实测（14 个战斗槽位，`curl` 走 `gh-proxy.com`）：

```
voice_cn/char_4182_oblvns/cn_019…cn_032.mp3   → 全部 404
voice/char_4182_oblvns/cn_019…cn_032.mp3      → 全部 200（27,603 / 8,168 / … / 31,991 字节）
```

3. 这不是「dump 还没更新」——**整个 Ave Mujica 联动都是这样**：祐天寺若麦（`char_4185_amoris`）、
   三角初华（`char_4184_dolris`）、若叶睦（`char_4183_mortis`）在 `voice_cn/` 同样 404，在 `voice/`
   同样 200。即联动的中文配音不存在，日语才是她的原生语音。

**因此她按日语语音接入**，改动如下：

| 位置 | 改动 |
|---|---|
| `tools/assets/plan.mjs` | `VOICE_LANG_OVERRIDE = { char_4182_oblvns: 'jp' }`：把她的 `voiceAlt` 指向 JP dump（`voice/`），其余干员仍用 `--voice-lang`（默认 cn），且每个干员的条目只属于一种语言 |
| `tools/fetch-voice-override.mjs`（新增） | 把这 14 条从 JP dump 取到 `public/assets/audio/voice/jp/char_4182_oblvns/`。走 `SP_GITHUB_PROXY`（默认 `gh-proxy.com`）——voice 分支没有 jsDelivr 镜像，而本机 hosts 把 `raw.githubusercontent.com` 指向 127.0.0.1 |
| `data/assets.json` | 她的 `audio.voice` 条目：14 条全部 `/assets/audio/voice/jp/char_4182_oblvns/cn_0NN.mp3`（`stats.voiceChars` 120 → **121**，`files` 5715 → 5729） |

客户端无需改动：`public/js/audio.js` 直接播 `audio.voice[charId][slot]` 里的 URL，`/media/voice/jp/…`
也由 `server/index.js` 的通用 `/media/` 路由解析（不按语言白名单）。测试：`test/voice-override.test.js`（新增，
覆盖覆盖表、取语音任务、代理顺序）与 `test/docs-consistency.test.js`（清单里每个干员的 URL 语言 = 覆盖表决定的语言）。

## 15. 技能音效（2026-10-07）

「放大招没音效」的**真正根因不在素材缺失，而在解析**——`07-assets.json` 的 `operators[*].sfx` / `skills[*].sfx`
其实是**纯文档字段，没有任何工具读它**（早先把它当输入是误判）：

1. `tools/assets/plan.mjs` 只认 `battle.ON_SKILL_START.<skillId>` 这一种银行名，她三个技能都不是这形状；
2. `tools/assets/audio.mjs` 的 `indexAudio()` 会把 `ON_ABILITY_START.skchr_oblvns_1` 与
   `ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]` 整个丢掉，而 `skchr_oblvns_2.1/.2` 因键名带后缀、精确查
   `skchr_oblvns_2` 查不到；
3. 客户端不需要改（`public/js/audio.js` 已按 `sfx.units[charId].skills[skillIndex]` 播，无则退回 `.skill`）。

修法：`audio.mjs` 新增**显式表** `SKILL_START_BANKS`（只列她三条）+ `indexAudio().skillStart()`，
`plan.mjs` 改用它；`fetch-voice-override.mjs` 新增 `--sfx` 取这 7 个文件（走 `SP_GITHUB_PROXY`）。映射：

| 技能 | 官方银行 | 探出的文件 |
|---|---|---|
| S1 | `ON_ABILITY_START.skchr_oblvns_1` | `p_skill_mjckyrdglsnt_d1.mp3`（d2/d3 为 alts） |
| S2 | `ON_SKILL_START.skchr_oblvns_2.1`（`.2` 为 alt） | `p_skill_mjckyrdslnt_h2.mp3` |
| S3 | `ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]` | `p_skill_mjckyrdslnt_s1.mp3`（s2 为 alt） |

**用显式表而不是通用规则，是因为池里另有 104 个技能的发动银行同样只有 `ON_ABILITY_START.<skillId>`**
（德克萨斯、能天使、银灰、玛恩纳…）；通用接受会一次性改写约 100 名干员的清单并让每次 `npm run assets`
多下约 100 个文件。这是一个**独立的引擎级决策**，本轮只修她（`--sfx --char=<id>` 会把无对应银行的技能逐个报错列出）。
清单变化只有她的 `sfx.units.skills{0,1,2}` 与 `stats`（其他干员一条未动），测试 `test/sfx-sakiko.test.js` 11 条。

## 15.1 音效还原总表（2026-10-08 更新：按技能细分 + 持续段循环 + 限流优先级）

官方 bank 里她的每一条音效，**现在全部有归属**（`docs/ASSETS.md`「按技能细分的音效」是 schema 权威）：

| 官方 bank | 文件 | 用途 | 状态 |
|---|---|---|---|
| `ON_UNIT_BORN/DED.char_4182_oblvns` | `b_char_set` / `b_char_dead` | 部署 / 阵亡（职业默认） | ✅ 0.1.4 起 |
| `ON_ABILITY_START.char_4182_oblvns.attack.4.1` | `p_atk_mjckyrdslnt` | 普攻挥舞 | ✅ 上一轮（`UNIT_SFX_BANKS` 钉死） |
| `ON_PROJECTILE_HIT.projectile_chr_oblvns[_talent]` | `p_imp_mjckyrdnt` | 天赋音符命中（单位 `hit`） | ✅ 上一轮 |
| `ON_PROJECTILE_BORN.projectile_chr_oblvns_talent` | `p_atk_mjckyrdnt` | 天赋音符诞生 | ✅ 上一轮 |
| `ON_ABILITY_START.skchr_oblvns_1` | `p_skill_mjckyrdglsnt_d1` | S1 发动 | ✅ 上一轮 |
| `ON_SKILL_START.skchr_oblvns_2.1`（`.2` alt） | `p_skill_mjckyrdslnt_h2` | S2 发动 | ✅ 上一轮 |
| `ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]` | `p_skill_mjckyrdslnt_s1`（s2 alt） | S3 发动 | ✅ 上一轮 |
| `ON_PROJECTILE_BORN.projectile_chr_oblvns_s2_t` / `_s2_slow_t` | `p_atk_mjckyrdnt_r` / `_p` | S2 音符诞生 | ✅ 本轮（`skillSfx[1].born`） |
| `ON_PROJECTILE_BORN.projectile_chr_oblvns_s3_phy` / `_s3_mag` | `p_atk_mjckyrdnt_r` / `_p` | S3 音符诞生 | ✅ 本轮（`skillSfx[2].born`） |
| `ON_CUSTOM_TRIGGER.projectile_chr_oblvns_s1_hit` | `p_imp_mjckyrdglsnt` | **S1 命中** | ✅ 本轮（`skillSfx[0].hit`） |
| `ON_PROJECTILE_HIT.projectile_chr_oblvns_s2` / `_s2_slow` | `p_imp_mjckyrdnt_r` / `_p` | **S2 命中** | ✅ 本轮（`skillSfx[1].hit`） |
| `ON_PROJECTILE_HIT.projectile_chr_oblvns_s3_phy` / `_s3_mag` | `p_imp_mjckyrdslnt`（同一文件） | **S3 命中** | ✅ 本轮（`skillSfx[2].hit`） |
| `ON_SKILL_FINISH.skchr_oblvns_2.1` / `.2` | `p_skill_mjckyrdslnt_h2` / `_h1` | **S2 结束** | ✅ 本轮（`skillSfx[1].finish`） |
| `ON_BUFF_START.oblvns_s_3[loop]`（`loop: true`） | `p_atk_mjckyrdslnt_lp` | **S3 持续段循环** | ✅ 本轮（`skillSfx[2].loop`，新原语 `startLoop`/`stopLoop`） |
| `soundFXCtrlBanks: ON_SKILL_FINISH.skchr_oblvns_3` | —（`ctrlStop: true`, fade 0.2 s） | **S3 结束 = 停循环** | ✅ 本轮（官方没有 finish 文件，停循环就是结束音） |
| `ON_ABILITY_ON.char_4182_oblvns.attack.{0,1,2,3,5}.1` / `combat.*` | `p_atk_mjckyrdnt_h` | 默认模式普攻音 | ⛔ **故意不消费**：客户端 `normalAttackSfx()` 会拒 `_h`（技能档文件），见 `docs/ASSETS.md` 的 C 项调查 |

**仍未还原的（无）**——她官方 bank 里的音效本轮全部落地。剩下的两处是**协议/取舍**而非素材：

1. **`noteSkill` 的诞生音无法再细分**：`snap.proj` 的 kind 只有 `note` / `noteSkill`，所以 `sfx.proj.noteSkill.born`
   只能取 S2 的 `_r`；S3 的法术半段（`_s3_mag` → `_p`）与 S2 的慢速变体（`_s2_slow_t` → `_p`）在客户端听起来仍是 `_r`。
   细分需要给 kind 加第三个值（`events.js` + 她的 kit `hitTag`），属于**协议/玩法侧改动**，本轮只报告不实现；
   解析侧已经就绪（`skillSfx[i].born` 存的正是那两个 take）。
2. **S2 的钢琴 / 风琴**：一个技能两种音色，官方两个 bank 各一个 take；`skillSfx[1]` 按 bank 顺序取钢琴（`_r`），
   风琴期间听的是钢琴的 take。同上，kind 不区分音色，需要玩法侧提供信息。

本轮还修了**「三技能开大没有大招音效」**（所有者实机报告）：不是清单/素材问题（`skills[2]` 一直在、文件在盘上、
HTTP 200），而是 **SFX 限流器**——`MAX_VOICES = 8` 是全场的并发上限，两只她在场时每次攻击有 挥击 + 音符诞生 +
音符命中 三个音，铺满后**后到的音一律被拒**，最该响的发动音被挤掉。修法见 `public/js/audio.js SFX_PRI`：
发动 / 部署 / 阵亡 / 漏怪为事件档、普攻命中为单位档、音符诞生等装饰音为最低档，满额时**低档让位**（官方
`maxSoundAllowed` / `popOldest` 的语义），被挤掉的音**立即停掉**因此响度不失控。回归测试
`test/ui/audio.test.js`「SFX priority」4 条 + 「按技能细分」8 条。

## 16. Fever 的完整规格（所有者 2026-10-07 提供的官方备注原文；实现以本节为准）

> Fever累计至**450点**时，任意一位 Ave Mujica 成员**手动触发技能**后，在场所有 Ave Mujica 成员 **20 秒**内会持续释放当前技能
> ※Fever 值以**图标显示于在场 Ave Mujica 成员模型右下**，其中的**玫红色**填充反映累积进度，**蓄满时出现光效提示**；该进度**所有成员共享**，在**整场战斗中保留**
> ※Fever 状态期间：**耗尽且不累积** Fever 值，**技力消耗条变为玫红色**，所有受影响成员将**无视技力限制地持续尝试开启技能（切换类技能除外）**，且通过此方法开启技能时**不消耗技力**；通过 Fever 状态开启的**持续类技能将在 Fever 状态结束时强制结束**；**进入 Fever 状态前正在释放的持续类技能暂停计时**，直至 Fever 状态结束
> 进入 Fever 状态后，场地 BGM 将临时切换为 TV 动画《BanG Dream! Ave Mujica》主题曲《KiLLKiSS》的高潮片段（inst.，时长约 20 秒），**每次 Fever 状态期间仅触发一次**，持续至 Fever 状态结束 / 场上没有处于技能期间的 Ave Mujica 成员 / 该片段播放完毕；场上存在**五名不同名**且通过 Fever 状态开启技能的 Ave Mujica 成员时以当前进度切换为 **Vocal. 版**，并**实时检测**状态以切换版本

**这条规格推翻了本项目早先的几个实现假设**（务必按本节改，不要再按旧的）：

| 旧实现（错） | 规格（对） |
|---|---|
| 计量 0–100、**50 %** 阈值 | 计量 **0–450**，**蓄满（450）**才可触发 |
| 只有 **MANUAL** 发动才触发 Fever | 本模式是全自动放技能：**任意一次技能发动**（含自动）在蓄满时即可触发。**所有者裁定 2026-10-08**：「这个模式是**自动触发**，也就是说**系统帮你按了技能键**」—— 所以**没有任何一次发动被排除**，S1「充能至最大层数时自动释放一次」那一次（`reason: 'chargeFull'`）**也算**。§17 S1 的「因充能到达上限自动释放时，不会触发 Fever」建立在该备注自己的「**手动触发技能**」前提上（原文与裁定见 §5.6 判断留档、§17 S1） |
| 只给发动者挂状态 | **在场所有** Ave Mujica 成员一起进入 |
| Fever 期间照常回 SP / 照常自动发动 | Fever 期间**停止 SP 积累、禁止常规自动发动**；只有 Fever 驱动的释放（实现：`holdAutoCast` 存原值并置 `rule:'NEVER'`，窗口结束时 `releaseAutoCast` 取回；倒计时挂在无主的 `battle.every(0.1)` 上。结束路径逐条实测 —— 到时间 / 她退场 / 被击倒（免死→强制退场）/ 永久退场 / 窗口内再部署 / 两只她之一离场，**全部**恢复原值；窗口内战斗结束那一场不再有 step，新一场是新 `Battle`＋新技能运行时。见 §5.6 末段） |
| Fever 期间的释放照常花 SP | Fever 驱动的开启**不消耗技力**（无视技力限制，切换类技能除外） |
| 计时器照常走 | **进入 Fever 前已在跑的持续类技能要暂停计时**；Fever 期间由 Fever 开启的持续类技能在 **Fever 结束时强制结束** |
| 状态条 = 血条下方一条 | **图标在模型右下角**，玫红填充；蓄满有光效；Fever 期间 SP 条变**玫红色** |
| 无 BGM 变化 | Fever 期间切 **KiLLKiSS 高潮片段**（约 20 秒，每段 Fever 只触发一次；条件结束即回退；五名不同名成员用 Fever 技能时切 **Vocal.** 版） |
| 每回合从 0 开始 | **所有者裁定 2026-10-07**：「**是一回合内，每回合从 0 开始，并且协助队友的时候也要重新积累**」——即 Fever 计量只在**本回合这一场战斗**内保留；新回合清零；**去协助队友的那场战斗也重新从 0 积累**（它同样是另一场 `Battle`）。实现上按 `Battle × ownerId` 存记录天然满足：每个 `Battle` 实例（每回合、每次联防协助）各自一份 |

## 17. 三个技能的逐条备注（PRTS `action=raw&section=7` 原文，2026-10-07 抓取）

**S1 新月的苏醒**（`skchr_oblvns_1`）
> ※触发技能时以自身朝向为基准，**自左 13.125° 至右 13.125° 顺时针均匀演奏音符（间隔 3.75°）**，每个音符的具体倍率参见该技能的算法。
> ※本技能的音符参数如下：**更新**间隔 0.2s，【自由移动】**最短自由移动时间** 0.6s；【自由移动】策略：固定 **1.7** 速度向当前方向移动，追踪范围半径 1.0；【追踪移动】策略：固定 **2.2** 速度向目标移动，转向速度 **1/6** 每帧；【已命中】状态：不存在
> ※因**充能到达上限自动释放时，不会触发 Fever**。**Fever 期间，此技能将被持续地触发**
> ※不论是因 Fever 还是因满充能，自动释放始终不改变技能为手动触发的本质

**实现**：「充能至最大层数时自动释放一次」= `chargeCapRelease()`（`op-oblvns.js`），充能到 `maxCharges` 时以
`reason: 'chargeFull'` 立刻释放一次 —— 不需要目标（PRTS 技能 §特殊属性/可充能：「…会**立刻**产生额外效果，如立刻
释放一次」；她的音符在空范围里也能发射：见天赋备注「攻击范围内不存在敌人时…发射的音符初始不存在追踪目标」），不花自动
操作的 3 s 冷却。

**「不会触发 Fever」这条已按所有者 2026-10-08 的裁定取消**：上面 PRTS 原文的那两句**保留引用**，但它的前提是官方
Fever 要求「**手动触发技能**」，而本模式是**全自动**（「系统帮你按了技能键」，原话见 §5.6 判断留档）—— 前提不成立，
故例外取消。**现在任何发动（`chargeFull` / `DEFAULT` 自动作战 / `manual` / Fever 驱动）只要蓄满（450）都触发 Fever，
`skillStart` 里没有例外**；`chargeFull` 这个 `reason` 仍保留，只用于区分「充能上限自己造成的那一次」与引擎的 `DEFAULT`。
`chargeCapRelease()` 的其它行为不变（立刻释放、不等攻击、不花 3 s 操作冷却；Fever 期间让位给 Fever 自己的持续触发，
所以**已经在 Fever 里时充能满不会重复进入**）。细节与实机/golden 证据见 §5.6 第 9、10 条与判断留档。

**S2 满月的舞会**（`skchr_oblvns_2`）
> ※**Fever 期间，此技能无法手动开启**；可以触发 Fever 时，**触发技能将仅触发 Fever，不进行技能形态切换**
> ※携带此技能时，音符以自身朝向为基准，随机在左 20° 至右 20° 范围内选择一个角度作为初始运动方向。
> ※**钢琴**音符：**更新** 0.2s，最短自由移动 **0.4s**；自由移动 = 扩张正弦（基础振幅 **0.4**，x 速度 **1.9**），追踪半径 **0.8**；追踪 = 固定 **3.5** 速度，转向 **1/2** 每帧；【已命中】= **激活 0.8 半径的碰撞**，固定 3.0 速度沿当前方向移动，持续 **0.5s**
> ※**风琴**音符：**更新** 0.4s，最短自由移动 **0.4s**；自由移动 = 扩张正弦（基础振幅 **0.15**，x 速度 **0.7**），追踪半径 **1.0**；追踪 = 固定 **1.0** 速度，转向 **1/12** 每帧；【已命中】不存在
> ※携带此技能时，Y 模组强化后的第一天赋**始终将自身视为技能期间**

**S3 残月的余响**（`skchr_oblvns_3`）
> ※**免死**效果需要处于技能期间生效，**优先级 −3000**，期间触发过此免死效果的单位将在 **Fever 结束时 / 自身退场时**退场
> ※技能期间，音符初始方向随机在左 20° 至右 20° 内
> ※技能期间音符（无论种类）：**更新** 0.4s，最短自由移动 **0.8s**；自由移动 = 扩张正弦（基础振幅 **0.5**，x 速度 **0.8**），追踪半径 1.0；追踪 = 固定 **1.3** 速度，转向 **1/4** 每帧；【已命中】不存在

**「转向速度」的归属与语义（2026-10-08 补：所有者实机报告后逐条核对）**

- **归属：【追踪移动】**。三行备注都把「转向速度」写在【追踪移动】策略那一句里，与「固定 X 速度**向目标移动**」并列
  （S1 原文即「【追踪移动】策略：固定 2.2 速度向目标移动，转向速度 1/6 每帧」）；【自由移动】那一句只有策略与速度
  （S1 是"固定 1.7 速度向当前方向移动"）。**天赋备注的两张参数表**同样如此：两张表的行是「更新间隔 / 最短自由移动」、
  「【自由移动】」、「追踪范围半径 / 追踪速度」、「转向速度（每帧）」，即转向速度与追踪速度同行（1.0 / 2.0），
  两张表的差别只在【自由移动】策略（无目标 = 扩张正弦 0.3/1.3，有目标 = 固定 2.0 沿当前方向）与转向速度
  （无目标 **7/30**、有目标 **1/6**）——所以 7/30 与 1/6 是**同一个位置的两张表取值**，按"发射时有没有目标"选
  （`noteSteer` 的 `st.aimed`），不是"自由态转向 / 追踪态转向"。
- **语义：朝向 = 目标方向，转向速度只是朝向变化速率的上限**。备注没有"径直"这个词，但同一句里的
  **「向目标移动」**加上所有者的实机裁定（「一旦锁定敌人后应该径直冲向敌人，而不是在外部兜圈」）就是判定口径：
  锁定后速度方向指向目标，每帧朝向最多转"剩余夹角 × 转向速度"；朝向落在目标的**后半球**时（按上限转仍在远离它，
  那正是"兜圈"）直接指向目标。**不允许出现环绕：锁定后距离每帧严格下降**。
  数值一个都没改，改的是这条语义 —— 实现、原始时间线与逐音符前后对照见 **§5.7**。

**对照本项目现状（需要改的）**：S1 现在是"随机 ±15°、间隔 0.1s 依次发"→ 应为**固定扇形 ±13.125°、每只相差 3.75°、顺时针**；音符运动现在只有一套（天赋的）参数 → 应为**按技能分别取上表**；S2 的钢琴"穿过敌人"现在是命中瞬间在 0.9 格补刀 → 官方是【已命中】态 0.8 半径碰撞 + 3.0 速度继续飞 0.5s；S3 免死优先级应为 −3000（现在 −80）且"自身退场时"也要退场。（**前三条已实现**：扇形见 §5.4，逐技能参数见 `NOTE_*`，【已命中】见 `noteSteer` 的 `hit` 分支；免死 −3000 见 §5.6。）
