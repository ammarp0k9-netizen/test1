import { applyProfileIntent, TREASURE_CAPACITY, TREASURE_TYPES, treasureChests, treasureSlots } from './profile-sync-policy.mjs?v=20261113-treasure-v1';

const root = window;
const guestKey = 'lootlingua:guest-treasure:v1';
const owner = () => root.auth?.currentUser?.uid || 'guest';
const generation = () => Number(root.__lootlinguaAuthGeneration) || 0;
const byId = id => document.getElementById(id);
let pending = false;
let clock;
let lastDraw = '';

function readGuest() {
  const record = JSON.parse(localStorage.getItem(guestKey) || '{}');
  return record && typeof record === 'object' ? record : {};
}

function finishGuestReward(vault) {
  if (!vault.pendingReward) return vault;
  const { userXP, streakFreezes } = vault.pendingReward;
  root.applyCanonicalLootlinguaProfile({
    userXP, streakFreezes: Math.max(streakFreezes, getStreakFreezeCount()),
  });
  delete vault.pendingReward;
  localStorage.setItem(guestKey, JSON.stringify(vault));
  return vault;
}

function profile() {
  if (owner() === 'guest') {
    try { return readGuest(); } catch { return {}; }
  }
  const snapshot = root.__lootlinguaProfileSnapshot;
  return snapshot?.uid === owner() && !snapshot.readFailed ? snapshot.data || {} : null;
}

function describe(chest) {
  const type = TREASURE_TYPES[chest.kind];
  return `صندوق ${type.label} · ${type.minXP}–${type.maxXP} XP · فرصة تجميد السلسلة ${Math.round(type.freezeChance * 100)}٪`;
}

async function commit(command) {
  const uid = owner(), session = generation();
  const isCurrent = () => owner() === uid && generation() === session;
  try {
    if (uid !== 'guest') {
      const result = await root.commitProfileIntent?.(command);
      return isCurrent() && result?.saved ? result : { reason: isCurrent() ? 'save-failed' : 'owner-changed' };
    }
    const work = () => {
      if (!isCurrent()) return { reason: 'owner-changed' };
      const guest = finishGuestReward(readGuest());
      const current = root.getLootlinguaProfilePayload();
      const next = applyProfileIntent({
        ...guest, motivationRewards: root.LootLinguaMotivation?.getGuestState?.(),
        userXP: current.userXP, streakFreezes: current.streakFreezes,
      }, command);
      if (next.reason) return { reason: next.reason };
      const { reward } = next.effects;
      const { extraChests, extraChestState } = next.profile;
      const vault = { extraChests, extraChestState };
      if (reward) vault.pendingReward = { userXP: next.profile.userXP, streakFreezes: next.profile.streakFreezes };
      localStorage.setItem(guestKey, JSON.stringify(vault));
      markGuestDataDirty();
      finishGuestReward(vault);
      return { applied: true, reward };
    };
    return navigator.locks ? await navigator.locks.request(guestKey, work) : work();
  } catch (error) {
    console.warn('[Treasure] Could not confirm chest action.', error?.message || error);
    return { reason: 'save-failed' };
  } finally {
    if (isCurrent()) {
      refresh();
      root.dispatchEvent(new Event('lootlingua:treasure-changed'));
    }
  }
}

function awardRolls() {
  return { xpRoll: Math.random(), freezeRoll: Math.random() };
}

async function training(game, runId, score) {
  if (!runId || score < (game === 'runner' ? 3 : 1)) return '';
  const day = todayStr();
  const result = await commit({ type: 'treasure-training', day, eventId: `${day}:${game}:${runId}`, game, score, ...awardRolls() });
  if (result.applied) return 'كسبت صندوق تدريب. يجهز بعد 20 دقيقة.';
  if (result.reason === 'treasure-full') return 'الخزنة ممتلئة. افتح صندوقًا لتكسب صندوق تدريب في جولة قادمة.';
  if (result.reason === 'training-already-earned') return 'استلمت صندوق التدريب لهذا اليوم.';
  if (result.reason === 'save-failed') return 'تعذّر تأكيد صندوق التدريب الآن. راجع الخزنة بعد المزامنة.';
  return '';
}

