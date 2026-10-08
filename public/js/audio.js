// Audio manager (Web Audio): BGM per phase, UI SFX, per-unit battle SFX, operator battle voice. Never throws.
//
// Sources: data/assets.json → audio (docs/ASSETS.md):
//   bgm { lobby, prep, combat, combatAlts?: [ {intro?, loop}, … ], boss: { intro?, loop } },
//   bossBgm { [bossId]: { intro?, loop } },
//   voice { [charId]: { start, faceEnemy, select, place, skill1…skill4, squad, squadFirst, result*, gacha } },
//   sfx.ui { click, buy, sell, refresh, freeze, levelup, merge, equip, ready, timer, yourTurn, … },
//   sfx.battle { deploy, tokenDeploy, charDie, tokenDie?, enemyDie, enemyHit, heal, killCoin, … },
//   sfx.units { [charId|tokenId|enemyId]: { attack?, hit?, skill?, die?, born?, mix?, skills?,
//     skillSfx?: { [skillIndex]: { born?, hit?, finish?, loop? } } } }.
//
// - The AudioContext is created on the first user gesture (pointerdown/keydown/touchend), so browsers
//   never block or warn; everything requested before that is remembered (BGM) or dropped (SFX).
// - Channels: master → { bgm, sfx, voice } gains; volumes from settings (0..1) + mute. Tab hidden ⇒ suspend.
// - BGM: `intro` then `loop` (1 s crossfade); switching tracks fades out/in (0.8 s). The same loop URL
//   keeps playing across phases (prep and combat share a track).
// - 开战 BGM: `bgm.combatAlts` are the mode's own battle tracks (塞壬唱片 骑士之日 / 无畏者). The track is fixed per
//   round, not drawn: 无畏者 through rounds 1–7 and 骑士之日 from round 8 on (`combatTrackFor`, the official
//   schedule), so every client of a match hears the same one, a fight never switches track halfway through and the
//   联防 that follows a 作战 keeps its round's track.
// - 干员战斗语音 (`audio.voice`, user request): an operator says the official line of the moment it is in —
//   行动出发 start, 行动开始 faceEnemy, 选中干员 select, 部署 place, 作战中1-4 skillN and the settlement's
//   结算 result* (all battle-only; the 休整期 is silent). Voices are seconds long and a battle deploys eight
//   operators, then fires dozens of skills, so they run on their own channel (own gain, settings 干员语音) through
//   VoiceGate: one line at a time, a global gap, a per-unit per-slot cooldown, and a higher-priority line taking the
//   channel over — the official scheduling of `audio_data.json battleVoice.voiceTypeOptions`.
// - Battle SFX from `b.ev` tuples (`handleBattleEvents`): at most MAX_VOICES concurrent unit sounds, at most
//   MAX_PER_URL overlapping copies of one sound (the official banks' maxSoundAllowed 2), a per-unit cooldown and a
//   per-unit per-URL minimum gap (SfxLimiter), so a 60-unit fight stays listenable. A `['skill', id, 1]` that arrives
//   before its unit is known is held and played once the unit is tracked (`pendingSkill`): a unit that casts inside its
//   own deploy tick emits that first cue before any `spawn` (or the field's unit list) reached this client, and dropping
//   it left the one cast silent while every later one played.
// - The minimum gap of one sound is per UNIT, not global (owner report 「场上有两只丰川祥子时，似乎只播放其中一只的音效」):
//   two operators of the same character fire their identical sound file milliseconds apart, and a global
//   "one URL per 45 ms" gap silently dropped the second unit's cue whenever both arrived in the same event batch
//   (a socket message carries both `atk` tuples, so they share one `performance.now()` reading). The official rule is the
//   bank's own `maxSoundAllowed: 2` — two overlapping copies are allowed — so the same unit is still held to the gap
//   (it cannot flam with itself) while two DIFFERENT units may each have theirs. Loudness stays bounded by the three
//   caps that are not per unit: MAX_VOICES concurrent sounds for the whole battle, MAX_PER_URL overlapping copies of one
//   file (2, the official number) and each unit's own UNIT_COOLDOWN_MS.
// - Impact sounds (user playtest #4 item 6): a 'dmg' plays the `hit` sound of the unit whose hostile attack ('atk' on a
//   unit of the other side) aimed at the target — once, within IMPACT_WINDOW_MS, and only for phys / arts / true damage.
//   A heal "attack" ('atk' of a healer on an ally, chain heals) never makes the healer the author of the next damage
//   on that ally (纯烬艾雅法拉's heals made every later hit on a healed ally ring her impact sound), element gauge fills
//   and DoTs play none, and a chain bounce ('chain' / 'chainHeal': its first id is the previous target) plays no attack
//   sound of that target. An operator's attack / hit sound that is a skill-mode file of its own (official names end in
//   `_n` for the normal attack, `_d` / `_h` / `_s` for its skill modes — the manifest picked 纯烬艾雅法拉's S3 impact
//   p_imp_gtshpbrnch_s as her `hit`) never plays for a normal attack (normalAttackSfx).
// - The official bank mix of a unit's own attack / hit / die / born sound (`mix`, tools/assets/audio.mjs bankMix; community
//   report #30): it plays with chance `p` — 猎狗pro / 深池侦察犬's attack bank is 80 % silence, so they bark on about one
//   attack in five (never replaced by the generic enemy sound) — at its base gain × `vol`, capped at 1: an official volume
//   below 1 is quieter (妖怪's 0.7), none is louder than before (unitGain).
// - Deaths/deployments follow the official per-class defaults (unitSoundClass): only operators play the
//   operator-knocked-down sound; summons use the token sounds; a summon used up by its own effect (fx `consumed`,
//   香槟炸弹) plays its impact sound instead of a death sound.
// - Buffers are fetched once and cached (LRU); failed fetch/decode ⇒ silent (logged once as a warning).
//
// `bgmKeyFor(route, pub)` picks the track for the current screen/phase (main.js calls `audio.install()`,
// which follows the store).

import { PHASE } from '../../shared/constants.js';
import { mediaUrl } from './media.js';

const MAX_VOICES = 8;
const UNIT_COOLDOWN_MS = 160;
/**
 * Minimum gap between two plays of the SAME file BY THE SAME UNIT (once per unit, not once for the whole battle: two
 * operators of one character may each have their own copy of the sound — see the header).
 */
const URL_GAP_MS = 45;
const MAX_PER_URL = 2;
/**
 * 漏怪: the original Arknights exit alarm (`sfx.battle.leak`, `battle/b_ui/b_ui_alarmenter`) runs **1.44 s**, and the
 * official bank is a one-shot: `battle.ON_ENEMY_REACHED_EXIT` carries `maxSoundAllowed: 1` with `popOldest: true` on the
 * `Battle_UI_Important` mixer, i.e. **never two at once** (a new escape replaces the one still ringing). We keep the
 * "never two at once" half and leave the rest of the cue alone: leaks closer together than the cue is long are the same
 * disaster and share one alarm, so a line that breaks costs one clear ring per 1.5 s instead of a stutter of restarts.
 * (The SFX limiter still applies on top.)
 */
const LEAK_SFX_GAP_MS = 1500;
const BUFFER_CACHE = 180;
/** Decoded-PCM budget of the buffer cache beside its entry count: a voice line decodes to 0.4–1.3 MB (see _buffer). */
const BUFFER_BYTES = 64 * 1024 * 1024;
const XFADE_S = 1;
const FADE_S = 0.8;
/** Voice: shortest gap between two lines, and the crossfade of a higher-priority line taking the channel (official 0.1 s). */
const VOICE_GAP_MS = 1200;
const VOICE_XFADE_S = 0.1;
/** 'atk' projectile kinds whose first id is the previous bounce target (sim ai.js), not the attacker. */
const CHAIN_KINDS = new Set(['chain', 'chainHeal']);
/** 'dmg' types that are an attack's impact (element gauge fills / 元素伤害 carry the element's name instead). */
const IMPACT_TYPES = new Set(['phys', 'arts', 'true']);
/** A 'dmg' later than this (real ms) after the attack aimed at the target is not that attack's impact. */
const IMPACT_WINDOW_MS = 2500;
/** Official operator sound files of a skill mode: `…_d` / `…_h` / `…_s` (+ digits) — the normal attack's end in `_n`. */
const SKILL_MODE_FILE = /_(d|h|s)\d*\.mp3$/i;
/**
 * 持续段循环音 (`sfx.units[id].skillSfx[i].loop`, e.g. 丰川祥子's S3): how long one loop may ring without its skill's end
 * event, and the fade of a stop. The official data makes the stop a CONTROL action rather than a sound:
 * `soundFXCtrlBanks` carries `battle.ON_SKILL_FINISH.skchr_oblvns_3 = { targetBank: 'battle.ON_BUFF_START.oblvns_s_3[loop]',
 * ctrlStop: true, ctrlStopFadetime: 0.2 }` — S3's own `ON_SKILL_FINISH` has no `soundFXBanks` entry at all, so its end
 * cue IS this fade-out (there is no file to play). The cap is the safety net for an end event this client never sees (a
 * dropped socket, a replay that starts mid-skill): a loop outliving its skill is the one failure a loop primitive can
 * have, and the official skill's own duration is 25 s.
 */
const SKILL_LOOP_MAX_S = 60, SKILL_LOOP_FADE_S = 0.2;

// ---- pure helpers (unit-tested) -----------------------------------------------------------------------

/**
 * BGM key for a route + match phase.
 * @param {'title'|'lobby'|'room'|'game'|string} route
 * @param {any} pub m.public (may be null)
 * @param {0|1|null} [combatTrack] the round's own 开战 track index into `bgm.combatAlts` (combatTrackFor; omitted ⇒
 *   plain 'combat', i.e. the manifest's default combat track)
 * @returns {string|null} 'lobby' | 'prep' | 'combat' | 'combat:<i>' | 'unite' | 'boss' | 'boss:<bossId>' | null
 */
