# Assets: sources, layout, manifest, credits

Owner: `tools/fetch-assets.mjs` and `tools/assets/*`. Research background: `docs/research/07-assets.md`.

All art, Spine models and audio are **downloaded at install time**. They are never committed; `public/assets/` is git-ignored.
Everything the client needs is listed in **`data/assets.json`**. The client should only request URLs that appear in that manifest.

## Running

```bash
npm install          # also vendors pixi / pixi-spine / preact / three (tools/vendor.mjs; three.js is fetched by
                     # browsers only when data/local-assets.json lists the board atlas — the 3D board, DESIGN §15)
npm run assets       # = node tools/vendor.mjs && node tools/fetch-assets.mjs
```

| Option | Effect |
|---|---|
| `--concurrency=N` | Parallel downloads (default 16). |
| `--force` | Re-download everything. |
| `--offline` | No network. Re-runs post-processing (atlas fixes, skeleton parsing, WOFF2) on what is already on disk, then rebuilds `data/assets.json`. |
| `--dry-run` | Print the plan (file and model counts, alias notes) and exit. |
| `--refresh-index` | Re-download the upstream indexes: `audio_data.json`, `charword_table.json` (the 干员战斗语音 slots) and `models_data.json`. |
| `--voice-lang=cn` | 干员战斗语音 language: `cn` (default) | `jp` | `en` | `kr` — the same file names under `voice_cn/`, `voice/`, `voice_en/`, `voice_kr/`. An operator the plan has no folder for in the asked dump keeps the dump that has one (`plan.mjs VOICE_LANG_OVERRIDE`, "An operator whose dub does not exist upstream" below); the summary then reads `(+1 on JP)` instead of claiming one language for every operator. |
| `--voice-all` | Plan every official voice slot, including the prep-only lines no battle plays (干员报到 / 编入队伍 / 任命队长 — 360 files, one per operator and slot). Off by default: nothing requests them, so planning them only makes every run download more. |
| `--prune` | Delete files under `public/assets/` that the manifest no longer references, for example after a mapping change. Without this flag they are only listed in the report. `public/assets/local/` (written by `tools/local-extract`) is never pruned. Implies `--allow-shrink`. |
| `--allow-shrink` | Write `data/assets.json` even when it loses entries the current one has (see "The manifest never shrinks by accident" below). |
| `--add-only` | For a checkout whose `public/assets/` and `public/fonts/` are shared with another one (a git worktree with symlinked asset folders): download only the files missing on disk and never re-download, rewrite or delete an existing file — atlases already on disk are left as they are, the fonts are not rebuilt (the manifest keeps its current `fonts`). Not with `--prune` / `--force`. |
| `--local-spines` | Rewrite `tools/assets/local-enemy-spines.json` and `tools/assets/local-token-spines.json` (the metadata of the enemy and token models only the local client has, see "Enemy aliases" and "Token models from the local client") from the models `tools/local-extract/extract.py` extracted to `public/assets/local/spine/enemy/` and `public/assets/local/spine/token/`. Run it after a game update changed them; without it the committed files are used and a differing extraction only gets a warning. |

