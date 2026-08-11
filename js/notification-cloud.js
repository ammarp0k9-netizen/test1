import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const app = getApps()[0];
const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeNotifications = null;
let subscriptionGeneration = 0;

function timeValue(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Math.max(0, Number(value) || 0);
}

function dateOrNull(value) {
  const time = timeValue(value);
  return time > 0 ? new Date(time) : null;
}

function cleanMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item) || item === null)
    .map(([key, item]) => [String(key).slice(0, 80), typeof item === 'string' ? item.slice(0, 500) : item]));
}

function serialize(record, uid) {
  const normalized = window.LootLinguaNotificationStore.normalizeRecord(record, uid);
  return {
    id: normalized.id,
    schemaVersion: normalized.schemaVersion,
    ownerId: uid,
    kind: normalized.kind,
    notificationType: normalized.notificationType,
    occurrenceKey: normalized.occurrenceKey,
    actionGroup: normalized.actionGroup,
    priority: normalized.priority,
    severity: normalized.severity,
    status: normalized.status,
    visualType: normalized.visualType,
    title: normalized.title,
    message: normalized.message,
    cta: normalized.cta ? {
      id: normalized.cta.id,
      label: normalized.cta.label,
      args: cleanMap(normalized.cta.args),
    } : null,
    context: cleanMap(normalized.context),
    createdAt: dateOrNull(normalized.createdAt),
    updatedAt: dateOrNull(normalized.updatedAt),
    eligibleSince: dateOrNull(normalized.eligibleSince),
    eligibleAt: dateOrNull(normalized.eligibleAt),
    firstShownAt: dateOrNull(normalized.firstShownAt),
    lastShownAt: dateOrNull(normalized.lastShownAt),
    showCount: normalized.showCount,
    shownSlots: normalized.shownSlots.slice(0, 12),
    readAt: dateOrNull(normalized.readAt),
    resolvedAt: dateOrNull(normalized.resolvedAt),
    dismissedAt: dateOrNull(normalized.dismissedAt),
    resolutionReason: normalized.resolutionReason,
    expiresAt: dateOrNull(normalized.expiresAt),
    policyVersion: normalized.policyVersion,
  };
}

async function writeOne(record, expectedUid) {
  const user = auth.currentUser;
  if (!user || user.uid !== expectedUid) return false;
  const target = doc(db, 'users', user.uid, 'notifications', String(record.id));
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(target);
    const merged = snapshot.exists()
      ? window.LootLinguaNotificationStore.mergePair(snapshot.data(), record, user.uid)
      : window.LootLinguaNotificationStore.normalizeRecord(record, user.uid);
    transaction.set(target, serialize(merged, user.uid));
  });
  return true;
}

async function writeRecords(values) {
  const user = auth.currentUser;
  if (!user) return false;
  const uid = user.uid;
  const unique = [...new Map((Array.isArray(values) ? values : [])
    .filter((record) => record?.id)
    .map((record) => [String(record.id), record])).values()];
  for (const record of unique) await writeOne(record, uid);
  return true;
}

async function migrateRecords(values) {
  return writeRecords(values);
}

async function latestTrustedQuizAt() {
  const user = auth.currentUser;
  if (!user) return 0;
  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, 'quizEvidenceSessions'),
    orderBy('completedAt', 'desc'),
    limit(1)
  ));
  return snapshot.empty ? 0 : timeValue(snapshot.docs[0].data()?.completedAt);
}

function stopSubscription() {
  subscriptionGeneration += 1;
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
}

function subscribeForUser(user) {
  stopSubscription();
  if (!user) return;
  const generation = subscriptionGeneration;
  const ownerId = user.uid;
  const target = query(
    collection(db, 'users', ownerId, 'notifications'),
    orderBy('updatedAt', 'desc'),
    limit(250)
  );
  let receivedFirstSnapshot = false;
  unsubscribeNotifications = onSnapshot(target, (snapshot) => {
    if (generation !== subscriptionGeneration || auth.currentUser?.uid !== ownerId) return;
    window.LootLinguaNotificationStore?.mergeCloud(snapshot.docs.map((item) => ({
      ...(item.data() || {}),
      id: item.id,
      ownerId,
    })));
    if (!receivedFirstSnapshot) {
      receivedFirstSnapshot = true;
      // Upload local account-cache records that were created offline. Every
      // transaction performs a monotonic merge before writing.
      writeRecords(window.LootLinguaNotificationStore?.getAll?.() || []).catch((error) => {
        console.warn('[NotificationCloud] Offline cache upload deferred.', error?.message || error);
      });
    }
  }, (error) => {
    if (generation !== subscriptionGeneration) return;
    console.warn('[NotificationCloud] Snapshot unavailable; local cache remains active.', error?.message || error);
  });
}

const adapter = Object.freeze({ writeRecords, migrateRecords });
window.LootLinguaNotificationStore?.registerCloudAdapter(adapter);

const API = Object.freeze({
  writeRecords,
  migrateRecords,
  latestTrustedQuizAt,
  serialize,
  stopSubscription,
});
Object.defineProperty(window, 'LootLinguaNotificationCloud', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

onAuthStateChanged(auth, (user) => {
  const ownerId = user?.uid || 'guest';
  window.LootLinguaNotificationStore?.switchOwner(ownerId);
  subscribeForUser(user);
});

window.addEventListener('beforeunload', stopSubscription, { once: true });