export function bgmKeyFor(route, pub, combatTrack = null) {
  if (route !== 'game') return route === 'title' || route === 'lobby' || route === 'room' ? 'lobby' : null;
  const phase = pub?.phase;
  if (!phase) return 'lobby';
  switch (phase) {
    case PHASE.INFO_CHECK: case PHASE.BAND_DRAFT: case PHASE.BATTLE_CHECK: case PHASE.RESULT: case PHASE.LOBBY:
      return 'lobby';
    case PHASE.UNITE:
      // 联防 has its own track: the official `escaped_single` / `escaped_multi` levels declare
      // `bgmEvent = corrosion` (level_act1autochess_escaped_*.json), so the rescue phase is not the 作战's track.
      // resolveBgm falls back to `bgm.combat` when a manifest predates it.
      return 'unite';
    case PHASE.COMBAT:
      // 开战 BGM: the round's own track — 骑士之日 / 无畏者 are fixed per round, not drawn (combatTrackFor)
      return combatTrack == null ? 'combat' : `combat:${combatTrack ? 1 : 0}`;
    case PHASE.FINAL_ASSAULT:
      return pub.bossId ? `boss:${pub.bossId}` : 'boss';
    case PHASE.HIDDEN_CORE:
      return pub.hiddenBossId ? `boss:${pub.hiddenBossId}` : pub.bossId ? `boss:${pub.bossId}` : 'boss';
    default:
      return 'prep';
  }
}

/**
 * Resolve a BGM key to { intro?, loop } URLs from the manifest: `boss:<id>` falls back to the generic boss track,
 * `combat:<i>` to the i-th `bgm.combatAlts` entry (and to `bgm.combat` when the manifest has none), and `unite`
 * (联防's own track) to `bgm.combat` when the manifest predates it.
 * @param {any} manifest
 * @param {string|null} key
 * @returns {{ intro: string|null, loop: string }|null}
 */
export function resolveBgm(manifest, key) {
  const a = manifest?.audio;
  if (!a || !key) return null;
  let t = null;
  if (key.startsWith('boss:')) t = a.bossBgm?.[key.slice(5)] || a.bgm?.boss;
  else if (key.startsWith('combat:')) t = a.bgm?.combatAlts?.[Number(key.slice('combat:'.length))] || a.bgm?.combat;
  else if (key === 'unite') t = a.bgm?.unite || a.bgm?.combat;
  else t = a.bgm?.[key];
  if (!t || typeof t.loop !== 'string') return null;
  return { intro: typeof t.intro === 'string' ? t.intro : null, loop: t.loop };
}

/**
 * The last round that plays 无畏者 (1–7); from the next round on it is 骑士之日 (8–13) — the official schedule
 * (docs/ASSETS.md "BGM"; the two tracks are the 塞壬唱片 act13side battle themes).
 */
export const COMBAT_TRACK_SWITCH_ROUND = 7;

/**
 * The round's own 开战 track index into `bgm.combatAlts` (plan.mjs order: 0 = `m_bat_kazimierz2_1` 骑士之日,
 * 1 = `m_bat_kazimierz2_2` 无畏者). The mode does not draw these: the official schedule plays one per round, 无畏者
 * through the early rounds (1–7) and 骑士之日 from round 8 to the last normal round (8–13). Everything after that is
 * the boss rounds (最终攻势 / 隐秘核心), which have their own tracks and never ask for `combat:<i>`.
 * @param {number|null|undefined} round m.public.round
 * @returns {0|1|null} null when the round is unknown ⇒ the manifest's plain `combat` track
 */
export function combatTrackFor(round) {
  const r = Number(round);
  if (!Number.isFinite(r) || r < 1) return null;
  return r <= COMBAT_TRACK_SWITCH_ROUND ? 1 : 0;
}

/**
 * Official sound class of a battle unit (audio_data `battle.ON_UNIT_DEAD|BORN.<class>` defaults):
 * 'enemy' | 'char' (operators: b_char_dead “干员被击倒” / b_char_set) | 'token' (summons: b_char_tokendead /
 * b_char_tokenset) | 'device' (stage devices: the act crate trap_1105 dies with b_char_tokendead, no born sound).
 * Band map characters (预备干员-医疗 / Touch, `char_*` ids) are characters although the sim runs them as tokens.
 * @param {{ side?: string, kind?: string, defId?: string, def?: string }|null} info tracked unit (UnitInfo subset)
 */
export function unitSoundClass(info) {
  if (!info) return 'char';
  if (info.side === 'enemy') return 'enemy';
  const id = String(info.defId ?? info.def ?? '');
  if (info.kind === 'device') return 'device';
  if (info.kind === 'token') return /^char_/.test(id) ? 'char' : 'token';
  return 'char';
}

/** URL of the generic token death sound (b_char_tokendead): sfx.battle.tokenDie, else next to charDie. */
function tokenDieUrl(manifest) {
  const b = manifest?.audio?.sfx?.battle;
  if (typeof b?.tokenDie === 'string') return b.tokenDie;
  return typeof b?.charDie === 'string' && /b_char_dead\.mp3$/.test(b.charDie) ? b.charDie.replace(/b_char_dead\.mp3$/, 'b_char_tokendead.mp3') : null;
}

/**
 * Death sound of a battle unit ('die' event): the unit's own ON_UNIT_DEAD sound, else its class default — only
 * operators play the operator-knocked-down sound (charDie). A summon that fired and was used up (香槟炸弹: its
 * explosion is the sound) is silent, and so is an operator leaving without being knocked out, when the event says so
 * (`reason` ≠ 'killed').
 * @param {any} manifest data/assets.json
 * @param {{ side?: string, kind?: string, defId?: string, def?: string, boss?: boolean }|null} info
 * @param {{ consumed?: boolean, reason?: string|null }} [o]
 * @returns {string|null} sound URL
 */
export function deathSfxUrl(manifest, info, { consumed = false, reason = null } = {}) {
  if (!info || consumed) return null;
  const cls = unitSoundClass(info);
  if (cls === 'char' && reason && reason !== 'killed') return null;
  const own = manifest?.audio?.sfx?.units?.[info.def]?.die;
  if (typeof own === 'string') return own;
  const b = manifest?.audio?.sfx?.battle ?? {};
  if (cls === 'enemy') return (info.boss ? b.enemyDieHeavy : null) ?? b.enemyDie ?? null;
  if (cls === 'char') return typeof b.charDie === 'string' ? b.charDie : null;
  return tokenDieUrl(manifest);
}

/**
 * Deployment sound of an allied unit ('deploy' event): its own ON_UNIT_BORN sound, else operators b_char_set
 * (sfx.battle.deploy), summons b_char_tokenset (tokenDeploy); stage devices have none.
 * @returns {string|null}
 */
export function deploySfxUrl(manifest, info) {
  if (!info || info.side === 'enemy') return null;
  const own = manifest?.audio?.sfx?.units?.[info.def]?.born;
  if (typeof own === 'string') return own;
  const b = manifest?.audio?.sfx?.battle ?? {};
  const cls = unitSoundClass(info);
  if (cls === 'device') return null;
  const url = cls === 'token' ? (b.tokenDeploy ?? b.deploy) : b.deploy;
  return typeof url === 'string' ? url : null;
}

/**
 * Whether a unit's manifest `attack` / `hit` sound may play for its normal attacks: an operator's (`char_*`) sound file
 * of one of its skill modes (`_d` / `_h` / `_s`, see header) may not. Enemy files use `_h` for heavy weapons (always
 * allowed), and so may summons.
 * @param {string} defId the unit's model id (sfx.units key)
 * @param {string} url
 */
export function normalAttackSfx(defId, url) {
  return typeof url === 'string' && !(typeof defId === 'string' && defId.startsWith('char_') && SKILL_MODE_FILE.test(url));
}

/**
 * Per-skill battle sound (`audio.sfx.units[defId].skillSfx[<skillIndex>]`, docs/ASSETS.md "按技能细分的音效"): the cue a
 * unit's OWN skill plays for a role its unit entry carries only once. Keyed by the skill index the snapshot's UnitInfo
 * carries (`skillIndex`, the equipped skill's 0-based index — the same key `unit()` reads for `skills[index]`), and read
 * anywhere a unit sound would otherwise be the only answer:
 *
 *   { "skillSfx": { "0": { "hit": "/assets/audio/sfx/…" }, "2": { "finish": "…", "loop": "…" } } }
 *
 * Roles: `born` / `hit` / `finish` / `loop` (see the manifest note on the unit entry). `role` is looked up on the
 * skill's own entry first, then — for roles a cast shares with the unit (`hit`) — nothing else: the CALLER decides the
 * fallback (`unit()` falls back to `u.hit`, the skill event to `u.finish`), so a unit whose entry has no `skillSfx` at
 * all behaves exactly as it did before this section existed. Both the numeric and the string form of the index are
 * accepted (JSON keys are strings; `skillIndex` off a snapshot is a number).
 * @param {any} manifest data/assets.json
 * @param {string} defId charId/tokenId/enemyId (sfx.units key)
 * @param {number|string|null|undefined} skillIndex 0-based equipped skill index
 * @param {'born'|'hit'|'finish'|'loop'} role
 * @returns {string|null} sound URL, or null when this unit / skill / role has none
 */
export function skillSfxUrl(manifest, defId, skillIndex, role) {
  if (typeof defId !== 'string' || defId === '') return null;
  if (!Number.isInteger(skillIndex) && typeof skillIndex !== 'string') return null;
  const s = manifest?.audio?.sfx?.units?.[defId]?.skillSfx;
  if (!s || typeof s !== 'object') return null;
  const e = s[String(skillIndex)];
  if (!e || typeof e !== 'object') return null;
  return typeof e[role] === 'string' ? e[role] : null;
}

