// tools/inject-sakiko.mjs — add 丰川祥子 (char_4182_oblvns) to the act2autochess tables.
//
// She is in the official character table (a 6★ WARRIOR·lord of the Ave Mujica collaboration) but the mode
// itself carries no chess record for her, so tools/build-data.mjs cannot see her. This script writes the
// three rows the builder reads (charChessDataDict / chessNormalIdLookupDict / charShopChessDatas) into the
// cached activity_table.json, after which `node tools/build-data.mjs --offline` emits her like any other
// operator.
//
// Everything the official tables provide is used as-is (stats, skills, talents, range, art ids); the values
// the mode would normally supply but does not for her are decided here and marked [ASSUMED]:
//
//   tier 6 / price 4 / sortId 23   a 6★ operator sits in tier 6 (cf. 银灰 chess_char_4_22_a, 仇白 6_15_a)
//   identifier 266 / 267           the highest identifier in use is 265 (chess_char_6_diy2_b)
//   bondIds ['emptyShip']          she has no faction of her own → the 协防干员 bond (see BOND_IDS below)
//   garrisonIds: []                her trait field carries no battle effect; the 协防干员 bond is the effect
//   defaultSkillIndex 2            same default as the other lords (银灰, 仇白)
//
// Idempotent: re-running rewrites the same rows. Docs: docs/research/12-sakiko.md
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, '.cache', 'gamedata', 'excel', 'activity_table.json');
const CHAR_ID = 'char_4182_oblvns';
const BASE = 'chess_char_6_21_a';
const GOLDEN = 'chess_char_6_21_b';
const SEASON = 'act2autochess';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('usage: node tools/inject-sakiko.mjs [--dry-run]');
  process.exit(0);
}
const dryRun = args.has('--dry-run');

const raw = readFileSync(TABLE, 'utf8');
const all = JSON.parse(raw);
const act = all.activity?.AUTOCHESS_SEASON?.[SEASON];
if (!act) { console.error(`no activity.AUTOCHESS_SEASON.${SEASON} in ${TABLE}`); process.exit(1); }
const char = JSON.parse(readFileSync(path.join(ROOT, '.cache', 'gamedata', 'excel', 'character_table.json'), 'utf8'))[CHAR_ID];
if (!char) { console.error(`${CHAR_ID} missing from character_table.json`); process.exit(1); }
const battleEquip = JSON.parse(readFileSync(path.join(ROOT, '.cache', 'gamedata', 'excel', 'battle_equip_table.json'), 'utf8'));

// --- guard: the id must not already be an official chess, and must not collide with another operator ---
const existing = act.charChessDataDict[BASE];
if (existing && existing.charId && existing.charId !== CHAR_ID) {
  console.error(`${BASE} already used by ${existing.charId}`); process.exit(1);
}
for (const id of [BASE, GOLDEN]) {
  const shop = act.charShopChessDatas[id];
  if (shop && shop.charId && shop.charId !== CHAR_ID) { console.error(`${id} already used by ${shop.charId}`); process.exit(1); }
}
for (const [id, s] of Object.entries(act.charShopChessDatas)) {
  if (s.charId === CHAR_ID && id !== BASE) { console.error(`${CHAR_ID} is already shop chess ${id}`); process.exit(1); }
}

const TIER = 6;
const priceRow = (isGolden) => (act.shopCharChessInfoData[String(TIER)] || []).find((p) => !!p.isGolden === isGolden) || {};
// Her own rows are excluded from the maxima, so re-running the script produces the same identifiers instead
// of drifting upward by two every time (it is idempotent, not additive).
const mine = new Set([BASE, GOLDEN]);
const maxIdentifier = Math.max(...Object.entries(act.charChessDataDict)
  .filter(([id]) => !mine.has(id)).map(([, c]) => c.identifier ?? 0));
const maxSortId = Math.max(...Object.entries(act.charShopChessDatas)
  .filter(([id, s]) => !mine.has(id) && s.chessLevel === TIER).map(([, s]) => s.shopLevelSortId ?? 0));
const idNorm = maxIdentifier + 1;
const idGold = maxIdentifier + 2;
const sortId = maxSortId + 1;

