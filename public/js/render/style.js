// render/style.js — palette and visual tunables of the battlefield renderer (pure data).
// Colours follow research 07 §7 (tile palette, tuned by eye) and the UI design system (theme.css).

export const TILE_H = Object.freeze({
  wall: 0.42,      // 'h' high ground
  forbid: 0.3,     // '#' forbidden block (data: HIGH)
  sep: 0.55,       // 'X' hard separator wall (rows 6 / 13)
  bench: 0.16,     // 'a' / 'A' hand & temp slots (data: HIGH)
  platform: 0.26,  // active 射击台 / mound devices
});

/** Stage glyph → material + height class (data/stages.json legend, DATA.md §12). */
export const GLYPH = Object.freeze({
  '#': { mat: 'forbid', h: 'forbid' },
  X: { mat: 'sep', h: 'sep' },
  r: { mat: 'road', h: null },
  R: { mat: 'roadN', h: null },
  f: { mat: 'floor', h: null },
  p: { mat: 'preview', h: null },
  h: { mat: 'wall', h: 'wall' },
  b: { mat: 'fence', h: null },
  a: { mat: 'hand', h: 'bench' },
  A: { mat: 'temp', h: 'bench' },
  S: { mat: 'start', h: null },
  E: { mat: 'end', h: null },
  I: { mat: 'telin', h: null },
  O: { mat: 'telout', h: null },
  m: { mat: 'mire', h: null },
  g: { mat: 'smog', h: null },
  d: { mat: 'deepsea', h: null },
  i: { mat: 'infection', h: null },
});

/** tileKey (when a stage uses glyphs outside the legend) → glyph. */
export const TILEKEY_GLYPH = Object.freeze({
  tile_forbidden: '#', tile_road: 'r', tile_floor: 'f', tile_wall: 'h', tile_fence_bound: 'b', tile_fence: 'b',
  tile_achand: 'a', tile_start: 'S', tile_end: 'E', tile_telin: 'I', tile_telout: 'O', tile_mire: 'm',
  tile_smog: 'g', tile_deepsea: 'd', tile_infection: 'i', tile_grass: 'r', tile_hole: '#',
});

export const COLORS = Object.freeze({
  bgTop: '#0b0f0e',
  bgMid: '#131a18',
  bgBottom: '#07090a',
  fog: [0.62, 0.68, 0.72],
  mint: 0x4ed8af,
  mintHi: 0x59f4ca,
  gold: 0xffc600,
  gateRed: 0xff3b30,
  gateRedDeep: 0xd0453b,
  objBlue: 0x39a7ff,
  objBlueDeep: 0x2d7fd6,
  legal: 0x3ce08c,
  illegal: 0xff4040,
  range: 0xff9c33,
  rangeStand: 0x4ed8af,
  hpAlly: 0x5fe07a,
  hpAllyLow: 0xe8c547,
  hpEnemy: 0xff4b3e,
  hpBoss: 0xff2d55,
  hpGhost: 0xfff0c8,
  hpBack: 0x0c0f0e,
  sp: 0x6fd3ff,
  spReady: 0xffe066,
  spActive: 0xffb347,
  shield: 0xdfe8ff,
});

/** Chess tier accents (theme.css --tier-1…6) and rarity-ish frames for enemies. */
export const TIER_COLORS = Object.freeze([0x9aa5a0, 0x9aa5a0, 0x7fd37a, 0x52b6ff, 0xb98cff, 0xffc600, 0xff6b3d]);
export const ENEMY_FRAME = Object.freeze({ normal: 0xc84a3c, elite: 0xff7a33, boss: 0xff2d55 });