/**
 * A content-owned projectile's own sound (`audio.sfx.proj`, docs/ASSETS.md "投射物音效"): the projectile kinds the sim
 * streams in `b.snap.proj` ('note' = 丰川祥子's talent note, 'noteSkill' = her skills') are sound classes of their own —
 * her note's launch is NOT her `attack` cue, and the manifest's `born` is the DEPLOYMENT sound (`ON_UNIT_BORN`,
 * deploySfxUrl). The URL is `/assets/audio/sfx/…`, exactly like `sfx.units[id][role]`, and the shape mirrors
 * `sfx.units` with an optional per-unit override so a class of projectiles can be shared:
 *
 *   sfx.proj['<kind>'] = '<url>' | { born?, hit?, units?: { [unitId]: { born?, hit? } } }
 *
 * Resolution order for a shot fired by `unitId`: the unit's own entry, then the kind's. The `born` sound of a note is
 * what this exists for; `hit` is carried by the manifest but deliberately not played — a note may leave the snapshot
 * because it expired instead of landing (see this file's `handleBattleEvents`, where an impact sound follows the `dmg`
 * that the SIM attributes, never the projectile's disappearance).
 * @param {any} manifest data/assets.json
 * @param {string} kind `snap.proj` kind ('note' | 'noteSkill' | …)
 * @param {'born'|'hit'} [role]
 * @param {string|null} [unitId] the unit that fired it (its `defId`/spine id), when the client knows it
 * @returns {string|null} sound URL
 */
export function projSfxUrl(manifest, kind, role = 'born', unitId = null) {
  if (typeof kind !== 'string' || !kind) return null;
  const e = manifest?.audio?.sfx?.proj?.[kind];
  if (!e) return null;
  const own = unitId != null ? e.units?.[unitId] : null;
  // the short string form is the launch sound of the kind (the role the client actually asks for)
  const pick = (node) => (typeof node === 'string' ? (role === 'born' ? node : null)
    : typeof node?.[role] === 'string' ? node[role] : null);
  return pick(own) ?? pick(e);
}

/**
 * Gain of a unit's own sound with its manifest mix (sfx.units[id].mix[role]: the official bank's volume): `base` × `vol`,
 * never above `base` (a bank louder than 1 plays as before — community report #30 asked for quieter, not louder).
 * @param {number} base the role's base gain (attack / hit 0.55, die / born / skill 0.8)
 * @param {{ vol?: number }|null|undefined} mix
 */
export function unitGain(base, mix) {
  const v = mix && Number(mix.vol);
  return Number.isFinite(v) && v >= 0 ? base * Math.min(1, v) : base;
}

/**
 * Whether a unit's own sound plays this time: its official bank's chance `mix.p` (sounds with a file over all the weights;
 * 猎狗pro's attack bank 20 of 100). `roll` ∈ [0, 1).
 */
export function unitSoundPlays(mix, roll) {
  const p = mix && Number(mix.p);
  return !(Number.isFinite(p) && p >= 0 && p < 1) || roll < p;
}

/**
 * Voice priorities — the official battle voice types (`audio_data.json battleVoice.voiceTypeOptions`) mapped onto the
 * manifest's slots: BATTLE_START 100, BATTLE_FACE_ENEMY 90, SKILL_ACTIVE 70, PASSIVE_IMP 60, PASSIVE_NOR 50,
 * PLACE_CHAR 20, FOCUS_CHAR 10. The settlement lines are no battle voice of the official scheduler: they sit at 85,
 * above 作战中 (70) but below 接敌 (90), so a battle's last word is never cut off by an ordinary line. The four prep
 * slots (部署 / 编入队伍 / 任命队长 / 干员报到) keep their levels although the 休整期 is silent (see the header).
 */
export const VOICE_PRIORITY = Object.freeze({
  start: 100, faceEnemy: 90,
  skill1: 70, skill2: 70, skill3: 70, skill4: 70,
  resultFour: 85, resultThree: 85, resultTwo: 85, resultLose: 85,
  gacha: 60, squadFirst: 45, squad: 30, place: 20, select: 10,
});

/** Per-unit per-slot cooldowns (ms): the official 10 s of the 作战中 (passive skill) lines, 3 s between 接敌 lines. */
export const VOICE_COOLDOWN_MS = Object.freeze({
  start: 0, faceEnemy: 3000,
  skill1: 10000, skill2: 10000, skill3: 10000, skill4: 10000,
  resultFour: 0, resultThree: 0, resultTwo: 0, resultLose: 0,
  gacha: 0, squadFirst: 0, squad: 0, place: 0, select: 1500,
});

/**
 * The settlement slot of a finished 作战: 完美作战 ⇒ 3星结束行动 (绝境 / 终极 ⇒ 完成高难行动 instead), a leaked enemy
 * ⇒ 非3星结束行动, nothing killed at all ⇒ 行动失败.
 * @param {{perfect?:boolean, leaked?:number, killed?:number, total?:number, hard?:boolean}} [o]
 * @returns {'resultFour'|'resultThree'|'resultTwo'|'resultLose'}
 */
export function resultVoiceSlot(o = {}) {
  const leaked = Number.isFinite(o.leaked) ? o.leaked : 0;
  const killed = Number.isFinite(o.killed) ? o.killed : 0;
  const total = Number.isFinite(o.total) ? o.total : 0;
  if (o.perfect) return o.hard ? 'resultFour' : 'resultThree';
  if (total > 0 && killed <= 0) return 'resultLose';
  if (leaked > 0) return 'resultTwo';
  return o.hard ? 'resultFour' : 'resultThree';
}

/**
 * Who says a battle's **result** line (结算): an operator of THAT battle's own field. Never the field the player happens
 * to be looking at (review on #73): reading the tracked units of the field on screen made a teammate's operator say the
 * viewer's 作战结束 line while the viewer was watching them.
 * `pp` is that battle's own `perPlayer` entry (BattleResult, sim/Battle.js): `unitsEnd` lists what stood on its field
 * when the battle ended. Its `defId` names the CHESS (`chess_char_*`) or a summon piece (`token_*`, which does not talk);
 * the voice bank belongs to the operator (`char_*`), so `charOf` maps a chess id to its charId (the chess record's
 * `charId`). Without it only ids that already are a charId count — a real result then has no speaker, which is how the
 * line stayed silent in every battle until 0.1.4's fix.
 * Survivors speak first — the line reports how the battle went, and a wiped-out squad is the only case where a fallen
 * operator ends up saying it. Ties are drawn like every other unit sound.
 * @param {{ unitsEnd?: Array<{ defId?: string|null, alive?: boolean }> } | null | undefined} pp that battle's perPlayer
 * @param {() => number} [random]
 * @param {((defId: string) => string|null|undefined) | null} [charOf] chess id → charId
 * @returns {string|null} charId, or null when that battle fielded no operator at all
 */
export function resultSpeaker(pp, random = Math.random, charOf = null) {
  const ops = [];
  for (const u of Array.isArray(pp?.unitsEnd) ? pp.unitsEnd : []) {
    if (!u || typeof u.defId !== 'string') continue;
    const id = u.defId.startsWith('char_') ? u.defId : charOf ? charOf(u.defId) : null;
    if (typeof id === 'string' && id.startsWith('char_')) ops.push({ id, alive: !!u.alive });
  }
  const standing = ops.filter((o) => o.alive);
  const pool = standing.length ? standing : ops;   // only a wiped-out squad is spoken for by a fallen operator
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id;
}

/** Concurrency + cooldown gate for battle SFX. Pure (time is passed in). */
/** Gestures that may unlock audio: iOS Safari only accepts touchend / click / keydown; pointerdown covers the rest. */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];
/**
 * SFX priority tiers of the `pri` argument every limiter call carries (lower wins). A field of two 丰川祥子 makes three
 * sounds per attack — 挥击 + 音符诞生 + 音符命中, each of them a note or an impact — and the global `MAX_VOICES` cap is
 * what they fill: an event sound that arrives while the cap is full used to be refused outright, so the ONE sound a
 * player most needs (技能发动 / 部署 / 阵亡) was the one that went missing (owner report 「现在三技能开大没有大招音效了」,
 * measured: see docs/ASSETS.md). The official banks answer this with `maxSoundAllowed` + `popOldest`: a new copy of an
 * important cue takes the place of an older, unimportant one.
 */
export const SFX_PRI = Object.freeze({
  /** Critical events: a skill's activation, a deployment, a death, an operator's card being played. Never starved. */
  event: 0,
  /** The unit's own ordinary attack / impact sounds. */
  unit: 1,
  /** High-frequency decoration: a content-owned projectile's launch (音符诞生), a generic battle cue. */
  deco: 2,
});

export class SfxLimiter {
  /** @param {{ maxVoices?: number, unitCooldownMs?: number, urlGapMs?: number, maxPerUrl?: number }} [o] */
  constructor(o = {}) {
    this.maxVoices = o.maxVoices ?? MAX_VOICES;
    this.unitCooldownMs = o.unitCooldownMs ?? UNIT_COOLDOWN_MS;
    // the minimum gap of one file, per unit (header): `urlGapMs` is the gap one unit must leave between two of its own
    // copies of the same sound — different units are not in each other's way
    this.urlGapMs = o.urlGapMs ?? URL_GAP_MS;
    // the official battle banks (attack, impact, heal, born, dead…) allow at most 2 overlapping copies of a sound
    // (audio_data maxSoundAllowed 2): a heal / impact heard on every tick of a crowd never piles up
    this.maxPerUrl = o.maxPerUrl ?? MAX_PER_URL;
    /** Keys per limiter map. A fight fields at most a few hundred units; a 4×-scenes day of battles is not a leak. */
    this.maxKeys = Number.isFinite(o.maxKeys) ? o.maxKeys : 1200;
    this.active = 0;
    this.lastByUnit = new Map();
    this.lastByUrlUnit = new Map();   // `${unitKey}\u0000${url}` → ms of that unit's last copy
    this.lastByUrl = new Map();       // keyless sounds only (unitKey == null): the per-url gap of one stream
    this.activeByUrl = new Map();
    /** Acquisition token → { url, pri } of every voice that still holds a slot (the `popOldest` candidates). */
    this.voices = new Map();
    this.nextToken = 1;
    /** The token of the acquisition `tryAcquire` just granted (0 = refused); read it right after a `true` answer. */
    this.lastToken = 0;
  }

