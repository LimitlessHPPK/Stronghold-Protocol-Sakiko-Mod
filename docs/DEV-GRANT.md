# 开发用发牌 / 改资金 / 设置盟约层数端点（本地）

`server/dev-grant.js` 提供的一个**默认关闭**的调试通道：给玩家发干员、改资金、**强制自选编队**、**设置盟约层数**。
它存在的原因是
房间只存在于这个进程的内存里，而协议（`shared/protocol.js`）没有任何发放/调试/管理消息，所以
没有正规办法在对局中途给玩家发牌。

0.2.0 把服务器入口拆开了：路由挂在 `server/http/routes.js`（`GET /dev/grant` 与 `/healthz` 并列），
开关与接线在 `server/index.js`（`SP_DEV_GRANT=1` 才 `createDevGrantHandler`）。

## 启动

必须带 `SP_DEV_GRANT=1`，否则路由根本不注册（`/dev/grant` 就是普通静态 404）。

```powershell
cd <仓库根目录>
$env:SP_DEV_GRANT=1
node server/index.js
```

启动后日志会有一条显眼的警告：

```
[dev-grant] ENABLED (SP_DEV_GRANT=1): GET /dev/grant from this machine can hand operators to a player
```

## 用法

```powershell
# 先看有哪些房间和对局（不带任何动作参数就是发现模式）
curl.exe "http://127.0.0.1:3000/dev/grant"

# 发干员
curl.exe "http://127.0.0.1:3000/dev/grant?chess=chess_char_5_01_b"
curl.exe "http://127.0.0.1:3000/dev/grant?chess=chess_char_5_02_a&count=3"   # 3 张自动合成精锐

# 改资金
curl.exe "http://127.0.0.1:3000/dev/grant?funds=99"        # 设成确切的 99
curl.exe "http://127.0.0.1:3000/dev/grant?fundsAdd=50"     # 加 50（可负数）

# 设置盟约层数（设为，不是增加）
curl.exe "http://127.0.0.1:3000/dev/grant?bond=swiftShip,sargonShip&layers=500"
curl.exe "http://127.0.0.1:3000/dev/grant?bond=yanShip&layers=0"        # 清空层数也是合法操作

# 多人 / 多房间时定位
curl.exe "http://127.0.0.1:3000/dev/grant?chess=...&room=DLVF&player=p_xxxx"
```

| 参数 | 说明 |
|---|---|
| `chess=<id>[,<id>…]` | 要发的干员 id（可多个，逗号分隔） |
| `count=N` | 每个 id 连发 N 张（1–50，默认 1）。N=3 会自动合成精锐 |
| `funds=N` | 资金设成确切的 N |
| `fundsAdd=N` | 资金加 N（负数为减） |
| `bond=<bondId>[,<bondId>…]` | **设置盟约层数**：要设置的目标盟约 id（可多个，逗号分隔；见下节） |
| `layers=<N>` | 配合 `bond=`：把这些盟约的层数**设为** N（0–999，`BOND_LAYER_CAP`） |
| `room=CODE` | 多房间时指定房间码（大小写不敏感） |
| `player=ID` | 多人局指定玩家（单人局可省略） |
| `toTemp=1` | 强制进暂存区而不是手牌 |
| `diy=<charId>` | **任意发牌**：强制把这个干员写进目标玩家的某个自选槽（见下节） |
| `skill=<0\|1\|2>` / `module=<uniEquipId>\|none` / `elite=1` / `slot=<slotBaseId>` | 配合 `diy=` 的技能 / 模组 / 精锐形态 / 指定槽位 |

## 任意发牌：强制自选编队（`diy=<charId>`）

自选编队（DIY）的机制决定了「给没选人的玩家发自选干员」必须先从**玩家自己**身上入手：

- 棋子只有 4 个通用占位（`chess_char_{5,6}_diy{1,2}_a`／`_b`），**干员身份来自该玩家的 pick**
  （`shared/diy.js` `diyRecordOf`：槽位的等阶 / 价格 / 合成 / 状态 + 干员的数值、技能、模组、盟约）；
