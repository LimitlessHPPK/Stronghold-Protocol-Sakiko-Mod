// tools/add-sakiko-assets.mjs — add 丰川祥子's art entry to docs/research/07-assets.json.
//
// The operator asset manifest is the hand-curated research file that tools/fetch-assets.mjs reads; she is
// not in it because the v0.1.3 snapshot predates the Ave Mujica collaboration. Every URL below is the same
// community mirror the other 138 operators use (fexli/ArknightsResource for battle spines,
// yuanyan3060/ArknightsGameResource for avatars / portraits / skill icons), so fetch-assets downloads her
// exactly like any other operator. Byte sizes are read from the upstream response so the manifest agrees
// with what the downloader verifies.
//
//   node tools/add-sakiko-assets.mjs [--dry-run]
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'docs', 'research', '07-assets.json');
const ID = 'char_4182_oblvns';
const dryRun = process.argv.includes('--dry-run');

const RAW_RES = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main';
const RAW_SPINE = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main';
const JSD_SPINE = 'https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main';

const urls = {
  avatarE0E1: `${RAW_RES}/avatar/${ID}.png`,
  avatarE2: `${RAW_RES}/avatar/${ID}_2.png`,
  portraitE0E1: `${RAW_RES}/portrait/${ID}_1.png`,
  portraitE2: `${RAW_RES}/portrait/${ID}_2.png`,
  fullArtE0E1: `${RAW_RES}/skin/${ID}_1b.png`,
  fullArtE2: `${RAW_RES}/skin/${ID}_2b.png`,
  skill0: `${RAW_RES}/skill/skill_icon_skchr_oblvns_1.png`,
  skill1: `${RAW_RES}/skill/skill_icon_skchr_oblvns_2.png`,
  skill2: `${RAW_RES}/skill/skill_icon_skchr_oblvns_3.png`,
  subProf: 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/arts/ui/subprofessionicon/sub_lord_icon.png',
};
const spineRel = (form, ext) => `spine/${ID}/${ID}/${form}/${ID}.${ext}`;

/**
 * Content-Length of a URL, read with curl -I. jsDelivr (Cloudflare) answers a Node `fetch` HEAD for .png
 * without a usable content-length, while `curl -I` reports it, and curl is what the project's own
 * download helper uses anyway.
 */
