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

  function recoverTerminalAsActionDraft(state) {
    const normalized = api().normalizeEntryState(state);
    if (!normalized || !api().isTerminalState(normalized)) return normalized;
    return api().normalizeEntryState({
      ...normalized,
      status: 'in-progress',
      currentStep: 'action',
      completedAt: 0,
      skippedAt: 0,
      updatedAt: Date.now(),
    });
  }

  function reconcileAccountDraft(cloudState, localState, cloudReadSucceeded) {
    const account = api().normalizeEntryState(cloudState);
    let local = api().normalizeEntryState(localState);
    if (account && api().isTerminalState(account)) return account;
    const accountNeedsFirstActionProof = account &&
      account.status !== 'in-progress' && !api().isTerminalState(account);
    if (accountNeedsFirstActionProof && local?.status === 'in-progress') return local;
    const localNeedsFirstActionProof = local &&
      local.status !== 'in-progress' && !api().isTerminalState(local);
    if (accountNeedsFirstActionProof && localNeedsFirstActionProof) {
      // Keep the legacy terminal marker intact until boot has the current
      // learning signals. Turning two old completed caches into an in-progress
      // merge here would lose whether recovery must restart at interests or use
      // the real-progress shortcut.
      return Number(local.updatedAt || 0) > Number(account.updatedAt || 0)
        ? local
        : account;
    }
    if (local && api().isTerminalState(local)) {
      if (!cloudReadSucceeded) return local;
      local = recoverTerminalAsActionDraft(local);
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
        if (journeyApi?.getActiveJourney) activeJourney = await journeyApi.getActiveJourney();
        if (token !== runtime.bootToken) return null;
        hasJourneyProgress = Boolean(activeJourney);
        if (!hasJourneyProgress && journeyApi?.hasAnyJourneyProgress) {
          hasJourneyProgress = await journeyApi.hasAnyJourneyProgress();
        }
        if (token !== runtime.bootToken) return null;
        if (activeJourney?.worldId && journeyApi?.resolveActiveJourneyDestination) {
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

    let guest = runtime.capturedGuest?.entryState || null;
    if (guest && guest.status !== 'in-progress' && !api().isTerminalState(guest)) {
      // Anonymous completed/skipped v1 documents came from the broken flow and
      // carry no durable first-action proof. Migrate them as a full draft.
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
          account = recoverTerminalAsActionDraft(account);
        }
      } else if (account && api().isTerminalState(account)) {
        // The account already owns a terminal v1. Claim this anonymous snapshot
        // so it cannot later complete a different account on the same device.
        claimGuestEntry(user, guest);
      }
    }
    if (!cloudReadSucceeded && !cloud()?.load) account = reconcileAccountDraft(null, local, false);
    return { state: account, cloudReadFailed };
  }

  function existingPreferences(user, state, profileSnapshot) {
    const profile = profileSnapshot?.data || {};
    const preservableThemes = api().PRESERVABLE_THEME_IDS || api().THEME_IDS;
    const themeId = state?.themeId || (
      preservableThemes.includes(profile.theme) ? profile.theme : ''
    ) || (!user && preservableThemes.includes(runtime.capturedGuest?.profile?.theme)
      ? runtime.capturedGuest.profile.theme
      : '');
    const scopedOasis = localStorage.getItem(api().oasisModeStorageKey(identityFor(user)));
    return {
      interestIds: state?.interestIds || [],
      themeId,
      oasisMode: state?.oasisMode || profile.oasisMode || scopedOasis || 'light',
    };
  }

  function baselinePreferences(user, state, profileSnapshot) {
    const profile = profileSnapshot?.data || {};
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
    const initialInterestIds = profileInterests.length ? profileInterests : (state?.interestIds || []);
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
    if (user) {
      const loaded = await loadAccountEntry(user, token);
      if (token !== runtime.bootToken) return;
      entryState = loaded.state;
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
    runtime.action = api().resolveNextAction(signals);
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
    announceEntryState();
    open();
    if (user && runtime.state.currentStep === 'action') {
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
    const index = step === 'interests' ? 1 : (step === 'theme' ? 2 : 3);
    return `الخطوة ${index} من 3`;
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
          <button type="button" class="entry-primary" data-entry-action="continue-action">جرّب أول خطوة <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></button>
        </div>
      </footer>
    `;
    bindPanelActions();
  }

  function renderAction() {
    const panel = panelElement();
    if (!panel) return;
    const action = runtime.action || api().resolveNextAction(runtime.signals || {});
    const isProgressReturn = runtime.presentation?.classification === 'returning-with-progress';
    const firstActionCompleted = runtime.state?.actionStatus === 'completed';
    const showDestination = isProgressReturn || firstActionCompleted;
    panel.innerHTML = `
      <div class="entry-action-screen">
        <header class="entry-header entry-action-header">
          <span class="entry-eyebrow">${isProgressReturn ? 'تقدّمك في مكانه' : 'جرّب قيمة LootLingua'}</span>
          <span class="entry-step-label">${isProgressReturn ? 'عودة سريعة' : stepIndicator('action')}</span>
        </header>
        <span class="entry-action-icon"><i class="fa-solid ${isProgressReturn ? 'fa-route' : 'fa-language'}" aria-hidden="true"></i></span>
        <h1 id="entryExperienceTitle">${isProgressReturn ? 'رحلتك جاهزة للمتابعة' : 'من كلمة إلى معرفة قابلة للمراجعة'}</h1>
        ${isProgressReturn ? `
          <p>${escapeHtml(action.hint)}</p>
        ` : `
          <p>اكشف معنى الكلمة لترى كيف يحوّل LootLingua ما تقابله إلى بطاقة واضحة يمكنك حفظها ومراجعتها لاحقًا.</p>
          <div class="entry-first-action-card${firstActionCompleted ? ' is-revealed' : ''}">
            <span class="entry-first-action-label">كلمة تجريبية</span>
            <strong lang="en" dir="ltr">Adventure</strong>
            <span class="entry-first-action-meaning" ${firstActionCompleted ? '' : 'hidden'}>مغامرة · تجربة مليئة بالاكتشاف</span>
            ${firstActionCompleted
              ? '<span class="entry-first-action-success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> هكذا تبدأ بطاقتك، من دون إنشاء حساب.</span>'
              : '<button type="button" class="entry-primary entry-reveal-action" data-entry-action="reveal-value">اكشف المعنى</button>'}
          </div>
          ${showDestination ? `<p class="entry-action-destination-hint">${escapeHtml(action.hint)}</p>` : ''}
        `}
        ${showDestination ? `
          <div class="entry-action-destinations">
            ${isProgressReturn ? '' : '<button type="button" class="entry-secondary" data-entry-action="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> رجوع</button>'}
            <button type="button" class="entry-primary entry-action-primary" data-entry-cta="${action.id}">${escapeHtml(action.label)} <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
            ${action.secondaryId ? `<button type="button" class="entry-secondary entry-action-secondary" data-entry-cta="${action.secondaryId}">${escapeHtml(action.secondaryLabel)}</button>` : ''}
          </div>
        ` : ''}
      </div>
    `;
    bindPanelActions();
  }

  function render() {
    if (!runtime.state) return;
    if (runtime.state.status !== 'in-progress' || runtime.state.currentStep === 'action') renderAction();
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
        committed = await cloud().save(normalized, runtime.user) || normalized;
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
      else if (action === 'continue-action') {
        transition({ type: 'continue-action' });
      }
      else if (action === 'reveal-value') transition({ type: 'complete-action' });
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
          <button type="button" class="entry-primary" data-journey-auth="login">المتابعة بحساب Google</button>
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
      if (status) status.textContent = 'جاري فتح تسجيل الدخول…';
      try {
        if (typeof root.login !== 'function') throw new Error('auth-unavailable');
        await root.login();
        if (!root.auth?.currentUser) {
          button.disabled = false;
          if (status) status.textContent = 'لم يكتمل تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة كضيف.';
        }
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
      entryStep: runtime.state?.currentStep || 'action',
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
    if (!runtime.state || runtime.state.status !== 'in-progress' || runtime.state.currentStep !== 'action') return;
    const expected = runtime.action || api().resolveNextAction(runtime.signals || {});
    if (![expected?.id, expected?.secondaryId].filter(Boolean).includes(id)) return;
    const actionReady = runtime.state.actionStatus === 'completed' || (
      runtime.presentation?.classification === 'returning-with-progress' &&
      runtime.state.actionStatus === 'ready'
    );
    if (!actionReady) return;
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
        ? 'وصلنا إلى وجهتك، لكن تعذّر تأكيد اكتمال التجربة في حسابك. أبقيناها مفتوحة للمحاولة مرة أخرى.'
        : (error?.code === 'entry/profile-write-failed'
          ? 'تعذّر حفظ المظهر في حسابك. لم نغلق التجربة ولم نعتبرها مكتملة.'
          : 'تعذّر فتح الوجهة المطلوبة. بقيت التجربة مفتوحة ولم تُعتبر مكتملة.');
    }
  }

  function setBackgroundInert(active) {
    if (active) {
      runtime.inerted = [];
      Array.from(document.body.children).forEach((element) => {
        if (['entryExperienceRoot', 'journeyAuthPrompt'].includes(element.id) || ['SCRIPT'].includes(element.tagName)) return;
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