/**
 * 活性源石 (infection) — the ONE palette of that tile, shared by the two boards (GitHub #184: the 2D atlas cell and the
 * 3D shader used to be two different materials — a beveled brick with crystal clusters against a world-space crust).
 * The values are the 3D board's own working colours (`render/board3d/materials.js` writes them into its shaders, which
 * end in `#include <colorspace_fragment>`, i.e. they are LINEAR); `textures.js` converts them for its canvas with
 * `linearToHex`, so both renderers show the same colour.
 *   base — the crust's dark side, crust — its lit side, vein — the glowing veins, spec — the bright crystal grains.
 */
export const ORIGINIUM = Object.freeze({
  base: Object.freeze([0.16, 0.05, 0.05]),
  crust: Object.freeze([0.3, 0.1, 0.07]),
  vein: Object.freeze([1.0, 0.46, 0.18]),
  spec: Object.freeze([1.0, 0.78, 0.52]),
  glow: 0xff6a3d,        // the additive pulse the 2D board tints per tile
});

/**
 * One channel of a working (linear) colour as the 0–255 sRGB value a canvas stores — the shaders' `#include
 * <colorspace_fragment>` does this for the 3D board, the canvas has to do it itself.
 */
export function linearToSrgb255(v) {
  const k = Number(v);
  const s = k <= 0.0031308 ? k * 12.92 : 1.055 * Math.pow(Math.max(0, k), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** A working (linear) `ORIGINIUM` colour as the `#rrggbb` sRGB string of the canvas (`textures.js originiumCanvas`). */
export function linearToHex(rgb) {
  return `#${rgb.map((v) => linearToSrgb255(v).toString(16).padStart(2, '0')).join('')}`;
}

export const DMG_STYLE = Object.freeze({
  phys: { font: 'sp-dmg-phys', fill: ['#fffbe8', '#ffb35c'], stroke: '#3b1400' },
  arts: { font: 'sp-dmg-arts', fill: ['#fbe8ff', '#c77dff'], stroke: '#2a0b45' },
  true: { font: 'sp-dmg-true', fill: ['#ffffff', '#e8e8e8'], stroke: '#2a2a2a' },
  heal: { font: 'sp-dmg-heal', fill: ['#eafff0', '#62f08a'], stroke: '#07361a' },
  elem: { font: 'sp-dmg-elem', fill: ['#fff4e0', '#ff7b3a'], stroke: '#3a1000' },
});

/** Map b.ev dmg types to a style key. */
export function dmgStyleKey(type) {
  if (type === 'phys' || type === 'arts' || type === 'true' || type === 'heal') return type;
  if (type === 'burn' || type === 'neural' || type === 'necrosis' || type === 'apoptosis' || type === 'erosion' || type === 'element') return 'elem';
  return 'phys';
}

/** Hit spark colour per damage type. */
export const HIT_TINT = Object.freeze({ phys: 0xffd9a0, arts: 0xc77dff, true: 0xffffff, heal: 0x62f08a, elem: 0xff7b3a });

/**
 * 丰川祥子's notes — the ONE place to tune their size (user feedback: they were too big). `head` / `width` are the drawn
 * glyph in tiles (× the camera's px per tile, so a note reads the same at every zoom and on both boards), `halo` the
 * diameter of the glow behind it, `haloA` that glow's alpha at high quality (halved at quality 'low').
 * The skill's note is ~25 % bigger than the talent's and its halo a little brighter (PROJ.note / PROJ.noteSkill).
 */
export const NOTE_SIZE = Object.freeze({
  talent: Object.freeze({ head: 0.42, width: 0.38, halo: 0.72, haloA: 0.75 }),
  skill: Object.freeze({ head: 0.52, width: 0.47, halo: 0.95, haloA: 0.88 }),
});
/**
 * The note's EFFECT colour, user-set: rgb(197, 62, 70) = 0xC53E46. The halo, the trail motes and the sparks of a note
 * leaving the field are exactly this colour — one edit here re-tints all three.
 */
export const NOTE_FX = 0xc53e46;
/**
 * The note GLYPH's own colour: a pale tint of NOTE_FX (a glyph in the effect colour itself would sink into its own halo
 * on the dark board). To draw the glyph in the exact effect colour too, set both entries to NOTE_FX.
 */
export const NOTE_INK = Object.freeze({ talent: 0xffe0e3, skill: 0xffeef1 });

/**
 * The Ave Mujica FEVER gauge's colour, per the official note (「以图标显示于在场 Ave Mujica 成员模型右下，其中的玫红色
 * 填充反映累积进度」): the icon's filling ring, its halo and the Fever-tinted SP bar are all this rose red. Deliberately
 * NOT the notes' NOTE_FX red — the gauge is its own thing (render/units.js FEVER_ICON draws it).
 */
export const FEVER_ROSE = 0xe8467c;
/** The same rose while Fever is ON (the icon shows its remaining time and must read apart from plain charging). */
export const FEVER_ROSE_HI = 0xff9ec4;
/**
 * The badge's ring TRACK while it is only charging: the rose darkened, so the empty part of the ring reads as part of
 * the gauge (the old badge had a dark disc behind the ring for that; the disc and the outer circle are gone —
 * render/units.js FEVER_ICON). While Fever runs the track takes FEVER_ROSE instead.
 */
export const FEVER_ROSE_DIM = 0x6d2139;

/**
 * Projectile visuals per b.ev 'atk' projKind (sim: none | arrow | bolt | bomb | lob | orb | drone | enemy | boomerang |
 * droneBomb | note | noteSkill; chain / chainHeal / beam are beams). Drawn by render/fx.js:
 *   look   tracer (bullet streak + muzzle flash) | orb (glowing ball, particle trail) | shell (lobbed on an arc with a
 *          ground shadow, smoke trail) | dart (small fast bolt) | boomerang (spins to the target and back to the thrower)
 *          | note (a floating music glyph — 八分 / 十六分音符 or 高音谱号 — with a halo)
 *   speed  tiles per game second — a copy of the sim's PROJECTILE_SPEEDS (server/sim/constants.js; `back` of the
 *          boomerang = BOOMERANG_RETURN_SPEED, PRTS 跃跃: out 15, back 3.75). fx.js prefers the sim's own values, loaded
 *          from /sim/constants.js, so the visual flight ends with the sim's hit; this copy stands in until then (and in
 *          Node). test/render/fxproj.test.js keeps the two equal. (`note` / `noteSkill` are not in the sim's table:
 *          their speed copies the note flight of server/sim/content/kits/collab.js.)
 *   sizes  in tiles (× the camera's px per tile at the shot): `len` trail length, `width` trail thickness, `head` glow
 *          diameter; `arc` peak height of a lob over a 3-tile throw (scales with the range). A note's `look` has no
 *          trail: `head` / `width` are its glyph's height / width and `halo` its glow's diameter (NOTE_SIZE)
 *   colours `tint` hot core, `glow` halo, `trail` trail particles, `muzzle` flash at the shooter
 *   hit    arrival burst (fx.js _impact): spark | arts | heal | boom | splash | zap | enemy
 *   once   a one-off cast, not an attack rhythm: the shooter's attack clip plays once at its own speed (render/spine.js
 *          SpineActor.attack / windUp) — 暴鸰's bomb drop
 *
 * `note` / `noteSkill` are 丰川祥子's notes (server/sim/content/kits/collab.js `battle.addProjectile({ visual: 'note' })`).
 * She fires them on her own — 【自由移动】 when nothing is in range, then 【追踪移动】 — so there is NO 'atk' event to
 * hang a visual on and no target view to home on: the sim streams their positions in `b.snap.proj` and render/fx.js
 * draws them from that list (FxSystem.syncNotes, one sprite per projectile id). Each note picks one of three glyphs at
 * random when it appears and keeps it (fx.js NOTE_FRAMES); `kind` tells the two kinds apart — her skill's notes
 * ('noteSkill') are bigger and brighter than the talent's ('note'). `look: 'note'` is still handled by
 * _dressProj / _stepShot, so a note that ever does arrive as an 'atk' kind flies and lands like the others.
 */
export const PROJ = Object.freeze({
  arrow: { look: 'tracer', speed: 14, tint: 0xfff6dc, glow: 0xffc45a, len: 1.05, width: 0.2, head: 0.36, muzzle: 0xffd27a, hit: 'spark' },
  bolt: { look: 'orb', speed: 11, tint: 0xf4e2ff, glow: 0xb36bff, len: 0.6, width: 0.34, head: 0.52, trail: 0xa35cff, muzzle: 0xc77dff, hit: 'arts' },
  orb: { look: 'orb', speed: 10, tint: 0xeafff0, glow: 0x3fe07a, len: 0.55, width: 0.3, head: 0.48, trail: 0x62f08a, muzzle: 0x62f08a, hit: 'heal' },
  bomb: { look: 'shell', speed: 8, tint: 0xffeed0, glow: 0xff8a3d, len: 0.85, width: 0.3, head: 0.56, trail: 0xff9c4a, arc: 1.1, smoke: 0x2e2824, muzzle: 0xffb35c, hit: 'boom' },
  lob: { look: 'shell', speed: 8, tint: 0xfff4dc, glow: 0xffb04a, len: 0.7, width: 0.26, head: 0.5, trail: 0xffc27a, arc: 1.4, smoke: 0x3a322c, muzzle: 0xffc27a, hit: 'splash' },
  drone: { look: 'dart', speed: 16, tint: 0xe4fbff, glow: 0x57c9ff, len: 0.7, width: 0.16, head: 0.3, trail: 0x57c9ff, hit: 'zap' },
  enemy: { look: 'orb', speed: 10, tint: 0xffe2da, glow: 0xff3b30, len: 0.55, width: 0.28, head: 0.44, trail: 0xff4a3a, muzzle: 0xff6a5a, hit: 'enemy' },
  boomerang: { look: 'boomerang', speed: 15, back: 3.75, tint: 0xfff4d6, glow: 0x9ff0dc, len: 0.4, width: 0.3, head: 0.5, trail: 0x9ff0dc, hit: 'spark' },
  // 暴鸰's bomb (sim content/enemies.js kitBombd; official projectile_bombd, speed 5): dropped from the drone, it falls
  // onto its target with a low arc and bursts where the sim's 'explode' blast goes off
  droneBomb: { look: 'shell', speed: 5, once: true, tint: 0xffe2c8, glow: 0xff5a3a, len: 0.6, width: 0.3, head: 0.5, trail: 0xff7a4a, arc: 0.35, smoke: 0x2e2824, hit: 'boom' },
  // 丰川祥子's talent note (collab.js fireNote, hitTag 'talent'): a floating music glyph — 八分音符 / 十六分音符 /
  // 高音谱号, picked at random per note (fx.js NOTE_FRAMES) — with a halo in the effect colour. Sizes: NOTE_SIZE.talent,
  // colours: NOTE_INK.talent (glyph) / NOTE_FX (halo, trail, sparks). `speed` copies the note's own flight (collab.js,
  // 【追踪移动】2 tiles/s) and is only read if a note ever arrives as an 'atk' kind — the live path is `b.snap.proj` →
  // fx.js syncNotes, which draws the sim's own positions instead.
  note: { look: 'note', speed: 2, tint: NOTE_INK.talent, glow: NOTE_FX, trail: NOTE_FX, ...NOTE_SIZE.talent, hit: 'arts' },
  // the same note fired by one of her skills (hitTag 'skill': S1's volley, S2's two timbres, S3's tracking pair):
  // bigger and brighter (a paler glyph, a wider and stronger halo) so a skill's notes read as the stronger ones
  noteSkill: { look: 'note', speed: 2, tint: NOTE_INK.skill, glow: NOTE_FX, trail: NOTE_FX, ...NOTE_SIZE.skill, hit: 'arts' },
});

/** Status keys (b.ev 'status' + UF flags) → icon atlas key (render/textures.js) and colour. */
export const STATUS_ICON = Object.freeze({
  stun: 'stun', freeze: 'freeze', cold: 'cold', stealth: 'stealth', shield: 'shield', fragile: 'fragile',
  artsFragile: 'fragile', physFragile: 'fragile', elemFragile: 'fragile', sleep: 'sleep', invulnerable: 'invuln',
  silence: 'silence', slow: 'slow', sluggish: 'slow', bind: 'bind', fear: 'fear', tremble: 'fear', weaken: 'weaken',
  levitate: 'levitate', taunt: 'taunt', defDown: 'weaken', resDown: 'weaken', aspdDown: 'slow', disarm: 'silence',
  burn: 'burn', burnBurst: 'burn', neural: 'neural', neuralBurst: 'neural', necrosis: 'necrosis', apoptosis: 'necrosis',
  // a 傀儡师 fighting as its <替身> (sim professions.js buff 'trait:substitute', the 20 s form)
  substitute: 'doll',
  // 禁疗 (sim status 'healFree': 史尔特尔's 余烬 — no heal reaches her until she leaves)
  healFree: 'healFree',
  // 折射 (sim buff 'ab:refraction', visible while the RES bonus is on). The tail of 'ab:refraction' hits this key.
  refraction: 'refraction',
});

/** Keyword fallbacks for namespaced / content status keys ('ab:frost', 'reed2:scorch', 'skill:shotst_shred' …). */
const STATUS_GUESS = [
  [/frost|chill|cold/i, 'cold'], [/freez/i, 'freeze'], [/scorch|burn|ignit|flame/i, 'burn'], [/stun|daze/i, 'stun'],
  [/sleep|slumber/i, 'sleep'], [/silenc/i, 'silence'], [/slow|slugg|bind|root|snare/i, 'slow'], [/fear|trembl/i, 'fear'],
  [/fragil|shred|expos|wanted|vulner|mark/i, 'fragile'], [/weak|down$/i, 'weaken'], [/shield|resist|guard|ward|barrier/i, 'shield'],
  [/invul|immun/i, 'invuln'], [/stealth|camou|invis/i, 'stealth'], [/levit|float/i, 'levitate'], [/taunt/i, 'taunt'],
  [/neural/i, 'neural'], [/necro|apopt|erosion/i, 'necrosis'],
];

/**
 * The 折射 icon is not drawn while the unit is silenced: the RES bonus is already off (enemies.js refraction)
 * and the status must not keep looking active. Other icons stay.
 * @param {string} key a b.ev status key
 * @param {Set<string>|string[]|null} statuses
 */
export function statusIconSuppressed(key, statuses) {
  if (key !== 'ab:refraction' && key !== 'refraction') return false;
  if (!statuses) return false;
  return typeof statuses.has === 'function' ? statuses.has('silence') : Array.isArray(statuses) && statuses.includes('silence');
}

/** Icon key (textures STATUS_KEYS) for a b.ev status key or flag name; null when it has no icon. */
export function statusIconKey(key) {
  if (typeof key !== 'string' || !key) return null;
  if (STATUS_ICON[key]) return STATUS_ICON[key];
  const tail = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  if (STATUS_ICON[tail]) return STATUS_ICON[tail];
  for (const [re, icon] of STATUS_GUESS) if (re.test(tail)) return icon;
  return null;
}

export const UNIT = Object.freeze({
  /** Spine skeleton units → world tiles (skeletons are ~360–450 units tall ⇒ ~1.2 tiles). */
  modelScale: 1 / 320,
  /** Fallback diamond size in tiles. */
  diamond: 0.78,
  headroom: 1.18, // tiles above the feet where bars sit (operators; enemies use their bounds)
  barWidth: 0.64,
  bossBarWidth: 2.2,
});