function achievement(award) {
  return { type: 'treasure-achievement', awardId: award.id, eventId: root.crypto.randomUUID(), ...awardRolls() };
}

function pendingAchievements() {
  const data = profile();
  const state = data?.extraChestState || {};
  const awards = owner() === 'guest' ? root.LootLinguaMotivation?.getState?.()?.rewards : data?.motivationRewards?.rewards;
  return Object.values(awards || {})
    .filter(award => ['mastery', 'station'].includes(award.kind) && !Object.hasOwn(state.achievements || {}, award.id));
}

async function offerAchievements(awards) {
  const uid = owner(), session = generation();
  for (const award of awards) {
    if (uid !== owner() || session !== generation() || treasureChests(profile()).length >= TREASURE_CAPACITY) break;
    const result = await commit(achievement(award));
    if (result.reason === 'treasure-full' || result.reason === 'save-failed') break;
  }
}

function actionButton(label, callback) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
}

async function runAction(command) {
  if (pending) return;
  pending = true;
  const uid = owner(), session = generation();
  const panel = byId('treasureVault');
  panel?.setAttribute('aria-busy', 'true');
  try {
    const result = await commit(command);
    if (uid !== owner() || session !== generation()) return;
    if (result.reward && result.applied) {
      const { xp, freezes } = result.reward;
      root.showToast?.(`فتحت الصندوق وحصلت على ${xp} XP${freezes ? ' وتجميد سلسلة' : ''}.`, 'success', { persist: false });
      root.launchConfetti?.();
      if (typeof renderLootSummary === 'function') renderLootSummary();
    } else if (result.reason === 'treasure-full') {
      root.showToast?.('الخزنة ممتلئة. افتح صندوقًا لتستلم مكافأتك.', 'info', { persist: false });
    } else if (result.reason === 'extra-chest-waiting') {
      root.showToast?.('هذا الصندوق لسه بانتظار موعده.', 'info', { persist: false });
    } else if (result.reason === 'save-failed') {
      root.showToast?.('تعذّر تأكيد العملية الآن. راجع الخزنة بعد المزامنة.', 'warning', { persist: false });
    }
  } finally {
    pending = false;
    panel?.removeAttribute('aria-busy');
    refresh();
    if (uid === owner() && session === generation() && panel?.isConnected &&
        document.activeElement === document.body && !panel.closest('[inert]')) {
      byId('treasureVaultHeading')?.focus({ preventScroll: true });
    }
  }
}