- 每个槽的份数是**该玩家自己的库存**（`server/match/player/diy.js` `DiyStock`：5 阶 8 份 / 6 阶 5 份），
  `poolOf(slotId)` 命中 DIY 时取的就是它；
- `initDiyStock` 只为**已填槽**、且盟约未被禁的槽发库存；玩家没填的槽在 `ps.gd` 里没有 `diyFor`
  → `acquireChess` 直接拒绝——旧版响应里那句笼统的 `refused` 就是从这里来的。

所以 `diy=<charId>` 先**把这个 pick 写进目标玩家**（`PlayerDiy.forceDiyPick`：用**新对象**覆盖 `ps.diy`，
冻结的旧对象不改；重建该槽两种形态的合成记录与 `ps.gd` 视图；重建该槽库存），然后才照常发 1 只。
它对三种情况都生效：玩家**没选人**、**选了别人**、**对局已经开始（picks 在开局时冻结）**。

```powershell
# 自动挑一个空闲的自选槽，发普通形态
curl.exe "http://127.0.0.1:3000/dev/grant?diy=char_4182_oblvns"

# 精锐形态 + 指定技能与模组
curl.exe "http://127.0.0.1:3000/dev/grant?diy=char_4182_oblvns&elite=1&skill=2&module=uniequip_002_oblvns"

# 明确指定槽位（写 _b 槽位 id 也等于 elite=1）
curl.exe "http://127.0.0.1:3000/dev/grant?diy=char_601_cguard&slot=chess_char_5_diy1_a"

# 连发 3 只 → 自动合成精锐（和 chess= 一样走正规合成路径）
curl.exe "http://127.0.0.1:3000/dev/grant?diy=char_4182_oblvns&count=3"

# 多房间 / 多人时照旧必须带 room= / player=
curl.exe "http://127.0.0.1:3000/dev/grant?diy=char_4182_oblvns&room=DLVF&player=p_xxxx"
```

| 参数 | 说明 |
|---|---|
| `diy=<charId>` | 强制把该干员写进目标玩家的一个自选槽、重建该槽库存，然后照常发 1 只（`count=` 同样适用） |
| `skill=<0\|1\|2>` | 写进 pick 的 `skillIndex`（默认：该槽原有 pick 的技能 → 原型干员的锁定技能 → 0） |
| `module=<uniEquipId>\|none` | 写进 pick 的 `uniEquipId`（默认：该槽原有 pick 的模组 → 原型干员的锁定模组 → 不带） |
| `elite=1` | 发精锐形态（`_b`）；默认 `_a` |
| `slot=<slotBaseId>` | 显式指定槽位；不传就自动挑：**空闲的 6 阶槽**，6 阶没有就空闲的 5 阶槽，全满则覆盖 6 阶槽 |

自动挑槽有一个例外：这个干员**只在 5 阶的池子里**（例如 4★ 预备干员 `char_601_cguard`）时优先挑 5 阶——
否则 sim 会拒绝它（见下）。响应里的 `notes` 会说明为什么挑了这个槽。

### 语义与响应

- **旧的 pick 用新对象覆盖**（`ps.diy = Object.freeze({ ...旧, [slot]: 新pick })`），冻结的旧对象**不被改写**
  （和 `setDiy` 一样）；响应里的 `picksBefore` / `picks` 是覆盖前后的**完整**编队。
- **库存重建**：该槽按 `economy.poolCopies[tier]` 重新给满，并从 `diyBanned` 里移除（即使这名干员的盟约
  本局全被禁）。发出去的份数照常从这份库存里扣，响应里的 `stock` 给出 `cap` / 重建前 / 现在还剩几份。