**The manifest never shrinks by accident.** An entry whose files are missing on this machine is left out of a rebuilt
manifest, so a run where some downloads failed (or whose upstream audio / model index lost them) would drop entries that
every other install still has from the committed `data/assets.json` (a pull request once carried such a manifest, 42
audio entries short — all 42 still resolve upstream; PR #7). When the rebuilt manifest lacks an entry of the current
one, the run keeps the current file, prints the entries it would drop (also in the report: `droppedEntries`,
`manifestWritten: false`) and exits 1. Re-run to retry the downloads, or pass `--allow-shrink` (or `--prune`) when the
smaller manifest is intended, for example after a mapping change. Build fields (`version`, `hash`, `generator`,
`stats`), new entries and a changed value are never a drop (`tools/assets/manifest.mjs droppedEntries`). A run whose
plan legitimately narrows — like the 干员战斗语音 default, which no longer plans the three prep-only slots (360 entries,
DESIGN §21.30) — reports exactly those entries and needs `--allow-shrink` once; the list it prints is the check.

The script is **idempotent**. A file on disk is kept, not re-downloaded, when any one of these holds:
- its size matches the ledger entry from a previous download (`.cache/assets-ledger.json`);
- its size matches the byte count recorded in research;
- no size is known, but the file passes format validation. Validation checks the PNG signature and `IEND`, the MP3 header, the sfnt header, the atlas page line, and that a skel is not an HTML error page.

Every download is written to a temp file, then renamed into place. A partial download therefore never reaches its final path.

How downloads are fetched:
- 16 connections at a time.
- Each source gets 3 attempts with exponential backoff.
- If `raw.githubusercontent.com` fails, the jsDelivr mirror (`cdn.jsdelivr.net/gh/…`) is tried.
- There is no mirror for the ArknightsAssets2 `voice` branch, because jsDelivr returns 404 for it.
- A manifest entry with fallbacks (for example an enemy icon that falls back to its base enemy's icon) only moves on to the next alternative after a **definitive 404**. When the primary fails transiently (network error, 5xx or an invalid payload after all retries), no fallback is fetched. The path is listed under `downloadErrors` in the report, and the next run retries the primary.
- A skeleton that fails to parse is deleted and removed from the ledger, so the next online run downloads it again.

The first run downloads about **309 MiB in about 5,690 files** (it took 134 s on a ~3 MB/s link before the 55 emote and 玩法说明 files, 21.3 MiB, and the 1,680 干员战斗语音 files, 40.1 MiB, were added). A re-run takes about 1 s. The voice count is the twelve slots a battle plays; the three prep-only slots the official client uses elsewhere (干员报到 / 编入队伍 / 任命队长, 360 more files, 18.4 MiB) are left out unless `--voice-all` is passed.

### An operator whose dub does not exist upstream (local)

`plan.mjs VOICE_LANG_OVERRIDE` takes an operator OUT of `--voice-lang` when the dump that was asked for has no folder for
them at all — the one entry is 丰川祥子 (`char_4182_oblvns`), the Ave Mujica collaboration operator this repo adds as a
自选 (diy) pick (`data/backups.json ownedPool`, DATA.md §18). Her `charword_table` rows are ordinary rows that do carry a
`voiceAsset`, but `voice_cn/char_4182_oblvns/` is a 404 for all fourteen battle lines (`cn_019`–`cn_032`), while the JP
dump `voice/` carries every one of them under the very same file names — the whole collaboration is like that (祐天寺若麦
/ 三角初华 / 若叶睦 too). Her manifest entries therefore read `/assets/audio/voice/jp/…` and every other operator stays on
the planned dump; `stats.voiceChars` counts her like anyone else, and the run's summary says `(+1 on JP)`.

Those 14 files come from their own script, because `tools/fetch-assets.mjs` cannot get them on a machine whose hosts file
sends `raw.githubusercontent.com` to `127.0.0.1`: the voice branch has no jsDelivr mirror at all (this page, "How
downloads are fetched"), so a direct run only ever tries the blocked raw URL. `tools/fetch-voice-override.mjs` fetches
them with `curl` through the opt-in GitHub proxy — `SP_GITHUB_PROXY`, default `https://gh-proxy.com/`, the same prefix
`--asset-source=mirror` uses — validates them with `tools/assets/formats.mjs` and writes exactly the path the plan
resolves. It is idempotent (a valid file already on disk is kept; `--force` re-downloads, `--char=` limits it to one
operator, `--dry-run` only lists):

```
node tools/fetch-voice-override.mjs      # the missing lines → public/assets/audio/voice/jp/{charId}/…
node tools/fetch-assets.mjs --offline    # → data/assets.json picks them up
```

A later `npm run assets` keeps them: `downloader.mjs existingSize` falls back to content validation when the ledger has
no entry for a path.

### 技能发动音效（`sfx.units[charId].skills[skillIndex]`, local)

The skill's own sound is planned from the official bank `battle.ON_SKILL_START.<skillId>` (`tools/assets/plan.mjs`) and
played by the client as `sfx.units[charId].skills[skillIndex]` (`public/js/audio.js`), falling back to `.skill`.

Two bank shapes that rule does NOT cover are listed explicitly in `tools/assets/audio.mjs SKILL_START_BANKS`, because the
pool has **~104 more skills** whose only start bank is `battle.ON_ABILITY_START.<skillId>` (德克萨斯, 能天使, 银灰,
玛恩纳 …) — accepting that shape generically would rewrite about a hundred operators' entries and add about a hundred
files to every run, an engine-level decision this change deliberately does not take. The table holds the three skills of
丰川祥子 (`ON_ABILITY_START.skchr_oblvns_1`, `ON_SKILL_START.skchr_oblvns_2.1`/`.2`,
`ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]`; `indexAudio().skillStart` reads it only when the convention finds nothing):
her Chinese lines are missing (see above) and so were her skill sounds. Fetch them with
`node tools/fetch-voice-override.mjs --sfx` (same proxy policy as her voice; `--char=<charId>` reports, per skill, which
ones have no matching official bank instead of writing nothing silently).

### 普攻 / 命中音效（`sfx.units[charId].attack` / `.hit`）: 0.1.4 有 → 0.2.x 丢 → 现在恢复

The client plays a unit's `attack` on every `['atk', attacker, target, kind]` aimed at the other side and its `hit` on
the first `['dmg', target, …]` of `phys` / `arts` / `true` that follows within 2.5 s (`public/js/audio.js
handleBattleEvents`, `IMPACT_WINDOW_MS`). 丰川祥子's ordinary attack is a note her kit adds and the engine's own arrow
carries nothing (`ai.js noAttackVis` / `noAttackDamage`), so the attack event's `vis` is `'none'` — the client plays the
`attack` cue anyway (only the *drawing* reads `vis`), and the note's landing is the `dmg` that plays her `hit`.

**This is a port regression of 0.1.4, not a missing feature.** 0.1.4's manifest carried

```json
"attack": "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt.mp3",
"hit":    "/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt.mp3"
```

and 0.2.x shipped neither, so the note left her silently and its impact on the enemy was silent too. What was NOT lost
is the resolution: `plan.mjs` resolves both roles for a 自选 (diy) pick exactly like for a pool operator — the 自选 owned
picks join `extraOperators`, which is merged into the very loop that calls `pickUnitSfx`, and running the real
`buildPlan` on this tree's data produces a template whose leaves are the two files above. What was lost is the two
**files**. In 0.1.4 she was a normal chess, so a full `npm run assets` downloaded them with the rest of the pool. The
0.2.x port brings her in as a 自选 pick into a `public/assets` folder that is **shared between checkouts** and already
held thousands of files, and its manifest rebuilds ran `--offline --add-only` (which never downloads a file that is not
on disk yet) plus `tools/fetch-voice-override.mjs --sfx` for her three skill banks — which are exactly the sounds that
survived. (A plain `tools/fetch-assets.mjs` on this machine cannot reach the voice branch at all without the proxy —
see "An operator whose dub does not exist upstream" above — so nothing else was going to arrive for her either; a
`--asset-source=mirror` run or that script is what a new 自选 operator needs.) `manifest.mjs resolveTemplate` drops a
leaf whose alternatives are missing on disk, **silently**, among hundreds of legitimate misses (`fetch-assets.mjs
requiredMisses` checks `avatar` / `portrait` / `spine.front` only), so a role the plan HAD resolved disappeared from the
manifest together with its file. A new operator on the 自选 route therefore needs a run that actually downloads
(`node tools/fetch-assets.mjs --asset-source=mirror`, or `node tools/fetch-voice-override.mjs --sfx` for the activation
banks), not a rebuild of what is already there — and `audio.mjs UNIT_SFX_BANKS` now names her two roles outright so they
cannot drift again.

The official bank shapes, and why the table names them instead of trusting the conventions:

| role | bank(s) | file |
| --- | --- | --- |
| `attack` | `battle.ON_ABILITY_START.char_4182_oblvns.attack.4.1` | `Player/p_atk/p_atk_MJCkyrdslnt` |
| `hit` | `battle.ON_PROJECTILE_HIT.projectile_chr_oblvns`, `…projectile_chr_oblvns_talent` | `Player/p_imp/p_imp_MJCkyrdnt` |

`p_atk_MJCkyrdslnt` is carried by **exactly one** bank of the official `soundFXBanks` (13,108 in the 0.2.1 dump), and
the generic attack pass reaches it only because `normalModeBank` does not read `_slnt` as a skill take — the ten
`ON_ABILITY_ON.…attack.*` / `…combat.*` banks (the numbered default mode, `.0` included) carry the other take
`p_atk_MJCkyrdnt_h`, which `public/js/audio.js normalAttackSfx()` refuses for a normal attack (`_h` = a skill mode's
file, user playtest #4 item 6). Pinning the file the client actually plays is what restores 0.1.4's sound.

#### Investigation: 「以清单为准、不再靠文件名启发式」 (NOT changed — for the owner to decide)

`normalAttackSfx(defId, url)` refuses an operator's (`char_*`) `attack` / `hit` when the FILE NAME ends in `_d` / `_h` /
`_s` (+ digits) — the official naming of a skill mode's take (the normal attack's end in `_n`). It exists because the
plan once resolved 纯烬艾雅法拉's S3 impact `p_imp_gtshpbrnch_s` as her `hit`, so her S3 impact rang on every ordinary
hit. On today's committed manifest the client-side test is **vacuous**: `0` of the 484 unit entries carry a
`char_*`-owned `_d`/`_h`/`_s` file for `attack` / `hit` (206 `char_*` units have either role at all; no `enemy_*` /
`token_*` entry uses one either). The filter that does the work is the plan's own `pickUnitSfx` `normalModeBank`
(`tools/assets/audio.mjs`), which never SELECTS such a file for an operator in the first place.

So "let the manifest be authoritative" splits into two questions, and only the first has a blast radius:

1. **Remove the client-side filter only** — the manifest is unchanged, so *no operator changes at all*: nothing the
   filter currently refuses is in the manifest (0 entries). What is lost is the last line of defence: a future plan
   regression of exactly the 纯烬艾雅法拉 kind would play again instead of being muted. Recommendation: keep it.
2. **Also drop the plan's `normalModeBank`** (accept skill-mode files for normal attacks at the source: 25 role picks
   over **20 operators** would change — `char_4137_udflow`, `char_253_greyy`, `char_107_liskam`, `char_279_excu`,
   `char_4122_grabds`, `char_4054_malist`, `char_174_slbell`, `char_332_archet`, `char_474_glady`, `char_1028_texas2`,
   `char_172_svrash`, `char_1026_gvial2`, `char_1032_excu2`, `char_1045_svash2`, `char_4064_mlynar`, `char_4193_lemuen`,
   `char_1046_sbell2`, `char_1014_nearl2`, `char_1038_whitw2`, `char_1016_agoat2` — e.g. 银灰's attack would become
   `p_atk_silver_n`, i.e. his S3 mode's swing, the very community report of 2026-10-06 this rule fixed). Of those 25,
   **17 picks are `_d`/`_h`/`_s` files** that the client would then refuse anyway — including 6 operators that currently
   have NO attack sound and would gain a refused one (`char_1028_texas2`, `char_1026_gvial2`, `char_4064_mlynar`,
   `char_1046_sbell2`, `char_174_slbell`, `char_107_liskam`), i.e. they would still be silent while their manifest
   claimed otherwise.

Measured with `pickUnitSfx(banks, { operator: true })` vs `{ operator: false }` over `docs/research/07-assets.json`.
**Not changed in this round** — it is an engine-level decision that rewrites 20 operators' sounds.

#### 大招音被限流饿死（owner report, fixed）

「现在三技能开大没有大招音效了」 was NOT the manifest (her `skills[2]` was always there, 86 KB on disk, HTTP 200)
but the SFX limiter: `MAX_VOICES = 8` is the whole battle's concurrency budget over THREE sounds per attack (挥击 +
音符诞生 + 音符命中), and an event sound arriving while it was full was refused outright. Measured in a browser with
two 丰川祥子 on the field (`test/e2e/sakiko-note-sfx-probe.mjs`, which now hooks `SfxLimiter.tryAcquire` and records
the refusal REASON):

```
=== SfxLimiter.tryAcquire calls: 101 (acquired 70, refused 31) by reason: {"perUrl":29,"voices":2}
```

The fix is `SFX_PRI` (audio.js): 技能发动 / 部署 / 阵亡 / 漏怪 are the EVENT tier, a unit's own attack / impact the
UNIT tier, and decorations (a note's launch, a generic battle cue) the lowest. When the budget is full the LOW tier
gives way (`popOldest`) instead of the high tier being refused, and the displaced voice is stopped immediately — so at
most `MAX_VOICES` sounds and at most `maxPerUrl` copies of one file still sound, exactly as before. A decoration is
never muted by this: it only never takes an event's slot.

Verified after the fix, real browser, one 丰川祥子 on S3 (SP boosted so the 47-SP cast is reachable inside one round):

```
   START t=40051ms unit=1 def=char_4182_oblvns skillIndex=2 scope=2 skillUrl=…/p_skill_mjckyrdslnt_s1.mp3
=== S3 cast cue …/p_skill_mjckyrdslnt_s1.mp3: 1 real _play calls, 1 START tuples
=== skill-note impact sounds actually played (5 _play calls):
      4 × p_imp_mjckyrdnt.mp3     (her talent note's impact — no cast behind those)
      1 × p_imp_mjckyrdslnt.mp3   (S3's own impact, scope=2)
```

The two-of-her probe was run too (and is where the `voices` refusals above come from), but it never got S3 cast at all
in that environment — one round is ~18 s, her S3 needs ~25 s of attacking to charge even with the probe's SP boost, and
the wave dies first. The `popOldest` behaviour under a FULL budget is therefore pinned by
`test/ui/audio.test.js` "SFX priority" (a real `AudioManager` with a saturated limiter: the cast cue still plays, the
concurrency cap holds, a 60-unit brawl stays bounded) rather than by that browser run.

**File names are lower-case**, both on disk and in the manifest: the official `audio_data.json` `asset` strings carry the
upper case (`Audio/Sound_Beta_2/Player/p_skill/p_skill_MJCkyrdglsnt_d1`) but the dump's file **names** do not
(`player/p_skill/p_skill_mjckyrdglsnt_d1.mp3` answers 200; the `MJC` spelling 404s), and `assetToPath` / `plan.mjs
soundAlt` lower-case the rel and the URL for every operator. Her seven skill files were on disk as `p_skill_MJC….mp3`
against a manifest that said `p_skill_mjc…` — invisible on Windows, a 404 on a Linux server; they were renamed, and
`test/sfx-oblvns.test.js` now compares the manifest's paths against the directory listing itself.

Not consumed on purpose (official banks exist, the project does not read them): **nothing any more** — the skill notes'
own impact banks are consumed by `skillSfx` since 「按技能细分的音效」 below (they were the last gap of her set). What
the project still does not read of the official audio data is unrelated to her: the ~104 pool skills whose only
activation bank is `battle.ON_ABILITY_START.<skillId>` ("技能发动音效" above), and the banks of the 13,108-entry dump
that name no unit, projectile or UI event this game has.

### 按技能细分的音效（`sfx.units[charId].skillSfx[skillIndex]`, owner report 「剩下没还原的音效全部补上」）

The unit roles above are per UNIT, but the official banks of a skill's own notes are per SKILL: her S1, S2 and S3 each
carry their own impact sound, and the client plays a unit's ONE `hit` for every damage it can attribute to her. So all
three impacts used to play the talent note's `p_imp_MJCkyrdnt` (measured in a browser: 3 runs × one skill, 11 / 12 / 4
impacts, one single file). The schema adds a per-skill entry, keyed by the same `skillIndex` the snapshot's UnitInfo
carries (`skills[]` already uses it):

```json
"sfx": { "units": { "char_4182_oblvns": {
  "skillSfx": {
    "0": { "hit":    "/assets/audio/sfx/player/p_imp/p_imp_mjckyrdglsnt.mp3" },
    "1": { "born":   "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt_r.mp3",
           "hit":    "/assets/audio/sfx/player/p_imp/p_imp_mjckyrdnt_r.mp3",
           "finish": "/assets/audio/sfx/player/p_skill/p_skill_mjckyrdslnt_h2.mp3" },
    "2": { "born":   "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt_r.mp3",
           "hit":    "/assets/audio/sfx/player/p_imp/p_imp_mjckyrdslnt.mp3",
           "loop":   "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdslnt_lp.mp3" }
} } } }
```

- **Key** = the equipped skill's 0-based index. **Roles**: `born` (the skill note's launch), `hit` (its impact),
  `finish` (the skill's end cue), `loop` (a sustained section). Only the roles the official data carries are emitted.
- Resolution (`tools/assets/audio.mjs SKILL_SFX_BANKS` + `skillSfx`, planned by `plan.mjs`, fetched by
  `node tools/fetch-voice-override.mjs --sfx` — the same "explicit table + official index" shape as the tables above;
  the banks are named after the PROJECTILE or the ABILITY, so no unit bank table can name them):

| skill | role | bank(s) | file |
| --- | --- | --- | --- |
| S1 `skchr_oblvns_1` | `hit` | `ON_CUSTOM_TRIGGER.projectile_chr_oblvns_s1_hit` (no `ON_PROJECTILE_*` bank exists for S1) | `Player/p_imp/p_imp_MJCkyrdglsnt` |
| S2 `skchr_oblvns_2` | `born` | `ON_PROJECTILE_BORN.projectile_chr_oblvns_s2_t`, `…_s2_slow_t` | `p_atk_MJCkyrdnt_r` (first bank wins) |
| S2 | `hit` | `ON_PROJECTILE_HIT.projectile_chr_oblvns_s2`, `…_s2_slow` | `p_imp_MJCkyrdnt_r` |
| S2 | `finish` | `ON_SKILL_FINISH.skchr_oblvns_2.1`, `.2` | `p_skill_MJCkyrdslnt_h2` (index order first) |
| S3 `skchr_oblvns_3` | `born` | `…_s3_phy`, `…_s3_mag` | `p_atk_MJCkyrdnt_r` |
| S3 | `hit` | `…_s3_phy`, `…_s3_mag` | `p_imp_MJCkyrdslnt` (one file for both halves) |
| S3 | `loop` | `ON_BUFF_START.oblvns_s_3[loop]` (`loop: true`) | `p_atk_MJCkyrdslnt_lp` |
| S3 | `finish` | — | **none**: `soundFXCtrlBanks` says S3's end is `ctrlStop` of that loop (0.2 s fade) |
| S1, S2 | `loop` | — | **none**: both are `durationType NONE` (instant / toggle), there is no sustained section |

- **What the client does with it** (`public/js/audio.js`):
  - `hit`: the impact follows the ATTACK, so the skill the attack was made under travels with it (`lastAttacker` keeps
    the index) and `unit(…, 'hit', …)` asks `skillSfx[i].hit` first. A hit with no cast behind it — every other
    operator, and her own talent note fired outside a skill — keeps the unit's ordinary `hit`. **That fallback is the
    contract**: a unit whose entry has no `skillSfx`, or a path where nothing is casting, sounds exactly as before.
    An INSTANT skill (her S1) has already ended when its notes land (the sim emits start and end in the same tick —
    measured in a browser), so a cast that ended within `IMPACT_WINDOW_MS` still counts for the impact it fired; a
    merely EQUIPPED skill never does (equipped is not evidence that a hit is that skill's).
  - `finish`: the sim's own `['skill', id, 0]` (技能结束) plays it. A unit without one stays silent there — the end
    event never plays `hit` or the ordinary sound.
  - `loop`: `['skill', id, 1]` starts it and `['skill', id, 0]` stops it (the official `ctrlStop`, 0.2 s fade), one loop
    per UNIT so two of her never share one. It is a real Web Audio loop through the SFX channel, so 音效 volume and
    静音 apply; `SKILL_LOOP_MAX_S` (60 s) bounds it if an end event is ever missed, and a new field stops every loop.
    `startLoop` / `stopLoop` are the only new audio primitive; a loop deliberately does not go through `SfxLimiter`
    (the limiter counts overlapping one-shots and a loop has no end to release).
  - `born` is **not** played from here: that is the note's launch, and the renderer asks for it by projectile KIND
    (`playProj` → `sfx.proj`, "投射物音效" above). The skill split of the launch is what `sfx.proj` cannot express yet
    (`noteSkill` is one kind; see below), so the role documents it without a second playback path.

Not implemented on purpose: **a finer `snap.proj` kind**. `noteSkill` covers S2 and S3 alike (S2's 钢琴/风琴 timbres
and S3's 物理/法术 halves), so the manifest keeps one launch file per kind — S3's magic half would want `_p` where the
kind plays `_r`. Splitting it means a third kind in the tuple, i.e. `server/sim/battle/events.js` plus her kit's
`hitTag` — a protocol/gameplay change, deliberately not taken here (the per-skill `born` role above is where the
resolution already lives, ready for whoever adds the kind).

### 投射物音效（`audio.sfx.proj`, owner report 「她发出音符时也应该有音效」）

A content-owned projectile is born with **no `atk` event of its own**: the sim streams its positions in `b.snap.proj`
(`[[id, x, y, kind]]`, `server/sim/battle/events.js`) and `render/fx/notes.js syncNotes` draws one glyph per id. So until
this section existed, 丰川祥子 firing a note was completely silent — and the official bank that carries that launch
(`battle.ON_PROJECTILE_BORN.projectile_chr_oblvns_talent` → `Player/p_atk/p_atk_MJCkyrdnt`) was on no machine at all,
because only a real download run ever fetches a file, and the plan never resolved it.

Schema (generic: nothing here names an operator; the client asks for a KIND):

```json
"audio": { "sfx": { "proj": {
  "note":      { "born": "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt.mp3" },
  "noteSkill": { "born": "/assets/audio/sfx/player/p_atk/p_atk_mjckyrdnt_r.mp3" }
} } }
```

- **Key** = the `kind` of a `snap.proj` entry: `note` (the talent's) and `noteSkill` (the skills'), i.e. the two the sim
  emits today (`server/sim/content/kits/ops/op-oblvns.js`, `render/style.js PROJ`). An unknown kind is simply silent.
- **Roles**: `born` (the launch — what the client plays) and `hit` (carried by the schema for a future per-kind impact;
  **not played**: a note also leaves the snapshot when it *expires*, so an impact sound hung on the disappearance would
  ring for a miss. The impact the sim really dealt plays the normal `dmg` attribution, `audio.js handleBattleEvents`).
- A kind may also be a plain URL string (treated as `born`) or carry `units: { [charId]: { born?, hit? } }`, a per-unit
  override resolved before the kind's own entry (`public/js/audio.js projSfxUrl`). The generator writes neither: her
  note's launch is its own bank, and a per-unit entry would only duplicate `sfx.units[charId].attack`.
- **Why the launch is not `sfx.units[id].born`**: that role is the DEPLOYMENT sound (`ON_UNIT_BORN` → `b_char_set`,
  `audio.js deploySfxUrl`). And it is not `sfx.units[id].attack` either: her note's launch (`p_atk_MJCkyrdnt`) and her
  attack cue (`p_atk_MJCkyrdslnt`, the swing bank) are two different files — both are heard, one per event.

Resolution (`tools/assets/audio.mjs PROJECTILE_SFX_BANKS` + `projSfx`, the same "explicit table + official index" shape
as `SKILL_START_BANKS` / `UNIT_SFX_BANKS`; a projectile bank is named after the PROJECTILE, so no unit bank table can
name it):

| kind | role | bank(s) | file |
| --- | --- | --- | --- |
| `note` | `born` | `battle.ON_PROJECTILE_BORN.projectile_chr_oblvns_talent` | `Player/p_atk/p_atk_MJCkyrdnt` |
| `noteSkill` | `born` | `…_s2_t`, `…_s2_slow_t`, `…_s3_phy`, `…_s3_mag` | `p_atk_MJCkyrdnt_r` (first bank wins) |

Her **skill** notes' other takes — S2's slow variant `…_s2_slow_t` (`p_atk_MJCkyrdnt_p`) and S3's magic half
(`…_s3_mag` → `…_p`) — need no separate entry *yet*: the snapshot distinguishes exactly two kinds, so a per-skill split
would mean a third `kind` in the tuple (a sim change), not a resolution change. The **impact** banks of those same
projectiles (`p_imp_MJCkyrdnt_r` / `_p` / `p_imp_MJCkyrdglsnt` / `p_imp_MJCkyrdslnt`) stay unplanned for the reason
above: one `hit` per unit, played for every damage attributed to it.

Planned by `plan.mjs projSfxLeaves` (one file per role, never a draw) and fetched by
`node tools/fetch-voice-override.mjs --sfx` — the same proxy-first route as her voice and her skill cues, because the
whole `voice` branch has no jsDelivr mirror. The `--char` filter reads the operator's own manifest URLs to decide which
kinds are its; a `--char` run therefore fetches only its skill sounds (no unit entry references the note's launch file:
`attack` is the swing, `hit` is `p_imp_MJCkyrdnt`), and the projectile sounds come with the default (no `--char`) run.

**Two 丰川祥子 are heard separately** (owner report 「只播放其中一只的音效」): every battle sound is limited per UNIT
(`public/js/audio.js SfxLimiter`), and the note's limiter key is the unit the renderer resolves as its owner — a
projectile is born at its caster, so the nearest view within 2.5 tiles is it (`render/fx/notes.js _noteOwner`, from
`ctx.units()` that `render/app.js` passes; presentation only, the positions stay the sim's). The first frame of a battle
only seeds its sprites (`this.time === 0`: entering a battle or a reconnect replay hands the whole `proj` list at once,
and those notes were fired before this client watched) — from the second frame on, every new id sounds.

Outputs:
- `data/assets.json`: the manifest (committed).
- `public/assets/**`: art and audio (git-ignored).
- `public/fonts/*`: fonts and `fonts.css`.
- `.cache/assets-report.json`: misses, fallbacks and notes from the last run.
- `.cache/spine-info.json`: skeleton parse cache.

The run exits with code 1 if any pool operator is missing its avatar, its portrait or its Front Spine.

Upstream indexes are cached under `.cache/`. They are downloaded when missing:
- `.cache/gamedata/excel/audio_data.json`, from `Kengxxiao/ArknightsGameData` (zh_CN).
- `.cache/ark-models/models_data.json`, from `isHarryh/Ark-Models`.

The research JSONs in `docs/research/` (03, 05, 07) define **which** ids are needed.

## What is downloaded

| Class | Source | Local path (under `public/assets/`) |
|---|---|---|
| Operator avatars, 180×180. Base, plus E2 when it exists. | yuanyan3060/ArknightsGameResource `avatar/` | `char/avatar/{charId}.png`, `char/avatar/{charId}_2.png` |
| Operator half-body portraits, 180×360 | yuanyan `portrait/` | `char/portrait/{charId}_1.png`, `_2.png` |
| Skill icons: every skill index of every planned operator (DESIGN §16 loadouts, 自选 picks) | yuanyan `skill/` | `skill/{iconId sanitized}.png` |
| Module type icons: the `typeIcon` of every module of `data/chess.json` and `data/backups.json` (the 干员调配 / 自选 module tiles when the local-client art lacks them) | AA2 `cn` `arts/ui/uniequiptype/{typeIcon}.png` (else its lower-case name: `WAH-Y` → `wah-y.png`) | `module/{typeIcon in lower case}.png` — one file per type: the official data spells one DEC X module `dec-X` and the others `dec-x`, and paths that differ only in case are one file on Windows / macOS and in a release zip |
| Enemy icons | yuanyan `enemy/`. Fallbacks: the handbook id, then the base id. | `enemy/icon/{enemyId}.png` |
| Token avatars | yuanyan `avatar/` | `token/avatar/{tokenId}.png` |
| Bond icons (the real autochess glyphs) | ArknightsAssets2 `cn` `ui/autochess/[uc]autochesscommon/arts/bondicon/`. Fallback: the camp logo. | `bond/{bondId}.png` |
| Shop item icons | AA2 `…/arts/shopitemicon/` | `item/{trapId}.png` |
| Band (strategy) icons | AA2 `…/arts/bandicon/` | `band/{bandId}.png` |
| Profession, sub-profession and battle-card icons | AA2 `arts/profession_hub`, `arts/ui/subprofessionicon`, `ui_battle_new/battlecard` | `prof/icon_{p}.png`, `prof/large_{p}.png`, `prof/battlecard_{p}.png`, `prof/sub/{subProfessionId}.png` |
| UI sprites (see below) | AA2 `ui/autochess/**`, `arts/**`, `activity/[uc]act2autochess/**`, `battle/[pack]common/sprites` | `ui/{group}/{key}.png` |
| The 36 battle emotes and the 19 玩法说明 (tutorial) pages, which `tools/local-extract` also extracts (GitHub issue #42: without the local client a server showed default emote icons) | AA2 `cn` `ui/emoticon/theme/[uc]{themeId}/icon/{picId}.png` (`shared/constants.js EMOTE_CATALOG`) and `arts/guidebookpages/[pack]autochess/{key}.png` (1024², shown at 16:9 like the local copies) | `ui/emoticon/{dir}/{picId}.png`, `ui/guide/{key}.png` |
| Operator battle Spine (Front, Back) | fexli/ArknightsResource `spine/{id}/{id}/{Front,Back}/` | `spine/op/{charId}/{front,back}/{stem}.{skel,atlas,png}` |
| Token Spine | fexli: the default model, or else the first skin variant (`spine/{tokenId}/{variant}/Spine/`) | `spine/token/{tokenId}/{stem}.*` |
| Enemy Spine (PC build, premultiplied alpha) | isHarryh/Ark-Models `models_enemies/{key}/`, file names from `models_data.json` | `spine/enemy/{enemyId}/{stem}.*` |
| Enemy Spine that no dump carries (灼热源石虫 / 炽焰源石虫) | the local client only (`tools/local-extract/extract.py ENEMY_SPINES`, optional); never downloaded and never required: an overlay of the web alias (`enemies[id].spineLocal`) | `local/spine/enemy/{enemyId}/{stem}.*` (listed in `data/local-assets.json`) |
| Token Spine that no dump carries (39 summons: most 自选 summons, 凯瑟琳's 爬行号·防护单元, 凛御银灰's 风雪之眼) | the local client only (`tools/local-extract/extract.py TOKEN_SPINES`, optional); never downloaded and never required: an overlay (`tokens[id].spineLocal`; without it the avatar diamond) | `local/spine/token/{tokenId}/{stem}.*` (listed in `data/local-assets.json`) |
| BGM | AA2 `voice` branch `audio/sound_beta_2/music/**` (大厅/休整期 `act1autochess`, 开战 `act13side/m_bat_kazimierz2_{1,2}` — 骑士之日 / 无畏者; the 开战 track follows the round: `_2` 无畏者 rounds 1–7, `_1` 骑士之日 from round 8) | `audio/bgm/{file}.mp3` |
| SFX (UI, battle, per unit, per projectile kind) | AA2 `voice` `audio/sound_beta_2/**`, mapped from `audio_data.json` banks | `audio/sfx/{same sub-path}.mp3` |
| 干员战斗语音 | AA2 `voice` `audio/sound_beta_2/voice_cn/{charId}/cn_nn.mp3` — the lines `charword_table.json` lists (`placeType` = when the game plays one, `voiceAsset` = the path); `--voice-lang=jp|en|kr` takes the same file names from `voice/`, `voice_en/`, `voice_kr/` | `audio/voice/{lang}/{charId}/{cn_nn}.mp3` |
| Fonts: Bender Regular and Light, Novecento Wide | TimWangZi/The-font-of-Arknights | `public/fonts/*.{otf,ttf,woff2}`, `public/fonts/fonts.css` |

The `stem` of a Spine model is the upstream file name. Two examples: `char_107_liskam` has the stem `char_107_liskarm`, and `enemy_9032_aclionk` uses `enemy_1559_vtlionk`. The skel and atlas of a model always share one stem. pixi-spine locates the atlas by swapping the extension, so this matters.

### Id scope

- **Operators:** all 138 pool charIds from `activity_table` (`charShopChessDatas[*].charId ∪ backupCharId`), including hidden chess and backup operators; plus every unit of `data/backups.json` research 07 does not list — the 72 自选 owned-6★ picks (`diy.ownedPool`, DATA.md §18; the collab operators are not in the data — 丰川祥子 joined the pool on 2026-10-08 (`DIY_INCLUDED_COLLAB`, her own operator kit) and her entries are planned like any other pick's, with two local exceptions: her battle voice comes from the JP dump (`plan.mjs VOICE_LANG_OVERRIDE`, "An operator whose dub does not exist upstream") and her three skill sounds from `audio.mjs SKILL_START_BANKS` ("技能发动音效") — and 焰狐龙梓兰's entries left the manifest when she left the pool in 0.2.0) — planned from 07's URL patterns (`tools/assets/plan.mjs patternOperator`, `tools/fetch-assets.mjs dataExtras`): avatar and portrait (E0–E1 and E2), the default-skin battle Spine Front / Back, the icon and skill sound of each skill, the sub-profession icon. 210 operators in all (207 with a Back model).
- **Tokens:** the 20 pool tokens, and the 38 summons of the 自选 picks (`data/backups.json tokens`) as extra tokens (below): their avatars; no dump carries the battle Spine of the 自选 summons (upstream has at most skin variants, which the default locations miss), so the web manifest has no model for them — 35 of them, and 4 pool summons, have the official model as an optional local-client overlay ("Token models from the local client"); 3 have no model in the game at all.
- **Enemies:** 253 ids planned, 252 in the manifest (心烛 has no assets). The set is the union of:
  - the 07 enemy list;
  - every enemy in the `act1autochess_*` wave, boss and 联防 levels that act2 modes use (from `05-maps.json`; the tutorial is excluded);
  - the bosses (`boss_1..10`);
  - the closure of their summons (`randomEnemyAttribute` spawns and blackboard `enemy_key` references);
  - every key of `data/enemies.json` (built by `tools/build-data.mjs`, when present), which adds for example the enemies swapped in by 机变 effects;
  - the bosses' handbook/model ids, such as `enemy_1559_vtlionk`;
  - enemy units spawned by operator kits (research 03 skills/talents). For example, 隐德来希's default S3 summons 心烛 `enemy_5601_entlec` through the talent key `take_extra_enemy_key`. 心烛 has no icon and no Spine in any dump, so it has no manifest entry: it is reported as a miss, and the client must draw a glyph.
- **Extra tokens:** any `token_*` key of `data/tokens.json` that research does not list gets the default avatar and Spine locations.
  - The non-token summons in that file (`enemy_9012_acloon` 炎佑, `char_605_cmedic`, `char_613_acmedc`) are found under `enemies` and `chars`.
- **Skill icons:** every skill index of every planned operator (the default one first; DESIGN §16 loadouts, the 自选 picks' three skills): 525 icons.
- **UI:**
  - every group from `07-assets.json → autochessUi`: rarity, elite and chess-level sprites, the shop panel and cards, HUD, bond board, equip slot, round dialog, band choose, settlement, prepare backdrop;
  - `arts` (rarity stars, elite icons, the camp logos of pool nations, the loading illustrations used by the act2 modes, battle common sprites, act2 entry backdrops and season logo, item rarity frames);
  - extras (`tools/assets/plan.mjs UI_EXTRAS`): mode choice art, battle-ready backdrops, battle UI (speed, pause, HP slider, attack range, boss avatar frame, skill ready), `empty_skill`, the 机变 panel and cards, the equip-replace dialog, the bond detail dialog, the prep-ready panel, stage-info titles, the 36 battle emotes (`emoticon/{dir}/{picId}`) and the 19 玩法说明 pages (`guide/{key}`) — these two keyed by the group and name of `data/local-assets.json`.

## Post-processing

- **Atlases** (research 07 §5.3):
  - Insert `size: W,H` right after each page name. fexli atlases omit it; the value is read from the PNG header. An existing size that disagrees with the PNG is corrected.
  - Ark-Models enemy atlases get `pma: true`, because their textures are premultiplied. pixi-spine reads this and sets `ALPHA_MODES.PMA`.
  - Page names are sanitized to safe file names.
  - All of this is idempotent.
- **Skeletons:** every `.skel` (Spine 3.8.99 binary) is parsed in Node with `@pixi-spine/runtime-3.8`, the parser the client ships.
  - The parse extracts animation names and durations, event names, `OnAttack` times per animation, and bounds.
  - Attachment paths are checked against the atlas regions.
  - Then the animation-role resolver runs. See `tools/assets/anim-roles.mjs` and research 07 §5.4.
  - A web enemy model whose clip names mislead the resolver gets the roles of its official battle prefab
    (`tools/assets/spine.mjs PREFAB_SPINE_ROLES`, read from the local client's `battle/enm_pfb_*.ab`: the prefab's anim
    key → clip table and the clip its Spine starts on): 普通囚犯 / 老练囚犯 start on their grey `*3` set (【禁锢】), not
    the unnumbered red one (【解放】) the names point to.
- **Fonts:** OTF/TTF files are converted to WOFF2 by a built-in encoder (`tools/assets/woff2.mjs`: Brotli with null transforms).
  - Its output was verified lossless against Google's reference `woff2` decoder.
  - `fonts.css` lists WOFF2 first and falls back to the original file.
- Images stay PNG. WebP conversion is not done: it would need a native dependency. The local-client board textures are the exception: `tools/local-extract/extract.py` (Python, where Pillow is already a dependency) writes WebP copies of the 12 textures the 3D board downloads (`WEBP`: colour maps lossy at quality 95 with the alpha and the RGB under transparent texels kept, normal and data maps lossless) and `data/local-assets.json` lists the copies; the PNGs stay beside them for `tools/crop-board-atlas.mjs`. `extract.py --webp` adds the copies to an existing extraction without the client.

## Manifest schema (`data/assets.json`)

All paths are URL paths relative to the site root, for example `/assets/char/avatar/char_002_amiya.png`. **Only entries whose files exist on disk are emitted.** When a key is missing, the client should use its fallback (research 07 §5.6).

```js
{
  version: 1,                       // schema version
  hash: 'a1b2c3d4e5f6',             // content hash (cache busting)
  generator: 'tools/fetch-assets.mjs',
  stats: { files, bytes, chars, charsWithBack, enemies, enemiesWithSpine, tokens, tokensWithSpine,
           spineModels, bonds, items, bands, skills, modules, ui, sfxUnits, voiceChars },
  chars:   { [charId]: { avatar, avatarE2?, portrait, portraitE2?, spine: { front: Spine, back?: Spine } } },
  enemies: { [enemyId]: { icon, spine?: Spine, spineAliasOf?: enemyId,
                          spineLocal?: { group, skel, atlas, textures, …Spine } } },
                          // spineLocal: an optional local-client model; file names in a data/local-assets.json group,
                          // not URLs, and always emitted (independent of the disk) — "Enemy aliases" below
  tokens:  { [tokenId]: { owner: charId|null, avatar?, spine?: Spine, spineVariant?: string,
                          spineLocal?: { group, skel, atlas, textures, …Spine } } },
                          // spineLocal: as for enemies — "Token models from the local client" below
  bonds:   { [bondId]: url },       // white glyphs; tint in CSS/canvas
  items:   { [trapId]: url },
  bands:   { [bandId]: url },
  skills:  { [iconId]: url },       // iconId = skill_table iconId ?? skillId
  skillsById: { [skillId]: iconId },
  modules: { [typeIcon]: url },     // module type icon (uniequip typeIcon, e.g. 'sol-x'): public/js/screens/loadout.js
                                    // moduleIconOf after the local-client art
  ui:      { ['group/key']: url },  // e.g. 'hudPanel/icon_hp', 'shopCard/frame_lv1', 'loading/loading_ac_core';
                                    // 'emoticon/basic/pic_happy_battle', 'guide/autochess_home_1': the data/local-assets.json
                                    // group + name of the same picture (the client takes the local one first)
  prof:    { icon: {caster…warrior}, large: {…}, battlecard: {…, token}, sub: {[subProfessionId]: url} },
  audio: {
    bgm:     { lobby, prep, combat, combatAlts?: [{ intro?, loop }, …], unite?: { intro?, loop }, boss: { intro?, loop } },
             // intro then crossfade to loop (1 s); combatAlts = the 开战 tracks of the mode's own act, chosen by the
             // round, not drawn: [0] = m_bat_kazimierz2_1 骑士之日 (rounds 8–13), [1] = m_bat_kazimierz2_2 无畏者
             // (rounds 1–7) — audio.js combatTrackFor / bgmKeyFor 'combat:<i>', the same on every client;
             // `unite` = 联防's own track — the official escaped_single / escaped_multi levels declare
             // `bgmEvent = corrosion` (卡西米尔 act13d5d0), so the rescue phase does not reuse the 作战's track
             // (audio.js bgmKeyFor 'unite', falling back to `bgm.combat` for a manifest that lacks it)
    bossBgm: { [bossId]: { intro?, loop } },                   // per-boss track of its R14/R15 level
    voice:   { [charId]: { start, faceEnemy, select, place, skill1…skill4,
                           resultFour, resultThree, resultTwo, resultLose } },
                           // 干员战斗语音: an operator's official battle lines (charword_table.json placeType → slot,
                           // tools/assets/audio.mjs VOICE_SLOTS); a slot with several lines is an array and the client
                           // draws one (public/js/audio.js voice); a slot whose lines are all missing on disk is left
                           // out (an operator with none has no entry), never an empty array. Only these twelve ever play (DESIGN §21.30): the
                           // prep-only slots 干员报到 / 编入队伍 / 任命队长 are left out of the plan by default —
                           // nothing requests them and they cost 360 files (19.3 MB) per run — and `--voice-all` adds
                           // them (audio.mjs VOICE_PREP_SLOTS) for the complete official set.
                           // The dump is `--voice-lang` for every operator except the ones plan.mjs
                           // VOICE_LANG_OVERRIDE re-points — 丰川祥子's lines are under voice/jp/ because the
                           // collaboration has no Chinese dump upstream ("An operator whose dub does not exist
                           // upstream" above); her entry is one language, never a mix.
    sfx: {
      ui:     { click, back, confirm, tab, pick, drop, error, buy, sell, income, refresh, freeze, levelup,
                merge, equip, itemMerge, bondUp, artPlace, ready, timer, draft, yourTurn, yourTurnCircle,
                target, broadcast, danger, emote, roundStart, rest, battleStart, battleStartBoss,
                bossRoundTeam, bossRoundSingle, bossRoundSecret, killBoss, killBossAll, killBossNormal,
                defenceStart, defenceUnite, battleOverReduce, battleOverNoReduce, battleOverNormal, goFirst,
                disconnect, settlementSucceed, settlementFail, settlementTeam, settlementBossSign,
                goodEvaluation, load, start, matchSucceed, matchFail, matchCancel, joinRoom },
      battle: { deploy, tokenDeploy, charDie, enemyDie, enemyDieHeavy, enemyHit, heal, leak, win, lose, killCoin },
      units:  { [charId|tokenId|enemyId]: { attack?, hit?, skill?, skills?: {[skillIndex]: url}, die?, born?,
                skillSfx?: { [skillIndex]: { born?, hit?, finish?, loop? } },
                mix?: { [attack|hit|die|born]: { p?, vol? } } } }
                // skills[skillIndex] = that skill's own activation sound, planned from
                // `battle.ON_SKILL_START.<skillId>` (else the audio.mjs SKILL_START_BANKS exceptions — 丰川祥子);
                // `skill` is the fallback for a unit the client knows no skill index for ("技能发动音效" above)
                // skillSfx[skillIndex] = the sounds one SKILL owns where the unit entry carries only ONE role
                // ("按技能细分的音效" below); both `skillSfx` and `skills` are keyed by the snapshot's own `skillIndex`
    }
  },
  // units' mix (tools/assets/audio.mjs bankMix; community report #30): the official bank of a role's sound — `p` = the weight
  // of its sounds that have a file over all weights (an empty asset is a chance of silence: 猎狗pro / 深池侦察犬 0.2), `vol` =
  // the played file's volume (妖怪 0.7); only values other than 1. public/js/audio.js plays the role with chance p at its
  // base gain × min(1, vol)
  // units' attack / hit (tools/assets/audio.mjs pickUnitSfx): operators get normal-mode banks only — the plain
  // `attack` / `combat` ability first, never a bank holding a skill-mode file (`_d` / `_h` / `_s`; the normal attack's end
  // in `_n`) — with their own projectile banks (ON_PROJECTILE_BORN / _HIT.projectile_chr_<name>) as fallbacks
  // (DESIGN §18.4: 纯烬艾雅法拉's S3 impact used to be her `hit`); an operator with such a plain bank (its default mode is
  // the unsuffixed ability) never takes a numbered variant `attack.N` — a skill mode's, whatever its file name (银灰's S3
  // swing p_atk_silver_n, community report of 2026-10-06); one that numbers its default mode (`attack.0` …) keeps the
  // numbered order; enemies and tokens take the first attack-like bank
  fonts: { css: '/fonts/fonts.css', faces: { [name]: { family, weight, woff2?, original } } }
}
```

### The `Spine` object

```js
{
  skel, atlas, textures: [url],       // load with PIXI.Assets.load(skel); atlas/png sit next to it
  pma: boolean,                       // true for enemies (atlas already carries `pma: true`)
  anims: Roles,                       // resolved roles, below
  animations: { [name]: seconds },    // every animation with its duration
  events: [name],                     // e.g. ['OnAttack', 'OnStart']
  hits: { [animName]: [seconds] },    // OnAttack event times (apply damage / spawn projectile)
  bounds: { x, y, width, height } | null  // skeleton AABB (setup pose, skeleton units)
}
```

The enemies' attack clip lengths are also a data input: `tools/build-data.mjs` copies each enemy model's
`anims.attack.loop` length and first `hits` time into data/enemies.json `attackAnim` (the sim stands an unblocked
ranged enemy for that clip, GitHub #58, and strikes every enemy attack at that frame, 0.2.0; docs/DATA.md §9) — rebuild the data after a manifest change that touches them.

### The `Roles` object

```js
Clip      = { begin: string|null, loop: string, end: string|null, via?: 'combat'|'attackAny'|'skill'|'idle'|'attack' }
SkillClip = Clip & { index: number /* 0-based skill index */, idle: string|null /* Skill_n_Idle */ }
Roles = {
  idle: string, deploy: string,
  attack: Clip,            // play begin once, loop per attack, end when stopping; `via:'idle'` ⇒ add a flash
  attackDown: Clip|null,   // _Down variants (target below the unit)
  skill: SkillClip|null,   // for the chess's default skill (primary index)
  skills?: { [index]: SkillClip },   // when the char is used with several default skills (backups); an enemy: every
                           //   numbered skill clip (Skill_01..04 of 盐风主教昆图斯 — the slot a sim `cast` event names, PR #275)
  die: string|null,        // null ⇒ a Back model gives way to the Front model's Die (DESIGN §22.1); any other
                           //   skeleton holds its idle's first frame while it fades out
  move: Clip|null,         // enemies: Move_Begin|Move_Start + Move_Loop|Move + Move_End → Run_*
  run?: Clip,              // the model's own Run cycle (Run_Begin/Loop/End): an enemy faster than moveSpeed 1 moves on it
  stun: Clip|null          // Stun | Stun_1 | Dizzy_Loop (+ *_Begin / *_End); null ⇒ freeze the track (timeScale 0)
}
```

`via` marks a fallback:

| `via` | The attack is actually… |
|---|---|
| `combat` | `Combat` |
| `attackAny` | a numbered attack such as `Attack_01`, possibly framed by `Attack_Begin`/`Attack_End` (`char_1045_svash2`) |
| `skill` | `Skill_1_Loop` (pure supporters) |
| `idle` | `Idle` (no attack animation at all) |

On a skill clip, `via: 'attack'` means the model has no skill animation, so the attack clip is reused.
A skill clip may also come from directional-only animations when a model has no undirected ones: for example `Skill_Right_Loop` (`char_279_excu`) or `Skill_Loop_Up` (the Back model of `char_431_ashlok`).

The resolver's full precedence list is in the header of `tools/assets/anim-roles.mjs`.

The manifest roles describe a unit's first form. Units whose skeleton holds another form's clip set get it from
`public/js/render/units.js FORMS` (keyed by Spine id, switched by the `form` of the sim's 'phase' / 'ember' / 'revive'
/ 'telegraph' / 'stone' / 'liberate' / 'substitute' / 'swap' / 'dollEnd' fx — `shared/protocol.js fxForm`; no client stage drops these fx: the runner keeps them through
catch-up frames and hidden tabs (`keepsState`), the game screen's pre-entry buffer (`keepEarly`) and the render engine's
event queue (`render/interp.js isCosmeticEvent`) too — or, for a view built mid-battle, UnitInfo `form`, which `render/app/info.js renderInfo` passes to the view; a
`change` clip plays once first, an `end` clip is timed from the fx's `dur` to finish as that state ends, keeping the
current form's death clip until the next form's fx). A blocked or revealed 隐匿 enemy is drawn solid: the sim sends the
stealth bit only while its 隐匿 is on:
- 掠海漂移体's crawl (`Change`, then `*_02`);
- 转译基底·α's three forms (`A_Die_B` / `_C` / `_D`, 2 s each, then `B_*` 寻仇者, `C_*` 幽灵, `D_*` 特战术师);
- the 深池逐火 embers (`Die`, then `Idle_2` / `Move_2` / `Die_2`; `Revive` ends as it stands up) and 假想敌：再生's puppet
  (`A_Die`, then `B_*`; `B_Revive`);
- the leaders' 重生: 锏 (`Revive1`, `Revive2` held, `Revive3`, then `B_*`), 扎罗 (`A_revive_1` / `_2` / `_3`, then `B_*`),
  “复仇者” (`Revive_Begin` / `_Loop` / `_End`), 杰斯顿 (`C1_Die`, then `C2_*`);
- 守墓石像 (the statue on `Sleep` [ASSUMED by name], then the flyer's `*_2`).
- the 孤岛风云 prisoners, as their official prefabs' modes: confined on the manifest's grey set, `warning` (mode R, the
  warning before the last confined attack) on the blinking orange set, `liberty` (【解放】) on the red set — 普通囚犯 /
  老练囚犯 `Idle3` → `Idle2` → `Idle`, 强壮囚犯 `Idle` → `Idle2` → `Idle3`, 拳师囚犯 / 重犯 / 传奇重犯 `*_grey` → `*_orange` →
  `*_red` (Move / Attack / Die alike; no change clip).
- the 傀儡师 operators' <替身> (form `doll` of the sim's 'substitute' / 'swap' / 'dollEnd' fx, DESIGN §22.11; the `*_B`
  clips draw the 替身's own slots and hide the 本体's): 归溟幽灵鲨 `Start_B` (it fades in), `Idle_B`, `Die_B` over its last
  second (it breaks apart and fades), `Die_B_2` when it is knocked out (it collapses), and the 本体 back on `Start_2` (a
  form's `leave` clip); 风丸 `Start_B`, `Idle_B` / `Attack_B` / `Die_B`, the 本体 back on `Start`. Facing up, 归溟幽灵鲨's
  Back skeleton has only `Idle_B` and `Start_2`, 风丸's `Start_B`, `Idle_B` and `Attack_B`: the missing clips are skipped.
  Neither Back skeleton has the 替身's death clip, so a 替身 knocked out lies on the Front model (like every knocked-out
  operator facing up, DESIGN §22.1) with its `Die_B_2` / `Die_B`: the view keeps the form it died in for that model and
  for one rebuilt while it lies down, although the sim resets the form right after the knock-out.

Not mapped (clip names ambiguous): “自在”, “巨大的丑东西”, 主角阵营角色 and “余音” (`*_A` / `*_B`: which of its two forms is A
is not known) keep their manifest clips.

Other renderer rules from research 07 §5.4–5.5:
- **Choosing the model:** Front when the unit faces right or down; Front mirrored when facing left; Back when facing up — while it stands: a dead or knocked-out operator falls and lies with the Front model unless its Back skeleton has a Die clip of its own (131 of the 135 have none; DESIGN §22.1, GitHub issue #25).
- **Attack speed:** set the attack `timeScale` to `duration / attackInterval`.
- **Model size:** every skeleton is drawn at one `UNIT.modelScale` (render/style.js, 320 skeleton units per tile), which stands for the official standard. The official client also scales each enemy model in its battle prefab: the Graphic / FaceSwitcher / Spine transforms multiply to 0.27 for most enemies and for the operators' battle skins, but not for all of them. For example, 威龙 is 0.16, 妖怪 0.20 and 青铜镜 0.6. The skeletons themselves carry no such scale, because every enemy SkeletonDataAsset uses 0.01. So an enemy is drawn × data/enemies.json `modelScale` (its prefab's product ÷ 0.27, see docs/DATA.md; user playtest #6: 威龙 used to be drawn 1.35× a 妖怪 instead of 1.08×), and its HP bar sits on that model: at its setup-pose bounds' height × the same factors, or, for a skeleton without bounds, at the chibi headroom × `modelScale` (bosses 2.2 tiles). `tools/local-extract/enemy_scales.py` reads the products from a local client, and `tools/build-data.mjs MODEL_SCALES` keeps them. Two prefab quirks on top (PR #211 by @xcdoge; the owner's decision of 2026-10-06; docs/research/12 §3.1): the two 帝国炮火先兆者 are stretched vertically (`modelScaleY` 1.263: their Graphic scale is (0.19, 0.24, 0.24)) and 木制瑞印 is mirrored (`mirrorX`: a negative Graphic X scale) — `tools/local-extract/enemy_model_offsets.py` reads them, `tools/build-data.mjs MODEL_STRETCH_Y` / `MIRRORED_PREFABS` keep them.
- **Flying units** hover `FLY_HOVER` = 1.3 tiles up (render/units.js; the client's single fly offset 0.35 in its character space, whose unit is the standard prefab scale 0.27 — docs/research/12) — an enemy flyer above the road whatever tile it crosses (a high-ground or forbidden block under it is no step, GitHub #277), an operator or summon above its tile: the body, its HP bar, damage numbers and hits ride the lift, the shadow stays on the ground tile (the block top under an enemy flyer crossing one), on the 2D and the 3D board alike (one camera drives both).
- **Enemy aliases:** `enemies[id].spineAliasOf` means the model belongs to another enemy. Two cases:
  - `_2` variants whose official prefab is the base one (鸭爵, 高普尼克, 流泪小子, 圆仔, 假想敌：胄, 假想敌：铳): the base model, as in the game.
  - an enemy whose own model no dump carries: 灼热源石虫 / 炽焰源石虫 (`enemy_1305_mhslim` / `_2`) use the plain 源石虫 on
    the web (`plan.mjs ENEMY_SPINE_ALIAS`). The reason is upstream: isHarryh/Ark-Models *indexes* `1305_mhslim` /
    `1305_mhslim_2` but with an **empty `assetList`** — registered, never uploaded — so `arkModel()` finds no files for
    them and the alias chain drops to `enemy_1007_slime`, a different enemy rather than a variant of it, which is why
    the renderer tints that alias toward the slug's own colours. Their official skeletons only exist in the client's
    enemy art bundles (`refs/arts/enm_art_*.ab`); the *mobile* build also ships them as
    `enemy_spine/<enemyId>/<enemyId>.{skel,atlas,png}` (straight-alpha pages: no `pma: true` line), but its only public
    mirror is a community wiki rather than a GitHub dump, so it is deliberately **not** an asset source — a third-party
    site is not added to `sources.mjs` for two models, and the tinted alias stays the web model until a GitHub dump
    carries them. The same official model from the local client is the optional **overlay**,
    `enemies[id].spineLocal` = `{ group, skel, atlas, textures, pma, anims, animations, events, hits, bounds }` (file
    names in the `data/local-assets.json` group `spine/enemy/{enemyId}`; the rest as a `spine` entry):
    - `tools/local-extract/extract.py` writes the model to `public/assets/local/spine/enemy/{enemyId}/` (page textures
      with their `[alpha]` texture merged in: premultiplied RGB + A like Ark-Models; the atlas gets `size:` and
      `pma: true`) and lists its files in `data/local-assets.json`.
    - The metadata comes from the committed `tools/assets/local-enemy-spines.json` (`fetch-assets --local-spines`
      parses the extracted models into it), never from the disk: `data/assets.json` is byte-identical with or without
      the extraction, it has no `/assets/local/` URL, and setup / doctor / the manifest tests never miss these files.
    - The client (`assets.js spineEntry`, with `assets.local()`, which `createFieldView` awaits with the manifest) draws
      the official model when the local manifest lists every file of it; otherwise, or when it fails to load
      (`UnitView`: the entry's `fallback`), the web alias, tinted toward the slug's own lava colours
      (`render/units.js ALIAS_TINT`: 灼热 orange, 炽焰 red-orange; research 07 §5.6 "a hue shift", [ASSUMED] look) so a
      source install without the extraction still tells them from the plain 源石虫. A release bundle carries the
      models only when it is zipped from a checkout where the extraction ran with the `spine/enemy` job (an extraction
      made with 0.1.0 lacks it: `node tools/setup.mjs --local` again, then check that `data/local-assets.json` lists
      `spine/enemy/enemy_1305_mhslim` and `spine/enemy/enemy_1305_mhslim_2`).
    User feedback after 0.1.0 (D3: "所有特殊源石虫的模型全表现为普通源石虫"): the ELEMENT faction spawns up to ten of them a
    round. A 2026-10-03 audit of every enemy of `data/enemies.json` (249) against the client's battle prefabs (the
    skeleton each prefab's Spine renderer draws) found no other enemy drawn with another enemy's model; 伊利昂的木驮兽
    (`enemy_10159_mntrjn`) starts on its `Full` skin (five passengers) in the game and is drawn with the `default` one.
- **Token models from the local client** (0.2.0): no dump carries the battle Spine of most 自选 summons (fetch-assets:
  "missing skel"), nor of 凯瑟琳's 爬行号·防护单元 and 凛御银灰's 风雪之眼, so they were drawn as the avatar diamond. The
  local client has them in its battle token packs (`pkgrps/btl_pfb_tokens_*.ab`, the Windows build carries all of them;
  the iOS build lacks `btl_pfb_tokens_0` and has ASTC pages), the same overlay as the enemies above:
  - `tools/local-extract/extract.py TOKEN_SPINES` (39 ids; `--only spine/token`) reads each token's battle prefab
    (`dyn/battle/prefabs/[uc]tokens/<id>.prefab`), takes the skeleton of its Front renderer — a directional token has
    Front / Back (/ Down) renderers, each with its own skeleton of the same name; the web tokens use Front too — and
    writes it to `public/assets/local/spine/token/{tokenId}/` like an enemy model (skeleton, sized `pma: true` atlas,
    premultiplied pages: the older tokens' `[alpha]` texture merged in, the newer RGBA pages kept with their own alpha).
  - `tokens[id].spineLocal` = `{ group: 'spine/token/{tokenId}', skel, atlas, textures, pma, anims, … }` from the
    committed `tools/assets/local-token-spines.json` (`fetch-assets --local-spines`), never from the disk;
    `assets.js spineEntry` draws the model when `data/local-assets.json` lists every file of it, else (or when it fails
    to load) the avatar diamond as before. The models are drawn like the web tokens: one `UNIT.modelScale`, no
    per-prefab factor (the official prefabs scale most tokens by the standard 0.27; W's 此面向敌 0.4, 令's “清平” 0.25 and
    “弦惊” 0.3, 傀影's 镜中虚影 0.26, 风雪之眼 and 淬羽赫默's 夜灯 0.25 — like the web tokens' 医疗探机 / 诅咒娃娃 0.4 and
    香槟炸弹 0.25).
  - Clip names the resolver cannot read are mapped in `tools/assets/spine.mjs LOCAL_SPINE_ROLES`: 电弧's 戴乌
    (`C_Skill1_*`, beside a 0 s `C_Default` pose), 酒神's 本能的召唤 (`Loop` / `End`) and 白铁's 多功能平台 (`End` as it
    goes) [ASSUMED: by the clip names], and 凯尔希·思衡托's 战术锚点, whose Start / Idle / Die clips hide its only
    attachment: it stays on its `Default` pose (a white anchor mark) [ASSUMED].
  - Not extracted: the tokens whose prefab draws nothing (an `EmptyAnimator` instead of a Spine renderer; no avatar in
    either install's asset index either): 乌尔比安's 从不混淆的方向, 圣聆初雪's 保护目标（冻结状态）, 酒神's 迷狂牢笼, 贝洛内's
    牵绊 and 予愿安洁莉娜's “一会儿见！” — the last three keep the token fallback picture (`tokenAvatarUrl`: no avatar, no
    owner in the manifest → the 召唤物 battle-card icon).

### Other fallbacks

- **Emotes and 玩法说明 pages** (`public/js/data.js artUrls / nextArtUrl`, `ui/guide.js guideStage`): the local-client picture (`data/local-assets.json`) first, then the mirror copy (`ui['emoticon/…']`, `ui['guide/…']`), each tried in turn when one fails to load; when none is left — none listed, or every copy failed (for example data/assets.json lists the downloaded pages but the files are not on disk yet: a `git pull` and restart without setup) — the neutral emote glyph, and for a page the official tips text (`config.tips`). The rest of the local-client art (the 3D board, the official HUD sprites, module type icons, the two enemy models and the 39 token models above) is not downloaded: the client looks it up in `data/local-assets.json` only (most of the HUD sprites are on the mirror too, DESIGN §22.5); docs/DEPLOY.md §6 lists what falls back without it.
- **Tokens:**
  - Without an avatar, use `chars[owner].avatar` with a 召唤物 badge, or `prof.battlecard.token` — except 圣聆初雪's 保护目标（冻结状态） (PRTS 无头像; the frozen gate), drawn as a procedural ice diamond (`render/units.js ICE_TOKENS`).
  - Without a Spine (and without its local-client model, "Token models from the local client"), draw the avatar sprite with a bob tween.
  - `spineVariant` names the skin-variant model that stands in for the missing default model.
- **Enemies without a spine** (for example `enemy_9016_acstmr`): draw `icon` in a diamond. Enemies with no manifest entry at all (`enemy_5601_entlec` 心烛): draw a procedural glyph.
- **Battle effects** (projectiles per kind, hit sparks and slashes, skill bursts and auras, 蕾缪安's lock reticles and shells, 回环射手 boomerangs — DESIGN §17.3) are procedural: the FX atlas is drawn at run time (`public/js/render/textures.js`), so they need no downloaded or local art. The local client does have battle effect art — `battle/[pack]common.ab` holds per-weapon projectile sprites (`projectile_arrow(_new)`, `projectile_crossbow(_new)`, `projectile_yuki`, `img_fx_light_01/02`, `trail_11`), and the per-character `battle/prefabs/effects/*.ab` are particle systems whose textures live in other bundles — but none of it is extracted: the sim's `arrow` also covers gun snipers, and friends joining a game may not have the local art. The 丰川祥子 collab operator needs no art of its own either: her 音符 glyphs (八分音符 / 十六分音符 / 高音谱号) and the Ave Mujica Fever badge (a rose ring) are two more procedural FX-atlas / HUD-ring frames (`public/js/render/textures.js` `drawNote` / `drawTreble`, `hudRings`), drawn from the snapshot (`b.snap.proj` / `b.snap.fever`, `public/js/render/fx/notes.js`, `public/js/render/units.js FEVER_ICON`).
- **Spine memory** (`public/js/assets.js`): skeletons are refcounted in an LRU with an idle budget (`SPINE_IDLE_BYTES`, 48 MB) and a 15 s grace; eviction runs `SPINE_EVICT_DELAY_MS` (1 s) after a release, the "no scene on screen" budget (0 bytes) applies after `SPINE_QUIET_DELAY_MS` (3 s) with nothing referenced, and a skeleton whose unload is still in flight is never handed out again — a new load waits for the unload (DESIGN §17.1; it used to leave operators invisible after a battle → prep switch).

### Looking up `data/chess.json` asset ids

`data/chess.json` stores asset **ids** in `chess[*].assets` (docs/DATA.md). They map onto this manifest as follows (checked for all 258 chess):

| `assets` field | Example id | Manifest URL |
|---|---|---|
| `avatar` | `char_498_inside` / `char_498_inside_2` | `chars[id].avatar` / `chars[id minus "_2"].avatarE2` |
| `portrait` | `char_498_inside_1` / `char_498_inside_2` | `chars[id minus "_1"].portrait` / `chars[id minus "_2"].portraitE2` |
| `spine` | `char_498_inside` | `chars[id].spine.front` (and `.back`) |
| `skillIcon` | `skchr_inside_2` | `skills[id]` (the id is the skill's `iconId`) |
| `subProfIcon` | `sub_fastshot_icon` | `prof.sub[id minus "sub_" and "_icon"]` |
- **Missing unit SFX:** use `audio.sfx.battle.enemyHit` or a WebAudio blip (research 07 §6.4).
- **Bond icons:** if the real glyph ever fails, the stored file is the nation camp logo.

## Verification

`node --test test/assets.test.js` covers the pure helpers: the resolver, the atlas normalizer, the format sniffers, WOFF2, audio banks, the plan id sets, the downloader against a fake network, and the self-heal of corrupt skeletons.
When `public/assets` exists, the same file also checks the generated output:
- Every manifest path exists on disk.
- Every pool operator has an avatar, a portrait and a Front model.
- Every atlas has `size:` lines, plus `pma: true` for enemies.
- Every Spine model loads the way the client loads it — the local-client enemy and token models too, when `data/local-assets.json` lists them. That means pixi-spine's atlas reader with real page sizes, where a region outside its page throws, then `SkeletonBinary` with `AtlasAttachmentLoader`, where a missing region throws. Every resolved role is then posed.

`test/feedback1d-models.test.js` (enemies) and `test/local-token-models.test.js` (tokens) check the local-client overlays: the plan, the committed metadata, the manifest without `/assets/local/` URLs, the client's choice of model; `test/local-extract.test.js` the extractor's job table and helpers.

The 2026-09-27 verification pass also checked:
- **PNG:** all 2,211 PNGs pass a full CRC and inflate check.
- **Audio:** all 467 MP3s decode with ffmpeg without errors.
- **Browser:** headless Chrome loads and animates all 529 Spine models with the vendored PixiJS 7.4.2 and pixi-spine 4.0.6, with no console errors. Chrome's font sanitizer also accepts the three WOFF2 files.
- **Official data:** 771 provenance checks against the official data (`activity_table`, `skill_table`, `models_data.json`) all match: avatars, portraits, E2 art, bond, band and item icons, and enemy skeleton files.

## Licensing and credits

The project's code is GPL-3.0-or-later (`LICENSE`); none of the items below is covered by it. Details: `NOTICE.md` (scope, non-commercial terms) and `THIRD-PARTY-NOTICES.md` (libraries, fonts, licence texts).

- **Game assets.** All images, Spine models, audio and game data are © **Hypergryph (上海鹰角网络)**. The overseas publisher is **Yostar**.
  - This is an **unofficial, non-commercial fan project**: no ads, donations or paywall.
  - Assets are fetched from public community dumps at install time and are not redistributed in this repository. The plug-and-play bundle attached to a GitHub release does carry them (with the local-client art) under the same non-commercial terms, with `NOTICE.md` inside.
  - Assets will be removed on request from the rights holders.
  - The client must show a credits screen: "Arknights © Hypergryph / Yostar. This is an unofficial fan project; all game assets belong to their owners."
- **Asset dumps and tools.** Credit to:
  - [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)
  - [fexli/ArknightsResource](https://github.com/fexli/ArknightsResource) (ArkResourceAutoUpdateBot)
  - [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) (ArkUnpacker). Not for commercial use.
  - [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2) (ArknightsStudio)
  - [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)
- **Spine runtime.** pixi-spine is MIT-licensed. It embeds Spine Runtime code under the [Spine Runtimes License](http://esotericsoftware.com/spine-runtimes-license), which formally expects a Spine Editor licence. This is commonly tolerated for non-commercial fan tools, and the Spine Runtimes License must be credited (`THIRD-PARTY-NOTICES.md`). The project's GPL carries an additional permission (section 7) to combine it with the Spine Runtimes (`NOTICE.md`).
- **Fonts.**
  - **Bender:** © Jovanny Lemonad (Oleg Zhuravlev, Ivan Gladkikh). Free for personal and commercial use.
  - **Novecento Wide:** © Jan Tonellato / Synthview. Free licence.
  - Both are mirrored from TimWangZi/The-font-of-Arknights.
  - Noto Sans SC and Noto Serif SC (SIL OFL) are loaded from Google Fonts, not self-hosted.