  /**
   * Whether a sound may start now; records it when allowed (call `release` / `finish` when it ends). When the voice cap
   * is full and the new sound's `pri` is strictly better (lower) than an older voice's, that older voice is evicted and
   * the slot given to the new one (`popOldest`, per the official banks' own field) — an event sound therefore always
   * plays, while the decorations it displaced simply end early instead of silencing it.
   * @param {number} now ms
   * @param {string|number|null} unitKey e.g. `${unitId}:atk` (null = no per-unit state at all)
   * @param {string} url
   * @param {number} [pri] the tier (SFX_PRI; omitted = event tier, so a caller that does not care is never starved)
   * @returns {boolean} whether the sound may start; its acquisition token is `lastToken` (0 when it may not)
   */
  tryAcquire(now, unitKey, url, pri = SFX_PRI.event) {
    this.lastToken = 0;
    const p = Number.isFinite(pri) ? pri : SFX_PRI.event;
    if ((this.activeByUrl.get(url) || 0) >= this.maxPerUrl) {
      // a third overlapping copy of one file: allowed only for a STRICTLY more important sound, and never for another
      // copy at the same tier (the official maxSoundAllowed 2 is a property of the bank, not of the limiter's mood)
      const v = this._findVoice((x) => x.url === url && x.pri > p);
      if (!v) return false;
      this._kill(v.token, v);
    } else if (this.active >= this.maxVoices) {
      const v = this._findVoice((x) => x.pri > p);
      if (!v) return false;
      this._kill(v.token, v);
    }
    if (unitKey != null) {
      const t = this.lastByUnit.get(unitKey);
      if (t != null && now - t < this.unitCooldownMs) return false;
    }
    const urlKey = unitKey != null ? `${unitKey}\u0000${url}` : url;
    const map = unitKey != null ? this.lastByUrlUnit : this.lastByUrl;
    const u = map.get(urlKey);
    if (u != null && now - u < this.urlGapMs) return false;
    if (unitKey != null) {
      if (this.lastByUnit.size > this.maxKeys) this.lastByUnit.clear();
      this.lastByUnit.set(unitKey, now);
    }
    if (map.size > this.maxKeys) map.clear();
    map.set(urlKey, now);
    const token = this.nextToken++;
    this.active += 1;
    this.activeByUrl.set(url, (this.activeByUrl.get(url) || 0) + 1);
    this.voices.set(token, { url, pri: p });
    this.lastToken = token;
    return true;
  }

  /** The oldest voice matching `want` ({ token, url, pri }), or null. Insertion order = oldest first. */
  _findVoice(want) {
    for (const [token, v] of this.voices) if (want(v)) return { token, ...v };
    return null;
  }

  /** Free one voice that the limiter itself displaced (`popOldest`); its owner stops the audio node through `onEvict`. */
  _kill(token, v) {
    this.voices.delete(token);
    this.active = Math.max(0, this.active - 1);
    const n = this.activeByUrl.get(v.url) || 0;
    if (n <= 1) this.activeByUrl.delete(v.url); else this.activeByUrl.set(v.url, n - 1);
    try { this.onEvict?.(token); } catch { /* ignore */ }
  }

  /**
   * Whether an acquired token may still start its sound (`_play` checks this after its buffer decoded, so a sound the
   * limiter displaced while it was loading never starts late on top of the one that took its slot).
   * @param {number} token
   */
  alive(token) { return this.voices.has(token); }

  /** A sound started by tryAcquire ended (or the caller gave up on it). A token the limiter already freed is a no-op. */
  release(url, token = null) {
    if (Number.isFinite(token)) {
      const v = this.voices.get(token);
      if (!v) return;                        // displaced by _kill (its own release already counted), or never acquired
      this._kill(token, v);
      return;
    }
    this.active = Math.max(0, this.active - 1);
    const n = this.activeByUrl.get(url) || 0;
    if (n <= 1) this.activeByUrl.delete(url); else this.activeByUrl.set(url, n - 1);
  }
}

/**
 * Voice gate: one line at a time, a global gap between two lines, a per-unit per-slot cooldown, and takeover by a
 * clearly more important line (the caller fades the playing one out first). Pure — the clock is passed in.
 */
export class VoiceGate {
  /** @param {{ gapMs?: number, preemptMargin?: number, maxUnits?: number }} [o] */
  constructor(o = {}) {
    this.gapMs = Number.isFinite(o.gapMs) ? o.gapMs : VOICE_GAP_MS;
    // a line only takes the channel over when its priority beats the playing one by this margin: an equal-priority
    // line (two 作战中 of different operators) waits for its turn instead of cutting the other off
    this.preemptMargin = Number.isFinite(o.preemptMargin) ? o.preemptMargin : 10;
    this.maxUnits = Number.isFinite(o.maxUnits) ? o.maxUnits : 400;
    this.playing = null;      // { slot, pri } of the line on air
    this.lastAt = -Infinity;
    this.unitUntil = new Map();
  }

  /** Drop all state (a new field must not inherit the previous battle's cooldowns). */
  reset() {
    this.playing = null;
    this.lastAt = -Infinity;
    this.unitUntil.clear();
  }

  /**
   * May a `slot` line from `unitKey` start now?
   * @param {string} slot
   * @param {string|number|null} unitKey the cooldown key (a battle unit id; null = no per-unit cooldown)
   * @param {number} now ms
   * @returns {'play'|'preempt'|'drop'}
   */
  request(slot, unitKey, now) {
    const pri = VOICE_PRIORITY[slot] ?? 0;
    if (this.playing) {
      if (pri < this.playing.pri + this.preemptMargin) return 'drop';
      return 'preempt';                       // a clearly more important line takes the channel
    }
    if (now - this.lastAt < this.gapMs) return 'drop';
    if (unitKey != null && now < (this.unitUntil.get(`${unitKey}:${slot}`) || 0)) return 'drop';
    return 'play';
  }

  /** Record a line that started (call right after request() answered play / preempt). */
  start(slot, unitKey, now) {
    this.playing = { slot, pri: VOICE_PRIORITY[slot] ?? 0 };
    this.lastAt = now;
    const cd = VOICE_COOLDOWN_MS[slot] ?? 0;
    if (unitKey != null && cd > 0) {
      if (this.unitUntil.size > this.maxUnits) this.unitUntil.clear();
      this.unitUntil.set(`${unitKey}:${slot}`, now + cd);
    }
  }

  /** The line ended (naturally, by takeover or by a stop). */
  release() { this.playing = null; }
}

// ---- manager -----------------------------------------------------------------------------------------------

/**
 * Could Web Audio decode this response? A host without the `/media/` route answers 404; some static hosts answer a
 * missing path with 200 + the SPA's index.html instead, and fetching *that* would fail to decode as silently as a
 * 404 would — so the fallback looks at the declared type too.
 *
 * A response that declares no type at all is not treated as wrong: absence of a header is not evidence of an HTML
 * page, and fetch stubs / minimal hosts legitimately omit it.
 * @param {{ ok?: boolean, headers?: { get?: (n: string) => string | null } }} res
 */
function isAudioResponse(res) {
  if (!res || !res.ok) return false;
  const type = res.headers?.get?.('content-type');
  return !type || /^\s*audio\//i.test(type);
}
export class AudioManager {
  /**
   * @param {{ getManifest?: () => any, win?: any }} [opts]
   */
  constructor(opts = {}) {
    this.getManifest = typeof opts.getManifest === 'function' ? opts.getManifest : () => null;
    this.random = typeof opts.random === 'function' ? opts.random : Math.random;   // a unit sound's chance (mix.p)
    this.win = opts.win ?? (typeof window !== 'undefined' ? window : null);
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.voiceGain = null;
    this.volumes = { bgm: 0.6, sfx: 0.8, voice: 0.8, muted: false };
    this.buffers = new Map(); // url → Promise<AudioBuffer|null> (insertion order = LRU)
    this.bufBytes = new Map(); // url → decoded PCM bytes (the byte budget of the LRU, see _buffer)
    this.warned = new Set();
    this.limiter = new SfxLimiter();
    // a voice the limiter displaces (`popOldest`, SFX_PRI): the manager stops its node through the ender the sound itself
    // registered (`voiceEnd`), so a displaced decoration really goes quiet instead of ringing under the event sound
    this.voiceEnd = new Map();   // limiter token → that sound's own ender
    this.limiter.onEvict = (token) => { const end = this.voiceEnd.get(token); if (end) end(); };
    this.voiceGate = new VoiceGate();
    this.voiceNode = null;    // { src, gain, url, token } of the line on air
    this.voiceToken = 0;
    this.startVoiceDone = false; // 行动出发 of this field (the first operator deployed says it)
    this.uiVoices = 0;
    this.wantBgm = null;      // desired key (kept while locked)
    this.bgm = null;          // { key, loopUrl, nodes: [{src, gain}], gain }
    this.bgmToken = 0;
    this.units = new Map();   // battle unit id → defId
    this.pendingSkill = new Map(); // unit id → a 'skill' tuple that arrived before its unit was known (see _track)
    this.activeSkill = new Map(); // unit id → the skill index currently casting (the key of sfx.units[id].skillSfx)
    this.recentSkill = new Map(); // unit id → { index, endedAt } of the cast that just ended (an instant skill's notes land later)
    this.loops = new Map();        // loop key → { src, gain, token, timer } of a running 持续段循环音 (see startLoop)
    this.loopToken = 0;
    this.lastAttacker = new Map(); // target id → { def, at } of the hostile attack last aimed at it (its impact sound)
    this.consumed = new Set();     // summons used up by their own effect (香槟炸弹 exploded): no death sound
    this.installed = false;
    this._unlock = this._unlock.bind(this);
    this._onVis = this._onVis.bind(this);
  }

  /** Attach gesture unlock + visibility handling. Idempotent. */
  install() {
    if (this.installed || !this.win) return;
    this.installed = true;
    try {
      for (const ev of UNLOCK_EVENTS) this.win.addEventListener(ev, this._unlock, { capture: true, passive: true });
      this.win.document?.addEventListener?.('visibilitychange', this._onVis);
      // iOS / iPadOS: a phone call, Siri or another app puts the context into 'interrupted'; coming back to the page
      // (pageshow / focus) resumes it (plus the next gesture, below)
      this.win.addEventListener?.('pageshow', this._onVis);
      this.win.addEventListener?.('focus', this._onVis);
    } catch { /* ignore */ }
  }

  get unlocked() { return !!this.ctx; }