// The elite record carries the module at its maximum level: build-data.mjs only activates a module when
// `status.equipLevel > 0` AND battle_equip_table has that phase (tools/build-data.mjs:815-830). Every other
// operator's elite status does the same (仇白 3, 银灰 1), so the injected elite must too or the elite would
// silently fight without its LOR-Y module.
const MODULE_ID = 'uniequip_002_oblvns';
const equipLevels = ((battleEquip[MODULE_ID] || {}).phases || []).map((p) => p.equipLevel).filter(Number.isInteger);
const ELITE_EQUIP_LEVEL = equipLevels.length ? Math.max(...equipLevels) : 0;
if (!ELITE_EQUIP_LEVEL) console.warn(`warn: ${MODULE_ID} has no battle_equip phases; the elite module stays inactive`);

// She belongs to the 协防干员 bond. Membership is ALWAYS the chess record's own `bondIds` — the engine never
// reads config.economy.fallbackBondId (server/match/bondsMeta.js pieceBonds just copies `c.bonds`), which is
// why the official 协防 operators each carry "emptyShip" in their own bondIds:
//   chess_char_2_14_a 调香师 -> ["deputShip", "emptyShip"]
//   chess_char_6_12_a 迷迭香 -> ["preciShip", "visiShip", "emptyShip"]
// An empty list would leave her outside the bond entirely: no membership, no count, and neither the
// −20 % damage taken nor the ×1.2 / ×1.4 member damage would apply to her (owner report, 2026-10-06).
const BOND_IDS = ['emptyShip'];

const statusOf = (isGolden) => ({
  evolvePhase: priceRow(isGolden).evolvePhase,
  charLevel: priceRow(isGolden).charLevel,
  skillLevel: priceRow(isGolden).skillLevel,
  favorPoint: 0,
  equipLevel: isGolden ? ELITE_EQUIP_LEVEL : 0,
});

act.charChessDataDict[BASE] = {
  chessId: BASE,
  identifier: idNorm,
  isGolden: false,
  status: statusOf(false),
  upgradeChessId: GOLDEN,
  upgradeNum: 3,
  bondIds: [...BOND_IDS],
  garrisonIds: [],
};
act.charChessDataDict[GOLDEN] = {
  chessId: GOLDEN,
  identifier: idGold,
  isGolden: true,
  status: statusOf(true),
  upgradeChessId: GOLDEN,
  upgradeNum: 3,
  bondIds: [...BOND_IDS],
  garrisonIds: [],
};
act.chessNormalIdLookupDict[BASE] = BASE;
act.chessNormalIdLookupDict[GOLDEN] = BASE;
act.charShopChessDatas[BASE] = {
  chessId: BASE,
  goldenChessId: GOLDEN,
  chessLevel: TIER,
  shopLevelSortId: sortId,
  chessType: 'NORMAL',
  charId: CHAR_ID,
  tmplId: null,
  defaultSkillIndex: 2,
  defaultUniEquipId: MODULE_ID,
  backupCharId: CHAR_ID,
  backupTmplId: null,
  backupCharSkillIndex: 1,
  backupCharUniEquipId: null,
  backupCharPotRank: 0,
  isHidden: false,
};

console.log(`${char.name} (${CHAR_ID}) -> ${BASE} / ${GOLDEN}`);
console.log(`  tier ${TIER}  price ${priceRow(false).purchasePrice}  sell ${priceRow(false).chessSoldPrice}  sortId ${sortId}`);
console.log(`  identifier ${idNorm} (normal) / ${idGold} (golden)  [ASSUMED: highest in use was ${maxIdentifier}]`);
console.log(`  bonds ${JSON.stringify(BOND_IDS)} -> 协防干员   garrisonIds [] -> no mode trait`);
console.log(`  rarity ${char.rarity} ${char.profession}/${char.subProfessionId} team=${char.teamId}`);
console.log(`  skills ${(char.skills || []).map((s) => s.skillId).join(', ')}`);

if (dryRun) { console.log('\n--dry-run: nothing written'); process.exit(0); }

// atomic replace: a half-written 14 MB table would poison every later build
const tmp = TABLE + '.tmp';
writeFileSync(tmp, JSON.stringify(all));
renameSync(tmp, TABLE);
console.log(`\nwrote ${path.relative(ROOT, TABLE)}`);
