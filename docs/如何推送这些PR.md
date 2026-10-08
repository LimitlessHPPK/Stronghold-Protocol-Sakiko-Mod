# 怎么把这些 PR 推到上游（本机受限时的操作手册）

> **为什么需要这份文档**：本机（`E:\`）到 GitHub 的**大流量传输会断**——
> `git clone` / `git fetch`（哪怕是 `--depth=1`）都是 `fetch-pack: unexpected disconnect while reading sideband packet` / `early EOF`；
> 而 **`git push` 与 GitHub API 都正常**。结果是：我们**造的出补丁，却造不出"与上游共史"的分支**，
> 于是 GitHub 拒绝建 PR（`The branch has no history in common with sganggs:master` ✗）。
> 换一台网络正常的机器（或挂上能稳定访问 GitHub 的代理），按下面三步即可发布。

---

## 0. 现状（2026-10-08）

| 项 | 状态 |
|---|---|
| 补丁与描述 | ✅ 全部就绪，见 `pr-out/0.2.1/<name>/`（每个目录含 `*.patch` + `PR-描述.md` + `PR-en.md`，部分含 `files/`、`verify/`） |
| 补丁正确性 | ✅ 每个补丁都在**纯净 v0.2.1** 上 `git am -3` 验证过：重放出的 tree 与开发分支**逐位相同** |
| 已推到 fork 的分支 | ⚠️ `pr-b-audio` / `pr-c-skillsfx` / `pr-d-assets` 是**孤儿分支**（无上游历史）→ **建不了 PR**，已在脚本里删除；`port/*` 四个分支的强推**因本机缺对象失败**，fork 上仍是旧的 v0.2.0 版本 |
| 四个已有 PR | #290 zoom/pan · #291 IPv6+dev-grant · #292 音效重放 · #293 攻速词条 —— 仍指向旧的（v0.2.0）分支，**待用 v0.2.1 版本强推更新** |

---

## 1. 一次性准备（网络正常的机器）

```bash
# 1) 克隆你的 fork（必须带完整历史：本机这一步会断，所以做不了）
git clone https://github.com/LimitlessHPPK/Stronghold-Protocol.git
cd Stronghold-Protocol
git remote add upstream https://github.com/sganggs/Stronghold-Protocol.git
git fetch upstream master
git checkout -B local-base upstream/master        # 以当前上游 master 为基
```

## 2. 依次应用五组补丁（每组一个分支）

补丁目录（本机）：`E:\Stronghold-Protocol-v0.1.4\pr-out\0.2.1\`

| 目录 | 分支名（**沿用已有 PR 的 head 名，才能更新 PR**） | 内容 |
|---|---|---|
| `01-zoom-pan/` | `port/zoom-pan` | 地图缩放/平移（3 补丁） |
| `02-ipv6-dev-grant/` | `port/ipv6-dev-grant` | IPv6 双栈 + `/dev/grant` + 设置迁移（3 补丁） |
| `03-audio-early-replay/` | `port/audio-early-replay` | 进战场音效重放（1 补丁） |
| `04-attack-speed/` | `port/attack-speed` | 模组条件攻速词条（1 补丁） |
| `client-audio-limiter/` | `pr-b-audio`（新 PR） | 按 (URL,单位) 间隔 + 事件音优先级 |
| `client-skill-sfx/` | `pr-c-skillsfx`（新 PR） | 按技能细分音效 + 持续段循环音 |
| `assets-dropped-leaf-report/` | `pr-d-assets`（新 PR） | 素材叶子静默丢弃 → 报告 + `--strict` |
| `engine-content-capabilities/` | `pr-e-engine`（新 PR） | 引擎四项整合（**注明为 Sakiko Mod 准备**） |

```bash
apply() {  # apply <分支名> <补丁...>
  local br="$1"; shift
  git checkout -B "$br" upstream/master
  git am -3 "$@" || { echo "!! $br 应用失败，需人工处理"; return 1; }
  # 三道 CI（本仓库的约定）
  npx eslint . && npx tsc --noEmit --checkJs -p jsconfig.json && node tools/check-imports.mjs
  git push -f origin "$br"
}

P=/path/to/pr-out/0.2.1
apply port/zoom-pan            $P/01-zoom-pan/*.patch
apply port/ipv6-dev-grant      $P/02-ipv6-dev-grant/*.patch
apply port/audio-early-replay  $P/03-audio-early-replay/*.patch
apply port/attack-speed        $P/04-attack-speed/*.patch
apply pr-b-audio               $P/client-audio-limiter/*.patch
apply pr-c-skillsfx            $P/client-skill-sfx/*.patch
apply pr-d-assets              $P/assets-dropped-leaf-report/*.patch
apply pr-e-engine              $P/engine-content-capabilities/*.patch
```

> ⚠️ `data/assets.json` 是**生成物**：若上游 master 已前进到会改动它的提交，`git am` 可能在此文件冲突 ✗。
> 处理办法：**不要文本合并**——冲突时 `git checkout --theirs data/assets.json` 之后按该 PR 的
> `verify/manifest-diff.*` 重新生成（各 PR 目录里都写了做法），或直接重跑清单工具。

## 3. 更新已有 PR / 开新 PR

- **`port/*` 四个分支强推后**，PR #290–#293 **会自动更新**（无需其它操作）；顺手在每条 PR 里贴一句
  "Rebased onto v0.2.1; the patch is a byte-exact replay of the branch (verified by `git am` on a pristine v0.2.1 — the resulting tree hash matches)"。
- **四个新分支**用对应的 `PR-en.md`（`TITLE:` 行 + `---` + 正文，可直接粘）开 PR，base 选 `master`。
- 全部描述里都已经写清：**基于 v0.2.1**、**验证命令与结果**、**golden 说明**、
  以及（对 02 与 E）"若维护者想拆分/只收一部分该怎么做"。

## 4. 本机可用的替代路径（如果暂时没有别的网络）

GitHub API 是通的 ⇒ 可以用 **服务端**造分支（`POST /git/blobs` → `/git/trees`（`base_tree` = 上游 master 的 tree）→ `/git/commits` → `POST /git/refs`），
每一步都在 GitHub 侧完成，**不需要本地历史**；随后照常开 PR。缺点是每个改动文件都要传一次 blob（C 组那个 1.1 MB 的 `data/assets.json` 也在内）。
需要的话我可以写这个脚本。

---

## 附：本轮产物的完整清单

```
pr-out/0.2.1/README.md                          索引（含"四分支共存 + 15 种子集组合"验证结果）
pr-out/0.2.1/ci-check.ps1                        三道 CI 一键脚本（-Suite 可跑全套件并排除 fullmatch）
pr-out/0.2.1/01-zoom-pan/                        3 patch + files/ + PR-描述.md + PR-en.md
pr-out/0.2.1/02-ipv6-dev-grant/                  3 patch + files/（8 个新增文件）+ 描述
pr-out/0.2.1/03-audio-early-replay/              1 patch + 描述（无新增文件）
pr-out/0.2.1/04-attack-speed/                    1 patch + files/ + 描述（含 matchrun 输出）
pr-out/0.2.1/client-audio-limiter/               1 patch + files/ + 描述 + verify/probe-limiter.mjs
pr-out/0.2.1/client-skill-sfx/                   1 patch + 描述 + verify/manifest-diff.{mjs,txt}
pr-out/0.2.1/assets-dropped-leaf-report/         1 patch + files/ + 描述 + evidence/（8 份原始日志 + 影子树脚本）
pr-out/0.2.1/engine-content-capabilities/        （E 组交付后出现）
```