  /**
   * First user gesture: create the context. The gesture listeners stay until the context actually runs — iOS Safari
   * only counts touchend / click (not pointerdown / touchstart) as activation, so a context created on pointerdown can
   * stay 'suspended' until the finger lifts. A 1-sample silent buffer is played inside the gesture (older WebKit only
   * unlocks output after something was started in a gesture).
   */
  _unlock() {
    if (this.ctx) {
      const st = this.ctx.state;
      if (st === 'running') { this._dropUnlock(); return; }
      if (!this.win?.document?.hidden) {
        this._primeOutput();
        const p = this.ctx.resume?.();
        if (p && typeof p.then === 'function') p.then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
      return;
    }
    try {
      const AC = this.win?.AudioContext || this.win?.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.voiceGain = this.ctx.createGain();
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.voiceGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      // iOS / iPadOS: a call, Siri or another app's audio moves a running context to 'interrupted' (or 'suspended');
      // a resume without a gesture may then be refused — listen for the next gesture again (dropped once it runs)
      try {
        this.ctx.addEventListener?.('statechange', () => {
          const s = this.ctx?.state;
          if (s && s !== 'running' && s !== 'closed' && !this.win?.document?.hidden) this._armUnlock();
        });
      } catch { /* ignore */ }
      this._applyVolumes();
      this._primeOutput();
      if (this.ctx.state === 'running') this._dropUnlock();
      else {
        const p = this.ctx.resume?.();
        if (p && typeof p.then === 'function') p.then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
      if (this.wantBgm) { const k = this.wantBgm; this.wantBgm = null; this.playBgm(k); }
    } catch (err) {
      this._warn('ctx', err);
      this.ctx = null;
    }
  }

  /** (Re-)attach the gesture listeners after the context stopped running while visible (see _unlock / _onVis). */
  _armUnlock() {
    if (!this._unlockDropped || !this.win) return;
    this._unlockDropped = false;
    try { for (const ev of UNLOCK_EVENTS) this.win.addEventListener(ev, this._unlock, { capture: true, passive: true }); } catch { /* ignore */ }
  }

  /** Remove the first-gesture listeners (the context runs). */
  _dropUnlock() {
    if (this._unlockDropped || !this.win) return;
    this._unlockDropped = true;
    try { for (const ev of UNLOCK_EVENTS) this.win.removeEventListener(ev, this._unlock, { capture: true }); } catch { /* ignore */ }
  }

  /** Start a silent 1-sample buffer (inside a user gesture: unlocks output on older WebKit). */
  _primeOutput() {
    try {
      const c = this.ctx;
      if (!c || typeof c.createBuffer !== 'function') return;
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate || 44100);
      src.connect(c.destination);
      src.start ? src.start(0) : src.noteOn?.(0);
    } catch { /* ignore */ }
  }

  _onVis() {
    try {
      if (!this.ctx) return;
      if (this.win?.document?.hidden) this.ctx.suspend().catch(() => {});
      else if (this.ctx.state !== 'running') {
        // back on the page: resume, and keep a gesture ready in case the browser wants one first (iOS after a call)
        this._armUnlock();
        this.ctx.resume().then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
    } catch { /* ignore */ }
  }

  _warn(key, err) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try { console.warn(`[audio] ${key} unavailable`, err?.message || err || ''); } catch { /* ignore */ }
  }

  /**
   * Set channel volumes (0..1) and mute.
   * @param {{ bgm?: number, sfx?: number, voice?: number, muted?: boolean }} v
   */
  setVolumes(v) {
    const n = (x, d) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    this.volumes = {
      bgm: n(v?.bgm, this.volumes.bgm),
      sfx: n(v?.sfx, this.volumes.sfx),
      voice: n(v?.voice, this.volumes.voice),
      muted: typeof v?.muted === 'boolean' ? v.muted : this.volumes.muted,
    };
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : 1, t, 0.03);
      // perceptual curve
      this.bgmGain.gain.setTargetAtTime(this.volumes.bgm ** 2 * 0.55, t, 0.05);
      this.sfxGain.gain.setTargetAtTime(this.volumes.sfx ** 2 * 0.9, t, 0.03);
      // no 0.9: a voice line is already mastered as loud as the rest of the official mix (settings 干员语音 tunes it)
      this.voiceGain.gain.setTargetAtTime(this.volumes.voice ** 2, t, 0.03);
    } catch { /* ignore */ }
  }

  /** Fetch + decode (cached, LRU). Resolves null on failure. */
  _buffer(url) {
    if (!this.ctx || typeof url !== 'string' || !url) return Promise.resolve(null);
    const hit = this.buffers.get(url);
    if (hit) {
      this.buffers.delete(url);
      this.buffers.set(url, hit);
      return hit;
    }
    const p = (async () => {
      try {
        // Extension-less URL first so download managers leave the BGM alone; a host without /media/ still works.
        const media = mediaUrl(url);
        let res = await fetch(media);
        if (media !== url && !isAudioResponse(res)) {
          // Drop the unusable response (404, or a 200 that is really index.html) before trying the original URL.
          try { await res.body?.cancel?.(); } catch { /* the fallback request matters more than draining this one */ }
          res = await fetch(url);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        return await new Promise((resolve) => {
          try {
            const r = this.ctx.decodeAudioData(ab, resolve, () => resolve(null));
            if (r && typeof r.then === 'function') r.then(resolve, () => resolve(null));
          } catch { resolve(null); }
        });
      } catch (err) {
        this._warn(url, err);
        return null;
      }
    })();
    this.buffers.set(url, p);
    p.then((buf) => {
      if (!buf) return;
      try {
        this.bufBytes.set(url, (buf.length || 0) * (buf.numberOfChannels || 1) * 4);
        this._trimBuffers();
      } catch { /* ignore */ }
    }, () => {});
    this._trimBuffers();
    return p;
  }

  /**
   * Evict least-recently-used buffers until both the entry count and the decoded-PCM budget hold. The count alone is
   * not enough once voice lines are in the cache: 180 of them are ~100 MB of PCM (a voice decodes to 0.4–1.3 MB).
   */
  _trimBuffers() {
    let bytes = 0;
    for (const n of this.bufBytes.values()) bytes += n;
    if (this.buffers.size <= BUFFER_CACHE && bytes <= BUFFER_BYTES) return;
    for (const url of [...this.buffers.keys()]) {
      if (this.buffers.size <= BUFFER_CACHE && bytes <= BUFFER_BYTES) break;
      // never evict the playing BGM (a voice keeps its own reference to its buffer)
      if (this.bgm && url === this.bgm.loopUrl) continue;
      bytes -= this.bufBytes.get(url) || 0;
      this.buffers.delete(url);
      this.bufBytes.delete(url);
    }
  }

  /** Preload a list of URLs (e.g. UI SFX) once unlocked. */
  preload(urls) {
    if (!this.ctx) return;
    for (const u of Array.isArray(urls) ? urls : []) this._buffer(u);
  }

  // ---- BGM ------------------------------------------------------------------------------------------------

  /**
   * Switch BGM (null stops). Same loop URL ⇒ no restart.
   * @param {string|null} key see bgmKeyFor
   */
  playBgm(key) {
    try {
      if (!this.ctx) { this.wantBgm = key; return; }
      const track = resolveBgm(this.getManifest(), key);
      if (this.bgm && track && this.bgm.loopUrl === track.loop) { this.bgm.key = key; return; }
      if (!track && !this.bgm) return;
      const token = ++this.bgmToken;
      this._fadeOutBgm();
      if (!track) return;
      this._startBgm(key, track, token);
    } catch (err) { this._warn('bgm', err); }
  }

  async _startBgm(key, track, token) {
    const [intro, loop] = await Promise.all([track.intro ? this._buffer(track.intro) : null, this._buffer(track.loop)]);
    if (token !== this.bgmToken || !this.ctx || !loop) return;
    try {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.connect(this.bgmGain);
      const t0 = ctx.currentTime + 0.05;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + FADE_S);
      const nodes = [];
      let loopAt = t0;
      if (intro) {
        const s = ctx.createBufferSource();
        s.buffer = intro;
        const g = ctx.createGain();
        s.connect(g); g.connect(gain);
        s.start(t0);
        const end = t0 + intro.duration;
        const xf = Math.min(XFADE_S, intro.duration / 2);
        g.gain.setValueAtTime(1, Math.max(t0, end - xf));
        g.gain.linearRampToValueAtTime(0, end);
        nodes.push({ src: s, gain: g });
        loopAt = end - xf;
      }
      const s = ctx.createBufferSource();
      s.buffer = loop;
      s.loop = true;
      const g = ctx.createGain();
      s.connect(g); g.connect(gain);
      if (intro) {
        g.gain.setValueAtTime(0, loopAt);
        g.gain.linearRampToValueAtTime(1, loopAt + Math.min(XFADE_S, intro.duration / 2));
      }
      s.start(loopAt);
      nodes.push({ src: s, gain: g });
      this.bgm = { key, loopUrl: track.loop, nodes, gain };
    } catch (err) { this._warn('bgm-start', err); }
  }

  _fadeOutBgm() {
    const cur = this.bgm;
    this.bgm = null;
    if (!cur || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
      for (const n of cur.nodes) { try { n.src.stop(t + FADE_S + 0.05); } catch { /* ignore */ } }
      setTimeout(() => { try { cur.gain.disconnect(); } catch { /* ignore */ } }, (FADE_S + 0.3) * 1000);
    } catch { /* ignore */ }
  }

  // ---- SFX ------------------------------------------------------------------------------------------------

  _play(url, { volume = 1, rate = 1, limited = false, unitKey = null, now = null, pri = SFX_PRI.event } = {}) {
    if (!this.ctx || !url || this.volumes.muted || this.volumes.sfx <= 0) return;
    // `now` lets a caller (or a test) hand in the reading a whole batch shares: one socket message delivers several
    // events at once and they all see the same `performance.now()`, which is exactly the case the limiter's per-unit
    // gap has to answer correctly.
    const t = Number.isFinite(now) ? now : typeof performance !== 'undefined' ? performance.now() : Date.now();
    let token = 0;
    if (limited) {
      if (!this.limiter.tryAcquire(t, unitKey, url, pri)) return;
      token = this.limiter.lastToken;
    } else if (this.uiVoices >= 12) return;
    else this.uiVoices += 1;
    const release = () => {
      if (limited) this.limiter.release(url, token);
      else this.uiVoices = Math.max(0, this.uiVoices - 1);
    };
    // a voice the limiter displaces (`popOldest`) is stopped HERE, through the node the ender below closes over: freeing
    // the slot without stopping the node would leave the displaced sound ringing on top of the one that took its place.
    if (limited) this.voiceEnd.set(token, release);
    const forget = () => { if (limited) this.voiceEnd.delete(token); };
    this._buffer(url).then((buf) => {
      // `alive`: the limiter may have displaced this voice while its buffer was loading (`popOldest`) — that slot now
      // belongs to the sound that took it, and starting late would put two sounds on one slot (and free the wrong one).
      if (!buf || !this.ctx || (limited && !this.limiter.alive(token))) { release(); forget(); return; }
      try {
        const s = this.ctx.createBufferSource();
        s.buffer = buf;
        s.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1.5, volume));
        s.connect(g); g.connect(this.sfxGain);
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          this.voiceEnd.delete(token);
          release();
          try { s.stop(); } catch { /* ignore */ }   // idempotent: an evicted voice stops early, a finished one is over
          try { g.disconnect(); } catch { /* ignore */ }
        };
        // an eviction that happened between the decode and here: the ender already ran and stopped nothing
        if (limited && !this.limiter.alive(token)) { end(); return; }
        if (limited) this.voiceEnd.set(token, end);
        s.onended = end;
        setTimeout(end, (buf.duration / rate) * 1000 + 250); // safety if onended never fires
        s.start();
      } catch { release(); forget(); }
    }, () => { release(); forget(); });
  }

  /**
   * 持续段循环音: start a sound that rings until `stopLoop` (a skill's sustained section, `skillSfx[i].loop`). One loop
   * per `key` — a second start on the same key replaces the first, so a skill re-cast before its end event cannot stack.
   *
   * The sound is NOT an official `loop: true` bank replayed by the game: the official client starts the bank when its
   * buff starts and stops it when the skill finishes (`soundFXCtrlBanks` `ctrlStop` / `ctrlStopFadetime`), which is
   * exactly start/stop. Web Audio plays it the same way (`createBufferSource` with `loop = true`), through the SFX
   * channel, so 音效 volume and 静音 apply like every other sound. It is deliberately not routed through SfxLimiter:
   * the limiter counts overlapping one-shots, and a loop has no "end" to release it — `SKILL_LOOP_MAX_S` bounds it
   * instead, and `stopAllLoops` (a new field, a death) ends it early.
   * @param {string} key identity of the loop (`skill:<unitId>` for a skill's own loop)
   * @param {string} url sound URL (the manifest's own)
   * @param {{ volume?: number, maxS?: number, on?: boolean }} [o] `on` = false starts nothing but still clears the key
   * @returns {boolean} whether a loop is (now) playing under that key
   */
  startLoop(key, url, o = {}) {
    if (typeof key !== 'string' || !key) return false;
    try {
      this.stopLoop(key, { fadeS: 0 });   // replacing / clearing: never two loops under one key
      if (o.on === false || !this.ctx || typeof url !== 'string' || !url) return false;
      if (this.volumes.muted || this.volumes.sfx <= 0) return false;
      const token = ++this.loopToken;
      const rec = { src: null, gain: null, token, timer: null };
      this.loops.set(key, rec);
      const maxS = Number.isFinite(o.maxS) ? o.maxS : SKILL_LOOP_MAX_S;
      rec.timer = setTimeout(() => this.stopLoop(key), maxS * 1000);   // safety: an end event we never see
      this._buffer(url).then((buf) => {
        const cur = this.loops.get(key);
        if (!cur || cur.token !== token) return;   // stopped (or replaced) while it decoded
        if (!buf || !this.ctx) { this.stopLoop(key); return; }
        try {
          const s = this.ctx.createBufferSource();
          s.buffer = buf;
          s.loop = true;
          const g = this.ctx.createGain();
          g.gain.value = Math.max(0, Math.min(1.5, Number.isFinite(o.volume) ? o.volume : 0.7));
          s.connect(g); g.connect(this.sfxGain);
          s.start();
          cur.src = s; cur.gain = g;
        } catch { this.stopLoop(key); }
      }, () => this.stopLoop(key));
      return true;
    } catch (err) { this._warn('loop', err); return false; }
  }

  /**
   * Stop a loop started by `startLoop` (fades out over the official `ctrlStopFadetime`, 0.2 s by default) and forget its
   * key. A key with no loop is a no-op, so a caller may stop unconditionally.
   * @param {string} key
   * @param {{ fadeS?: number }} [o]
   */
  stopLoop(key, o = {}) {
    const rec = this.loops.get(key);
    if (!rec) return;
    this.loops.delete(key);
    rec.token = -1;                       // a start still decoding must not attach itself to this key
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    const fadeS = Number.isFinite(o.fadeS) ? o.fadeS : SKILL_LOOP_FADE_S;
    const { src, gain } = rec;
    if (!src || !this.ctx) return;
    const kill = () => { try { src.stop(); } catch { /* ignore */ } try { gain.disconnect(); } catch { /* ignore */ } };
    try {
      const t = this.ctx.currentTime;
      if (fadeS > 0) {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fadeS);
        setTimeout(kill, (fadeS + 0.05) * 1000);
      } else kill();   // `src.stop()` on a source that never started is legal (it is simply ended)
    } catch { kill(); }
  }

  /** Every loop of the current field (a new field, or a battle whose events stopped arriving). */
  stopAllLoops() {
    for (const key of [...this.loops.keys()]) this.stopLoop(key, { fadeS: 0 });
  }

  /**
   * UI sound by name (sfx.ui keys). Unknown names are ignored.
   * @param {string} name
   * @param {{ volume?: number }} [o]
   */
  sfx(name, o = {}) {    try {
      const url = this.getManifest()?.audio?.sfx?.ui?.[name];
      if (typeof url === 'string') this._play(url, { volume: o.volume ?? 0.9 });
    } catch { /* ignore */ }
  }

  /**
   * Battle sound by name (sfx.battle keys), limited like unit sounds. A generic battle cue is DECORATION (SFX_PRI) —
   * `o.pri` raises the few that are alerts of their own (漏怪's exit alarm: an event, not a garnish).
   * @param {string} name
   * @param {{ volume?: number, unitKey?: string|number, pri?: number }} [o]
   */
  battle(name, o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.battle?.[name];
      if (typeof url === 'string') {
        this._play(url, { volume: o.volume ?? 0.7, limited: true, unitKey: o.unitKey ?? `b:${name}`, pri: o.pri ?? SFX_PRI.deco });
      }
    } catch { /* ignore */ }
  }

  /**
   * Per-unit sound (attack/hit/skill/die/born), throttled.
   * @param {string} defId charId/tokenId/enemyId (or chess id — mapped via its spine/char id by the caller)
   * @param {'attack'|'hit'|'skill'|'die'|'born'} kind
   * @param {number|string} unitId battle unit id (cooldown key)
   * @param {number} [skillIndex] the skill the sound belongs to: its own `skillSfx[index].<kind>` (the 按技能细分 roles —
   *   her S1 / S2 / S3 impacts are three different files), else the unit's own role; for `kind === 'skill'` the equipped
   *   skill's ACTIVATION cue (`skills[index]`, DESIGN §16). A role the skill does not carry falls back to the unit's,
   *   so a unit with no `skillSfx` at all sounds exactly as before
   * @param {number} [now] the batch's own clock reading (all events of one socket message share it; see _play)
   * @returns {boolean} whether a unit-specific sound exists
   */
  unit(defId, kind, unitId, skillIndex, now = null) {
    try {
      const u = this.getManifest()?.audio?.sfx?.units?.[defId];
      // 按技能细分 (docs/ASSETS.md): only for the ROLES the unit's own entry carries once. `skill` is NOT one of them: a
      // cast cue is `skills[index]` (DESIGN §16) and the skill's `born` role is the note's LAUNCH, which the renderer
      // asks for by projectile kind (`playProj` → `sfx.proj`) — reading `skillSfx[i].born` here would replace her
      // 大招音 with the note's launch sound, which is exactly what this branch must not do.
      const own = kind === 'skill'
        ? (Number.isInteger(skillIndex) && u?.skills ? u.skills[skillIndex] : null)
        : skillSfxUrl(this.getManifest(), defId, skillIndex, kind);
      const url = typeof own === 'string' ? own : u?.[kind];
      if (typeof url !== 'string') return false;
      if ((kind === 'attack' || kind === 'hit') && !normalAttackSfx(defId, url)) return false;
      // the official bank's mix (header): a silent roll still counts as the unit's own sound (no generic fallback).
      // A per-skill cue has no `mix` of its own (the plan writes mix per unit role only): it plays at the base gain.
      const mix = typeof own === 'string' || kind === 'skill' ? null : u?.mix?.[kind];
      if (!unitSoundPlays(mix, this.random())) return true;
      // an EVENT sound (技能发动 / 部署 / 阵亡 / 出生): the tiers keep it from being starved by the note storm (SFX_PRI)
      const pri = kind === 'attack' || kind === 'hit' ? SFX_PRI.unit : SFX_PRI.event;
      this._play(url, { volume: unitGain(kind === 'attack' || kind === 'hit' ? 0.55 : 0.8, mix), limited: true, unitKey: `${unitId}:${kind}`, now, pri });
      return true;
    } catch { return false; }
  }

  /**
   * Sound of a content-owned projectile (`audio.sfx.proj`; docs/ASSETS.md "投射物音效"), limited like unit sounds. The
   * caller is the renderer's own projectile list (`render/fx/notes.js syncNotes`), which sees a note the moment its id
   * appears in the snapshot — a note is born with no `atk` event of its own, so this is where 「发出音符」 is heard.
   * @param {string} kind `snap.proj` kind ('note' | 'noteSkill')
   * @param {{ unitId?: string|number|null, unit?: string|null, role?: 'born'|'hit', volume?: number, now?: number }} [o]
   *   `unitId` = the battle unit that fired it (the limiter's own key, so two units never swallow each other's copy);
   *   `unit` = that unit's model id (charId), which picks a per-unit override when the manifest has one
   * @returns {boolean} whether the manifest carries such a sound
   */
  playProj(kind, o = {}) {
    try {
      const url = projSfxUrl(this.getManifest(), kind, o.role ?? 'born', o.unit ?? null);
      if (typeof url !== 'string') return false;
      const key = o.unitId ?? o.unit ?? kind;
      // a note's launch is high-frequency DECORATION: it must never take the slot an event sound needs (SFX_PRI)
      this._play(url, { volume: o.volume ?? 0.7, limited: true, unitKey: `proj:${kind}:${key}`, now: o.now ?? null, pri: SFX_PRI.deco });
      return true;
    } catch { return false; }
  }

  // ---- operator battle voice ----------------------------------------------------------------------------------

  /**
   * Play an operator's battle line (`audio.voice[charId][slot]`; a slot with several lines draws one at random).
   * Only in battle: every caller is a running battle's own event stream or its settlement (user request — the 休整期
   * is silent). The line must pass VoiceGate: one at a time, a global gap, a per-unit cooldown, higher priority wins.
   * @param {string} charId e.g. 'char_263_skadi'
   * @param {'start'|'faceEnemy'|'select'|'place'|'skill1'|'skill2'|'skill3'|'skill4'|'squad'|'squadFirst'
   *   |'resultFour'|'resultThree'|'resultTwo'|'resultLose'|'gacha'} slot
   * @param {{ unitKey?: string|number|null, volume?: number }} [o] `unitKey` = the cooldown key (a battle unit id)
   * @returns {boolean} whether such a line exists and started
   */
  voice(charId, slot, o = {}) {
    try {
      if (!this.ctx || !this.voiceGain || this.volumes.muted || this.volumes.voice <= 0) return false;
      if (typeof charId !== 'string' || typeof slot !== 'string') return false;
      const line = this.getManifest()?.audio?.voice?.[charId]?.[slot];
      const url = Array.isArray(line) ? line[Math.floor(Math.random() * line.length)] : line;
      if (typeof url !== 'string' || !url) return false;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const verdict = this.voiceGate.request(slot, o.unitKey ?? null, now);
      if (verdict === 'drop') return false;
      if (verdict === 'preempt') this._stopVoice();
      this.voiceGate.start(slot, o.unitKey ?? null, now);
      const token = ++this.voiceToken;
      this._playVoice(url, token, o.volume);
      return true;
    } catch (err) { this._warn('voice', err); return false; }
  }

  /** Fetch/decode and start one voice line through the voice channel. */
  _playVoice(url, token, volume) {
    // `token` is the line's own `voiceToken`. Every deferred step below — the decode, a failed fetch, `onended` and the
    // safety timer — can land AFTER this line was taken over or stopped: `voiceToken` has moved on and the channel then
    // belongs to the line that replaced it. So each step re-checks its token and, when it is stale, touches NOTHING:
    // `_stopVoice` (takeover / stop) and `setFieldUnits` released the gate themselves. An unconditional release here let
    // a stale callback free the channel the NEW line had just taken, and the next line walked in on top of it (review
    // on #73).
    this._buffer(url).then((buf) => {
      if (token !== this.voiceToken) return;   // taken over / stopped while it decoded: not ours to release
      if (!buf || !this.ctx || !this.voiceGain) { this.voiceGate.release(); return; }
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const gain = this.ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1.5, Number.isFinite(volume) ? volume : 1));
        src.connect(gain); gain.connect(this.voiceGain);
        const node = { src, gain, url, token };
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          // this line's own end (natural, or the safety timer): only the line that still owns the channel may free it.
          // A stale end is the takeover's leftovers — `_stopVoice` already faded it out and released the gate.
          if (token === this.voiceToken) {
            if (this.voiceNode === node) this.voiceNode = null;
            this.voiceGate.release();
          }
          try { gain.disconnect(); } catch { /* ignore */ }
        };
        src.onended = end;
        setTimeout(end, (buf.duration + 0.3) * 1000); // safety if onended never fires
        src.start();
        this.voiceNode = node;
      } catch (err) {
        this._warn('voice-play', err);
        if (token === this.voiceToken) this.voiceGate.release();
      }
    }, () => { if (token === this.voiceToken) this.voiceGate.release(); });
  }

  /** Fade the line on air out (a higher priority line is taking the channel over). */
  _stopVoice() {
    const cur = this.voiceNode;
    this.voiceNode = null;
    this.voiceToken += 1;              // a line still decoding must not start afterwards
    this.voiceGate.release();
    if (!cur || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + VOICE_XFADE_S);
      cur.src.stop(t + VOICE_XFADE_S + 0.02);
    } catch { /* ignore */ }
  }

  // ---- battle events ------------------------------------------------------------------------------------------

  /** Reset the unit map for a new field (m.field.units = UnitInfo[]). */
  setFieldUnits(units) {
    this.units.clear();
    this.lastAttacker.clear();
    this.consumed.clear();
    this.activeSkill.clear();
    this.recentSkill.clear();
    // a new field is a new battle: a sustained loop of the previous one must not ring on (and neither must a skill's)
    try { this.stopAllLoops(); } catch { /* ignore */ }
    // a new field is a new battle: the first operator deployed says 行动出发 again and no cooldown carries over
    this.startVoiceDone = false;
    try { this.voiceGate.reset(); this._stopVoice(); } catch { /* ignore */ }
    for (const u of Array.isArray(units) ? units : []) this._track(u);
    // …and a cast held for a unit that never appears must not outlive the field. This runs after the loop: the one cue
    // this mechanism exists for is the one already waiting when the field's own unit list arrives (a battle entered
    // late replays its buffered events to this manager, screens/game.js), so the list gets its chance to claim it
    // first — `_track` plays and removes it.
    this.pendingSkill.clear();
  }

  _track(u) {
    if (!u || typeof u !== 'object' || u.id == null) return;
    // UnitInfo.spine is the model id (charId / tokenId / enemyId) — the key of sfx.units; kind/defId pick the
    // official class sounds (operator vs summon vs device)
    this.units.set(u.id, { def: u.spine || u.defId, defId: u.defId ?? null, kind: u.kind ?? null, side: u.side, boss: !!u.boss,
      skillIndex: Number.isInteger(u.skillIndex) ? u.skillIndex : null });
    // NB: `skillIndex` is the EQUIPPED skill, not a running one, so nothing is started here — the 持续段循环音 of a
    // sustained skill begins on its own `['skill', id, 1]` (below), which is also the event that arrives for a unit
    // already tracked. Seeding a loop from the equipped index would ring the sustained sound of a skill nobody cast.
    // a cast that arrived before this unit was known (handleBattleEvents): play it now, once. No unit is ever tracked
    // twice into a stale entry — `setFieldUnits` clears both maps — so this cannot double a cue.
    const held = this.pendingSkill.get(u.id);
    if (held) {
      this.pendingSkill.delete(u.id);
      this.handleBattleEvents([held]);
    }
  }

  /**
   * Start / stop the 持续段循环音 of one unit's sustained skill (`sfx.units[def].skillSfx[index].loop`), keyed by the
   * unit so two of that operator never share one loop. Called on the skill's own `['skill', id, 1]` / `['skill', id, 0]`
   * (the end event is also its official stop: 丰川祥子's S3 has no finish FILE, `soundFXCtrlBanks` stops its loop
   * instead) and on a unit that dies or leaves mid-skill.
   * @param {number|string} unitId battle unit id
   * @param {string} def unit model id (sfx.units key)
   * @param {number|null} skillIndex
   * @param {boolean} on
   */
  _skillLoop(unitId, def, skillIndex, on) {
    const url = skillSfxUrl(this.getManifest(), def, skillIndex, 'loop');
    this.startLoop(`skill:${unitId}`, url, { on: on && typeof url === 'string', volume: 0.7 });
  }

  /**
   * Play a resolved battle sound for a unit event, limited like unit sounds. A death / deployment cue is an EVENT
   * (SFX_PRI): the generic b_char_dead / b_char_set fallbacks it plays for everyone must not be starved by decorations.
   */
  _playUnitUrl(url, unitKey, volume = 0.8) {
    if (typeof url === 'string') {
      this._play(url, { volume, limited: true, unitKey, pri: /:(die|born)$/.test(String(unitKey)) ? SFX_PRI.event : SFX_PRI.deco });
    }
  }

  /**
   * React to `b.ev` tuples (DESIGN §8.2).
   * @param {any[]} ev
   */
  handleBattleEvents(ev) {
    if (!this.ctx || !Array.isArray(ev)) return;
    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      for (const e of ev) {
        if (!Array.isArray(e)) continue;
        const kind = e[0];
        if (kind === 'spawn') { this._track(e[1]); continue; }
        if (kind === 'atk') {
          // a chain bounce: its first id is the previous target, whose attack sound this is not (see header)
          if (CHAIN_KINDS.has(e[3])) { this.lastAttacker.delete(e[2]); continue; }
          const src = this.units.get(e[1]);
          if (!src) continue;
          // only a hostile attack authors the target's next impact (a heal — an ally aiming at an ally — never does).
          // The skill it was made under travels with it: the impact that follows plays THAT skill's own `hit`
          // (`skillSfx[i].hit`, e.g. her S1 / S2 / S3 note impacts are three different files), falling back to the
          // unit's ordinary `hit` when the manifest carries none — see the `dmg` branch.
          const tgt = this.units.get(e[2]);
          if (tgt && tgt.side !== src.side) {
            // The skill the attack was made under travels with it: the impact that follows plays THAT skill's own `hit`
            // (her S1 / S2 / S3 note impacts are three different files), falling back to the unit's ordinary `hit` when
            // the manifest carries none — see the `dmg` branch. An INSTANT skill (her S1) has already ended when the
            // note it fired lands (`skills.js` emits `['skill', id, 1]` and, in the same tick, `['skill', id, 0]` —
            // measured in a browser), so a cast that ended within the impact window still counts for it. A running cast
            // needs no such window: it covers exactly the attacks made while it runs. (The unit's own `skillIndex` is
            // the skill it is EQUIPPED with, and is deliberately NOT used here: equipped is not evidence that damage
            // dealt on a plain attack is that skill's.)
            const running = this.activeSkill.get(e[1]);
            const ended = this.recentSkill.get(e[1]);
            const skill = running ?? (ended && now - ended.endedAt <= IMPACT_WINDOW_MS ? ended.index : null);
            this.lastAttacker.set(e[2], { def: src.def, at: now, skill: skill ?? null });
          }
          if (!this.unit(src.def, 'attack', e[1]) && src.side === 'enemy') this.battle('enemyHit', { unitKey: `${e[1]}:atk`, volume: 0.35 });
        } else if (kind === 'dmg') {
          const by = this.lastAttacker.get(e[1]);
          if (!by || !IMPACT_TYPES.has(e[3])) continue;
          this.lastAttacker.delete(e[1]); // one impact per attack
          if (now - by.at <= IMPACT_WINDOW_MS) this.unit(by.def, 'hit', `h${e[1]}`, by.skill ?? undefined, now);
        } else if (kind === 'heal') {
          this.battle('heal', { unitKey: `heal:${e[1]}`, volume: 0.35 });
        } else if (kind === 'skill' && e[2]) {
          const u = this.units.get(e[1]);
          if (u) {
            // a cast: this unit's skill becomes the scope every impact of this cast resolves against (`skillSfx[i].hit`)
            // AND, when the skill carries one, the sustained loop starts.
            //
            // The scope hangs on the unit having a `skillSfx` entry, NOT on the skill having a `loop`: S2 is a sustained
            // skill with a `hit` and a `finish` but no loop bank of its own (`ON_BUFF_START…[loop]` is S3's), so gating
            // the scope on `loop` left every S2 impact on the unit's ordinary `hit` — measured in a browser before this
            // was fixed (22 skill-note impacts, all `p_imp_mjckyrdnt`).
            const m = this.getManifest();
            const perSkill = u.skillIndex != null && m?.audio?.sfx?.units?.[u.def]?.skillSfx?.[String(u.skillIndex)];
            if (perSkill) this.activeSkill.set(e[1], u.skillIndex);
            this._skillLoop(e[1], u.def, u.skillIndex, true);
            this.unit(u.def, 'skill', e[1], u.skillIndex ?? undefined);
            // 作战中N: the equipped skill's own slot (0-based; 作战中4 is the fallback of a 4th slot)
            if (unitSoundClass(u) === 'char') {
              const n = Number.isInteger(u.skillIndex) ? Math.min(4, u.skillIndex + 1) : 1;
              this.voice(u.def, `skill${n}`, { unitKey: e[1] });
            }
          } else {
            // The unit is not tracked yet, and its cue is the ONE skill sound a battle can lose this way: a deployment
            // that casts inside its own first tick (`initSp` already at `spCost`) emits its `['skill', id, 1]` before
            // anything told this client about the unit — `['spawn', unitInfo]` and the field's own unit list arrive in
            // the same or a later message, and an operator deployed into a running battle is the same shape. Dropping
            // it made that first cast silent while every later one played. Held here and answered once in `_track`,
            // which is also how the same order inside a replayed pre-entry buffer is covered (screens/game.js hands the
            // whole buffered list over instead of its 'spawn' tuples alone).
            this.pendingSkill.set(e[1], e);
          }
        } else if (kind === 'skill') {
          // 技能结束 (`['skill', id, 0]`): the cast is over — its own end cue (`skillSfx[i].finish`), and the sustained
          // loop it started stops with the official fade (`soundFXCtrlBanks ctrlStop`: S3's end cue IS that stop, it has
          // no finish file). A unit whose entry carries neither is silent here, exactly as before this section existed.
          const u = this.units.get(e[1]);
          if (u) {
            const i = this.activeSkill.get(e[1]) ?? (Number.isInteger(u.skillIndex) ? u.skillIndex : null);
            this.activeSkill.delete(e[1]);
            // an instant skill ends in the tick that started it while the notes it fired are still flying: remember the
            // cast for the impact window, so their landing can still be attributed to it (`dmg` above)
            if (i != null) this.recentSkill.set(e[1], { index: i, endedAt: now });
            this._skillLoop(e[1], u.def, i, false);
            this.unit(u.def, 'finish', e[1], i ?? undefined, now);
          }
        } else if (kind === 'engage') {
          // 行动开始: the first attack a unit makes on an enemy (the sim's ENGAGE, official ENCOUNTER_ENEMY, 3 s apart)
          const u = this.units.get(e[1]);
          if (u && unitSoundClass(u) === 'char') this.voice(u.def, 'faceEnemy', { unitKey: e[1] });
        } else if (kind === 'die') {
          const u = this.units.get(e[1]);
          if (!u) continue;
          const consumed = this.consumed.delete(e[1]);
          const m = this.getManifest();
          const url = deathSfxUrl(m, u, { consumed, reason: typeof e[2] === 'string' ? e[2] : null });
          if (!url) continue;
          const own = url === m?.audio?.sfx?.units?.[u.def]?.die;
          const mix = own ? m.audio.sfx.units[u.def].mix?.die : null;
          if (!unitSoundPlays(mix, this.random())) continue;
          this._playUnitUrl(url, own ? `${e[1]}:die` : `die:${e[1]}`, own ? unitGain(0.8, mix) : 0.7);
        } else if (kind === 'leak') {
          // 漏怪: an enemy reached its goal (Battle.leak emits the sim's own EV.LEAK — it is NOT a `die`, so until now a
          // leak was completely silent, for the player's own field and for a 联防 the helpers could not hold alike).
          // The cue is the ORIGINAL Arknights stage alarm — the one an enemy entering the exit plays in any normal
          // stage (manifest `sfx.battle.leak`, bank battle.ON_ENEMY_REACHED_EXIT, file b_ui_alarmenter).
          // `LEAK_SFX_GAP_MS` keeps it to one alarm at a time (the official bank's own maxSoundAllowed 1).
          if (now - (this.lastLeakSfxAt ?? -Infinity) < LEAK_SFX_GAP_MS) continue;
          if (typeof this.getManifest()?.audio?.sfx?.battle?.leak !== 'string') continue;
          this.lastLeakSfxAt = now;
          // an alarm of its own (the official bank is maxSoundAllowed 1 / popOldest): an EVENT, never starved
          this.battle('leak', { unitKey: 'leak', volume: 0.85, pri: SFX_PRI.event });
        } else if (kind === 'deploy') {
          const u = this.units.get(e[1]);
          if (!u || u.side === 'enemy') continue;
          const m = this.getManifest();
          const url = deploySfxUrl(m, u);
          // 行动出发 / 部署: the first operator of the battle says the battle-start line, the others their deploy line
          // (a knocked-out operator redeploying in the same battle is one of the others; a summon says nothing).
          // Kept ahead of the deploy-SFX guards below: the voice channel is independent of the unit sound's roll.
          if (unitSoundClass(u) === 'char') {
            if (!this.startVoiceDone) {
              this.startVoiceDone = true;
              if (!this.voice(u.def, 'start')) this.voice(u.def, 'place', { unitKey: e[1] });
            } else this.voice(u.def, 'place', { unitKey: e[1] });
          }
          if (!url) continue;
          const own = url === m?.audio?.sfx?.units?.[u.def]?.born;
          const mix = own ? m.audio.sfx.units[u.def].mix?.born : null;
          if (!unitSoundPlays(mix, this.random())) continue;
          this._playUnitUrl(url, own ? `${e[1]}:born` : 'deploy', own ? unitGain(0.8, mix) : 0.5);
        } else if (kind === 'fx') {
          // a summon used up by its own effect (香槟炸弹 exploding: `consumed`): its impact sound now, no death sound
          const ex = e[4];
          if (!ex || typeof ex !== 'object' || !ex.consumed || ex.id == null) continue;
          const u = this.units.get(ex.id);
          if (!u || u.side === 'enemy') continue;
          this.consumed.add(ex.id);
          if (this.consumed.size > 200) this.consumed.delete(this.consumed.values().next().value);
          this.unit(u.def, 'hit', `${ex.id}:boom`);
        } else if (kind === 'bounty') {
          this.battle('killCoin', { unitKey: 'coin' });
        }
      }
    } catch (err) { this._warn('events', err); }
  }
}