- **不校验池子，但要如实标注**：干员可以不在 `diy.ownedPool` 里（这就是「任意」）。响应给出
  `resolved.ownedPool`、`resolved.pooled`（是否在该阶的池子里）、`resolved.pooledTiers`、`resolved.kitted`
  与 `resolved.kit`；`kit` 为 `fallback` 表示它没有 kit 文件，模拟按职业走泛用 kit
  （`server/sim/content/generic.js` + `genericTalents`）。
- **`resolved.sim` 是「能不能打」的唯一判据**：sim 与客户端都会用 `shared/diy.js` `diyRecordOf`（内部
  `checkDiyPick`）**重建**这只棋子的记录，所以池子之外的 pick（`sim: false`，`resolved.check` 给出
  `checkDiyPick` 的原话）在**对局内**成立（手牌 / 详情 / 商店 / AI 都按该干员），但**进战场时会被拒绝、
  部署不出来**。`diy=` 不会因此失败：它照发，只在 `notes` 里说清。
- **失败就什么都不做**：未知 charId、不是自选槽、技能 / 模组不属于该干员、`skill=` / `module=` 格式不对
  → **400**，`error: "diy"`，`detail` 给出具体原因（例如 `no skill 9 for char_4182_oblvns at tier 6 (has: 0, 1, 2)`），
  pick、库存、手牌一律不动。pick 才是这次调用的目的，半途生效比干净失败更糟。
  另有一种 `ok: false` 是 **409**：pick 已经写进去了（`picks` / `resolved` 有值），但这一只没发出去
  （`failed` 给出原因，例如整备区满）—— 看响应里的 `picks` 就能分辨这两种。
- 成功响应（`diy=` 时才有 `picksBefore` / `resolved` / `stock`；`picks` / `notes` 总是有）：

```json
{
  "ok": true, "roomCode": "DLVF", "playerId": "p_0", "phase": "PREP", "round": 3,
  "picksBefore": {},
  "resolved": { "charId": "char_4182_oblvns", "name": "丰川祥子", "skillIndex": 0, "uniEquipId": null,
                "tier": 6, "elite": false, "slot": "chess_char_6_diy1_a", "chessId": "chess_char_6_diy1_a",
                "skillId": "skchr_oblvns_1", "ownedPool": true, "pooled": true, "pooledTiers": [5, 6],
                "prototype": false, "kitted": true, "kit": "operator", "sim": true },
  "picks": { "chess_char_6_diy1_a": { "charId": "char_4182_oblvns", "skillIndex": 0, "uniEquipId": null } },
  "granted": [{ "id": "chess_char_6_diy1_a", "count": 1, "name": "丰川祥子" }],
  "stock": { "slot": "chess_char_6_diy1_a", "cap": 5, "before": null, "left": 4 },
  "failed": [],
  "notes": ["自动选了 6 阶的空闲槽 chess_char_6_diy1_a。", "库存 chess_char_6_diy1_a：没有 → 4（cap 5）。"]
}
```

`notes` 是排查用的中文说明：覆盖了谁、技能 / 模组是不是沿用了旧 pick（旧的技能 / 模组不属于新干员时会说）、
有没有 kit、sim 认不认、盟约是否本局全禁、同一个干员是不是占了两个槽……先读它，再看 `resolved`。

### 列表接口也带编队（只读）

不带任何动作参数的 `GET /dev/grant` 现在每个玩家多两项：`picks`（当前的自选编队）与 `diyStock`（每个槽还剩
几份），每个对局多一项 `diySlots`（四个槽位 id）。它们都是**只读**诊断信息，端点本身只在回环上——排查
「为什么发不进去」时先看这里。（响应形状因此变了；`test/dev-grant.test.js` 的对应断言已按新设计更新。）

### ⚠️ 这是调试口：账目不真实

`diy=` **会改写这一局的真实状态**，请只把它当沙盒：

- 它绕过了 `room.diy` 的全部校验（池子、kit、同阶两个槽不能是同一人、已拥有干员只占一个槽……），能造出
  **正常编队做不出来**的局面（同一个干员占两个槽、别人池子里的干员、没有 kit 的干员）；
