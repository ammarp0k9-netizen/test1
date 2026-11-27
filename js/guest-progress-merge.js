import { GUIDE_TOUR, mergeGuideCoverage, readGuideCoverage } from './guide-coverage.mjs';
import { createGuestDictionaryMerge } from './guest-dictionary-merge.js?v=full-merge-1';
import { savedGuestError } from './saved-guest-session.js';
import { legacyWordMastery, mergeCanonical, mergeJourney, mergeMastery, mergeProfile, number, pickGate, time, union } from './guest-progress-policy.js?v=streak-migration-1';

const duplicateReasons = new Set(['word_transition_new_learning', 'word_transition_learning_reviewing', 'word_mastered_first',
  'word_remastered', 'daily_chest_unlock', 'motivation_milestone']);
const consumedPrefix = 'xp_event_profile_sync_v1_' + encodeURIComponent('extra-consumed:');
const receiptPrefixes = ['xp_event_word_transition:', 'xp_event_daily_chest_unlock:', 'xp_event_motivation_', consumedPrefix];

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createGuestProgressMerge({ firestore, getDatabase, assertCurrent }) {
  const { doc, collection, documentId, getDocFromServer, getDocsFromServer, orderBy, query,
    runTransaction, serverTimestamp, startAt, endAt, where } = firestore;
  const dictionary = createGuestDictionaryMerge({ firestore, getDatabase, assertCurrent });
  const userDoc = (db, uid, ...path) => doc(db, 'users', uid, ...path);
  const profileRef = (db, uid) => userDoc(db, uid, 'meta', 'profile');
  const grantRef = (db, uid) => userDoc(db, uid, 'savedGuestMerges', 'progress');
  const permitRef = plan => userDoc(plan.target, plan.targetUid, 'meta', 'saved_guest_import');
  const receiptRef = plan => userDoc(plan.target, plan.targetUid, 'guestProgressImports', plan.sourceUid);
  const rows = async (db, uid, ...path) => new Map((await getDocsFromServer(collection(db, 'users', uid, ...path)))
    .docs.map(row => [row.id, row.data()]));
  const read = async ref => (await getDocFromServer(ref)).data();
  async function blocks(list, size, task) {
    for (let i = 0; i < list.length; i += size) await task(list.slice(i, i + size));
  }
  async function receipts(db, uid) {
    const meta = collection(db, 'users', uid, 'meta');
    const pages = await Promise.all(receiptPrefixes.map(prefix => getDocsFromServer(
      query(meta, orderBy(documentId()), startAt(prefix), endAt(prefix + '\uf8ff')))));
    return new Map(pages.flatMap(page => page.docs.map(row => [row.id, row.data()])));
  }
  const duplicateXP = (incoming, existing) => [...incoming].reduce((amount, [id, event]) => {
    const other = existing.get(id);
    return duplicateReasons.has(event.reason) && event.reason === other?.reason && event.amount === other.amount
      ? amount + number(event.amount) : amount;
  }, 0);

  async function preview(selection, sourceAuth) {
    assertCurrent(selection);
    const sourceUid = selection.source.uid, targetUid = selection.target.uid;
    const plan = { selection, sourceUid, targetUid, source: getDatabase(sourceAuth), target: getDatabase(selection.destinationAuth) };
    const [grant, receipt, permit] = await Promise.all([
      read(grantRef(plan.source, sourceUid)), read(receiptRef(plan)), read(permitRef(plan)),
    ]);
    assertCurrent(selection);
    if (grant?.targetUid && grant.targetUid !== targetUid) throw savedGuestError('guest-saved/another-destination');
    if (receipt?.completedAt) return { ...plan, completed: true, receipt };
    if (permit?.sourceUid && permit.sourceUid !== sourceUid) throw savedGuestError('guest-saved/another-import');
    const [words, guest, account, journeys, sourceReceipts, targetReceipts] = await Promise.all([
      dictionary.preview(selection, sourceAuth, { includeHidden: true }),
      read(profileRef(plan.source, sourceUid)), read(profileRef(plan.target, targetUid)),
      rows(plan.source, sourceUid, 'contentProgress'), receipts(plan.source, sourceUid), receipts(plan.target, targetUid),
    ]);
    assertCurrent(selection);
    const creditedXP = receipt?.xpAdded ?? Math.max(0, number(guest?.userXP) - duplicateXP(sourceReceipts, targetReceipts));
    return { ...plan, words, guest: guest || {}, account: account || {}, journeys, sourceReceipts, receipt,
      xpAdded: creditedXP, finalXP: receipt ? number(account?.userXP) : number(account?.userXP) + creditedXP };
  }

  async function authorize(plan) {
    const grant = grantRef(plan.source, plan.sourceUid);
    await runTransaction(plan.source, async tx => {
      assertCurrent(plan.selection);
      const existing = await tx.get(grant);
      assertCurrent(plan.selection);
      if (existing.exists()) {
        if (existing.data().targetUid !== plan.targetUid) throw savedGuestError('guest-saved/another-destination');
      } else tx.set(grant, { targetUid: plan.targetUid, createdAt: serverTimestamp() });
    });
    return runTransaction(plan.target, async tx => {
      assertCurrent(plan.selection);
      const [permit, receipt] = await Promise.all([tx.get(permitRef(plan)), tx.get(receiptRef(plan))]);
      assertCurrent(plan.selection);
      if (receipt.data()?.completedAt) return false;
      if (permit.exists() && permit.data().sourceUid !== plan.sourceUid) throw savedGuestError('guest-saved/another-import');
      if (!permit.exists()) tx.set(permitRef(plan), { sourceUid: plan.sourceUid, startedAt: serverTimestamp() });
      return true;
    });
  }

  const imported = data => ({ ...data, _savedGuestImportedAt: serverTimestamp() });

  async function writeRows(plan, writes) {
    await blocks(writes, 6, async chunk => runTransaction(plan.target, async tx => {
      assertCurrent(plan.selection);
      const snapshots = await Promise.all(chunk.map(({ ref }) => tx.get(ref)));
      assertCurrent(plan.selection);
      chunk.forEach(({ ref, merge, stamp }, i) => {
        const prior = snapshots[i].data();
        const value = merge(prior);
        if (value && value !== prior) tx.set(ref, stamp ? imported(value) : value);
      });
    }));
  }

  const insert = (plan, path, value, stamp = false) => ({ ref: userDoc(plan.target, plan.targetUid, ...path), merge: prior => prior || value, stamp });

  async function copyWords(plan) {
    const { source, sourceUid } = plan;
    const importedWords = new Map();
    const [canonicalWords, sessions, privateWorlds, mastery, entry] = await Promise.all([
      rows(source, sourceUid, 'contentWords'), rows(source, sourceUid, 'quizEvidenceSessions'),
      rows(source, sourceUid, 'customWorlds'), read(userDoc(source, sourceUid, 'meta', 'word_mastery')),
      read(userDoc(source, sourceUid, 'entryExperiences', 'v2')),
    ]);
    for (const word of plan.words.additions) await dictionary.copyWord(plan.words, word);

    for (const [id, world] of privateWorlds) {
      const path = ['customWorlds', id];
      const items = await rows(source, sourceUid, ...path, 'words');
      await writeRows(plan, [insert(plan, path, { ...world, userId: plan.targetUid }),
        ...[...items].map(([wordId, word]) => insert(plan, [...path, 'words', wordId], { ...word, userId: plan.targetUid }))]);
    }

    await writeRows(plan, [...sessions].map(([id, value]) => insert(plan, ['quizEvidenceSessions', id], value, true)));
    await blocks([...canonicalWords], 10, async block => {
      const documents = await Promise.all(block.map(async ([key, value]) => {
        const path = ['contentWords', key];
        const [sources, evidence] = await Promise.all([rows(source, sourceUid, ...path, 'sources'), rows(source, sourceUid, ...path, 'evidence')]);
        const legacy = plan.words.wordIds.get(value.legacyWordId);
        return [
          { ref: userDoc(plan.target, plan.targetUid, ...path), stamp: true, merge: prior => {
            const merged = mergeCanonical(prior, value, legacy, evidence);
            if (merged) importedWords.set(key, merged);
            return merged;
          } },
          ...[...sources].map(([id, data]) => insert(plan, [...path, 'sources', id], data, true)),
          ...[...evidence].map(([id, data]) => insert(plan, [...path, 'evidence', id], data, true)),
        ];
      }));
      await writeRows(plan, documents.flat());
    });

    const incomingMastery = { ...legacyWordMastery(plan.words.sourceWords), ...mastery?.entries };
    if (Object.keys(incomingMastery).length) {
      const existingMastery = legacyWordMastery(plan.words.targetWords);
      const ref = userDoc(plan.target, plan.targetUid, 'meta', 'word_mastery');
      await writeRows(plan, [{ ref, merge: prior => ({
        entries: mergeMastery({ ...existingMastery, ...prior?.entries }, incomingMastery), updatedAt: serverTimestamp(),
      }) }]);
    }
    if (entry?.status === 'completed') await writeRows(plan, [insert(plan, ['entryExperiences', 'v2'], entry)]);
    return importedWords;
  }

  async function publishedOrder(plan, id) {
    const byOrder = (a, b) => number(a.data().order) - number(b.data().order) || a.id.localeCompare(b.id);
    const published = async (...path) => (await getDocsFromServer(query(collection(plan.source, ...path), where('status', '==', 'published')))).docs;
    const root = ['content_worlds', id, 'ranks'];
    try {
      const ranks = (await published(...root)).sort((a, b) => globalThis.LootLinguaContentSchema.comparePublishedRanks(
        { ...a.data(), rankId: a.id }, { ...b.data(), rankId: b.id }));
      const gates = await Promise.all(ranks.map(async rank => (await published(...root, rank.id, 'gates')).sort(byOrder).map(gate => `${rank.id}/${gate.id}`)));
      return new Map(gates.flat().map((key, index) => [key, index]));
    } catch (error) {
      // Archived content may no longer be public; the historical progress is still owned.
      if (error.code === 'permission-denied') return new Map();
      throw error;
    }
  }

  async function copyJourneys(plan, wordStates, existingReceipts) {
    if (!globalThis.LootLinguaLearningEvidence) await import('./learning-evidence.js');
    if (!globalThis.LootLinguaGateLesson) await import('./gate-lesson.js');
    const lesson = globalThis.LootLinguaGateLesson;
    const evidence = globalThis.LootLinguaLearningEvidence;
    const counted = new Map();
    const { source, sourceUid } = plan;
    const sourcePointer = await read(userDoc(source, sourceUid, 'meta', 'active_content_journey'));
    const targetWorlds = await rows(plan.target, plan.targetUid, 'contentProgress');
    const allReceipts = new Map([...plan.sourceReceipts, ...existingReceipts]);
    for (const [id, journey] of plan.journeys) {
      const path = ['contentProgress', id];
      const [attempts, placement, levels, order] = await Promise.all([
        rows(source, sourceUid, ...path, 'gateClearAttempts'), rows(source, sourceUid, ...path, 'placementSessions'),
        rows(source, sourceUid, ...path, 'levelPlacementSessions'), targetWorlds.has(id) ? publishedOrder(plan, id) : new Map(),
      ]);
      const subcollections = [['gateClearAttempts', attempts], ['placementSessions', placement], ['levelPlacementSessions', levels]];
      await writeRows(plan, subcollections.flatMap(([name, entries]) => [...entries].map(([key, value]) => insert(plan, [...path, name, key], value, true))));
      const target = targetWorlds.get(id);
      const rankIds = union(union([journey.activeRankId, ...attempts.values()].map(value => value?.rankId || value).filter(id => typeof id === 'string' && id), journey.unlockedRankIds),
        union(journey.completedRankIds, target?.unlockedRankIds));
      let gateReceipts = 0;
      for (const rankId of rankIds) {
        const gatePath = [...path, 'ranks', rankId, 'gates'];
        const [incoming, existing] = await Promise.all([rows(source, sourceUid, ...gatePath), rows(plan.target, plan.targetUid, ...gatePath)]);
        for (const [gateId, gate] of incoming) {
          const current = existing.get(gateId);
          const fullPath = [...gatePath, gateId];
          const context = { worldId: id, rankId, gateId };
          const localKey = 'lootlingua:gate-lesson:v1:' + sourceUid + ':' + lesson.keyFor(context);
          let localLesson = null;
          try { localLesson = JSON.parse(globalThis.localStorage?.getItem(localKey) || 'null')?.state; } catch (_) {}
          const storedLesson = await read(userDoc(source, sourceUid, ...fullPath, 'lesson', 'progress'));
          const checkpoint = lesson.merge(lesson.upgrade(storedLesson, { confirmed: true }), localLesson);
          // Import historical credit only from the source account's saved checkpoint.
          if (checkpoint) checkpoint.creditedIds = storedLesson?.creditedIds || [];
          if (checkpoint?.version === lesson.version) {
            const lessonRef = userDoc(plan.target, plan.targetUid, ...fullPath, 'lesson', 'progress');
            await writeRows(plan, [{
              ref: lessonRef,
              merge: prior => {
                if (prior && !lesson.sameWords(prior.wordIds, checkpoint.wordIds)) return prior;
                return {
                  ...lesson.merge(lesson.upgrade(prior, { confirmed: true }), checkpoint),
                  updatedAt: serverTimestamp(),
                };
              },
              stamp: true,
            }]);
          }
          if (pickGate(current, gate, attempts) !== gate) continue;
          const proof = gate.status === 'ready' || gate.status === 'cleared'
            ? await read(userDoc(source, sourceUid, ...fullPath, 'readiness', 'proof')) : null;
          const ref = userDoc(plan.target, plan.targetUid, ...fullPath);
          await runTransaction(plan.target, async tx => {
            assertCurrent(plan.selection);
            const prior = (await tx.get(ref)).data();
            assertCurrent(plan.selection);
            if (pickGate(prior, gate, attempts) !== gate) return;
            const words = gate.loadedWordKeys?.map(key => wordStates.get(key)) || [];
            let saved = gate;
            if (gate.status === 'learning' && words.length && words.every(Boolean)) {
              const next = evidence.computeGateReadiness(words, gate);
              saved = { ...gate, status: next.status, readyEvidenceCount: next.readyWordCount, readyWordCount: next.readyWordCount,
                requiredWordCount: next.requiredWordCount, evidenceStepCount: next.evidenceStepCount,
                totalEvidenceSteps: next.totalEvidenceSteps, needsEvidenceWordCount: next.needsEvidenceWordCount,
                availableForReviewNowCount: next.availableForReviewNow, waitingLaterTodayCount: next.waitingLaterToday,
                waitingNextDayCount: next.waitingNextDay, readinessVersion: next.readinessVersion,
                readinessNextAt: next.nextAvailabilityAt ? new Date(next.nextAvailabilityAt) : null,
                runnerReviewDueWordKeys: words.filter(word => {
                  const state = evidence.getWordGateReadiness(word);
                  return !state.ready && (!state.nextEligibleAt || state.nextEligibleAt <= Date.now());
                }).map(word => word.wordKey),
              };
            }
            tx.set(ref, imported(saved));
            if (proof) tx.set(userDoc(plan.target, plan.targetUid, ...fullPath, 'readiness', 'proof'), imported(proof));
          });
        }
        for (const gateId of union(incoming.keys(), existing.keys())) {
          const receipt = 'xp_event_motivation_' + await sha256(`gate:${id}/${rankId}/${gateId}`);
          if (allReceipts.get(receipt)?.reason === 'motivation_gate_counted') gateReceipts++;
        }
      }
      if (gateReceipts) counted.set(`world:${id}`, gateReceipts);
      const ref = userDoc(plan.target, plan.targetUid, ...path);
      await writeRows(plan, [{ ref, stamp: true, merge: prior => mergeJourney(prior, journey, order) }]);
    }
    if (sourcePointer?.worldId && plan.journeys.has(sourcePointer.worldId)) {
      await writeRows(plan, [insert(plan, ['meta', 'active_content_journey'], sourcePointer)]);
    }
    return counted;
  }

  async function creditBalance(plan, counted, existing) {
    const incoming = plan.sourceReceipts;
    const consumed = new Set([...incoming, ...existing].filter(([id]) => id.startsWith(consumedPrefix))
      .map(([id]) => decodeURIComponent(id.slice(consumedPrefix.length))));
    return runTransaction(plan.target, async tx => {
      assertCurrent(plan.selection);
      const profile = profileRef(plan.target, plan.targetUid);
      const [balance, receipt] = await Promise.all([tx.get(profile), tx.get(receiptRef(plan))]);
      assertCurrent(plan.selection);
      if (receipt.exists()) return receipt.data();
      const target = balance.data() || {};
      const xpDeduplicated = Math.min(number(plan.guest.userXP), duplicateXP(incoming, existing));
      const coverage = mergeGuideCoverage(plan.guest.onboardingProgress?.[GUIDE_TOUR],
        readGuideCoverage(globalThis.localStorage, plan.sourceUid));
      const guest = coverage ? { ...plan.guest, onboardingProgress: { ...plan.guest.onboardingProgress, [GUIDE_TOUR]: coverage } } : plan.guest;
      const merged = mergeProfile(target, guest, xpDeduplicated, consumed, counted);
      tx.set(profile, { ...merged, _syncRevision: number(target._syncRevision) + 1, updatedAt: serverTimestamp() });
      const amounts = { sourceUid: plan.sourceUid, sourceXP: number(plan.guest.userXP), xpDeduplicated,
        xpAdded: number(plan.guest.userXP) - xpDeduplicated, runnerCoinsAdded: number(plan.guest.runnerCoins),
        botsCoinsAdded: number(plan.guest.lootBots?.coins) };
      tx.set(receiptRef(plan), { ...amounts, balanceAppliedAt: serverTimestamp() });
      return amounts;
    });
  }

  async function commit(plan, onProgress = () => {}) {
    assertCurrent(plan.selection);
    if (plan.completed || !await authorize(plan)) return;
    // Complete the transferable documents before applying balances. The
    // receipt is written atomically with the profile even if Auth is lost.
    if (!plan.receipt) {
      onProgress('words');
      const wordStates = await copyWords(plan);
      onProgress('journeys');
      const targetReceipts = await receipts(plan.target, plan.targetUid);
      const counted = await copyJourneys(plan, wordStates, targetReceipts);
      await creditBalance(plan, counted, targetReceipts);
    }
    onProgress('finalizing');
    await writeRows(plan, [...plan.sourceReceipts].filter(([id, value]) =>
      id.startsWith(consumedPrefix) ? value.type === 'profile-extra-consumed-v1' :
        duplicateReasons.has(value.reason) || value.reason === 'motivation_gate_counted')
      .map(([id, value]) => insert(plan, ['meta', id], value)));
    await runTransaction(plan.target, async tx => {
      assertCurrent(plan.selection);
      const receipt = await tx.get(receiptRef(plan));
      assertCurrent(plan.selection);
      if (receipt.data()?.completedAt) return;
      tx.update(receiptRef(plan), { completedAt: serverTimestamp() });
      tx.delete(permitRef(plan));
    });
  }

  return Object.freeze({ preview, commit });
}