let manifestGetter = () => null;
/** App-wide audio manager. */
export const audio = new AudioManager({ getManifest: () => manifestGetter() });

/**
 * Wire the singleton to the app (called once by main.js): manifest source, settings and store-driven BGM.
 * @param {{ getManifest: () => any, subscribe: (fn: (s:any, prev:any) => void) => () => void, getState: () => any,
 *   selectRoute: (s:any) => string, settings?: { bgm:number, sfx:number, voice:number, muted:boolean } }} deps
 */
export function installAudio(deps) {
  try {
    manifestGetter = typeof deps?.getManifest === 'function' ? deps.getManifest : manifestGetter;
    audio.install();
    if (deps?.settings) audio.setVolumes(deps.settings);
    if (typeof deps?.subscribe === 'function' && typeof deps?.getState === 'function') {
      const sync = (s) => {
        try {
          const pub = s.match?.public ?? null;
          // 开战 BGM: the round's own track out of bgm.combatAlts (骑士之日 / 无畏者 are fixed per round, not drawn),
          // so every client of a room hears the same one, a mid-fight re-render (or a teammate view) never switches,
          // and the next round moves on by the table. 联防 shares its round ⇒ same key ⇒ the loop keeps playing.
          audio.playBgm(bgmKeyFor(deps.selectRoute(s), pub, combatTrackFor(pub?.round)));
        } catch { /* ignore */ }
      };
      sync(deps.getState());
      return deps.subscribe((s, prev) => {
        if (s.match?.public?.phase !== prev?.match?.public?.phase || s.room !== prev?.room || s.session !== prev?.session
          || s.match?.public?.bossId !== prev?.match?.public?.bossId) sync(s);
      });
    }
  } catch (err) { console.warn('[audio] install failed', err); }
  return () => {};
}