- 它**重建了该槽的库存**：这一局该槽的商店抽卡概率与 `left` 记账因此改变，**不要据此推断商店概率**；
- 库存**发完了也照发**（和 `chess=` 一样不受份数上限约束）：超出的份数记 0 份，所以 `left + held == cap`
  这条不变量仍然成立，只是该槽 `left` 归零后就不再进入商店抽卡（`diyRollEntries` 只抽还有份数的槽）；
- 它按需**覆盖冻结的 picks**：这一局的干员身份被换掉了（客户端下一次 `m.private` 也会跟着换），
  下一局仍按玩家自己的编队设置；
- 和下面「实测补充」同一条道理：开发端点发放**不代表**该数量在正常玩法里可得。

## 设置盟约层数（`bond=` / `layers=`）

给目标玩家的任意盟约**设一个确切的层数**（`ps.layers[bondId]`），用来试高层的盟约效果（例如把迅捷 `swiftShip`
与萨尔贡 `sargonShip` 都设成 500）。它和发牌 / 改资金一样只在 PREP / SETTLE 放行，走同一套四道闸。

```powershell
# 迅捷与萨尔贡都设成 500
curl.exe "http://127.0.0.1:3000/dev/grant?bond=swiftShip,sargonShip&layers=500"

# 清空（0 是合法值，不是「不设置」）
curl.exe "http://127.0.0.1:3000/dev/grant?bond=yanShip&layers=0"

# 多房间 / 多人时照旧必须带 room= / player=
curl.exe "http://127.0.0.1:3000/dev/grant?bond=swiftShip&layers=500&room=DLVF&player=p_xxxx"
```

### 语义

- **「设为」而不是「增加」**：`layers=N` 是目标值。**上限仍是 999**（`shared/constants.js` `BOND_LAYER_CAP`，
  官方客户端的 `MAX_GARRISON_STACK`），端点不绕过它——`layers=1000` 直接 400。
- **加层走引擎的门，降层只能直接写**：目标值**高于**当前层数时走 `PlayerState.addLayers`
  （`server/match/player/economy.js`：`layerGainRoom` 夹到 999、`onLayers` 照常派发，所以里程碑 / 「每 N 层」的
  效果和一次正常加层一样被结清）；**低于**当前层数时引擎没有对应的 API（层数只有「加」这一个门），端点直接写
  `ps.layers[bondId]` + `ps.recompute()`——里程碑只往前结清，所以降层不会退款、也不会被引擎回滚。
- **跨回合保留**：写的是**持久层数** `ps.layers[bondId]`（`server/match/PlayerState.js`）。每场战斗的输入都由
  `PlayerState.battleInput()` → `bondsMeta.bondSnapshot()` 从它初始化，所以**这局接下来的战斗立刻按新层数算**，
  并且一直保留到对局结束。
- **当前战斗的实时副本一起同步**：`Battle.addLayers` 写的是战斗里的实时副本
  （`battle.getPlayer(pid).bonds[bondId].layers`）。端点对**这一局还握着战场的那些 `m.fields`** 一并写同一个值；
  战斗自己的 `layerGains` 是**增量**、不被动过，所以结算（`Match.settle`）加的还是那一场真正涨的层数，不会重复计。
- **客户端刷新就能看到**：层的持久值经 `computeBonds` 进视图，`bondList` 会把 `layers > 0` 的盟约列出来，
  所以 `m.private` / `m.public` 都带新层数（响应后照旧 `ps.dirty()` + `m.flush(true)` 立即推一次）。
  没有新协议消息。
- **不存在的盟约记录会被创建**：调试口按方便来——盟约在这个玩家身上此前没有任何记录（无成员、无层数、未激活）
  也照样写，响应里 `created: true` 说明它此前不存在。`modeInactiveBonds`（本局禁用）里的盟约也写持久值，
  但视图只会把它当灰记录，`notes` 会说。