function draw() {
  const grid = byId('treasureSlots');
  if (!grid) return;
  const data = profile();
  const slots = treasureSlots(data);
  const chests = slots.filter(Boolean);
  const awards = data ? pendingAchievements() : [];
  const transfers = data?.extraChestState?.transferred || [];
  const now = Date.now(), full = chests.length >= TREASURE_CAPACITY;
  const signature = JSON.stringify([owner(), !!data, slots.map(chest => chest && [chest.id, chest.readyAt <= now]), awards.map(award => award.id), transfers.map(chest => chest.id)]);
  if (lastDraw !== signature) {
    lastDraw = signature;
    byId('treasureVaultCapacity').textContent = `${chests.length}/${TREASURE_CAPACITY}`;
    grid.replaceChildren();
    for (let index = 0; index < TREASURE_CAPACITY; index++) {
      const chest = slots[index];
      const slot = document.createElement(chest ? 'button' : 'span');
      slot.className = 'treasure-vault-slot';
      const icon = document.createElement('span');
      icon.className = 'treasure-vault-icon';
      icon.setAttribute('aria-hidden', 'true');
      slot.append(icon);
      if (chest) {
        slot.type = 'button';
        slot.dataset.kind = chest.kind;
        slot.dataset.chestId = chest.id;
        const ready = chest.readyAt <= now;
        slot.classList.toggle('is-ready', ready);
        slot.setAttribute('aria-label', `${describe(chest)} · ${ready ? 'جاهز للفتح' : 'بانتظار موعد الفتح'}`);
        const name = document.createElement('strong'), time = document.createElement('small');
        name.textContent = TREASURE_TYPES[chest.kind].label;
        time.dataset.chestTime = '';
        slot.append(name, time);
        slot.addEventListener('click', () => {
          if (chest.readyAt <= Date.now()) void runAction({ type: 'treasure-open', chestId: chest.id, eventId: root.crypto.randomUUID() });
          else root.showToast?.(`${describe(chest)}. يفتح بعد ${formatLootTime(chest.readyAt - Date.now())}.`, 'info', { persist: false });
        });
      } else slot.setAttribute('aria-label', 'خانة فارغة');
      grid.append(slot);
    }
    const deferred = byId('treasureVaultDeferred');
    deferred.replaceChildren();
    if (!data) deferred.textContent = 'جارٍ تحميل خزنة حسابك…';
    else if (awards.length || transfers.length) {
      const total = awards.length + transfers.length;
      const text = document.createElement('p');
      text.textContent = full ? `الخزنة ممتلئة. لديك ${total} مكافآت محفوظة بانتظار خانة.` : `مكافآت بانتظار الاستلام · ${total}`;
      deferred.append(text);
      if (!full) {
        const transfer = transfers[0], award = awards[0];
        const label = transfer ? `استلم صندوق ${TREASURE_TYPES[transfer.kind]?.label || 'الضيف'}` : `استلم صندوق ${TREASURE_TYPES[award.kind].label} · ${award.title}`;
        deferred.append(actionButton(label, () => void runAction(transfer
          ? { type: 'treasure-recover', chestId: transfer.id, eventId: root.crypto.randomUUID() } : achievement(award))));
      }
    }
  }
  slots.forEach((chest, index) => {
    if (!chest) return;
    const time = grid.children[index]?.querySelector('[data-chest-time]');
    if (!time) return;
    const text = chest.readyAt <= now ? 'افتح' : formatLootTime(chest.readyAt - now);
    if (time.textContent !== text) time.textContent = text;
  });
}

function facts(now = Date.now()) {
  const data = profile();
  if (!data) return { complete: false };
  const chests = treasureChests(data);
  const ready = chests.filter(chest => chest.readyAt <= now);
  return {
    complete: true,
    count: ready.length,
    readyAt: ready.length ? Math.min(...ready.map(chest => chest.readyAt)) : 0,
    readyKey: ready.map(chest => chest.id).sort().join('|'),
    nextAt: chests.filter(chest => chest.readyAt > now).reduce((next, chest) => Math.min(next || chest.readyAt, chest.readyAt), 0),
  };
}

function refresh() {
  clearInterval(clock);
  const view = byId('treasureView');
  if (view && view.style.display !== 'none') {
    draw();
    clock = setInterval(() => {
      if (view.style.display === 'none') { clearInterval(clock); return; }
      draw();
    }, 1000);
  }
  root.LootLinguaNotificationRuntime?.requestEvaluation?.('treasure-vault');
}

root.LootLinguaTreasure = Object.freeze({
  refresh, facts, training, offerAchievements,
  hasPendingAchievement: id => pendingAchievements().some(award => award.id === id),
  canClaimAchievement: () => !!profile() && treasureChests(profile()).length < TREASURE_CAPACITY,
  claimAchievement: award => runAction(achievement(award)),
  guestProfile() {
    try {
      const { extraChests, extraChestState } = owner() === 'guest' ? finishGuestReward(readGuest()) : readGuest();
      return extraChestState || extraChests?.length ? { extraChests: extraChests || [], extraChestState: extraChestState || {} } : null;
    } catch { return null; }
  },
});
for (const name of ['lootlingua:auth-state', 'lootlingua:profile-loaded', 'lootlingua:surface-ready']) {
  root.addEventListener(name, refresh);
}
root.addEventListener('storage', event => { if (event.key === guestKey && owner() === 'guest') refresh(); });
if (owner() === 'guest') {
  try { finishGuestReward(readGuest()); } catch (error) { console.warn('[Treasure] Guest reward will be retried.', error?.message || error); }
}
refresh();
