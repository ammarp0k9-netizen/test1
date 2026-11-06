import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Uses existing owner profile and immutable XP receipts. No Functions or new
// rules/collections, and no client-supplied XP amount or completion counter.
async function receiptId(key) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return 'xp_event_motivation_' + [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function claim({ gates = [], expectedUid } = {}) {
  const app = getApps()[0], auth = getAuth(app), uid = auth.currentUser?.uid;
  if (!uid || uid !== expectedUid) throw new Error('motivation/owner-changed');
  const db = getFirestore(app), policy = window.LootLinguaMotivationPolicy;
  const profileRef = doc(db, 'users', uid, 'meta', 'profile');
  const masteryRef = doc(db, 'users', uid, 'meta', 'word_mastery');
  const validGates = [...new Map(gates.filter(gate => [gate?.worldId, gate?.rankId, gate?.gateId]
    .every(id => typeof id === 'string' && id.length > 0 && id.length <= 500 && !id.includes('/')))
    .map(gate => [[gate.worldId, gate.rankId, gate.gateId].join('/'), gate])).entries()].slice(0, 12);
  const gateRefs = await Promise.all(validGates.map(async ([key, gate]) => ({ gate,
    receipt: doc(db, 'users', uid, 'meta', await receiptId(`gate:${key}`)),
    progress: doc(db, 'users', uid, 'contentProgress', gate.worldId, 'ranks', gate.rankId, 'gates', gate.gateId) })));
  return runTransaction(db, async transaction => {
    if (auth.currentUser?.uid !== uid) throw new Error('motivation/owner-changed');
    const profileSnapshot = await transaction.get(profileRef);
    const profile = profileSnapshot.data() || {};
    const snapshots = await Promise.all([Promise.resolve(profileSnapshot),
      (profile.motivationRewards?.masteredKeys?.length || 0) >= 100 ? Promise.resolve({ data: () => ({}) }) : transaction.get(masteryRef),
      ...gateRefs.flatMap(item => [transaction.get(item.receipt), transaction.get(item.progress)])]);
    const entries = snapshots[1].data()?.entries || {};
    const eligible = gateRefs.filter((item, index) => {
      const receipt = snapshots[2 + index * 2], progress = snapshots[3 + index * 2].data() || {};
      return !receipt.exists() && progress.clearedBy === 'gate-clear' &&
        progress.lastClearResult === 'passed' && ['cleared', 'mastered'].includes(progress.status);
    });
    const { state, awards } = policy.advance(profile.motivationRewards, entries, eligible.map(item => item.gate));
    const refs = await Promise.all(awards.map(async award => doc(db, 'users', uid, 'meta', await receiptId(award.id))));
    const receipts = await Promise.all(refs.map(ref => transaction.get(ref)));
    const awarded = [], now = Date.now(); let amount = 0;
    awards.forEach((award, index) => {
      const previous = receipts[index].data();
      state.rewards[award.id] = { ...award, at: Number(previous?.at) || now };
      if (!receipts[index].exists()) {
        amount += award.xp; awarded.push(state.rewards[award.id]);
        transaction.set(refs[index], { amount: award.xp, reason: 'motivation_milestone', at: now, rewardId: award.id, createdAt: new Date(now) });
      }
    });
    for (const item of eligible) transaction.set(item.receipt, { reason: 'motivation_gate_counted', amount: 0, createdAt: new Date(now) });
    const nextXP = Math.max(0, Number(profile.userXP) || 0) + amount;
    const changed = JSON.stringify(state) !== JSON.stringify(profile.motivationRewards || {});
    if (changed || amount) transaction.set(profileRef, { motivationRewards: state, userXP: nextXP,
      _syncRevision: (Number(profile._syncRevision) || 0) + 1, updatedAt: new Date(now) }, { merge: true });
    return { state, awarded, userXP: nextXP, uid, revision: (Number(profile._syncRevision) || 0) + (changed || amount ? 1 : 0) };
  });
}
window.LootLinguaMotivationCloud = Object.freeze({ claim });
window.dispatchEvent(new CustomEvent('lootlingua:motivation-cloud-ready'));