/** https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path> -> https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path> */
function jsdelivr(rawUrl) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(rawUrl);
  if (!m) return rawUrl;
  const [, owner, repo, branch, rest] = m;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${rest}`;
}

function head(url) {
  try {
    const out = execFileSync('curl.exe', ['-s', '-I', '-L', url], { encoding: 'utf8', timeout: 30000 });
    const m = /^content-length:\s*(\d+)/im.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function sizeOf(rawUrl) {
  // jsDelivr (Cloudflare) answers a HEAD for these files without a usable content-length, and curl -I is
  // unreliable here, so fall back to a real GET on the mirror the rest of the manifest uses.
  for (const u of [jsdelivr(rawUrl), rawUrl]) {
    try {
      const r = await fetch(u, { redirect: 'follow' });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 0) return buf.length;
    } catch { /* try the next mirror */ }
  }
  return null;
}

const sizes = {};
for (const [k, u] of Object.entries(urls)) sizes[k] = await sizeOf(u);
for (const form of ['Front', 'Back']) {
  for (const ext of ['skel', 'atlas', 'png']) sizes[`${form}.${ext}`] = await sizeOf(`${RAW_SPINE}/${spineRel(form, ext)}`);
}

const missing = Object.entries(sizes).filter(([, v]) => v == null).map(([k]) => k);
if (missing.length) { console.error(`no content-length for: ${missing.join(', ')}`); process.exit(1); }

const all = JSON.parse(readFileSync(FILE, 'utf8'));
// Her `sfx` / `skills[*].sfx` records are resolved from the official audio index, not from this script (the banks of
// her three skills are named differently from `battle.ON_SKILL_START.<skillId>`: tools/assets/audio.mjs
// SKILL_START_BANKS, downloaded by tools/fetch-voice-override.mjs --sfx, test/sfx-sakiko.test.js). Re-running this
// entry writer must not wipe them back to `{}` — that is how her manifest lost its skill sounds in the first place.
const prev = all.operators[ID] || {};
const prevSkillSfx = (i) => (prev.skills || []).find((s) => s.index === i)?.sfx ?? {};

const entry = {
  name: '丰川祥子',
  rarity: 'TIER_6',
  profession: 'WARRIOR',
  subProfessionId: 'lord',
  nationId: null,
  chess: [{ chessId: 'chess_char_6_21_a', chessLevel: 6, chessType: 'NORMAL', defaultSkillIndex: 2, evolvePhase: 'PHASE_2' }],
  avatar: { e0e1: { url: urls.avatarE0E1, bytes: sizes.avatarE0E1 }, e2: { url: urls.avatarE2, bytes: sizes.avatarE2 } },
  portrait: { e0e1: { url: urls.portraitE0E1, bytes: sizes.portraitE0E1 }, e2: { url: urls.portraitE2, bytes: sizes.portraitE2 } },
  fullArt: { e0e1: { url: urls.fullArtE0E1, bytes: sizes.fullArtE0E1 }, e2: { url: urls.fullArtE2, bytes: sizes.fullArtE2 } },
  skills: [
    { index: 0, skillId: 'skchr_oblvns_1', iconId: 'skchr_oblvns_1', icon: { url: urls.skill0, bytes: sizes.skill0 }, sfx: prevSkillSfx(0) },
    { index: 1, skillId: 'skchr_oblvns_2', iconId: 'skchr_oblvns_2', icon: { url: urls.skill1, bytes: sizes.skill1 }, sfx: prevSkillSfx(1) },
    { index: 2, skillId: 'skchr_oblvns_3', iconId: 'skchr_oblvns_3', icon: { url: urls.skill2, bytes: sizes.skill2 }, sfx: prevSkillSfx(2) },
  ],
  battleSpine: {
    front: {
      skel: { url: `${RAW_SPINE}/${spineRel('Front', 'skel')}`, bytes: sizes['Front.skel'] },
      atlas: { url: `${RAW_SPINE}/${spineRel('Front', 'atlas')}`, bytes: sizes['Front.atlas'] },
      png: { url: `${RAW_SPINE}/${spineRel('Front', 'png')}`, bytes: sizes['Front.png'] },
      jsdelivrSkel: `${JSD_SPINE}/${spineRel('Front', 'skel')}`,
    },
    back: {
      skel: { url: `${RAW_SPINE}/${spineRel('Back', 'skel')}`, bytes: sizes['Back.skel'] },
      atlas: { url: `${RAW_SPINE}/${spineRel('Back', 'atlas')}`, bytes: sizes['Back.atlas'] },
      png: { url: `${RAW_SPINE}/${spineRel('Back', 'png')}`, bytes: sizes['Back.png'] },
      jsdelivrSkel: `${JSD_SPINE}/${spineRel('Back', 'skel')}`,
    },
    note: 'Ave Mujica collaboration operator, added locally; not part of the v0.1.3 snapshot (docs/research/12-sakiko.md)',
  },
  sfx: prev.sfx ?? {},
  subProfessionIcon: urls.subProf,
};

if (all.operators[ID]) console.log(`${ID} already present; overwriting`);
all.operators[ID] = entry;
all.meta = all.meta || {};
if (all.meta.operatorCount !== undefined) all.meta.operatorCount = Object.keys(all.operators).length;

console.log(`${entry.name} (${ID}) -> docs/research/07-assets.json`);
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(14)} ${String(v).padStart(9)} bytes`);
console.log(`  operators: ${Object.keys(all.operators).length}`);

if (dryRun) { console.log('\n--dry-run: nothing written'); process.exit(0); }
const tmp = FILE + '.tmp';
// The research manifests are stored with ONE-space indentation; JSON.stringify's default is two, which
// would rewrite all 51k lines of the file for a one-operator addition. Re-indent to keep the diff minimal.
const oneSpace = JSON.stringify(all, null, 1);
writeFileSync(tmp, oneSpace + '\n');
renameSync(tmp, FILE);
console.log(`\nwrote ${path.relative(ROOT, FILE)}`);
