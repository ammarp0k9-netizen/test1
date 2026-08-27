(function attachLootLinguaEntryExperienceController(root) {
  'use strict';

  const runtime = {
    initialized: false,
    bootToken: 0,
    user: null,
    state: null,
    presentation: null,
    signals: null,
    action: null,
    profile: null,
    capturedGuest: null,
    opened: false,
    settingsMode: '',
    settingsBaseState: null,
    baselinePreferences: null,
    previousFocus: null,
    inerted: [],
    savePromise: Promise.resolve(),
    intentConsuming: false,
    authPromptFocus: null,
    legacyPreferences: null,
    previewGeneration: 0,
    worldsPreview: { status: 'idle', items: [], error: null },
    structurePreview: {
      status: 'idle',
      worldId: '',
      model: null,
      error: null,
      selectedRankId: '',
      gatesStatus: 'idle',
      gates: [],
      selectedGateId: '',
      gateStatus: 'idle',
      gatePreview: null,
      gateError: null,
    },
    returnPreview: { status: 'idle', worldId: '', model: null, error: null },
    gamerGuide: null,
  };

  function api() {
    return root.LootLinguaEntryExperience;
  }

  function cloud() {
    return root.LootLinguaEntryExperienceCloud;
  }

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw || '');
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readJson(key, fallback) {
    return safeParse(localStorage.getItem(key), fallback);
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readArrayKey(key) {
    const value = readJson(key, []);
    return Array.isArray(value) ? value : [];
  }

  function readGuestWords() {
    const rows = [
      ...readArrayKey('words_normal_guest'),
      ...readArrayKey('words_gamer_guest'),
      ...readArrayKey('lootlinguaDict'),
    ];
    const seen = new Set();
    return rows.filter((word) => {
      const key = String(word?.word || word?.text || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function guestProfileSnapshot() {
    return {
      userXP: Number(localStorage.getItem('userXP')) || 0,
      dailyStreak: Number(localStorage.getItem('dailyStreak')) || 0,
      maxStreak: Number(localStorage.getItem('lootlinguaMaxStreak')) || 0,
      lastActivityDate: localStorage.getItem('lastActivityDate') || '',
      activityMap: readJson('activityMap', {}),
      quizExposureHistory: readJson('lootlinguaQuizExposureHistory_guest', []),
      theme: localStorage.getItem(api()?.themeStorageKey({}) || '') || localStorage.getItem('theme') || '',
      addedGameWords: readJson('addedGameWords', []),
      dailyLootState: readJson('lootlinguaDailyLootState', {}),
      titlesState: readJson('lootlinguaTitlesState', {}),
      streakFreezes: Number(localStorage.getItem('lootlinguaStreakFreezes')) || 0,
      freezeSaves: Number(localStorage.getItem('lootlinguaFreezeSaves')) || 0,
      gameDictAdds: Number(localStorage.getItem('lootlinguaGameDictAdds')) || 0,
      perfectQuizzes: Number(localStorage.getItem('lootlinguaPerfectQuizzes')) || 0,
      extraChests: readJson('lootlinguaExtraChests', []),
    };
  }

  function captureGuestSnapshot() {
    if (!api()) return null;
    const mastery = readJson('lootlinguaWordMastery_guest', {});
    const guestState = api().normalizeEntryState(readJson(api().entryStorageKey({}), null));
    const legacyPreferences = api().normalizeLegacyPreferences(
      readJson(api().entryStorageKey({}, 1), null)
    );
    const snapshot = {
      words: readGuestWords(),
      profile: guestProfileSnapshot(),
      activeQuizSession: readJson('active_quiz_session', null),
      srsEntryCount: mastery && typeof mastery === 'object' ? Object.keys(mastery).length : 0,
      customWorldCount: readArrayKey('custom_worlds_guest').length,
      hasLocalLearningDraft: Boolean(
        localStorage.getItem('active_quiz_session') ||
        localStorage.getItem('pending_custom_worlds_guest')
      ),
      legacyMarkers: {
        onboarding: localStorage.getItem('lootlinguaOnboarding') || '',
        emptyOnboarding: localStorage.getItem('hasCompletedOnboarding') || '',
        welcome: localStorage.getItem('lootlingua_welcome_v1_seen') || '',
      },
      entryState: guestState,
      legacyPreferences,
      capturedAt: Date.now(),
    };
    runtime.capturedGuest = snapshot;
    return snapshot;
  }

  captureGuestSnapshot();

  function identityFor(user) {
    return user?.uid ? { uid: user.uid } : {};
  }

  function localStateFor(user) {
    return api().normalizeEntryState(
      readJson(api().entryStorageKey(identityFor(user)), null)
    );
  }

  function persistLocalState(state, user) {
    const normalized = api().normalizeEntryState(state);
    if (!normalized) return;
    writeJson(api().entryStorageKey(identityFor(user)), normalized);
  }

  function recoverTerminalAsDraft(state) {
    const normalized = api().normalizeEntryState(state);
    if (!normalized || !api().isTerminalState(normalized)) return normalized;
    return api().normalizeEntryState({
      ...normalized,
      status: 'in-progress',
      currentStep: normalized.classification === 'returning-with-progress' ? 'return' : 'interests',
      journeyStatus: 'pending',
      selectedWorldId: '',
      gamerStatus: 'not-applicable',
      completedAt: 0,
      skippedAt: 0,
      updatedAt: Date.now(),
    });
  }

  function reconcileAccountDraft(cloudState, localState, cloudReadSucceeded) {
    const account = api().normalizeEntryState(cloudState);
    let local = api().normalizeEntryState(localState);
    if (account && api().isTerminalState(account)) return account;
    const accountNeedsJourneyProof = account &&
      account.status !== 'in-progress' && !api().isTerminalState(account);
    if (accountNeedsJourneyProof && local?.status === 'in-progress') return local;
    const localNeedsJourneyProof = local &&
      local.status !== 'in-progress' && !api().isTerminalState(local);
    if (accountNeedsJourneyProof && localNeedsJourneyProof) {
      // Keep the unverified terminal marker intact until boot has the current
      // learning signals. Turning two completed caches into an in-progress
      // merge here would lose whether recovery must restart at interests or use
      // the real-progress shortcut.
      return Number(local.updatedAt || 0) > Number(account.updatedAt || 0)
        ? local
        : account;
    }
    if (local && api().isTerminalState(local)) {
      if (!cloudReadSucceeded) return local;
      local = recoverTerminalAsDraft(local);
    }
    if (!account) return local;
    if (!local) return account;
    const merged = api().mergeEntryStates(account, local, {
      audience: account.audience,
      classification: account.classification,
    }).state;
    const localAppearanceIsNewer = local.themeExplicit &&
      Number(local.updatedAt || 0) >= Number(account.updatedAt || 0);
    return api().normalizeEntryState({
      ...merged,
      audience: account.audience,
      classification: account.classification,
      themeStatus: localAppearanceIsNewer ? local.themeStatus : merged.themeStatus,
      themeId: localAppearanceIsNewer ? local.themeId : merged.themeId,
      oasisMode: localAppearanceIsNewer ? local.oasisMode : merged.oasisMode,
      themeExplicit: localAppearanceIsNewer ? local.themeExplicit : merged.themeExplicit,
      source: account.source,
    });
  }

  function readGuestEntryClaim() {
    return readJson(api().guestEntryClaimStorageKey(), null);
  }

  function guestEntryCanMerge(user, guestState) {
    const claim = readGuestEntryClaim();
    if (!claim || Number(claim.guestUpdatedAt) !== Number(guestState?.updatedAt || 0)) return true;
    return claim.uid === user?.uid;
  }

  function claimGuestEntry(user, guestState) {
    if (!user?.uid || !guestState) return;
    writeJson(api().guestEntryClaimStorageKey(), {
      version: api().EXPERIENCE_VERSION,
      uid: user.uid,
      guestUpdatedAt: Number(guestState.updatedAt) || 0,
      claimedAt: Date.now(),
    });
  }

  function announceEntryState() {
    root.dispatchEvent?.(new CustomEvent('lootlingua:entry-state-ready', {
      detail: { state: runtime.state ? { ...runtime.state, interestIds: [...runtime.state.interestIds] } : null },
    }));
  }

  function srsEntryCount(user) {
    const owner = user?.uid || 'guest';
    const entries = readJson(`lootlinguaWordMastery_${owner}`, {});
    return entries && typeof entries === 'object' ? Object.keys(entries).length : 0;
  }

  function currentProfile(user) {
    const snapshot = root.__lootlinguaProfileSnapshot;
    if (user?.uid && snapshot?.uid === user.uid) return snapshot;
    if (!user) return { uid: '', exists: false, data: guestProfileSnapshot(), readFailed: false };
    return { uid: user.uid, exists: false, data: null, readFailed: true };
  }

  async function readLearningSignals(user, token) {
    let activeJourney = null;
    let hasJourneyProgress = false;
    let journeyDestination = null;
    let activeQuizSession = null;
    let learningReadFailed = false;
    if (user) {
      const journeyApi = root.LootLinguaJourneyCloud;
      try {
        if (journeyApi?.resolveAccountJourneyDestination) {
          journeyDestination = await journeyApi.resolveAccountJourneyDestination({
            resumePausedLevelPlacement: true,
          });
          activeJourney = journeyDestination?.classification === 'actionable-journey'
            ? journeyDestination.journey
            : null;
        } else if (journeyApi?.getActiveJourney) {
          activeJourney = await journeyApi.getActiveJourney();
        }
        if (token !== runtime.bootToken) return null;
        hasJourneyProgress = Boolean(
          activeJourney || journeyDestination?.classification === 'world-completed'
        );
        if (!hasJourneyProgress && journeyApi?.hasAnyJourneyProgress) {
          hasJourneyProgress = await journeyApi.hasAnyJourneyProgress();
        }
        if (token !== runtime.bootToken) return null;
        if (!journeyDestination && activeJourney?.worldId && journeyApi?.resolveActiveJourneyDestination) {
          try {
            journeyDestination = await journeyApi.resolveActiveJourneyDestination(
              activeJourney.worldId,
              { resumePausedLevelPlacement: true }
            );
          } catch (_) {
            // The preserved active Journey remains the safe fallback CTA.
          }
        }
      } catch (_) {
        learningReadFailed = true;
      }
      try {
        if (typeof root.loadActiveQuizSessionFromCloud === 'function') {
          activeQuizSession = await root.loadActiveQuizSessionFromCloud();
        }
      } catch (_) {
        learningReadFailed = true;
      }
    } else {
      activeQuizSession = readJson('active_quiz_session', null);
    }
    if (token !== runtime.bootToken) return null;
    return {
      activeJourney,
      hasJourneyProgress,
      journeyDestination,
      activeQuizSession,
      learningReadFailed,
    };
  }

  async function loadAccountEntry(user, token) {
    const local = localStateFor(user);
    let legacyPreferences = api().normalizeLegacyPreferences(
      readJson(api().entryStorageKey(identityFor(user), 1), null)
    );
    let account = local;
    let cloudReadFailed = false;
    let cloudReadSucceeded = false;
    if (cloud()?.load) {
      try {
        const result = await cloud().load(user);
        if (token !== runtime.bootToken) return { state: null, cloudReadFailed: true };
        cloudReadSucceeded = true;
        account = reconcileAccountDraft(result.state, local, true);
      } catch (error) {
        if (error?.code === 'entry/auth-changed') return { state: null, cloudReadFailed: true };
        cloudReadFailed = true;
      }
    }
    if (!account && cloud()?.loadLegacyPreferences) {
      try {
        const legacy = await cloud().loadLegacyPreferences(user);
        if (token !== runtime.bootToken) return { state: null, legacyPreferences: null, cloudReadFailed: true };
        legacyPreferences = legacy.preferences || legacyPreferences;
      } catch (error) {
        if (error?.code === 'entry/auth-changed') return { state: null, legacyPreferences: null, cloudReadFailed: true };
      }
    }

    let guest = runtime.capturedGuest?.entryState || null;
    if (guest && guest.status !== 'in-progress' && !api().isTerminalState(guest)) {
      // A malformed v2 terminal snapshot carries no required Journey proof.
      // Recover it as a draft instead of suppressing Product Entry.
      guest = api().recoverUnverifiedTerminal(guest, {
        classification: 'returning-guest-with-local-data',
      });
    }
    if (guest && guestEntryCanMerge(user, guest)) {
      const merged = api().mergeEntryStates(account, guest, {
        audience: account?.audience || 'returning-guest',
        classification: account?.classification || 'returning-guest-with-local-data',
      });
      account = merged.state;
      if (merged.changed && account && cloud()?.save) {
        try {
          const saved = await cloud().save(account, user);
          if (token !== runtime.bootToken) return { state: null, cloudReadFailed: true };
          account = saved || account;
          persistLocalState(account, user);
          claimGuestEntry(user, guest);
          localStorage.removeItem(api().entryStorageKey({}));
          runtime.capturedGuest.entryState = null;
        } catch (_) {
          cloudReadFailed = true;
          account = recoverTerminalAsDraft(account);
        }
      } else if (account && api().isTerminalState(account)) {
        // The account already owns a terminal v2. Claim this anonymous snapshot
        // so it cannot later complete a different account on the same device.
        claimGuestEntry(user, guest);
      }
    }
    if (!cloudReadSucceeded && !cloud()?.load) account = reconcileAccountDraft(null, local, false);
    return { state: account, legacyPreferences, cloudReadFailed };
  }

  function existingPreferences(user, state, profileSnapshot) {
    const profile = profileSnapshot?.data || {};
    const legacy = runtime.legacyPreferences || {};
    const preservableThemes = api().PRESERVABLE_THEME_IDS || api().THEME_IDS;
    const themeId = state?.themeId || legacy.themeId || (
      preservableThemes.includes(profile.theme) ? profile.theme : ''
    ) || (!user && preservableThemes.includes(runtime.capturedGuest?.profile?.theme)
      ? runtime.capturedGuest.profile.theme
      : '');
    const scopedOasis = localStorage.getItem(api().oasisModeStorageKey(identityFor(user)));
    return {
      interestIds: state?.interestIds?.length ? state.interestIds : (legacy.interestIds || []),
      themeId,
      oasisMode: state?.oasisMode || legacy.oasisMode || profile.oasisMode || scopedOasis || 'light',
    };
  }

  function baselinePreferences(user, state, profileSnapshot) {
    const profile = profileSnapshot?.data || {};
    const legacy = runtime.legacyPreferences || {};
    const scopedTheme = localStorage.getItem(api().themeStorageKey(identityFor(user)));
    const scopedOasis = localStorage.getItem(api().oasisModeStorageKey(identityFor(user)));
    const preservableThemes = api().PRESERVABLE_THEME_IDS || api().THEME_IDS;
    const profileTheme = preservableThemes.includes(profile.theme) ? profile.theme : '';
    const guestTheme = !user && preservableThemes.includes(runtime.capturedGuest?.profile?.theme)
      ? runtime.capturedGuest.profile.theme
      : '';
    const themeId = preservableThemes.includes(scopedTheme)
      ? scopedTheme
      : (profileTheme || guestTheme || (state?.themeExplicit ? '' : state?.themeId) || '');
    const profileInterests = Array.isArray(profile.interestIds) ? profile.interestIds : [];
    const initialInterestIds = profileInterests.length
      ? profileInterests
      : (state?.interestIds?.length ? state.interestIds : (legacy.interestIds || []));
    return {
      interestsStatus: initialInterestIds.length
        ? 'selected'
        : (state?.interestsStatus === 'skipped' ? 'skipped' : 'pending'),
      interestIds: initialInterestIds,
      themeId,
      oasisMode: profile.oasisMode || scopedOasis || (state?.themeExplicit ? 'light' : state?.oasisMode) || 'light',
    };
  }

  async function boot() {
    if (!runtime.initialized || !api() || !root.__lootlinguaAuthResolved) return;
    if (!root.__lootlinguaInitialDataReady) return;
    if (!cloud() && root.__lootlinguaAuthUser) return;
    if (root.__lootlinguaAuthUser && !root.LootLinguaJourneyCloud) return;

    const token = ++runtime.bootToken;
    const user = root.__lootlinguaAuthUser || null;
    runtime.user = user;
    runtime.previewGeneration += 1;
    runtime.worldsPreview = { status: 'idle', items: [], error: null };
    runtime.structurePreview = {
      status: 'idle', worldId: '', model: null, error: null,
      selectedRankId: '', gatesStatus: 'idle', gates: [],
      selectedGateId: '', gateStatus: 'idle', gatePreview: null, gateError: null,
    };
    runtime.returnPreview = { status: 'idle', worldId: '', model: null, error: null };
    if (user) {
      claimGuestPendingIntentForUser(user);
      claimGuestThemeForUser(user);
    }

    if (user && typeof root.prepareGuestMigrationForUser === 'function') {
      try {
        await root.prepareGuestMigrationForUser(user);
      } catch (_) {}
      if (token !== runtime.bootToken || root.auth?.currentUser?.uid !== user.uid) return;
    }

    const profileSnapshot = currentProfile(user);
    runtime.profile = profileSnapshot;
    let entryState = localStateFor(user);
    let entryCloudReadFailed = false;
    runtime.legacyPreferences = user
      ? api().normalizeLegacyPreferences(readJson(api().entryStorageKey(identityFor(user), 1), null))
      : (runtime.capturedGuest?.legacyPreferences || null);
    if (user) {
      const loaded = await loadAccountEntry(user, token);
      if (token !== runtime.bootToken) return;
      entryState = loaded.state;
      runtime.legacyPreferences = loaded.legacyPreferences || runtime.legacyPreferences;
      entryCloudReadFailed = loaded.cloudReadFailed;
    }

    const learning = await readLearningSignals(user, token);
    if (!learning || token !== runtime.bootToken) return;
    const guest = runtime.capturedGuest || captureGuestSnapshot() || {};
    const profileData = user ? (profileSnapshot.data || {}) : (guest.profile || {});
    const words = user
      ? (Array.isArray(root.words) ? root.words : [])
      : (guest.words || readGuestWords());
    const accountCreation = user?.metadata?.creationTime || '';
    const accountLastSignIn = user?.metadata?.lastSignInTime || '';
    const rawSignals = {
      isAuthenticated: Boolean(user),
      uid: user?.uid || '',
      words,
      guestWords: user ? [] : words,
      profile: profileData,
      profileExists: Boolean(user && profileSnapshot.exists),
      profileReadFailed: Boolean(user && (
        profileSnapshot.readFailed ||
        entryCloudReadFailed ||
        learning.learningReadFailed ||
        (
          root.__lootlinguaMasterySnapshot?.uid === user.uid &&
          root.__lootlinguaMasterySnapshot.readFailed === true
        )
      )),
      activeJourney: learning.activeJourney,
      hasJourneyProgress: learning.hasJourneyProgress,
      journeyDestination: learning.journeyDestination,
      activeQuizSession: learning.activeQuizSession,
      srsEntryCount: user
        ? Math.max(
          srsEntryCount(user),
          root.__lootlinguaMasterySnapshot?.uid === user.uid
            ? Number(root.__lootlinguaMasterySnapshot.entryCount) || 0
            : 0
        )
        : (guest.srsEntryCount || 0),
      customWorldCount: user
        ? readArrayKey(`custom_worlds_${user.uid}`).length
        : (guest.customWorldCount || 0),
      hasLocalLearningDraft: !user && guest.hasLocalLearningDraft,
      localDraft: entryState,
      legacyMarkers: user ? {} : guest.legacyMarkers,
      accountCreatedAt: accountCreation,
      accountLastSignInAt: accountLastSignIn,
      now: Date.now(),
      hasPublishedWorld: true,
    };
    let presentation = api().classifyUser(rawSignals);
    if (
      user &&
      !entryState &&
      guest.words?.length &&
      presentation.classification !== 'brand-new'
    ) {
      presentation = {
        ...presentation,
        classification: 'returning-guest-with-local-data',
        audience: 'returning-guest',
      };
    }
    const signals = presentation.signals;
    runtime.signals = signals;
    const terminalEntry = entryState && api().isTerminalState(entryState);
    const staleBroadProgressClassification = entryState?.classification === 'returning-with-progress' &&
      !signals.hasMeaningfulJourneyProgress;
    runtime.presentation = {
      classification: staleBroadProgressClassification && !terminalEntry
        ? presentation.classification
        : (entryState?.classification || presentation.classification),
      audience: staleBroadProgressClassification && !terminalEntry
        ? presentation.audience
        : (entryState?.audience || presentation.audience),
    };
    if (entryState && entryState.status !== 'in-progress' && !terminalEntry) {
      entryState = api().recoverUnverifiedTerminal(entryState, runtime.presentation, Date.now());
      persistLocalState(entryState, user);
    }
    runtime.action = api().resolveNextAction(signals, {
      selectedWorldId: entryState?.selectedWorldId || '',
    });
    runtime.baselinePreferences = baselinePreferences(user, entryState, profileSnapshot);

    if (entryState && !api().shouldPresent(entryState)) {
      runtime.state = entryState;
      announceEntryState();
      close({ silent: true });
      queueMicrotask(() => consumePendingJourneyIntent());
      return;
    }
    runtime.state = entryState || api().createEntryDraft(
      runtime.presentation,
      existingPreferences(user, entryState, profileSnapshot)
    );
    runtime.state = api().alignStateToJourneyDestination(
      runtime.state,
      signals.journeyDestination,
      Date.now()
    );
    announceEntryState();
    open();
    if (user && runtime.state.currentStep === 'destination') {
      const resumed = await consumePendingJourneyIntent({ allowWhileOpen: true });
      if (resumed && token === runtime.bootToken && runtime.state?.status === 'in-progress') {
        try {
          const completed = api().transitionState(runtime.state, { type: 'complete' }, Date.now());
          await commitTerminalState(completed, 'جارٍ إكمال طلبك…', { applyAppearance: true });
          close();
        } catch (error) {
          const status = document.getElementById('entryExperienceStatus');
          if (status) status.textContent = error?.code === 'entry/profile-write-failed'
            ? 'نُفّذ طلبك، لكن تعذّر حفظ المظهر. بقيت التجربة مفتوحة لتأكيد الإكمال.'
            : 'نُفّذ طلبك، لكن تعذّر تأكيد اكتمال التجربة. بقيت مفتوحة للمحاولة مرة أخرى.';
        }
      }
    }
  }

  function rootElement() {
    return document.getElementById('entryExperienceRoot');
  }

  function panelElement() {
    return document.getElementById('entryExperiencePanel');
  }

  function setBusy(busy, label) {
    const rootNode = rootElement();
    if (!rootNode) return;
    rootNode.classList.toggle('is-busy', Boolean(busy));
    rootNode.setAttribute('aria-busy', busy ? 'true' : 'false');
    rootNode.querySelectorAll('button').forEach((button) => {
      if (!button.classList.contains('entry-allow-busy')) button.disabled = Boolean(busy);
    });
    const status = document.getElementById('entryExperienceStatus');
    if (status) status.textContent = busy ? (label || 'جارٍ حفظ اختياراتك…') : '';
  }

  function currentCopy() {
    return api().entryCopy(runtime.presentation?.classification, runtime.signals);
  }

  function stepIndicator(step) {
    const hasGames = runtime.state?.interestIds?.includes('games');
    const order = hasGames
      ? ['interests', 'theme', 'worlds', 'journey', 'context', 'destination']
      : ['interests', 'theme', 'worlds', 'journey', 'destination'];
    const index = Math.max(0, order.indexOf(step)) + 1;
    return `الخطوة ${index} من ${order.length}`;
  }

  function renderInterests() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const copy = currentCopy();
    const selected = new Set(runtime.state.interestIds);
    const isSettings = Boolean(runtime.settingsMode);
    panel.innerHTML = `
      <header class="entry-header">
        <div>
          <span class="entry-eyebrow">${escapeHtml(copy.eyebrow)}</span>
          <span class="entry-step-label">${stepIndicator('interests')}</span>
        </div>
        ${isSettings ? '<button type="button" class="entry-full-skip" data-entry-action="cancel-settings">إلغاء</button>' : ''}
      </header>
      <div class="entry-copy">
        <h1 id="entryExperienceTitle">${escapeHtml(copy.title)}</h1>
        <p>${escapeHtml(copy.body)}</p>
      </div>
      <div class="entry-interest-grid" role="group" aria-label="اختر اهتماماتك">
        ${api().INTERESTS.map((interest) => `
          <button type="button" class="entry-interest-card${selected.has(interest.id) ? ' selected' : ''}"
            data-entry-interest="${interest.id}" aria-pressed="${selected.has(interest.id) ? 'true' : 'false'}">
            <span class="entry-card-check"><i class="fa-solid fa-check" aria-hidden="true"></i></span>
            <i class="${interest.icon}" aria-hidden="true"></i>
            <span>${escapeHtml(interest.label)}</span>
          </button>
        `).join('')}
      </div>
      <footer class="entry-footer">
        <p id="entryInterestHint" class="entry-helper${selected.size ? ' ready' : ''}">${selected.size ? `اخترت ${selected.size} — يمكنك اختيار أكثر من اهتمام` : 'اختر اهتمامًا واحدًا على الأقل، أو تخطَّ هذا السؤال'}</p>
        <div class="entry-actions">
          ${runtime.settingsMode ? '' : '<button type="button" class="entry-secondary" data-entry-action="skip-interests">تخطي الاهتمامات</button>'}
          <button type="button" class="entry-primary" data-entry-action="continue-interests" ${selected.size ? '' : 'disabled'}>${runtime.settingsMode ? 'حفظ الاهتمامات' : 'كمّل'} <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
        </div>
      </footer>
    `;
    bindPanelActions();
  }

  function renderTheme() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const explicit = runtime.state.themeExplicit;
    const selectedTheme = runtime.state.themeId || 'lootlingua';
    const oasisMode = runtime.state.oasisMode || 'light';
    const isSettings = Boolean(runtime.settingsMode);
    panel.innerHTML = `
      <header class="entry-header">
        <div>
          <span class="entry-eyebrow">اختر المظهر الذي يريحك</span>
          <span class="entry-step-label">${stepIndicator('theme')}</span>
        </div>
        ${isSettings ? '<button type="button" class="entry-full-skip" data-entry-action="cancel-settings">إلغاء</button>' : ''}
      </header>
      <div class="entry-copy entry-copy-compact">
        <h1 id="entryExperienceTitle">كيف تحب أن تبدو تجربتك؟</h1>
        <p>اختر مظهرًا الآن أو اترك إعدادك الحالي كما هو. يمكنك تغييره لاحقًا من ملفك الشخصي.</p>
      </div>
      <div class="entry-theme-grid" role="radiogroup" aria-label="اختيار مظهر التطبيق">
        <button type="button" role="radio" aria-checked="${selectedTheme === 'lootlingua'}"
          class="entry-theme-card entry-theme-loot${selectedTheme === 'lootlingua' ? ' selected' : ''}"
          data-entry-theme="lootlingua" tabindex="${selectedTheme === 'ocean' ? '-1' : '0'}">
          <span class="entry-theme-preview" aria-hidden="true">
            <span class="entry-preview-top"></span><span class="entry-preview-card"></span><span class="entry-preview-lines"></span>
          </span>
          <span class="entry-theme-name">LootLingua</span>
          <small>الهوية الجيمرية الأصلية</small>
        </button>
        <button type="button" role="radio" aria-checked="${selectedTheme === 'ocean'}"
          class="entry-theme-card entry-theme-oasis mode-${oasisMode}${selectedTheme === 'ocean' ? ' selected' : ''}"
          data-entry-theme="ocean" tabindex="${selectedTheme === 'ocean' ? '0' : '-1'}">
          <span class="entry-theme-preview" aria-hidden="true">
            <span class="entry-preview-top"></span><span class="entry-preview-card"></span><span class="entry-preview-lines"></span>
          </span>
          <span class="entry-theme-name">واحة الهدوء</span>
          <small>مساحة هادئة للدراسة والتركيز</small>
        </button>
      </div>
      <div class="entry-oasis-modes${selectedTheme === 'ocean' ? ' visible' : ''}" aria-label="إضاءة واحة الهدوء">
        <span>إضاءة الواحة</span>
        <div role="radiogroup">
          <button type="button" data-entry-oasis-mode="light" role="radio" aria-checked="${oasisMode === 'light'}" tabindex="${oasisMode === 'light' ? '0' : '-1'}" class="${oasisMode === 'light' ? 'selected' : ''}"><i class="fa-solid fa-sun" aria-hidden="true"></i> فاتح</button>
          <button type="button" data-entry-oasis-mode="dark" role="radio" aria-checked="${oasisMode === 'dark'}" tabindex="${oasisMode === 'dark' ? '0' : '-1'}" class="${oasisMode === 'dark' ? 'selected' : ''}"><i class="fa-solid fa-moon" aria-hidden="true"></i> داكن</button>
        </div>
      </div>
      <footer class="entry-footer">
        <p class="entry-helper ready">${explicit ? 'سيُطبّق اختيارك عند إكمال الإعداد' : (runtime.state.themeId ? 'لن نغيّر مظهرك الحالي ما لم تختر مظهرًا آخر' : 'LootLingua هو الخيار الافتراضي ويمكن تغييره لاحقًا')}</p>
        <div class="entry-actions">
          <button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button>
          <button type="button" class="entry-primary" data-entry-action="${isSettings ? 'complete' : 'continue-theme'}">${isSettings ? 'حفظ المظهر' : 'اكتشف العوالم'} <i class="fa-solid fa-compass" aria-hidden="true"></i></button>
        </div>
      </footer>
    `;
    bindPanelActions();
  }

  function previewApi() {
    return root.LootLinguaWorldsEntryPreview;
  }

  function currentNextAction() {
    runtime.action = api().resolveNextAction(runtime.signals || {}, {
      selectedWorldId: runtime.state?.selectedWorldId || '',
    });
    return runtime.action;
  }

  function selectedWorldPreview() {
    const id = String(runtime.state?.selectedWorldId || '');
    const choice = runtime.worldsPreview.items.find((item) => String(item?.worldId || '') === id);
    return choice || runtime.structurePreview.model?.world || null;
  }

  function worldPreviewVisual(world) {
    const cover = String(world?.cover || world?.coverUrl || world?.imageUrl || world?.image || '').trim();
    if (cover) return `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`;
    const icon = String(world?.icon || '').trim();
    if (/^(fa-|fas |far |fab )/.test(icon)) return `<i class="${escapeHtml(icon)}" aria-hidden="true"></i>`;
    if (icon && /\p{Extended_Pictographic}/u.test(icon)) return `<span class="entry-world-emoji">${escapeHtml(icon)}</span>`;
    return '<i class="fa-solid fa-earth-americas" aria-hidden="true"></i>';
  }

  async function ensureWorldChoices(force) {
    if (!runtime.state || runtime.state.currentStep !== 'worlds') return;
    if (!force && ['loading', 'ready'].includes(runtime.worldsPreview.status)) return;
    const provider = previewApi();
    if (!provider?.loadWorldChoices) {
      runtime.worldsPreview = { status: 'waiting', items: [], error: null };
      return;
    }
    const generation = ++runtime.previewGeneration;
    runtime.worldsPreview = { status: 'loading', items: [], error: null };
    renderWorldsOnboarding();
    try {
      const items = await provider.loadWorldChoices(runtime.state.interestIds, { force: Boolean(force) });
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'worlds') return;
      runtime.worldsPreview = { status: 'ready', items: Array.isArray(items) ? items : [], error: null };
    } catch (error) {
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'worlds') return;
      runtime.worldsPreview = { status: 'error', items: [], error };
    }
    renderWorldsOnboarding();
    focusEntryHeading();
  }

  async function ensureStructurePreview(force) {
    if (!runtime.state || runtime.state.currentStep !== 'journey') return;
    const worldId = String(runtime.state.selectedWorldId || '');
    if (!worldId) return;
    if (
      !force &&
      ['loading', 'ready'].includes(runtime.structurePreview.status) &&
      runtime.structurePreview.worldId === worldId
    ) return;
    const provider = previewApi();
    if (!provider?.loadWorldStructure) {
      runtime.structurePreview = {
        status: 'waiting', worldId, model: null, error: null,
        selectedRankId: '', gatesStatus: 'idle', gates: [],
        selectedGateId: '', gateStatus: 'idle', gatePreview: null, gateError: null,
      };
      return;
    }
    const generation = ++runtime.previewGeneration;
    runtime.structurePreview = {
      status: 'loading', worldId, model: null, error: null,
      selectedRankId: '', gatesStatus: 'idle', gates: [],
      selectedGateId: '', gateStatus: 'idle', gatePreview: null, gateError: null,
    };
    renderJourneyStructure();
    try {
      const model = await provider.loadWorldStructure(worldId, { force: Boolean(force) });
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      const selectedRankId = String(model?.rank?.rankId || model?.ranks?.[0]?.rankId || '');
      runtime.structurePreview = {
        status: 'ready',
        worldId,
        model,
        error: null,
        selectedRankId,
        gatesStatus: 'ready',
        gates: Array.isArray(model?.gates) ? model.gates : [],
        selectedGateId: '',
        gateStatus: 'idle',
        gatePreview: null,
        gateError: null,
      };
    } catch (error) {
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      runtime.structurePreview = {
        status: 'error', worldId, model: null, error,
        selectedRankId: '', gatesStatus: 'idle', gates: [],
        selectedGateId: '', gateStatus: 'idle', gatePreview: null, gateError: null,
      };
    }
    renderJourneyStructure();
    focusEntryHeading();
  }

  async function ensureReturnPreview(force) {
    if (!runtime.state || runtime.state.currentStep !== 'return') return;
    const journey = runtime.signals?.activeJourney;
    const worldId = String(journey?.worldId || '');
    if (!worldId) return;
    if (!force && ['loading', 'ready'].includes(runtime.returnPreview.status) && runtime.returnPreview.worldId === worldId) return;
    const provider = previewApi();
    if (!provider?.loadJourneyContext) {
      runtime.returnPreview = { status: 'waiting', worldId, model: null, error: null };
      return;
    }
    const generation = ++runtime.previewGeneration;
    runtime.returnPreview = { status: 'loading', worldId, model: null, error: null };
    renderReturnJourney();
    try {
      const model = await provider.loadJourneyContext(journey, { force: Boolean(force) });
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'return') return;
      runtime.returnPreview = { status: 'ready', worldId, model, error: null };
    } catch (error) {
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'return') return;
      runtime.returnPreview = { status: 'error', worldId, model: null, error };
    }
    renderReturnJourney();
    focusEntryHeading();
  }

  function renderWorldsOnboarding() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const selectedId = String(runtime.state.selectedWorldId || '');
    const state = runtime.worldsPreview;
    const loading = state.status === 'loading' || state.status === 'waiting' || state.status === 'idle';
    const empty = state.status === 'ready' && !state.items.length;
    const failed = state.status === 'error';
    let content = '';
    if (loading) {
      content = `<div class="entry-world-grid" aria-label="جاري تحميل العوالم">
        ${[1, 2, 3].map(() => '<span class="entry-world-card entry-world-skeleton" aria-hidden="true"></span>').join('')}
      </div><p class="entry-helper ready">جاري قراءة العوالم المنشورة…</p>`;
      queueMicrotask(() => ensureWorldChoices(false));
    } else if (failed || empty) {
      content = `<div class="entry-preview-fallback" role="status">
        <i class="fa-solid ${failed ? 'fa-cloud-arrow-down' : 'fa-compass'}" aria-hidden="true"></i>
        <strong>${failed ? 'تعذر تحميل العوالم الآن' : 'لا توجد عوالم منشورة جاهزة للعرض الآن'}</strong>
        <span>سنشرح شكل رحلة التعلم دون عرض محتوى غير متاح، ثم يمكنك فتح العوالم المنشورة.</span>
        ${failed ? '<button type="button" class="entry-secondary" data-entry-action="retry-worlds"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> إعادة المحاولة</button>' : ''}
      </div>`;
    } else {
      content = `<div class="entry-world-grid" role="radiogroup" aria-label="اختر عالمًا للتعرّف إلى رحلته">
        ${state.items.map((world) => {
          const selected = String(world.worldId || '') === selectedId;
          const recommended = world.recommendation?.kind === 'interest-match';
          return `<button type="button" role="radio" aria-checked="${selected}" class="entry-world-card${selected ? ' selected' : ''}${recommended ? ' recommended' : ''}" data-entry-world="${escapeHtml(world.worldId)}">
            <span class="entry-world-visual">${worldPreviewVisual(world)}</span>
            <span class="entry-world-copy">
              ${recommended ? '<small><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> مقترح حسب اهتماماتك</small>' : '<small>عالم منشور</small>'}
              <strong>${escapeHtml(world.title || world.name || 'عالم تعلّم')}</strong>
              <span>${escapeHtml(world.description || world.subtitle || 'مجموعة كلمات حول موضوع أو اهتمام.')}</span>
              <em>${Number(world.gateCount) || 0} بوابة</em>
            </span>
            <i class="fa-solid fa-circle-check entry-world-check" aria-hidden="true"></i>
          </button>`;
        }).join('')}
      </div>`;
    }
    panel.innerHTML = `
      <header class="entry-header"><div><span class="entry-eyebrow">اهتماماتك تفتح لك أبوابًا حقيقية</span><span class="entry-step-label">${stepIndicator('worlds')}</span></div></header>
      <div class="entry-copy entry-copy-compact">
        <h1 id="entryExperienceTitle">اختر عالمًا يثير فضولك</h1>
        <p>كل بطاقة هنا عالم منشور فعليًا. اختيارك يحدد ما ستراه في هذه الجولة فقط؛ لن يبدأ رحلة تعلم ولن يغيّر تقدمك.</p>
      </div>
      ${content}
      <footer class="entry-footer">
        <p class="entry-helper${selectedId || failed || empty ? ' ready' : ''}">${selectedId ? 'اختيارك محفوظ — سنريك كيف تسير رحلة هذا العالم.' : (failed || empty ? 'يمكنك التعرّف إلى طريقة التعلم، ثم فتح العوالم المتاحة.' : 'اختر عالمًا واحدًا للمتابعة.')}</p>
        <div class="entry-actions">
          <button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button>
          ${failed || empty
            ? '<button type="button" class="entry-primary" data-entry-action="continue-worlds-fallback">تعرّف إلى شكل الرحلة <i class="fa-solid fa-route" aria-hidden="true"></i></button>'
            : `<button type="button" class="entry-primary" data-entry-action="continue-worlds" ${selectedId ? '' : 'disabled'}>استكشف رحلته <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>`}
        </div>
      </footer>`;
    bindPanelActions();
  }

  function legacyStructureNodes(state) {
    const model = state.model;
    const ranks = Array.isArray(model?.ranks) ? model.ranks.slice(0, 5) : [];
    const selectedRankId = String(state.selectedRankId || ranks[0]?.rankId || 'example');
    const usingExample = !ranks.length;
    const rankNodes = ranks.length
      ? ranks.map((rank, index) => {
        const selected = String(rank.rankId || '') === selectedRankId;
        return `<button type="button" role="tab" aria-selected="${selected}" class="entry-route-node entry-route-rank${selected ? ' selected' : ''}" data-entry-preview-rank="${escapeHtml(rank.rankId)}">
          <i class="fa-solid fa-ranking-star" aria-hidden="true"></i>
          <span><small>${selected ? 'الرتبة المعروضة الآن' : `الرتبة ${index + 1}`}</small><strong>${escapeHtml(rank.title || `الرتبة ${index + 1}`)}</strong></span>
          <i class="fa-solid fa-circle-check entry-route-selected-icon" aria-hidden="true"></i>
        </button>`;
      }).join('')
      : `<button type="button" role="tab" aria-selected="true" class="entry-route-node entry-route-rank selected" data-entry-preview-rank="example">
          <i class="fa-solid fa-ranking-star" aria-hidden="true"></i><span><small>مثال توضيحي</small><strong>رتبة منظّمة</strong></span><i class="fa-solid fa-circle-check entry-route-selected-icon" aria-hidden="true"></i>
        </button>`;
    const gates = usingExample
      ? [1, 2, 3].map((index) => ({ gateId: `example-${index}`, title: `بوابة ${index}`, wordCount: 0, example: true }))
      : (Array.isArray(state.gates) ? state.gates.slice(0, 8) : []);
    let gateNodes = '';
    if (state.gatesStatus === 'loading') {
      gateNodes = '<div class="entry-route-inline-state"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>نفتح بوابات هذه الرتبة…</span></div>';
    } else if (state.gatesStatus === 'error') {
      gateNodes = '<div class="entry-route-inline-state is-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>تعذر فتح بوابات هذه الرتبة. اختر الرتبة مرة أخرى للمحاولة.</span></div>';
    } else if (!gates.length) {
      gateNodes = '<div class="entry-route-inline-state"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><span>لا توجد بوابات منشورة في هذه الرتبة الآن.</span></div>';
    } else {
      gateNodes = gates.map((gate, index) => {
        const selected = String(gate.gateId || '') === String(state.selectedGateId || '');
        return `<button type="button" role="option" aria-selected="${selected}" class="entry-route-node entry-route-gate${selected ? ' selected' : ''}" data-entry-route-node="gate:${escapeHtml(gate.gateId)}" data-entry-preview-gate="${escapeHtml(gate.gateId)}">
          <span>${index + 1}</span><strong>${escapeHtml(gate.title || `البوابة ${index + 1}`)}</strong>
          <small>${gate.example ? 'مثال على خطوة تعلم' : `${Number(gate.wordCount) || 0} كلمة`}</small>
          <i class="fa-solid fa-circle-check entry-route-selected-icon" aria-hidden="true"></i>
        </button>`;
      }).join('');
    }
    return `<div class="entry-preview-stage">
      <div class="entry-preview-stage-heading"><span>1</span><div><small>الرتبة</small><strong>اختر الرتبة التي تريد فتح بواباتها</strong></div></div>
      <div class="entry-route-ranks" role="tablist" aria-label="رتب العالم">${rankNodes}</div>
    </div>
    <div class="entry-route-line" aria-hidden="true"></div>
    <div class="entry-preview-stage">
      <div class="entry-preview-stage-heading"><span>2</span><div><small>البوابة</small><strong>${state.selectedGateId ? 'هذه هي البوابة المحددة الآن' : 'اختر بوابة لتظهر معاينتها'}</strong></div></div>
      <div class="entry-route-gates" role="listbox" aria-label="بوابات الرتبة">${gateNodes}</div>
    </div>`;
  }

  function structureNodes(state) {
    const gates = Array.isArray(state.gates) && state.gates.length
      ? state.gates.slice(0, 12)
      : [1, 2, 3].map((index) => ({
        gateId: `example-${index}`,
        title: `بوابة ${index}`,
        wordCount: 0,
        cefrLevel: 'A1',
        example: true,
      }));
    const levels = new Map();
    gates.forEach((gate) => {
      const level = String(gate?.cefrLevel || 'unclassified');
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(gate);
    });
    const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'unclassified'];
    const orderedLevels = [...levels.keys()].sort((left, right) => order.indexOf(left) - order.indexOf(right));
    if (state.gatesStatus === 'loading') {
      return '<div class="entry-route-inline-state"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>نجهّز بوابات المستويات…</span></div>';
    }
    if (state.gatesStatus === 'error') {
      return '<div class="entry-route-inline-state is-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>تعذر فتح بوابات هذا العالم الآن.</span></div>';
    }
    return orderedLevels.map((level) => {
      const gatesInLevel = levels.get(level) || [];
      return `<div class="entry-preview-stage">
        <div class="entry-preview-stage-heading"><span>${escapeHtml(level)}</span><div><small>المستوى</small><strong>بوابات مستوى ${escapeHtml(level)}</strong></div></div>
        <div class="entry-route-gates" role="listbox" aria-label="بوابات مستوى ${escapeHtml(level)}">
          ${gatesInLevel.map((gate, index) => {
            const selected = String(gate.gateId || '') === String(state.selectedGateId || '');
            return `<button type="button" role="option" aria-selected="${selected}" class="entry-route-node entry-route-gate${selected ? ' selected' : ''}" data-entry-route-node="gate:${escapeHtml(gate.gateId)}" data-entry-preview-gate="${escapeHtml(gate.gateId)}">
              <span>${index + 1}</span><strong>${escapeHtml(gate.title || `بوابة ${index + 1}`)}</strong>
              <small>${gate.example ? 'مثال على خطوة تعلّم' : `${Number(gate.wordCount) || 0} كلمة`}</small>
              <i class="fa-solid fa-circle-check entry-route-selected-icon" aria-hidden="true"></i>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    }).join('<div class="entry-route-line" aria-hidden="true"></div>');
  }

  function gatePreviewMarkup(state) {
    const selectedGate = (state.gates || []).find(
      (gate) => String(gate?.gateId || '') === String(state.selectedGateId || '')
    );
    if (!state.selectedGateId) {
      return `<section class="entry-gate-preview entry-gate-preview-empty" aria-live="polite">
        <i class="fa-regular fa-hand-pointer" aria-hidden="true"></i>
        <div><small>معاينة البوابة</small><strong>لم تختر بوابة بعد</strong><span>اضغط على أي بوابة أعلاه لترى محتواها، ولن يتغير تقدمك.</span></div>
      </section>`;
    }
    const gate = state.gatePreview?.gate || selectedGate || {};
    if (state.gateStatus === 'loading') {
      return `<section class="entry-gate-preview is-loading" aria-live="polite" aria-busy="true">
        <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
        <div><small>معاينة البوابة</small><strong>${escapeHtml(gate.title || 'جاري فتح البوابة')}</strong><span>نقرأ عينة صغيرة من محتواها المنشور…</span></div>
      </section>`;
    }
    if (state.gateStatus === 'error') {
      return `<section class="entry-gate-preview is-error" aria-live="polite">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div><small>معاينة البوابة</small><strong>${escapeHtml(gate.title || 'تعذرت المعاينة')}</strong><span>لم نتمكن من قراءة محتواها الآن. اخترها مرة أخرى للمحاولة.</span></div>
      </section>`;
    }
    const words = Array.isArray(state.gatePreview?.words) ? state.gatePreview.words : [];
    const wordList = words.length
      ? `<div class="entry-gate-preview-words">${words.map((word) => `<span><strong lang="en" dir="ltr">${escapeHtml(word.word || word.text || '')}</strong><small>${escapeHtml(word.translation || word.meaning || '')}</small></span>`).join('')}</div>`
      : '<p class="entry-gate-preview-note">لا توجد عينة كلمات منشورة لهذه البوابة الآن، لكن مكانها في الرحلة واضح.</p>';
    return `<section class="entry-gate-preview is-selected" aria-live="polite">
      <div class="entry-gate-preview-title"><span><i class="fa-solid fa-dungeon" aria-hidden="true"></i></span><div><small>معاينة البوابة المحددة</small><strong>${escapeHtml(gate.title || 'البوابة')}</strong><em>${Number(gate.wordCount) || words.length || 0} كلمة في البوابة</em></div><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
      ${wordList}
    </section>`;
  }

  function renderJourneyStructure() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const selectedId = String(runtime.state.selectedWorldId || '');
    const status = runtime.structurePreview.status;
    const structure = runtime.structurePreview;
    const model = structure.model;
    const explored = runtime.state.journeyStatus === 'structure-explored';
    if (selectedId && ['idle', 'waiting'].includes(status)) queueMicrotask(() => ensureStructurePreview(false));
    const loading = selectedId && ['idle', 'waiting', 'loading'].includes(status);
    const failed = selectedId && status === 'error';
    const world = model?.world || selectedWorldPreview();
    panel.innerHTML = `
      <header class="entry-header"><div><span class="entry-eyebrow">معاينة تعليمية — لا تغيّر تقدمك</span><span class="entry-step-label">${stepIndicator('journey')}</span></div></header>
      <div class="entry-copy entry-copy-compact">
        <h1 id="entryExperienceTitle">${escapeHtml(world?.title || 'من العالم إلى بوابة تتقنها')}</h1>
        <p>كل عالم منظّم حسب مستوى لغتك، ثم بوابات تتعلم منها الكلمات خطوة بخطوة.</p>
      </div>
      <section class="entry-route-preview${explored ? ' explored' : ''}" aria-label="كيف تسير رحلة التعلم">
        <div class="entry-route-world"><span>${worldPreviewVisual(world)}</span><div><small>العالم</small><strong>${escapeHtml(world?.title || 'عالم التعلّم')}</strong></div></div>
        ${loading ? '<div class="entry-route-loading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> نجهّز المستويات والبوابات المنشورة…</div>' : structureNodes(structure)}
        ${failed ? '<button type="button" class="entry-secondary entry-route-retry" data-entry-action="retry-structure"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> أعد تحميل المستويات والبوابات</button>' : ''}
      </section>
      ${loading ? '' : gatePreviewMarkup(structure)}
      <section class="entry-learning-explainer" aria-label="كيف يعمل التعلم في LootLingua">
        <div><small>كيف تتعلم هنا؟</small><strong>الكلمات لا تظهر مرة واحدة ثم تختفي</strong></div>
        <div class="entry-learning-loop">
        <span><i class="fa-solid fa-book-open" aria-hidden="true"></i><strong>تتعلّم</strong><small>كلمات البوابة</small></span>
        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
        <span><i class="fa-solid fa-rotate" aria-hidden="true"></i><strong>تراجع</strong><small>في الوقت المناسب</small></span>
        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
        <span><i class="fa-solid fa-unlock-keyhole" aria-hidden="true"></i><strong>تتقدّم</strong><small>إلى البوابة التالية</small></span>
        </div>
      </section>
      <footer class="entry-footer"><p class="entry-helper${explored ? ' ready' : ''}">${explored ? 'استكشفت بوابة فعلية، وعرفت كيف تسير الرحلة.' : 'اختر بوابة واحدة على الأقل لإكمال هذه الخطوة.'}</p>
        <div class="entry-actions"><button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button><button type="button" class="entry-primary" data-entry-action="continue-journey" ${explored ? '' : 'disabled'}>حدد خطوتي التالية <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button></div>
      </footer>`;
    bindPanelActions();
  }

  function renderContextFeature() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const status = runtime.state.gamerStatus;
    const guestQuotaUnavailable = !runtime.user && (
      localStorage.getItem('hasUsedNormalGuestShot') === '1' ||
      localStorage.getItem('hasUsedGamerGuestShot') === '1'
    );
    const finished = ['completed', 'unavailable'].includes(status);
    panel.innerHTML = `
      <header class="entry-header"><div><span class="entry-eyebrow">ميزة من سياق اهتمامك</span><span class="entry-step-label">${stepIndicator('context')}</span></div></header>
      <div class="entry-context-layout">
        <span class="entry-context-icon"><i class="fa-solid fa-gamepad" aria-hidden="true"></i></span>
        <div class="entry-copy entry-copy-compact"><h1 id="entryExperienceTitle">الكلمة العامة قد تتغير داخل اللعبة</h1><p>يمكنك تجربة البحث الحقيقي: تظهر الترجمة العامة أولًا، ثم تختار بنفسك زر «معنى الألعاب» الموجود تحت النتائج.</p></div>
        <div class="entry-context-example" aria-hidden="true"><strong lang="en" dir="ltr">Spawn</strong><span>ترجمة عامة</span><i class="fa-solid fa-arrow-left"></i><span><i class="fa-solid fa-gamepad"></i> سياق الألعاب</span></div>
        ${guestQuotaUnavailable ? '<p class="entry-context-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> تجربة البحث المجانية استُخدمت على هذا الجهاز. لن نطلب تسجيل الدخول بسبب ذلك؛ يمكنك متابعة الجولة.</p>' : ''}
        ${finished ? `<p class="entry-context-note ${status === 'completed' ? 'success' : ''}"><i class="fa-solid ${status === 'completed' ? 'fa-circle-check' : 'fa-circle-info'}" aria-hidden="true"></i>${status === 'completed' ? 'جرّبت الفرق داخل البحث الحقيقي.' : 'لم تتوفر نتيجة سياقية هذه المرة، ويمكنك المحاولة لاحقًا من القاموس.'}</p>` : ''}
      </div>
      <footer class="entry-footer"><p class="entry-helper ready">هذه الميزة اختيارية ولا تحدد نجاح الجولة.</p><div class="entry-actions">
        ${finished ? '<button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button><button type="button" class="entry-primary" data-entry-action="continue-context">تابع إلى خطوتك <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>' : `
          <button type="button" class="entry-secondary" data-entry-action="skip-gamer-demo">ليس الآن</button>
          <button type="button" class="entry-primary" data-entry-action="start-gamer-demo" ${guestQuotaUnavailable ? 'disabled' : ''}>${status === 'running' ? 'استأنف البحث الحقيقي' : 'جرّبها في البحث الحقيقي'} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></button>`}
      </div></footer>`;
    bindPanelActions();
  }

  function renderReturnJourney() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const journey = runtime.signals?.activeJourney || {};
    const model = runtime.returnPreview.model;
    const reviewed = runtime.state.journeyStatus === 'return-reviewed';
    if (['idle', 'waiting'].includes(runtime.returnPreview.status)) queueMicrotask(() => ensureReturnPreview(false));
    const worldTitle = model?.world?.title || 'رحلتك الحالية';
    const levelTitle = model?.rank?.cefrLevel || 'المستوى الحالي';
    const gateTitle = model?.gate?.title || journey.activeGateId || 'البوابة الحالية';
    panel.innerHTML = `
      <header class="entry-header entry-action-header"><span class="entry-eyebrow">تقدّمك الحقيقي محفوظ</span><span class="entry-step-label">عودة سريعة</span></header>
      <div class="entry-copy entry-copy-compact"><h1 id="entryExperienceTitle">أعدناك إلى موضعك، لا إلى بداية جديدة</h1><p>التعلّم هنا منظّم في عالم، ثم مستوى، ثم بوابة. هذه البطاقة تعرض رحلتك الفعلية ولا تغيّرها.</p></div>
      <section class="entry-saved-route${reviewed ? ' reviewed' : ''}">
        <span><i class="fa-solid fa-earth-americas" aria-hidden="true"></i><small>العالم</small><strong>${escapeHtml(worldTitle)}</strong></span>
        <i class="fa-solid fa-angle-left" aria-hidden="true"></i>
        <span><i class="fa-solid fa-signal" aria-hidden="true"></i><small>المستوى</small><strong>${escapeHtml(levelTitle)}</strong></span>
        <i class="fa-solid fa-angle-left" aria-hidden="true"></i>
        <span><i class="fa-solid fa-dungeon" aria-hidden="true"></i><small>البوابة</small><strong>${escapeHtml(gateTitle)}</strong></span>
      </section>
      ${reviewed ? '<p class="entry-context-note success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> هذا هو موضعك المحفوظ، وسنفتحه كما هو.</p>' : '<button type="button" class="entry-primary entry-inspect-return" data-entry-action="review-return"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> أرني موضعي في الرحلة</button>'}
      <footer class="entry-footer"><div class="entry-actions entry-actions-single"><button type="button" class="entry-primary" data-entry-action="continue-return" ${reviewed ? '' : 'disabled'}>تابع إلى رحلتك <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button></div></footer>`;
    bindPanelActions();
  }

  function renderDestination() {
    const panel = panelElement();
    if (!panel || !runtime.state) return;
    const action = currentNextAction();
    if (action.completedWorld === true) {
      panel.innerHTML = `
        <div class="entry-action-screen entry-destination-screen entry-completed-world-screen">
          <header class="entry-header entry-action-header"><span class="entry-eyebrow">رحلتك هنا مكتملة</span><span class="entry-step-label">إنجاز محفوظ</span></header>
          <span class="entry-action-icon"><i class="fa-solid fa-trophy" aria-hidden="true"></i></span>
          <h1 id="entryExperienceTitle">أنهيت هذا العالم 🎉</h1>
          <p>${escapeHtml(action.hint)}</p>
          <div class="entry-action-destinations">
            <button type="button" class="entry-primary entry-action-primary" data-entry-cta="${action.id}">${escapeHtml(action.label)} <i class="fa-solid fa-compass" aria-hidden="true"></i></button>
          </div>
        </div>`;
      bindPanelActions();
      return;
    }
    const selectedWorld = selectedWorldPreview();
    panel.innerHTML = `
      <div class="entry-action-screen entry-destination-screen">
        <header class="entry-header entry-action-header"><span class="entry-eyebrow">خطوتك التالية واضحة</span><span class="entry-step-label">${runtime.presentation?.classification === 'returning-with-progress' ? 'عودة سريعة' : stepIndicator('destination')}</span></header>
        <span class="entry-action-icon"><i class="fa-solid ${action.id.includes('journey') ? 'fa-route' : (action.id === 'review-words' ? 'fa-rotate' : 'fa-compass')}" aria-hidden="true"></i></span>
        <h1 id="entryExperienceTitle">${escapeHtml(action.label)}</h1>
        <p>${escapeHtml(action.hint)}</p>
        ${selectedWorld ? `<div class="entry-selected-world-summary"><span>${worldPreviewVisual(selectedWorld)}</span><div><small>العالم الذي اخترته</small><strong>${escapeHtml(selectedWorld.title || selectedWorld.name || 'عالم التعلّم')}</strong></div></div>` : ''}
        <div class="entry-journey-recap"><span><i class="fa-solid fa-earth-americas"></i> عالم</span><i class="fa-solid fa-angle-left"></i><span><i class="fa-solid fa-signal"></i> مستويات</span><i class="fa-solid fa-angle-left"></i><span><i class="fa-solid fa-dungeon"></i> بوابات</span><i class="fa-solid fa-angle-left"></i><span><i class="fa-solid fa-rotate"></i> تعلم ومراجعة</span></div>
        <div class="entry-action-destinations">
          ${runtime.presentation?.classification === 'returning-with-progress' ? '' : '<button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button>'}
          <button type="button" class="entry-primary entry-action-primary" data-entry-cta="${action.id}">${escapeHtml(action.label)} <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
          ${action.secondaryId ? `<button type="button" class="entry-secondary entry-action-secondary" data-entry-cta="${action.secondaryId}">${escapeHtml(action.secondaryLabel)}</button>` : ''}
        </div>
      </div>`;
    bindPanelActions();
  }

  function render() {
    if (!runtime.state) return;
    if (runtime.state.status !== 'in-progress' || runtime.state.currentStep === 'destination') renderDestination();
    else if (runtime.state.currentStep === 'return') renderReturnJourney();
    else if (runtime.state.currentStep === 'context') renderContextFeature();
    else if (runtime.state.currentStep === 'journey') renderJourneyStructure();
    else if (runtime.state.currentStep === 'worlds') renderWorldsOnboarding();
    else if (runtime.state.currentStep === 'theme') renderTheme();
    else renderInterests();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function bindPanelActions() {
    const panel = panelElement();
    if (!panel) return;
    panel.querySelectorAll('[data-entry-interest]').forEach((button) => {
      button.addEventListener('click', () => toggleInterest(button.dataset.entryInterest, button));
    });
    panel.querySelectorAll('[data-entry-theme]').forEach((button) => {
      button.addEventListener('click', () => selectTheme(button.dataset.entryTheme));
    });
    panel.querySelectorAll('[data-entry-world]').forEach((button) => {
      button.addEventListener('click', () => selectWorld(button.dataset.entryWorld));
    });
    panel.querySelectorAll('[data-entry-preview-rank]').forEach((button) => {
      button.addEventListener('click', () => selectPreviewRank(button.dataset.entryPreviewRank));
    });
    panel.querySelectorAll('[data-entry-preview-gate]').forEach((button) => {
      button.addEventListener('click', () => inspectPreviewGate(button.dataset.entryPreviewGate));
    });
    panel.querySelectorAll('[data-entry-oasis-mode]').forEach((button) => {
      button.addEventListener('click', () => selectOasisMode(button.dataset.entryOasisMode));
    });
    panel.querySelectorAll('[data-entry-action]').forEach((button) => {
      button.addEventListener('click', () => handleAction(button.dataset.entryAction));
    });
    panel.querySelectorAll('[data-entry-cta]').forEach((button) => {
      button.addEventListener('click', () => runCta(button.dataset.entryCta));
    });
  }

  function focusEntryHeading() {
    requestAnimationFrame(() => {
      const heading = panelElement()?.querySelector('h1');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
  }

  function transition(event) {
    runtime.state = api().transitionState(runtime.state, event, Date.now());
    if (!runtime.settingsMode) persistLocalState(runtime.state, runtime.user);
    return runtime.state;
  }

  function toggleInterest(interestId, button) {
    const ids = new Set(runtime.state.interestIds);
    if (ids.has(interestId)) ids.delete(interestId);
    else ids.add(interestId);
    transition({ type: 'select-interests', interestIds: [...ids] });
    const selected = ids.has(interestId);
    if (button) {
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    const hint = document.getElementById('entryInterestHint');
    if (hint) {
      hint.classList.toggle('ready', ids.size > 0);
      hint.textContent = ids.size
        ? `اخترت ${ids.size} — يمكنك اختيار أكثر من اهتمام`
        : 'اختر اهتمامًا واحدًا على الأقل، أو تخطَّ هذا السؤال';
    }
    const continueButton = panelElement()?.querySelector('[data-entry-action="continue-interests"]');
    if (continueButton) continueButton.disabled = ids.size === 0;
  }

  function selectTheme(themeId) {
    transition({ type: 'select-theme', themeId, oasisMode: runtime.state.oasisMode || 'light' });
    renderTheme();
    requestAnimationFrame(() => panelElement()?.querySelector(`[data-entry-theme="${themeId}"]`)?.focus());
  }

  function selectOasisMode(mode) {
    transition({ type: 'select-theme', themeId: 'ocean', oasisMode: mode });
    renderTheme();
    requestAnimationFrame(() => panelElement()?.querySelector(`[data-entry-oasis-mode="${mode}"]`)?.focus());
  }

  async function selectWorld(worldId) {
    if (!worldId || runtime.state?.currentStep !== 'worlds') return;
    try {
      transition({ type: 'select-world', worldId });
      runtime.structurePreview = {
        status: 'idle', worldId: '', model: null, error: null,
        selectedRankId: '', gatesStatus: 'idle', gates: [],
        selectedGateId: '', gateStatus: 'idle', gatePreview: null, gateError: null,
      };
      await saveCheckpoint('جاري حفظ اختيار العالم…');
      renderWorldsOnboarding();
      requestAnimationFrame(() => {
        const target = [...(panelElement()?.querySelectorAll('[data-entry-world]') || [])]
          .find((element) => element.dataset.entryWorld === worldId);
        target?.focus();
      });
    } catch (error) {
      setBusy(false);
      renderWorldsOnboarding();
      const status = document.getElementById('entryExperienceStatus');
      if (status) status.textContent = 'تعذر حفظ اختيار العالم في الحساب. بقي اختيارك محفوظًا على هذا الجهاز؛ حاول مرة أخرى.';
    }
  }

  async function selectPreviewRank(rankId) {
    if (!rankId || runtime.state?.currentStep !== 'journey') return;
    const structure = runtime.structurePreview;
    if (rankId === 'example') {
      runtime.structurePreview = {
        ...structure,
        selectedRankId: rankId,
        gatesStatus: 'ready',
        selectedGateId: '',
        gateStatus: 'idle',
        gatePreview: null,
        gateError: null,
      };
      renderJourneyStructure();
      return;
    }
    if (String(structure.selectedRankId || '') === String(rankId) && structure.gatesStatus === 'ready') return;
    runtime.structurePreview = {
      ...structure,
      selectedRankId: rankId,
      gatesStatus: 'loading',
      gates: [],
      selectedGateId: '',
      gateStatus: 'idle',
      gatePreview: null,
      gateError: null,
    };
    renderJourneyStructure();
    const provider = previewApi();
    if (!provider?.loadRankPreview) {
      runtime.structurePreview = { ...runtime.structurePreview, gatesStatus: 'error' };
      renderJourneyStructure();
      return;
    }
    const generation = ++runtime.previewGeneration;
    try {
      const preview = await provider.loadRankPreview(structure.worldId, rankId);
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      runtime.structurePreview = {
        ...runtime.structurePreview,
        selectedRankId: rankId,
        gatesStatus: 'ready',
        gates: Array.isArray(preview?.gates) ? preview.gates : [],
      };
    } catch (error) {
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      runtime.structurePreview = {
        ...runtime.structurePreview,
        gatesStatus: 'error',
        gates: [],
        gateError: error,
      };
    }
    renderJourneyStructure();
    requestAnimationFrame(() => {
      const target = [...(panelElement()?.querySelectorAll('[data-entry-preview-rank]') || [])]
        .find((element) => element.dataset.entryPreviewRank === rankId);
      target?.focus();
    });
  }

  async function inspectPreviewGate(gateId) {
    if (!gateId || runtime.state?.currentStep !== 'journey') return;
    const structure = runtime.structurePreview;
    const selectedGate = (structure.gates || []).find(
      (gate) => String(gate?.gateId || '') === String(gateId)
    ) || (gateId.startsWith('example-') ? { gateId, title: `بوابة ${gateId.split('-').pop()}`, wordCount: 0 } : null);
    runtime.structurePreview = {
      ...structure,
      selectedGateId: gateId,
      gateStatus: 'loading',
      gatePreview: { gate: selectedGate, words: [] },
      gateError: null,
    };
    renderJourneyStructure();
    const generation = ++runtime.previewGeneration;
    try {
      let preview;
      if (gateId.startsWith('example-')) {
        preview = { gate: selectedGate, words: [] };
      } else {
        const provider = previewApi();
        if (!provider?.loadGatePreview) throw new Error('Gate preview is unavailable.');
        preview = await provider.loadGatePreview(
          structure.worldId,
          String(selectedGate?.rankId || structure.selectedRankId || ''),
          gateId
        );
      }
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      runtime.structurePreview = {
        ...runtime.structurePreview,
        selectedGateId: gateId,
        gateStatus: 'ready',
        gatePreview: preview,
        gateError: null,
      };
      if (runtime.state.journeyStatus !== 'structure-explored') {
        transition({ type: 'explore-structure' });
        await saveCheckpoint('نحفظ تقدمك في الجولة…');
      }
      renderJourneyStructure();
      requestAnimationFrame(() => {
        const target = [...(panelElement()?.querySelectorAll('[data-entry-preview-gate]') || [])]
          .find((element) => element.dataset.entryPreviewGate === gateId);
        target?.focus();
      });
    } catch (error) {
      if (generation !== runtime.previewGeneration || runtime.state?.currentStep !== 'journey') return;
      setBusy(false);
      runtime.structurePreview = {
        ...runtime.structurePreview,
        selectedGateId: gateId,
        gateStatus: 'error',
        gatePreview: { gate: selectedGate, words: [] },
        gateError: error,
      };
      renderJourneyStructure();
    }
  }

  function clearGamerGuide() {
    const guide = runtime.gamerGuide;
    if (guide?.listener) root.removeEventListener('lootlingua:dictionary-search-result', guide.listener);
    document.getElementById('entryGamerGuide')?.remove();
    document.querySelectorAll('.entry-guided-search-target').forEach((element) => {
      element.classList.remove('entry-guided-search-target');
    });
    root.__lootlinguaEntryGamerGuideActive = false;
    runtime.gamerGuide = null;
  }

  function targetGamerGuide(selector) {
    document.querySelectorAll('.entry-guided-search-target').forEach((element) => {
      element.classList.remove('entry-guided-search-target');
    });
    const target = document.querySelector(selector);
    target?.classList?.add('entry-guided-search-target');
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return target;
  }

  function updateGamerGuide(phase) {
    const coach = document.getElementById('entryGamerGuide');
    if (!coach) return;
    const title = coach.querySelector('[data-entry-guide-title]');
    const body = coach.querySelector('[data-entry-guide-body]');
    const badge = coach.querySelector('[data-entry-guide-step]');
    if (phase === 'gamer') {
      if (badge) badge.textContent = '2 من 2';
      if (title) title.textContent = 'الآن اطلب معنى الألعاب';
      if (body) body.textContent = 'ظهرت الترجمة العامة. اضغط زر «معنى ألعاب؟» الحقيقي أسفل النتائج لترى الفرق.';
      targetGamerGuide('#gamerMeaningBubble .gamer-meaning-btn');
    } else {
      if (badge) badge.textContent = '1 من 2';
      if (title) title.textContent = 'ابدأ بالترجمة العامة';
      if (body) body.textContent = 'جهزنا كلمة Spawn كمثال. اضغط زر «ابحث عن معنى» الحقيقي؛ لن نضيف الكلمة إلى قاموسك.';
      targetGamerGuide('#searchBtn');
    }
  }

  async function finishGamerGuide(outcome) {
    if (!runtime.state || runtime.state.currentStep !== 'context') return;
    clearGamerGuide();
    try {
      transition({ type: 'finish-gamer-demo', outcome });
      transition({ type: 'continue-context' });
      await saveCheckpoint('جاري العودة إلى جولتك…');
    } catch (error) {
      setBusy(false);
    }
    open();
    render();
    focusEntryHeading();
  }

  async function skipActiveGamerGuide() {
    if (!runtime.state || runtime.state.currentStep !== 'context') return;
    clearGamerGuide();
    try {
      transition({ type: 'skip-gamer-demo' });
      await saveCheckpoint('جاري العودة إلى جولتك…');
    } catch (error) {
      setBusy(false);
    }
    open();
    render();
    focusEntryHeading();
  }

  async function launchGamerGuide() {
    if (!runtime.state || runtime.state.currentStep !== 'context') return;
    const unavailable = !runtime.user && (
      localStorage.getItem('hasUsedNormalGuestShot') === '1' ||
      localStorage.getItem('hasUsedGamerGuestShot') === '1'
    );
    if (unavailable || typeof root.fetchSuggestions !== 'function' || typeof root.fetchGamerSuggestions !== 'function') {
      await finishGamerGuide('unavailable');
      return;
    }
    try {
      if (runtime.state.gamerStatus !== 'running') {
        transition({ type: 'start-gamer-demo' });
        await saveCheckpoint('جاري فتح البحث الحقيقي…');
      }
    } catch (error) {
      setBusy(false);
      return;
    }

    close({ silent: true });
    root.loadPersonalDictionary?.();
    root.__lootlinguaEntryGamerGuideActive = true;
    const coach = document.createElement('aside');
    coach.id = 'entryGamerGuide';
    coach.className = 'entry-gamer-guide';
    coach.setAttribute('role', 'dialog');
    coach.setAttribute('aria-labelledby', 'entryGamerGuideTitle');
    coach.innerHTML = `<span class="entry-guide-step" data-entry-guide-step>1 من 2</span>
      <i class="fa-solid fa-gamepad" aria-hidden="true"></i>
      <div><strong id="entryGamerGuideTitle" data-entry-guide-title>ابدأ بالترجمة العامة</strong><p data-entry-guide-body>جهزنا كلمة Spawn كمثال. اضغط زر «ابحث عن معنى» الحقيقي؛ لن نضيف الكلمة إلى قاموسك.</p></div>
      <button type="button" class="entry-secondary" data-entry-guide-skip>تخطي التجربة</button>`;
    document.body.appendChild(coach);
    const listener = (event) => {
      const detail = event.detail || {};
      if (detail.type === 'normal') {
        if (detail.status === 'success') updateGamerGuide('gamer');
        else if (['empty', 'error', 'blocked'].includes(detail.status)) finishGamerGuide('unavailable');
      } else if (detail.type === 'gamer') {
        finishGamerGuide(detail.status === 'success' ? 'completed' : 'unavailable');
      }
    };
    runtime.gamerGuide = { listener };
    root.addEventListener('lootlingua:dictionary-search-result', listener);
    coach.querySelector('[data-entry-guide-skip]')?.addEventListener('click', skipActiveGamerGuide);
    const input = document.getElementById('wordInput');
    if (input) {
      input.value = 'Spawn';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    updateGamerGuide('normal');
  }

  async function saveCheckpoint(label) {
    persistLocalState(runtime.state, runtime.user);
    if (!runtime.user || !cloud()?.save) {
      announceEntryState();
      return runtime.state;
    }
    setBusy(true, label);
    runtime.savePromise = runtime.savePromise.catch(() => {}).then(() => cloud().save(runtime.state, runtime.user));
    try {
      const saved = await runtime.savePromise;
      runtime.state = saved || runtime.state;
      persistLocalState(runtime.state, runtime.user);
      announceEntryState();
      return runtime.state;
    } finally {
      setBusy(false);
    }
  }

  async function commitTerminalState(candidate, label, options) {
    const previous = runtime.state;
    const normalized = api().normalizeEntryState(candidate);
    if (!normalized || !api().isTerminalState(normalized)) {
      throw new TypeError('A terminal Entry Experience state is required.');
    }
    setBusy(true, label);
    try {
      if (options?.applyAppearance) {
        applyExplicitAppearance(normalized);
        if (runtime.user && normalized.themeExplicit) {
          if (typeof root._saveProfileToCloudNow !== 'function') {
            throw Object.assign(new Error('Profile persistence is unavailable.'), {
              code: 'entry/profile-write-failed',
            });
          }
          const profileSaved = await root._saveProfileToCloudNow({ verify: true });
          if (profileSaved !== true) {
            throw Object.assign(new Error('The selected appearance was not saved to the account.'), {
              code: 'entry/profile-write-failed',
            });
          }
        }
      }

      let committed = normalized;
      if (runtime.user) {
        if (!cloud()?.save) {
          throw Object.assign(new Error('Entry persistence is unavailable.'), {
            code: 'entry/write-failed',
          });
        }
        committed = await cloud().save(normalized, runtime.user, {
          operation: 'entry-completion',
          verify: true,
        }) || normalized;
      }
      runtime.state = committed;
      persistLocalState(committed, runtime.user);
      announceEntryState();
      return committed;
    } catch (error) {
      runtime.state = previous;
      if (previous) persistLocalState(previous, runtime.user);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action) {
    if (!runtime.state) return;
    if (action === 'cancel-settings') {
      runtime.state = runtime.settingsBaseState;
      runtime.settingsBaseState = null;
      runtime.settingsMode = '';
      close();
      return;
    }
    if (action === 'back') {
      transition({ type: 'back' });
      render();
      focusEntryHeading();
      return;
    }
    try {
      if (action === 'continue-interests') {
        transition({ type: 'continue-interests' });
        if (runtime.settingsMode === 'interests') {
          const draft = runtime.state;
          runtime.state = api().normalizeEntryState({
            ...runtime.settingsBaseState,
            interestsStatus: draft.interestsStatus,
            interestIds: draft.interestIds,
            source: 'settings',
            updatedAt: Date.now(),
          });
          runtime.settingsMode = '';
          runtime.settingsBaseState = null;
          await saveCheckpoint('جارٍ حفظ اهتماماتك…');
          root.closeProfileModal?.();
          close();
          return;
        }
      }
      else if (action === 'skip-interests') transition({ type: 'skip-interests' });
      else if (action === 'continue-theme') transition({ type: 'continue-theme' });
      else if (action === 'retry-worlds') {
        await ensureWorldChoices(true);
        return;
      }
      else if (action === 'continue-worlds') transition({ type: 'continue-worlds' });
      else if (action === 'continue-worlds-fallback') transition({ type: 'continue-worlds-fallback' });
      else if (action === 'retry-structure') {
        await ensureStructurePreview(true);
        return;
      }
      else if (action === 'continue-journey') transition({ type: 'continue-journey' });
      else if (action === 'start-gamer-demo') {
        await launchGamerGuide();
        return;
      }
      else if (action === 'skip-gamer-demo') transition({ type: 'skip-gamer-demo' });
      else if (action === 'continue-context') transition({ type: 'continue-context' });
      else if (action === 'review-return') transition({ type: 'review-return' });
      else if (action === 'continue-return') transition({ type: 'continue-return' });
      else if (action === 'complete') {
        if (runtime.settingsMode === 'theme') {
          const draft = runtime.state;
          runtime.state = api().normalizeEntryState({
            ...runtime.settingsBaseState,
            themeStatus: draft.themeStatus,
            themeId: draft.themeId,
            oasisMode: draft.oasisMode,
            themeExplicit: draft.themeExplicit,
            source: 'settings',
            updatedAt: Date.now(),
          });
          runtime.settingsMode = '';
          runtime.settingsBaseState = null;
          await saveCheckpoint('جارٍ حفظ المظهر…');
          applyExplicitAppearance();
          root.closeProfileModal?.();
          close();
          return;
        }
        return;
      }
      else return;

      await saveCheckpoint('جارٍ حفظ خطوتك…');
      render();
      focusEntryHeading();
    } catch (error) {
      setBusy(false);
      if (runtime.state && runtime.state.status === 'in-progress') {
        render();
        focusEntryHeading();
      }
      const status = document.getElementById('entryExperienceStatus');
      if (status) status.textContent = error?.code === 'entry/write-failed'
        ? 'تعذّر حفظ الخطوة في الحساب. بقيت التجربة مفتوحة واختياراتك محفوظة على هذا الجهاز؛ حاول مرة أخرى.'
        : (error?.code === 'entry/profile-write-failed'
          ? 'تعذّر حفظ المظهر في حسابك. بقيت التجربة مفتوحة ولم نعتبرها مكتملة.'
          : 'تعذّر إكمال الخطوة. راجع اختيارك وحاول مرة أخرى.');
    }
  }

  function applyExplicitAppearance(state) {
    const selected = state || runtime.state;
    if (!selected?.themeExplicit) return;
    const themeId = selected.themeId;
    if (typeof root.setTheme === 'function') root.setTheme(themeId);
    localStorage.setItem(api().themeStorageKey(identityFor(runtime.user)), themeId);
    if (themeId === 'ocean') {
      if (typeof root.setProfileOasisMode === 'function') {
        root.setProfileOasisMode(selected.oasisMode || 'light');
      } else {
        setOasisMode(selected.oasisMode || 'light', { persist: true, user: runtime.user });
      }
    }
    if (!runtime.user) {
      sessionStorage.setItem('lootlingua:guest-theme-explicit:v1', JSON.stringify({
        themeId,
        oasisMode: selected.oasisMode || 'light',
        entryUpdatedAt: selected.updatedAt || Date.now(),
        at: Date.now(),
      }));
    }
  }

  function setOasisMode(mode, options) {
    const next = api().OASIS_MODES.includes(mode) ? mode : 'light';
    document.documentElement.setAttribute('data-oasis-mode', next);
    if (options?.persist) {
      localStorage.setItem(api().oasisModeStorageKey(identityFor(options.user)), next);
      localStorage.setItem('lootlinguaOasisMode', next);
    }
    return next;
  }

  function createOperationId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return `journey-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function closeJourneyAuthPrompt(options) {
    const prompt = document.getElementById('journeyAuthPrompt');
    if (prompt) prompt.remove();
    document.removeEventListener('keydown', onJourneyAuthPromptKeydown, true);
    document.documentElement.classList.remove('journey-auth-active');
    document.body.classList.remove('journey-auth-active');
    setBackgroundInert(false);
    if (runtime.opened) setBackgroundInert(true);
    const authPromptFocus = runtime.authPromptFocus;
    if (!options?.silent && authPromptFocus?.isConnected) {
      requestAnimationFrame(() => authPromptFocus.focus?.({ preventScroll: true }));
    }
    runtime.authPromptFocus = null;
  }

  function dismissJourneyAuthPrompt() {
    closeJourneyAuthPrompt();
  }

  function claimGuestPendingIntentForUser(user) {
    if (!user?.uid) return null;
    const guestKey = api().pendingIntentStorageKey({});
    const accountKey = api().pendingIntentStorageKey(identityFor(user));
    const guestRaw = readJson(guestKey, null);
    if (!guestRaw) return null;
    const selection = api().resolvePendingIntentCandidate(
      readJson(accountKey, null),
      guestRaw,
      Date.now()
    );
    if (!selection.intent) return null;
    writeJson(accountKey, selection.intent);
    localStorage.removeItem(guestKey);
    return selection.intent;
  }

  function claimGuestThemeForUser(user) {
    if (!user?.uid) return;
    const key = 'lootlingua:guest-theme-explicit:v1';
    const marker = safeParse(sessionStorage.getItem(key), null);
    if (!marker || marker.targetUid === user.uid) return;
    if (marker.targetUid) return;
    sessionStorage.setItem(key, JSON.stringify({ ...marker, targetUid: user.uid }));
  }

  function onJourneyAuthPromptKeydown(event) {
    const prompt = document.getElementById('journeyAuthPrompt');
    if (!prompt) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissJourneyAuthPrompt();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...prompt.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showJourneyAuthPrompt(intent) {
    closeJourneyAuthPrompt({ silent: true });
    runtime.authPromptFocus = document.activeElement;
    const prompt = document.createElement('div');
    prompt.id = 'journeyAuthPrompt';
    prompt.className = 'journey-auth-prompt';
    prompt.innerHTML = `
      <div class="journey-auth-backdrop" aria-hidden="true"></div>
      <section class="journey-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="journeyAuthTitle" aria-describedby="journeyAuthBody">
        <span class="entry-eyebrow">خطوتك محفوظة</span>
        <h2 id="journeyAuthTitle">سجّل دخولك لبدء الرحلة</h2>
        <p id="journeyAuthBody">سنحفظ بيانات الضيف أولًا، ثم نعيدك إلى العالم نفسه ونكمل طلبك مرة واحدة.</p>
        <p class="journey-auth-status" id="journeyAuthStatus" role="status" aria-live="polite"></p>
        <div class="journey-auth-actions">
          <button type="button" class="entry-primary" data-journey-auth="login">اختيار طريقة تسجيل الدخول</button>
          <button type="button" class="entry-secondary" data-journey-auth="guest">استكشف كضيف الآن</button>
        </div>
      </section>`;
    document.body.appendChild(prompt);
    document.documentElement.classList.add('journey-auth-active');
    document.body.classList.add('journey-auth-active');
    setBackgroundInert(true);
    prompt.querySelector('[data-journey-auth="guest"]')?.addEventListener('click', dismissJourneyAuthPrompt);
    prompt.querySelector('[data-journey-auth="login"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = prompt.querySelector('#journeyAuthStatus');
      button.disabled = true;
      if (status) status.textContent = 'جاري فتح خيارات تسجيل الدخول…';
      try {
        if (typeof root.openAppAuth !== 'function') throw new Error('auth-unavailable');
        closeJourneyAuthPrompt({ silent: true });
        root.openAppAuth('login');
      } catch (_) {
        button.disabled = false;
        if (status) status.textContent = 'تعذّر تسجيل الدخول الآن. حاول مرة أخرى من دون فقدان خطوتك.';
      }
    });
    document.addEventListener('keydown', onJourneyAuthPromptKeydown, true);
    requestAnimationFrame(() => prompt.querySelector('[data-journey-auth="login"]')?.focus());
    return intent;
  }

  function requestJourneyAuth(rawIntent) {
    const now = Date.now();
    const intent = api().sanitizePendingIntent({
      ...rawIntent,
      source: rawIntent?.source || 'world',
      entryStep: runtime.state?.currentStep || 'destination',
      operationId: createOperationId(),
      createdAt: now,
      status: 'pending',
      returnTo: `${location.pathname}${location.search}${location.hash}`,
    }, now);
    if (!intent) return null;
    writeJson(api().pendingIntentStorageKey({}), intent);
    showJourneyAuthPrompt(intent);
    return intent;
  }

  function pendingIntentCandidates(user) {
    const accountKey = api().pendingIntentStorageKey(identityFor(user));
    const guestKey = api().pendingIntentStorageKey({});
    return {
      accountKey,
      guestKey,
      accountRaw: readJson(accountKey, null),
      guestRaw: readJson(guestKey, null),
    };
  }

  async function consumePendingJourneyIntent(options) {
    const user = runtime.user || root.auth?.currentUser;
    if (!user || runtime.intentConsuming || (runtime.opened && !options?.allowWhileOpen)) return false;
    const candidates = pendingIntentCandidates(user);
    if (!candidates.accountRaw && !candidates.guestRaw) return false;
    const selection = api().resolvePendingIntentCandidate(
      candidates.accountRaw,
      candidates.guestRaw,
      Date.now()
    );
    if (candidates.accountRaw && !selection.accountValid) {
      localStorage.removeItem(candidates.accountKey);
    }
    if (candidates.guestRaw && !selection.guestValid) {
      localStorage.removeItem(candidates.guestKey);
    }
    const intent = selection.intent;
    if (!intent) return false;
    if (intent.status === 'consumed' || intent.status === 'cancelled') {
      if (
        selection.source === 'guest' ||
        api().sanitizePendingIntent(candidates.guestRaw, Date.now())?.operationId === intent.operationId
      ) {
        localStorage.removeItem(candidates.guestKey);
      }
      return false;
    }
    if (intent.status === 'consuming' && intent.leaseUntil > Date.now()) return false;
    const mirrorGuestCandidate = selection.guestValid;

    const run = async () => {
      if (runtime.intentConsuming) return false;
      runtime.intentConsuming = true;
      const lease = api().sanitizePendingIntent({
        ...intent,
        status: 'consuming',
        leaseUntil: Date.now() + 45_000,
      }, Date.now());
      writeJson(candidates.accountKey, lease);
      if (mirrorGuestCandidate) writeJson(candidates.guestKey, lease);
      try {
        const published = root.LootLinguaPublishedContent;
        const actions = root.LootLinguaJourneyEntryActions;
        if (!published?.getPublishedWorld || !actions?.resumePendingIntent) {
          throw Object.assign(new Error('Journey entry is not ready.'), { retryable: true });
        }
        if (intent.returnTo && root.history?.replaceState) {
          try { root.history.replaceState(root.history.state, '', intent.returnTo); } catch (_) {}
        }
        const world = await published.getPublishedWorld(intent.worldId);
        if (!world) {
          const cancelled = api().sanitizePendingIntent({
            ...intent,
            status: 'cancelled',
            leaseUntil: 0,
          }, Date.now());
          writeJson(candidates.accountKey, cancelled);
          localStorage.removeItem(candidates.guestKey);
          root.showToast?.('العالم الذي اخترته لم يعد متاحًا. يمكنك اختيار عالم آخر.', 'info', 4600);
          root.loadWorldsView?.();
          return false;
        }
        const restoration = await actions.resumePendingIntent(intent, world);
        if (restoration?.restored !== true) {
          throw Object.assign(new Error('The requested Journey action did not complete.'), {
            code: 'journey/intent-not-completed',
            retryable: true,
          });
        }
        const consumed = api().sanitizePendingIntent({
          ...intent,
          status: 'consumed',
          leaseUntil: 0,
          consumedAt: Date.now(),
        }, Date.now());
        writeJson(candidates.accountKey, consumed);
        localStorage.removeItem(candidates.guestKey);
        closeJourneyAuthPrompt({ silent: true });
        return true;
      } catch (error) {
        const pending = api().sanitizePendingIntent({
          ...intent,
          status: 'pending',
          leaseUntil: 0,
        }, Date.now());
        writeJson(candidates.accountKey, pending);
        if (mirrorGuestCandidate) writeJson(candidates.guestKey, pending);
        if (!error?.retryable) root.showToast?.('تعذّرت استعادة طلب الرحلة. سنحتفظ به للمحاولة التالية.', 'danger', 4800);
        return false;
      } finally {
        runtime.intentConsuming = false;
      }
    };

    if (root.navigator?.locks?.request) {
      return root.navigator.locks.request(`lootlingua-intent-${intent.operationId}`, { ifAvailable: true }, (lock) => (
        lock ? run() : false
      ));
    }
    return run();
  }

  async function openEntryDestination(id, expected) {
    if (id === 'resume-quiz') {
      if (typeof root.loadQuizView !== 'function') throw new Error('Quiz destination is unavailable.');
      root.loadQuizView();
      return { type: 'quiz' };
    }
    if (id === 'continue-journey' || id === 'resume-journey-session') {
      const worldId = expected?.worldId || runtime.signals?.activeJourney?.worldId;
      if (!worldId || typeof root.loadWorldsView !== 'function' || typeof root.openPublishedWorld !== 'function') {
        throw new Error('Journey destination is unavailable.');
      }
      root.loadWorldsView();
      root.openPublishedWorld(worldId);
      return { type: 'world', worldId };
    }
    if (id === 'open-selected-world') {
      const worldId = expected?.worldId || runtime.state?.selectedWorldId;
      if (!worldId || typeof root.loadWorldsView !== 'function' || typeof root.openPublishedWorld !== 'function') {
        throw new Error('Selected World destination is unavailable.');
      }
      const published = root.LootLinguaPublishedContent;
      if (published?.getPublishedWorld) {
        const world = await published.getPublishedWorld(worldId);
        if (!world) {
          root.loadWorldsView();
          root.showToast?.('هذا العالم لم يعد منشورًا. اختر عالمًا آخر من قائمة العوالم.', 'info', 4200);
          return { type: 'worlds' };
        }
      }
      root.loadWorldsView();
      root.openPublishedWorld(worldId);
      return { type: 'world', worldId };
    }
    if (id === 'review-words' || id === 'new-user-start') {
      if (typeof root.loadPersonalDictionary !== 'function') {
        throw new Error('Dictionary destination is unavailable.');
      }
      root.loadPersonalDictionary();
      return { type: 'dictionary', focusWordInput: id === 'new-user-start' };
    }
    if (id === 'explore-worlds' || id === 'suggest-placement') {
      if (typeof root.loadWorldsView !== 'function') throw new Error('Worlds destination is unavailable.');
      root.loadWorldsView();
      return { type: 'worlds' };
    }
    throw new Error('Unsupported Entry destination.');
  }

  async function runCta(id) {
    if (!runtime.state || runtime.state.status !== 'in-progress' || runtime.state.currentStep !== 'destination') return;
    const expected = currentNextAction();
    if (![expected?.id, expected?.secondaryId].filter(Boolean).includes(id)) return;
    if (!['structure-explored', 'return-reviewed'].includes(runtime.state.journeyStatus)) return;
    if (api().ctaContradictsSignals({ ...expected, id }, runtime.signals)) return;

    setBusy(true, 'جارٍ فتح وجهتك…');
    try {
      const destination = await openEntryDestination(id, expected);
      const completed = api().transitionState(runtime.state, { type: 'complete' }, Date.now());
      await commitTerminalState(completed, 'جارٍ حفظ اكتمال التجربة…', { applyAppearance: true });
      close();
      if (destination.focusWordInput) {
        setTimeout(() => document.getElementById('wordInput')?.focus(), 0);
      }
    } catch (error) {
      setBusy(false);
      const status = document.getElementById('entryExperienceStatus');
      if (status) status.textContent = error?.code === 'entry/write-failed'
        ? `وصلنا إلى وجهتك، لكن تعذّر تأكيد اكتمال التجربة في حسابك. أبقيناها مفتوحة للمحاولة مرة أخرى.${error?.diagnostic?.firebaseCode ? ` (${error.diagnostic.firebaseCode} / ${error.diagnostic.phase})` : ''}`
        : (error?.code === 'entry/validation-failed'
          ? `تعذّر التحقق من حالة اكتمال التجربة محليًا.${error?.diagnostic?.firebaseCode ? ` (${error.diagnostic.firebaseCode})` : ''}`
          : (error?.code === 'entry/verification-failed'
            ? `تمت كتابة حالة التجربة، لكن تعذّر التحقق منها بعد الحفظ.${error?.diagnostic?.firebaseCode ? ` (${error.diagnostic.firebaseCode} / ${error.diagnostic.phase})` : ''}`
        : (error?.code === 'entry/profile-write-failed'
          ? 'تعذّر حفظ المظهر في حسابك. لم نغلق التجربة ولم نعتبرها مكتملة.'
          : 'تعذّر فتح الوجهة المطلوبة. بقيت التجربة مفتوحة ولم تُعتبر مكتملة.')));
    }
  }

  function setBackgroundInert(active) {
    if (active) {
      runtime.inerted = [];
      Array.from(document.body.children).forEach((element) => {
        if (['entryExperienceRoot', 'journeyAuthPrompt', 'appAuthDialogShell'].includes(element.id) || ['SCRIPT'].includes(element.tagName)) return;
        if (element.id === 'smartLoadingOverlay') return;
        runtime.inerted.push({
          element,
          inert: Boolean(element.inert),
          ariaHidden: element.getAttribute('aria-hidden'),
        });
        if ('inert' in HTMLElement.prototype) element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      });
    } else {
      runtime.inerted.forEach((record) => {
        const element = record?.element;
        if (!element?.isConnected) return;
        if ('inert' in HTMLElement.prototype) element.inert = record.inert;
        if (record.ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', record.ariaHidden);
      });
      runtime.inerted = [];
    }
  }

  function focusables() {
    return Array.from(panelElement()?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || []).filter((element) => !element.hidden && element.getClientRects().length > 0);
  }

  function onKeydown(event) {
    if (!runtime.opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      panelElement()?.querySelector('[data-entry-action="cancel-settings"], [data-entry-action="skip-interests"], [data-entry-action="back"]')?.focus();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const active = document.activeElement;
      const attribute = active?.hasAttribute('data-entry-theme')
        ? 'data-entry-theme'
        : (active?.hasAttribute('data-entry-oasis-mode') ? 'data-entry-oasis-mode' : '');
      if (attribute) {
        const radios = [...panelElement().querySelectorAll(`[${attribute}]`)];
        const index = radios.indexOf(active);
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const next = radios[(index + delta + radios.length) % radios.length];
        if (next) {
          event.preventDefault();
          next.click();
        }
        return;
      }
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open() {
    const shell = rootElement();
    if (!shell || runtime.opened) {
      if (runtime.opened) render();
      return;
    }
    runtime.opened = true;
    runtime.previousFocus = document.activeElement;
    root.__entryExperienceActive = true;
    shell.hidden = false;
    shell.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('entry-experience-active');
    document.body.classList.add('entry-experience-active');
    setBackgroundInert(true);
    document.addEventListener('keydown', onKeydown, true);
    render();
    focusEntryHeading();
  }

  function close(options) {
    const shell = rootElement();
    runtime.opened = false;
    root.__entryExperienceActive = false;
    if (shell) {
      shell.hidden = true;
      shell.setAttribute('aria-hidden', 'true');
    }
    document.documentElement.classList.remove('entry-experience-active');
    document.body.classList.remove('entry-experience-active');
    document.removeEventListener('keydown', onKeydown, true);
    setBackgroundInert(false);
    const previousFocus = runtime.previousFocus;
    if (!options?.silent && previousFocus?.isConnected) {
      requestAnimationFrame(() => previousFocus.focus?.({ preventScroll: true }));
    }
    runtime.previousFocus = null;
    root.flushDeferredEntryToasts?.();
  }

  function init() {
    if (runtime.initialized || !api()) return;
    runtime.initialized = true;
    root.addEventListener('lootlingua:auth-state', (event) => {
      runtime.bootToken += 1;
      if (event.detail?.user) {
        captureGuestSnapshot();
        claimGuestPendingIntentForUser(event.detail.user);
        claimGuestThemeForUser(event.detail.user);
        closeJourneyAuthPrompt({ silent: true });
      }
      if (runtime.opened) setBusy(true, 'جارٍ ربط حسابك ومتابعة خطوتك…');
      queueMicrotask(boot);
    });
    root.addEventListener('lootlingua:profile-snapshot', () => queueMicrotask(boot));
    root.addEventListener('lootlingua:initial-data-ready', () => queueMicrotask(boot));
    root.addEventListener('lootlingua:entry-cloud-ready', () => queueMicrotask(boot));
    root.addEventListener('lootlingua:journey-cloud-ready', () => queueMicrotask(boot));
    root.addEventListener('lootlingua:word-mastery-snapshot', () => queueMicrotask(boot));
    root.addEventListener('lootlingua:worlds-entry-preview-ready', () => {
      if (runtime.state?.currentStep === 'worlds') queueMicrotask(() => ensureWorldChoices(true));
      else if (runtime.state?.currentStep === 'journey') queueMicrotask(() => ensureStructurePreview(true));
      else if (runtime.state?.currentStep === 'return') queueMicrotask(() => ensureReturnPreview(true));
    });
    queueMicrotask(boot);
  }

  function openSettings(section) {
    const state = runtime.state;
    if (!state) return;
    runtime.settingsMode = section === 'interests' ? 'interests' : 'theme';
    runtime.settingsBaseState = state;
    runtime.state = {
      ...state,
      status: 'in-progress',
      currentStep: runtime.settingsMode,
      source: 'settings',
    };
    open();
  }

  const CONTROLLER = Object.freeze({
    init,
    boot,
    openSettings,
    close,
    captureGuestSnapshot,
    setOasisMode,
    requestJourneyAuth,
    consumePendingJourneyIntent,
    getState: () => runtime.state ? { ...runtime.state, interestIds: [...runtime.state.interestIds] } : null,
    getPresentation: () => runtime.presentation ? { ...runtime.presentation } : null,
    isActive: () => runtime.opened,
  });

  Object.defineProperty(root, 'LootLinguaEntryExperienceController', {
    value: CONTROLLER,
    configurable: false,
    enumerable: true,
    writable: false,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else init();
})(typeof window !== 'undefined' ? window : globalThis);