- **⚠️ 层数不等于激活**：盟约是否生效取决于**成员数**（`computeBonds` 的 count / tier），战斗内容对未激活的盟约
  **什么都不注册**（`server/sim/content/bonds/*` 的 `install` 只看 tier ≥ 1）。所以「设成 500」之后还要让场上
  凑够人（迅捷 2 名不同干员、萨尔贡 3 名），否则 500 层只是个数字。响应的 `active` 与 `notes` 会直说。

### 响应

```json
{
  "ok": true, "roomCode": "DLVF", "playerId": "p_0", "phase": "PREP", "round": 3,
  "picks": {},
  "granted": [], "failed": [],
  "bonds": [
    { "bondId": "swiftShip", "name": "迅捷", "before": 0, "after": 500, "active": false, "created": true },
    { "bondId": "sargonShip", "name": "萨尔贡", "before": 0, "after": 500, "active": false, "created": true }
  ],
  "notes": [
    "swiftShip（迅捷）此前在该玩家身上没有任何记录：已新建并把层数设为 500。",
    "swiftShip 未激活（成员数 0）——层数会保留，但盟约效果只在激活后按层数生效，先让它在场上凑够人。",
    "当前没有握着战场（PREP / SETTLE）：下一场战斗的输入从持久层数初始化（battleInput → bondSnapshot）。"
  ]
}
```

`bonds[]` 每个目标一条：`bondId` / `name` / `before`（写之前的层数）/ `after`（写之后）/ `active`（写完之后是否
激活，看成员数）/ `created`（此前是否完全没有记录）。`notes` 是排查用的中文说明（新建、降层、清空、到上限、
未激活、本局禁用、实时副本同步了几个战场）。

### 失败

**先全部校验、再写**：任何参数问题都是 **400** `error: "bond"` + `detail`，**什么都不写**——包括同一个请求里带的
`chess=` / `funds=`（和 `diy=` 一条规矩：半途生效比干净失败更糟）。

| 情况 | 响应 |
|---|---|
| `bond=` 没给 / 空 | 400 `bond= 要给出至少一个盟约 id，例如 bond=swiftShip,sargonShip&layers=500` |
| `layers=` 没给 / 空 | 400 `layers= 要给出层数（0–999）…` |
| 非整数（`abc` / `1.5` / `-1`） | 400 `layers= 只接受 0–999 的整数：<原值>`（原值照抄，不做四舍五入） |
| 越界（`>999`） | 400 `layers= 超出上限：1000 > 999（BOND_LAYER_CAP，shared/constants.js）` |
| 未知 bondId | 400 `未知盟约 id：xxx`，响应另带 `unknown: [...]` 与 `available: [全部盟约 id]` |
| 没有进行的对局 | 404（和发牌一样） |
| 多房间没带 `room=` | 404（和发牌一样） |
| 阶段不允许（`COMBAT` 等） | **409**，`phase` 给出当前阶段；**不改任何东西**（连持久值也不改） |

### ⚠️ 这是调试口：数值会脱离正常玩法

- 正常玩法里一层一层攒的盟约，这里可以一步到 999；**不要用它判断平衡**，也不要拿它的数字当「这个盟约有多强」。
- **降层是引擎里不存在的手工状态**：它直接改持久值，里程碑已经付过的东西不会退回（层数掉下去，之前拿到的
  资金 / 装备 / 折扣都留着）；再往上加时 `onLayers` 会照常派发。要「干净」的对比请在两个房间里分别设。
- **实时副本只在还握着战场时同步**：PREP / SETTLE 正常没有战场（`startRound` / `settle` 会清空 `m.fields`），
  此时下一次战斗从持久值初始化；真正在跑的 COMBAT 被第三道闸挡着（409）。
- 和 `chess=` / `diy=` 一样，改过的房间状态**不再代表正常对局**：排查「为什么效果不对」时先看 `active`。

### 列表接口也带层数（只读）

