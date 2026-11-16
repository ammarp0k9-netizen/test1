import './content-schema.js';
import { savedGuestError } from './saved-guest-session.js';

const educationalFields = [
  'definition', 'definition_ar', 'example', 'exampleTranslation', 'partOfSpeech',
  'level', 'pronunciation', 'notes',
];
const text = (value) => typeof value === 'string' ? value.normalize('NFC').trim() : '';
const terms = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

function dictionaryEntry(data, includeHidden = false) {
  const word = text(data.text || data.word);
  const hidden = data.hiddenFromDictionary === true || data.personalDictionaryState === 'moved-to-private-world';
  if (!word || (hidden && !includeHidden)) return null;
  const meaning = text(data.meaning || data.translation);
  const category = text(data.category) || 'عام';
  if (word.length > 500 || meaning.length > 2000 || category.length > 120) return null;
  const entry = { word, meaning, translation: text(data.translation) || meaning, category };
  for (const field of educationalFields) entry[field] = text(data[field]);
  entry.definition_ar ||= text(data.definitionAr);
  entry.level ||= text(data.difficulty);
  entry.tags = terms(data.tags);
  entry.synonyms = terms(data.synonyms);
  if (hidden) {
    entry.hiddenFromDictionary = true;
    if (data.personalDictionaryState === 'moved-to-private-world') entry.personalDictionaryState = data.personalDictionaryState;
  }
  return entry;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createGuestDictionaryMerge({ firestore, getDatabase, assertCurrent }) {
  const { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } = firestore;
  const transferRef = (db, plan) => doc(db, 'users', plan.sourceUid, 'savedGuestMerges', plan.id);

  async function preview(selection, sourceAuth, { includeHidden = false } = {}) {
    assertCurrent(selection);
    const sourceUid = selection.source.uid;
    const targetUid = selection.target.uid;
    const source = getDatabase(sourceAuth);
    const target = getDatabase(selection.destinationAuth);
    const [sourceWords, targetWords] = await Promise.all([
      getDocsFromServer(collection(source, 'users', sourceUid, 'words')),
      getDocsFromServer(collection(target, 'users', targetUid, 'words')),
    ]);
    assertCurrent(selection);
    const existing = new Map();
    for (const row of targetWords.docs) {
      const entry = dictionaryEntry(row.data(), includeHidden);
      if (entry) existing.set(JSON.stringify(entry), row.id);
    }
    const entries = new Map();
    const wordSignatures = new Map();
    let skipped = 0;
    for (const row of sourceWords.docs) {
      const entry = dictionaryEntry(row.data(), includeHidden);
      if (!entry) { skipped += 1; continue; }
      const signature = JSON.stringify(entry);
      wordSignatures.set(row.id, signature);
      if (!entries.has(signature)) entries.set(signature, { entry, starred: includeHidden && row.data().starred === true });
    }
    const signatures = [...entries.keys()].sort();
    const id = await digest(JSON.stringify([sourceUid, targetUid, signatures]));
    const additions = await Promise.all(signatures.filter((signature) => !existing.has(signature)).map(async (signature) => ({
      ...entries.get(signature), signature, id: 'saved_guest_' + await digest(signature),
    })));
    const targetIds = new Map([...existing, ...additions.map(word => [word.signature, word.id])]);
    const wordIds = new Map([...wordSignatures].map(([wordId, signature]) => [wordId, targetIds.get(signature)]));
    const plan = { id, selection, sourceUid, targetUid, source, target, additions, skipped, wordIds,
      duplicates: entries.size - additions.length };
    const receipt = await getDocFromServer(transferRef(source, plan));
    assertCurrent(selection);
    return { ...plan, completed: Boolean(receipt.data()?.completedAt),
      ...(includeHidden ? { sourceWords: sourceWords.docs.map(row => row.data()), targetWords: targetWords.docs.map(row => row.data()) } : {}) };
  }

  // Copy dictionary content only. Neither an owner-writable balance nor a
  // dictionary receipt establishes a learning or reward event for the target.
  async function copyWord(plan, { entry, id, starred }) {
    const identity = globalThis.LootLinguaContentSchema.normalizeWordIdentity(entry.word);
    const word = doc(plan.target, 'users', plan.targetUid, 'words', id);
    const canonical = identity.wordKey && identity.normalizedWord.length <= 240 && entry.translation.length <= 1000
      ? doc(plan.target, 'users', plan.targetUid, 'contentWords', identity.wordKey) : null;
    return runTransaction(plan.target, async (transaction) => {
      assertCurrent(plan.selection);
      const prior = await transaction.get(word);
      if (prior.exists()) return;
      const learningWord = canonical ? await transaction.get(canonical) : null;
      assertCurrent(plan.selection);
      transaction.set(word, {
        ...entry, text: entry.word, userId: plan.targetUid, wordKey: identity.wordKey,
        normalizedWord: identity.normalizedWord, forgetCount: 0, starred: starred === true, order: 0,
        personalDictionaryState: entry.personalDictionaryState || 'active', createdAt: serverTimestamp(),
      });
      if (canonical && !learningWord.exists()) {
        const sourceId = 'import_saved_guest';
        transaction.set(canonical, {
          ...identity, word: entry.word, translation: entry.translation, meaning: entry.meaning,
          canonicalId: identity.wordKey, masteryKey: identity.wordKey, legacyWordId: id,
          primarySource: { sourceId, addedFrom: 'import', importId: 'saved_guest' }, sourceCount: 1,
          forgetCount: 0, eligibleEvidenceCount: 0, evidenceVersion: 1, schemaVersion: 1,
          createdAt: serverTimestamp(), joinedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(doc(canonical, 'sources', sourceId), {
          addedFrom: 'import', operationId: plan.id, importId: 'saved_guest', linkedAt: serverTimestamp(),
        });
      }
    });
  }

  async function commit(plan, onProgress = () => {}) {
    assertCurrent(plan.selection);
    if (plan.completed || !plan.additions.length) return;
    const grant = transferRef(plan.source, plan);
    const completed = await runTransaction(plan.source, async (transaction) => {
      assertCurrent(plan.selection);
      const existing = await transaction.get(grant);
      if (existing.exists()) {
        if (existing.data().targetUid !== plan.targetUid) throw savedGuestError('guest-saved/session-changed');
        return Boolean(existing.data().completedAt);
      }
      assertCurrent(plan.selection);
      transaction.set(grant, { targetUid: plan.targetUid, createdAt: serverTimestamp() });
      return false;
    });
    if (completed) return;
    for (const [index, entry] of plan.additions.entries()) {
      await copyWord(plan, entry);
      onProgress(index + 1, plan.additions.length);
    }
    const receipt = transferRef(plan.target, plan);
    await runTransaction(plan.target, async (transaction) => {
      assertCurrent(plan.selection);
      const current = await transaction.get(receipt);
      if (!current.data()?.completedAt) transaction.update(receipt, { completedAt: serverTimestamp() });
    });
  }

  return Object.freeze({ preview, commit, copyWord });
}
