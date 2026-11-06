(function(root) {
  'use strict';
  const P = root.LootLinguaMotivationPolicy;
  const PREFIX = 'lootlinguaMotivation_v1_';
  const owner = () => root.auth?.currentUser?.uid || 'guest';
  const generation = () => Number(root.__lootlinguaAuthGeneration) || 0;
  const element = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const button = (text, action) => { const node = element('button', 'motivation-button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
  function read(id = owner()) { try { return P.normalize(JSON.parse(localStorage.getItem(PREFIX + id) || '{}')); } catch { return P.normalize(); } }
  let state = read(), stateOwner = owner(), revision = -1, timer, celebrationTimer, activeJob = null, pending = false;
  let pendingTitles = [], pendingAwards = [], dialog = null, historyLimit = 20;
  const queuedGates = new Map();
  function current() { if (stateOwner !== owner()) { stateOwner = owner(); state = read(); revision = -1; } return state; }
  function save(next) {
    state = P.normalize(next); stateOwner = owner();
    try { localStorage.setItem(PREFIX + stateOwner, JSON.stringify(state)); }
    catch (error) { if (stateOwner === 'guest') throw error; console.warn('[Motivation] Local display cache unavailable.', error); }
  }
  function announce(awards) {
    const store = root.LootLinguaNotificationStore;
    if (!store || store.currentOwner() !== owner()) return;
    for (const award of awards.slice().sort((a, b) => b.at - a.at).slice(0, 50)) {
      const key = `motivation:${award.id}`;
      if (store.find(store.deterministicId(owner(), key))) continue;
      try { store.upsert({ ownerId: owner(), kind: 'legacy', notificationType: 'achievement.motivation',
        occurrenceKey: key, title: award.title, message: `${award.reason} +${award.xp} XP إضافية.`,
        priority: 80, visualType: 'success', status: 'active', createdAt: award.at,
        cta: { id: 'open-motivation-rewards', label: 'سجل المكافآت' }, context: { rewardId: award.id } }); }
      catch (error) { console.warn('[Motivation] Notification deferred; the reward is already saved.', error); }
    }
  }
  function acceptProfile(profile, uid) {
    if (!uid || uid !== owner() || !profile?.motivationRewards) return;
    const nextRevision = Number(profile._syncRevision) || 0;
    if (nextRevision < revision) return;
    revision = nextRevision;
    save(profile.motivationRewards); announce(Object.values(state.rewards)); render();
  }
  function schedule(delay = 300) { clearTimeout(timer); timer = setTimeout(() => void reconcile(), delay); }
  async function reconcile() {
    const id = owner(), gen = generation(); current();
    if (activeJob?.id === id && activeJob.gen === gen) { pending = true; return; }
    if (root.isInitialLoad || root.__applyingCloudProfile || root.__profileHydrating || Number(root.__lootlinguaQuizLearningCommitDepth) > 0) return;
    if (id !== 'guest' && !root.LootLinguaMotivationCloud) return;
    const job = { id, gen }; activeJob = job; pending = false;
    const gates = [...queuedGates.values()].slice(0, 12); let succeeded = false;
    try {
      let result;
      if (id === 'guest') {
        const work = () => {
          if (owner() !== id || generation() !== gen) throw new Error('motivation/owner-changed');
          const local = read('guest'), mastery = root.readSharedWordMasteryStore?.('guest') || {};
          const next = P.advance(local, mastery), at = Date.now();
          for (const award of next.awards) next.state.rewards[award.id] = { ...award, at };
          const amount = next.awards.reduce((total, award) => total + award.xp, 0);
          save(next.state);
          if (amount) root.applyXPDelta?.(amount);
          return { state: next.state, awarded: next.awards.map(award => ({ ...award, at })) };
        };
        result = root.navigator?.locks ? await navigator.locks.request('lootlingua-motivation-guest', work) : work();
      } else result = await root.LootLinguaMotivationCloud.claim({ gates, expectedUid: id });
      if (owner() !== id || generation() !== gen) return;
      succeeded = true;
      gates.forEach(gate => queuedGates.delete([gate.worldId, gate.rankId, gate.gateId].join('/')));
      if (id !== 'guest') {
        const xp = Number(root.getLootlinguaProfilePayload?.().userXP) || 0;
        if (result.userXP > xp) root.applyXPDelta?.(result.userXP - xp);
        if (Number(result.revision) >= revision) { revision = result.revision; save(result.state); }
      }
      document.querySelectorAll('.motivation-sync-error').forEach(node => node.remove());
      announce(Object.values(current().rewards));
      pendingAwards.push(...result.awarded);
      render(); queueCelebration();
    } catch (error) {
      if (owner() !== id || generation() !== gen) return;
      console.warn('[Motivation] Reward confirmation deferred.', error?.code || error?.message || error);
      const panel = document.getElementById('motivationRewardsPanel');
      if (panel && !panel.querySelector('.motivation-sync-error')) {
        const notice = element('p', 'motivation-sync-error', 'تعذّر تأكيد المكافآت الآن. تقدّم تعلّمك محفوظ، وسنعيد المحاولة عند الاتصال. ');
        notice.append(button('إعادة المحاولة', () => schedule(0))); panel.append(notice);
      }
    } finally {
      if (activeJob === job) { activeJob = null; if (pending || succeeded && queuedGates.size) schedule(500); }
    }
  }
  function observeGates(world, rank, progress) {
    if (owner() === 'guest') return;
    for (const item of progress instanceof Map ? progress.values() : (Array.isArray(progress) ? progress : [])) {
      if (item?.clearedBy !== 'gate-clear' || item.lastClearResult !== 'passed' || !['cleared', 'mastered'].includes(item.status)) continue;
      const gate = { worldId: String(world.worldId), rankId: String(item.rankId || rank.rankId), gateId: String(item.gateId || ''), worldLabel: world.title || 'العالم' };
      if (gate.gateId) queuedGates.set([gate.worldId, gate.rankId, gate.gateId].join('/'), gate);
    }
    if (queuedGates.size) schedule();
  }
  function openHistory() { root.loadTreasureView?.(); setTimeout(() => document.getElementById('motivationRewardsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }
  function makeGoal(worldId, progress, context = {}) {
    if (worldId && progress?.clearedBy === 'gate-clear') observeGates({ worldId }, { rankId: progress.rankId }, [progress]);
    const node = element('aside', 'motivation-goal'); node.dataset.motivationGoal = ''; if (worldId) node.dataset.worldId = worldId;
    if (context.gateCount) node.dataset.gateCount = String(context.gateCount);
    if (context.complete) node.dataset.complete = 'true';
    if (progress?.readinessNextAt) node.dataset.reviewAt = String(progress.readinessNextAt?.toMillis?.() ?? progress.readinessNextAt);
    renderGoal(node); return node;
  }
  function renderGoal(node) {
    const data = current(), worldId = node.dataset.worldId;
    const mastery = P.nextMastery(data), station = worldId ? P.nextStation(data, worldId, { availableCount: node.dataset.gateCount, complete: node.dataset.complete === 'true' }) : null;
    const goal = station && (station.remaining <= 1 || !mastery || mastery.remaining > 3) ? station : mastery;
    node.replaceChildren();
    if (!goal) { node.append(element('strong', '', 'أكملت مراحل مكافآت الإتقان!'), button('سجل المكافآت', openHistory)); return; }
    const copy = element('div', 'motivation-goal-copy');
    copy.append(element('small', '', goal.kind === 'station' ? 'محطتك القادمة' : 'هدف الإتقان القادم'),
      element('strong', '', goal.kind === 'station' ? `${goal.count} / ${goal.target} بوابات — مكافأة ${goal.xp} XP` : `${goal.count} / ${goal.target} كلمات — مكافأة ${goal.xp} XP`));
    const waiting = Number(node.dataset.reviewAt) > Date.now();
    copy.append(element('span', '', !goal.remaining ? 'اكتمل الهدف؛ المكافأة بانتظار تأكيد الحفظ.' : waiting && goal.kind === 'station' ? 'تقدّمك محفوظ. تابع بعد حلول موعد المراجعة الموثّقة.' : goal.kind === 'station' ? `باقي ${goal.remaining} بوابات مكتملة في هذا العالم للمكافأة.` : `باقي ${goal.remaining} كلمات مختلفة لإتقانها لأول مرة.`));
    const meter = element('progress'); meter.max = goal.target; meter.value = Math.min(goal.count, goal.target); meter.setAttribute('aria-label', 'التقدم نحو المكافأة'); copy.append(meter);
    node.append(copy, button('سجل المكافآت', openHistory));
  }
  function render() {
    document.querySelectorAll('[data-motivation-goal]').forEach(renderGoal);
    const panel = document.getElementById('motivationRewardsPanel'); if (!panel) return;
    const rewards = Object.values(current().rewards).sort((a, b) => b.at - a.at);
    panel.replaceChildren(element('h3', '', 'إنجازاتك ومكافآت التعلّم'), makeGoal());
    const guide = element('p', 'motivation-guide', 'مكافآت إضافية: 10 كلمات ← 20 XP · 25 ← 35 XP · 50 ← 60 XP · 100 ← 100 XP. وكل 3 بوابات تجتازها بالتعلّم في العالم تمنح 25 XP. كل إنجاز يُصرف مرة واحدة.');
    panel.append(guide);
    if (!rewards.length) panel.append(element('p', '', 'أول إنجاز قادم! تقدّمك نحو المكافأة ظاهر بالأعلى.'));
    for (const award of rewards.slice(0, historyLimit)) {
      const row = element('article', 'motivation-history-row'), copy = element('div');
      copy.append(element('strong', '', award.title), element('span', '', award.reason), element('small', '', new Date(award.at).toLocaleDateString('ar')));
      row.append(copy, element('b', '', `+${award.xp} XP`)); panel.append(row);
    }
    if (rewards.length > historyLimit) panel.append(button('عرض المزيد', () => { historyLimit += 20; render(); }));
  }
  function blocked() {
    return document.hidden || activeJob || root.__entryExperienceActive || root.__lootlinguaRunnerInputActive || root.__applyingCloudProfile ||
      (typeof activeQuizSession !== 'undefined' && activeQuizSession) || Number(root.__lootlinguaQuizLearningCommitDepth) > 0 ||
      document.querySelector('.modal.show, .modal.visible, .profile-modal.show, .smart-loading-overlay.visible');
  }
  function queueCelebration() {
    clearTimeout(celebrationTimer);
    if (!pendingTitles.length && !pendingAwards.length || dialog) return;
    celebrationTimer = setTimeout(() => {
      if (blocked()) { queueCelebration(); return; }
      showCelebration();
    }, 900);
  }
  function showCelebration() {
    const awards = [...new Map(pendingAwards.map(item => [item.id, item])).values()]; pendingAwards = [];
    const titles = [...new Map(pendingTitles.map(item => [item.id, item])).values()]; pendingTitles = [];
    if (!awards.length && !titles.length) return;
    const shell = element('section', 'motivation-celebration'); shell.id = 'motivationCelebration';
    shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); shell.setAttribute('aria-labelledby', 'motivationCelebrationTitle');
    const card = element('div', 'motivation-celebration-card'); card.tabIndex = -1;
    card.append(element('span', 'motivation-emblem', awards.some(item => item.kind === 'station') ? '✦' : '◆'), element('small', '', 'إنجاز يستحق الاحتفال'));
    const heading = element('h2', '', awards.length === 1 ? awards[0].title : awards.length ? 'تعلّمك أثمر!' : 'فتحت لقبًا جديدًا'); heading.id = 'motivationCelebrationTitle'; card.append(heading);
    const summary = element('div', 'motivation-celebration-summary');
    for (const award of awards) summary.append(element('p', '', award.reason));
    if (awards.length) summary.append(element('strong', 'motivation-xp', `+${awards.reduce((sum, item) => sum + item.xp, 0)} XP إضافية`));
    for (const title of titles) summary.append(element('p', '', `لقب جديد: ${title.name} — ${title.how}`));
    const next = P.nextMastery(current());
    if (next && awards.some(item => item.kind === 'mastery')) summary.append(element('p', '', `الهدف القادم: ${next.target} كلمة — تقدّمك ${next.count}/${next.target}.`));
    card.append(summary);
    const close = () => { if (dialog !== shell) return; root.LootLinguaModalFocus?.close(shell); root.unlockBackgroundScroll?.('motivation'); shell.remove(); dialog = null; queueCelebration(); };
    const actions = element('div', 'motivation-actions');
    if (titles.length) actions.append(button('استخدم اللقب', () => { root.setActiveLootlinguaTitle?.(titles[0].id); close(); }));
    actions.append(button('متابعة', close), button('سجل المكافآت', () => { close(); openHistory(); }));
    card.append(actions); shell.append(card); document.body.append(shell); dialog = shell;
    root.lockBackgroundScroll?.('motivation'); root.LootLinguaModalFocus?.open(shell, { dialog: card, onEscape: close });
    actions.querySelector('button')?.focus();
    if (!root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) root.launchConfetti?.();
  }
  root.LootLinguaMotivation = Object.freeze({ getState: () => P.normalize(current()), getGuestState: () => read('guest'),
    isLearningCommitActive: () => Boolean(activeJob?.id === owner() && activeJob.gen === generation() || typeof activeQuizSession !== 'undefined' && activeQuizSession),
    acceptProfile, reconcile, observeGates, makeGoal, render, openHistory,
    queueTitles(titles) { pendingTitles.push(...titles); queueCelebration(); return true; } });
  root.addEventListener('lootlingua:trusted-quiz-completed', () => schedule(500));
  root.addEventListener('lootlingua:initial-data-ready', () => schedule(700));
  root.addEventListener('lootlingua:motivation-cloud-ready', () => schedule(1200));
  root.addEventListener('lootlingua:profile-snapshot', event => acceptProfile(event.detail?.data, event.detail?.uid));
  root.addEventListener('lootlingua:word-mastery-snapshot', () => schedule(700));
  root.addEventListener('online', () => schedule(200));
  root.addEventListener('lootlingua:auth-state', () => {
    clearTimeout(timer); clearTimeout(celebrationTimer); pendingAwards = []; pendingTitles = []; queuedGates.clear(); pending = false;
    if (dialog) { root.LootLinguaModalFocus?.close(dialog); root.unlockBackgroundScroll?.('motivation'); dialog.remove(); dialog = null; }
    stateOwner = owner(); state = read(); revision = -1; render();
  });
  root.addEventListener('storage', event => { if (event.key === PREFIX + owner()) { state = read(); render(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { render(); schedule(1500); }, { once: true });
  else { render(); schedule(1500); }
})(window);