不带任何动作参数的 `GET /dev/grant` 现在每个玩家再多一项 `bonds`：`{bondId: {layers, count, active}}`——
只列**有成员 / 有层数 / 已激活**的盟约（`bondsMeta.bondList` 的规则，也就是客户端条上会出现的那些）。
它是**只读**诊断信息（响应形状因此又变了一点；`test/dev-grant.test.js` 的对应断言已按新设计更新）。

## 四道安全锁

1. **默认关闭** —— 没有 `SP_DEV_GRANT=1` 就不注册路由（`server/index.js` 只在开关打开时才
   `createDevGrantHandler`，`server/http/routes.js` 也只在这个 handler 存在时接 `/dev/grant`）
2. **仅本机** —— 非回环来源一律 403（即使开了开关）。LAN 和公网都进不来
3. **走正规门** —— 干员走 `PlayerState.acquireChess`（`server/match/player/acquire.js`），资金走
   `PlayerState.addFunds`（`server/match/player/economy.js`），盟约层数**加层**走 `PlayerState.addLayers`
   （同一个文件；降层 / 清空只能直接写持久值，见上节），和购买 / 奖励 / 效果同一条路径：
   扣共享池份数、处理整备区溢出、合成照常出精锐、`gainedChess` / `fundsGained` 统计照常更新、
   层数照常被 `layerGainRoom` 夹在 `BOND_LAYER_CAP` 且派发 `onLayers`。
   **不直接写棋盘状态**，所以 `server/match/invariants.js` 与 `server/match/audit.js` 依然成立
4. **对局中拒绝** —— 只放行 `PREP` / `SETTLE`。原因很具体：`acquireChess` 唯一无法保证
   安全的情况是**发牌正好凑齐合成**，此时 `_mergeChess` 会把精锐强行推上棋盘，而客户端
   正在跑这一回合，审计（`server/match/audit.js`）会记成异常。其他阶段返回 409 并告知当前阶段。
   盟约层数沿用同一道闸（`COMBAT` 期间连持久值也不改），理由是为了和发牌保持一致：
   战斗中途改层数会让客户端正在跑的那一场与服务端的实时副本 / 战报 `layerGains` 记账对不上，
   要留给下一回合就等 SETTLE

## 已知陷阱

- **`funds=+50` 会被拒绝**（409，资金不变）。URL 查询串里的 `+` 会解码成空格，`Number(' 50')`
  恰好等于 50，所以它会静默变成「设成 50」。加法必须用 `fundsAdd=`。校验针对**原始值**，
  带 `+`、带空格、带符号一律拒绝且不写入任何东西。
- **资金只在这一回合有效。** `economy.leftoverFundsLost: true` —— 休整期结束时没花完的资金会
  被清零（只有 `band_cannot` 策略保留）。这是官方规则，端点没有绕开它。
- **精锐干员会扣 `goldenCopies`=3 份池子**（普通扣 1 份）。这是正规合成路径的记账方式，
  不是凭空造牌，所以商店剩余概率保持正确。5 阶角色每局池子 8 份。

## 常用干员 id

| 干员 | id | 阶 | 备注 |
|---|---|---|---|
| 缇缇 | `chess_char_5_02_a` | 5 | 精锐 `_b`；带 `garrison_125_a` |
| 圣约送葬人 | `chess_char_5_01_a` | 5 | 精锐 `chess_char_5_01_b` |
| 风丸 | `chess_char_2_11_a` | 2 | **只需 2 张合成**（全干员唯一例外） |
| 跃跃 | `chess_char_1_09_a` | 1 | |

完整 id 表在 `data/chess.json`。精锐形态的 id 一律是普通 id 把结尾 `_a` 换成 `_b`。

## 测试

`node --test test/dev-grant.test.js` —— 29 条，三组：

- **dev grant channel（11 条，桩对局）**：开关解析、四种非回环地址全被拒、发现模式（现在带 `picks` /
  `diyStock` / `bonds` / `diySlots` 与 `bond=` / `layers=` 的用法串）、正规门参数、立即 flush、各阶段放行/拒绝、
  未知 id / 手牌满 / 无对局 / 多房间歧义 / 玩家不存在、资金三个参数形态与三种畸形输入。
