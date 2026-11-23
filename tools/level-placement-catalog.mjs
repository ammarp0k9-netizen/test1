import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import '../js/content-schema.js';
import '../js/level-placement.js';
import '../js/journey.js';

const schema = globalThis.LootLinguaContentSchema;
const placement = globalThis.LootLinguaLevelPlacement;
const journey = globalThis.LootLinguaJourney;
const require = createRequire(import.meta.url);
const classified = schema.CEFR_LEVELS.filter(level => level !== 'unclassified');

export function buildPlacementCatalog(worldId, bundles) {
  const ranks = journey.stableRankOrder(bundles.map(bundle => bundle.rank));
  const levels = Object.fromEntries(classified.map(level => [level, ranks
    .filter(rank => schema.normalizeCefrLevel(rank.cefrLevel) === level).map(rank => rank.rankId)]));
  const gatesByRank = Object.fromEntries(bundles.map(({ rank, gates }) => [rank.rankId,
    journey.stableContentOrder(gates.map(({ gate }) => gate), 'gateId').map(gate => gate.gateId)
  ]));
  const questions = {};
  for (const { rank, gates } of bundles) {
    for (const { gate, words } of gates) {
      const configured = Number(gate.entryAssessmentPassRatio);
      const threshold = configured > 0 && configured <= 1 ? configured : schema.ENTRY_ASSESSMENT_DEFAULTS.passRatio;
      for (const word of words) {
        if (!word.wordKey || !word.word || !(word.translation || word.meaning)) continue;
        const { contentWordId, wordKey } = word;
        const key = placement.questionId(rank.rankId, gate.gateId, contentWordId);
        if (Object.hasOwn(questions, key) || wordKey !== schema.normalizeWordIdentity(word).wordKey) {
          throw new Error(`Conflicting published Placement identity at ${worldId}/${key}`);
        }
        questions[key] = { rankId: rank.rankId, gateId: gate.gateId, contentWordId, wordKey, threshold };
      }
    }
  }
  const next = Object.fromEntries(classified.map((level, index) => {
    for (const later of classified.slice(index + 1)) {
      const rankId = levels[later].find(rank => gatesByRank[rank].length);
      if (rankId) return [level, { rankId, gateId: gatesByRank[rankId][0], level: later }];
    }
    return [level, { rankId: '', gateId: '', level: '' }];
  }));
  const data = { levels, next, ranks: gatesByRank, questions,
    rankPositions: Object.fromEntries(ranks.map((rank, index) => [rank.rankId, index])),
    worldCompletion: journey.createWorldCompletionAchievement({ worldId, ranks, completedBy: 'level-placement' }),
  };
  return { ...data, id: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}

function toFirestore(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestore) } };
  if (typeof value === 'object') return { mapValue: { fields: fields(value) } };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, toFirestore(value)]));
const field = (row, key) => {
  const value = row.fields?.[key];
  if (value) return value.stringValue ?? value.doubleValue ?? value.integerValue;
};

async function publishCatalogs(project, write) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('Specify a Firebase project ID.');
  const auth = require('firebase-tools/lib/auth');
  const { Client } = require('firebase-tools/lib/apiv2');
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('Sign in with Firebase CLI first.');
  auth.setRefreshToken(account.tokens.refresh_token);
  const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const base = `/projects/${project}/databases/(default)/documents`;
  const id = row => row.name.split('/').at(-1);
  const published = async (parent, collectionId) => {
    const response = await api.post(`${base}${parent}:runQuery`, { structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
    } });
    return response.body.flatMap(item => item.document ? [item.document] : []);
  };
  const worlds = await published('', 'content_worlds');
  const catalogs = [];
  for (const world of worlds) {
    const worldPath = `/content_worlds/${id(world)}`;
    const rankRows = await published(worldPath, 'ranks');
    const bundles = await Promise.all(rankRows.map(async row => {
      const rank = { rankId: id(row), status: 'published', cefrLevel: field(row, 'cefrLevel'),
        version: field(row, 'version'), order: field(row, 'order') };
      const rankPath = `${worldPath}/ranks/${rank.rankId}`;
      const gateRows = await published(rankPath, 'gates');
      const gates = await Promise.all(gateRows.map(async row => {
        const gate = { gateId: id(row), status: 'published', order: field(row, 'order'),
          entryAssessmentPassRatio: field(row, 'entryAssessmentPassRatio') };
        const words = await published(`${rankPath}/gates/${gate.gateId}`, 'words');
        return { gate, words: words.map(row => ({
          contentWordId: id(row), wordKey: field(row, 'wordKey'), word: field(row, 'word'),
          translation: field(row, 'translation'), meaning: field(row, 'meaning'),
        })) };
      }));
      return { rank, gates };
    }));
    const data = buildPlacementCatalog(id(world), bundles);
    const encoded = fields(data);
    if (Buffer.byteLength(JSON.stringify(encoded)) >= 900_000) throw new Error(`Catalog too large for ${id(world)}`);
    catalogs.push({ world: id(world), path: `${base}${worldPath}/placementCatalog/current`, encoded, data });
  }
  if (write && !catalogs.length) throw new Error('No published worlds found.');
  for (const { world, path, encoded, data } of catalogs) {
    if (write) await api.patch(path, { fields: encoded });
    console.log(JSON.stringify({ project, world, version: data.id, questions: Object.keys(data.questions).length, written: write }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , project, option] = process.argv;
  if (option && option !== '--write') throw new Error('Use --write to publish the catalogs.');
  await publishCatalogs(project || '', option === '--write');
}
