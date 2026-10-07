// scripts/gen-level-list.mjs — regenerate scripts/gamedata-levels.txt.
//
// The wave/stage level files tools/build-data.mjs downloads are derived at runtime from act2autochess
// (battleDataDict + the two escaped templates + stageDatasDict + the season-wide enemy override). This
// script reproduces that derivation — templateIdOf / levelPath are copied verbatim from build-data.mjs —
// and writes the resulting paths, so scripts/fetch-gamedata.ps1 never has to hard-code (and mis-case) them.
//
//   node scripts/gen-level-list.mjs          (needs .cache/gamedata/excel/activity_table.json)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, '.cache', 'gamedata', 'excel', 'activity_table.json');
const OUT = path.join(ROOT, 'scripts', 'gamedata-levels.txt');

// --- copied from tools/build-data.mjs ---
const templateIdOf = (s) => { const m = /level_([A-Za-z0-9_]+)$/.exec(String(s)); return m ? m[1] : String(s); };
const levelPath = (idOrLevelId) => {
  const s = String(idOrLevelId);
  if (s.includes('/')) {
    const dir = s.slice(0, s.lastIndexOf('/')).toLowerCase();
    return `levels/${dir}/level_${templateIdOf(s)}.json`;
  }
  const season = s.split('_')[0];
  return `levels/activities/${season}/level_${s.toLowerCase()}.json`;
};

const all = JSON.parse(readFileSync(TABLE, 'utf8'));
const act = all.activity?.AUTOCHESS_SEASON?.act2autochess;
const ac = all.autoChessData;
if (!act || !ac) { console.error('activity_table has no act2autochess / autoChessData section'); process.exit(1); }

const levelSrc = new Map();
for (const rounds of Object.values(act.battleDataDict)) {
  for (const entries of Object.values(rounds)) for (const e of entries) levelSrc.set(templateIdOf(e.levelId), e.levelId);
}
for (const k of ['escapedBattleTemplateMapSinglePlayer', 'escapedBattleTemplateMapMultiPlayer']) {
  if (act.constData[k]) levelSrc.set(templateIdOf(act.constData[k]), act.constData[k]);
}
for (const id of Object.keys(act.stageDatasDict)) levelSrc.set(id, id);
if (ac.constData.enemyDataLevelId) levelSrc.set(templateIdOf(ac.constData.enemyDataLevelId), ac.constData.enemyDataLevelId);

const paths = [...new Set([...levelSrc.keys()].sort().map((id) => levelPath(levelSrc.get(id))))]
  // The table spells the mirror wave variants `..._h07_01_S`; the upstream repo stores them lower-case
  // (`level_act1autochess_h07_01_s.json`). Windows cannot tell the two apart, GitHub can, so the list is
  // normalised to the spelling the repo actually uses -- otherwise the download 404s while a
  // case-different file on disk makes the cache look complete.
  .map((p) => p.replace(/_S\.json$/, '_s.json'));
writeFileSync(OUT, paths.join('\n') + '\n');
console.log(`${paths.length} level paths -> ${path.relative(ROOT, OUT)}`);