- **任意发牌（9 条，真对局，`test/match/harness.js`）**：没选人的玩家被强制 pick 后**那只棋子在 sim 里就是
  该干员**（`m.ds.getChess(id, { diy })` 的 `def.charId` / 技能 id，以及 `battleInput` 的 `diy`）、精锐形态
  与 `skill=` / `module=`、覆盖原有 pick（前后 picks + 冻结对象不被改写）、对局进行中仍然生效、`ownedPool`
  之外的干员（合法阶位仍能打 / 池子外 `sim: false` 如实标注）、`count=3` 合成精锐且库存记账平衡、
  写不进去时的具体原因（什么都不写）、`diy=` 不绕过四道闸、列表接口的只读编队。
- **设置盟约层数（9 条，真对局）**：一次设多条盟约并新建缺失记录、客户端视图（`privateView` / `publicView` /
  `m.private` 的 flush）带 500、**设为而非增加**（降到 200、`layers=0` 清空、同值幂等、999 封顶且此后加层为 0）、
  **下一场战斗从新层数初始化**（`battleInput().bonds[…]`）且**跨回合保留**（`h.toPrep(2)`）、
  **还握着的战场实时副本同步**（`battle.getPlayer(pid).bonds[id].layers`，且战斗自己的 `layerGains`
  仍是增量）、参数校验（未知 id + `available` 列表 / 越界 / 非整数 / 缺 `bond=` / 缺 `layers=`，
  **什么都不写**，连同一个请求里的 `chess=` / `funds=` 也不生效）、四道闸、列表接口的只读层数。
  外加两条「**500 层确实按 500 算**」的证据（真战斗，用盟约测试自己的读法）：
  - **迅捷**：`procChance(bondBb('swiftShip'), 500) = 1`（0 层是 0.20），且成员技能结束时**真的**拿到
    `normal_sp` 12 + `power_sp` 15（`spGain` 钩子，40 层以上那一档也因 500 ≥ 40 而生效）；
  - **萨尔贡**：同一个玩家同一块棋盘，0 层时 ASPD 堆叠持续 `base_time` 5 s，设成 500 后
    `battle.getPlayer(...)` 读到 500、堆叠持续 `5 + 0.22×500 = 115 s`（`bond:sargon` 的 `timeLeft`），
    并真的涨了 `base_attack_speed` 12 点攻速。

每条真对局用例都跑 `h.invariants()`（`server/match/invariants.js`），包括 `left + held == cap` 的自选库存记账。

---

## 实测补充：共享池份数**不是**这条端点的约束（2026-10-07）

文档上面写着"精锐干员会扣 `goldenCopies`=3 份池子 / 一局最多一只精锐"——那是**商店与合成**那条路的记账规则。
**实测 `/dev/grant` 本身不校验、也不受共享池上限约束**：

```
GET /dev/grant?chess=chess_char_6_21_b&count=8&room=XADF
  → {"ok":true,"granted":[{"id":"chess_char_6_21_b","count":8}]}
```

6 阶干员在共享池里只有 **5 份**（`economy.poolCopies[6] = 5`），一只精锐按商店路径要占 **3 份**，
所以商店/合成路径下**一局最多 1 只精锐**（买/合成会正确地 `SOLD_OUT`）；而这条开发端点一次发了 8 只（= 24 份）。

**含义**：
- 开发端点发放**不代表**该数量在正常玩法里可得；用它做"发放几只"的沙盒没问题，但**不要用它推断商店概率**。
- 被这样发放过的房间，其**池子账目不真实**（她那一项可能已空或为负），该局的商店刷新概率随之失真；
  `matchrun` 的引擎不变量**不**检查这一项，所以不会报错。
- 若希望端点也守池子上限，或反过来把"绕过池子"变成**显式**行为（例如加 `free=1`），改一处即可——目前是默认绕过。
