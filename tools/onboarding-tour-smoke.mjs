import assert from 'node:assert/strict';

export async function checkOnboardingSections({ run, click, waitFor, until, cdp, screenshot }) {
  const coach = '#lootlinguaSectionTour';
  const trace = [];
  const select = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  async function step(topic, { ready = true } = {}) {
    const selector = coach + '[data-guide-topic="' + topic + '"]' + (ready ? '[data-guide-ready="true"]' : '');
    const state = await until(() => run(`(() => {
      const coach = ${select(selector)};
      if (!coach) return null;
      const options = coach.querySelector('.section-tour-options');
      const anchor = document.querySelector('.coach-highlight-target');
      const a = anchor?.getBoundingClientRect();
      const b = coach.getBoundingClientRect();
      const overlap = a && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const dock = document.getElementById('legendDock')?.getBoundingClientRect();
      if (overlap || b.left < -1 || b.right > innerWidth + 1 || (dock?.height && b.bottom > dock.top + 1)) return null;
      return { topic: coach.dataset.guideTopic, section: coach.dataset.guideSection, path: location.pathname,
        highlighted: Boolean(a), ready: coach.dataset.guideReady === 'true', overlap: Boolean(overlap),
        singleAction: coach.querySelectorAll('.section-tour-actions > button').length === 1,
        options: options.querySelector('summary').textContent.trim(), menu: options.open };
    })()`), 'section step ' + topic);
    assert.equal(state.singleAction, true);
    assert.equal(state.options, '⋯');
    assert.equal(state.menu, false);
    if (ready) assert.equal(state.highlighted, true, topic);
    trace.push(state);
    return state;
  }
  async function command(name) {
    if (name !== 'next' && !await run(select(coach + ' details') + '.open')) {
      await click(coach + ' details > summary');
    }
    await click(coach + ' [data-guide-command="' + name + '"]');
  }
  async function index() {
    if (await run('Boolean(' + select(coach) + ')')) await command('index');
    if (!await run('Boolean(document.querySelector("#profileModal.open"))')) await click('#heroAvatarBtn');
    if (!await run('document.querySelector("#lootlinguaGuide").open')) await click('#lootlinguaGuide > summary');
  }
  async function visit(topic, opts) {
    await index();
    const item = '[data-guide-topics="' + topic + '"]';
    if (!await run(select(item) + '.open')) await click(item + ' > summary');
    const prior = await run('window.LootLinguaGuide.covered(' + JSON.stringify(topic) + ')');
    await click(item + ' [data-guide-visit]');
    const result = await step(topic, opts);
    assert.equal(await run('window.LootLinguaGuide.covered(' + JSON.stringify(topic) + ')'), prior,
      'Showing the first step must not complete ' + topic);
    await screenshot('tour-' + topic);
    return result;
  }
  async function next(topic, opts) {
    await command('next');
    await step(topic, opts);
  }
  await visit('worlds');
  await click('#' + 'publishedWorldsPanel [data-guided-world]');
  await step('gate-start', { ready: false });
  await visit('dictionary');
  await next('search');
  await run(`(() => {
    const input = document.getElementById('wordInput');
    input.value = 'orbital';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await click('#searchBtn');
  await waitFor('#suggestionsList [data-action="select-ai-meaning"]');
  await next('meaning');
  await click('#suggestionsList [data-action="select-ai-meaning"]');
  await step('manual-meaning');
  await next('save');
  await click('#addBtn');
  await until(() => run('window.LootLinguaGuide.covered("save")'), 'coverage recorded after saving');
  if (await run('Boolean(document.querySelector("' + coach + '"))')) await command('next');
  await run('loadPersonalDictionary()');
  await click('.word-row .star-btn, .star-btn');
  await visit('starred');
  await visit('quiz');
  await click('#quizViewSetup .quiz-mode-time');
  await step('quiz-source');
  await click('#quizSettingsPanel [data-quiz-source="personal"]');
  await next('quiz-count');
  await click('#quizSettingsPanel [data-quiz-count="5"]');
  await next('quiz-launch');
  await next('personal-review');
  await next('games');
  await screenshot('tour-games');
  await visit('treasure');
  await next('treasure-extra');
  await waitFor('#treasureVault details summary');
  await click('#treasureVault details summary');
  assert.equal(await run('document.querySelector("#treasureVault details").open'), true);
  await visit('custom-worlds');
  await click('#customWorldsPanel .world-card-add');
  await step('custom-world-form');
  await screenshot('tour-custom-world-form');
  await visit('full-stats');
  await next('activity');
  await visit('profile');
  await next('xp');
  await next('ranks');
  await click('#xpRanksGuideToggle');
  await next('stats');
  await next('titles', { ready: false });
  await next('appearance');
  await next('settings');
  await screenshot('tour-profile-settings');
  await visit('notices');
  await click('#notifBtn');
  await waitFor('#notificationsPanel');
  await click('#notificationsPanel .notif-close');
  await visit('quests');
  await screenshot('tour-quests');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await run('document.querySelector("' + coach + ' details > summary").focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await run(select(coach + ' details') + '.open'), true);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => run('!document.querySelector("' + coach + '")'), 'keyboard pause');
  assert.equal(await run('document.querySelectorAll("#legendDock [data-discovery-pending]").length'), 0);
  return trace;
}

export async function checkOnboardingIdentity({ run, click, waitFor, until, cdp }) {
  const opening = '#lootlinguaSectionTour';
  const guestUid = await run('window.auth.currentUser.uid');
  await waitFor('button[data-guide-learn-gate]');
  await click('#heroAvatarBtn');
  await click('#lootlinguaGuide > summary');
  await click('[data-guide-topics="dictionary"] > summary');
  await click('[data-guide-visit="dictionary"]');
  await waitFor(opening + '[data-guide-topic="dictionary"]');
  await click(opening + ' [data-guide-command="next"]');
  await waitFor(opening + '[data-guide-topic="search"]');
  await click(opening + ' details > summary');
  await click(opening + ' [data-guide-command="pause"]');
  assert.equal(await run('window.LootLinguaGuide.status("dictionary")'), 'seen');
  const makeAccounts = await run(`(async () => {
    if (window.auth.app.options.projectId !== 'demo-lootlingua' || !window.auth.emulatorConfig) throw new Error('Local Auth required');
    const appSdk = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const sdk = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const app = appSdk.initializeApp(window.auth.app.options, 'qa-tour-account');
    const setup = sdk.getAuth(app);
    sdk.connectAuthEmulator(setup, 'http://127.0.0.1:9099', { disableWarnings: true });
    const password = 'LocalTestOnly-Pass4';
    const stamp = Date.now();
    const accounts = [];
    for (const label of ['destination', 'independent']) {
      const email = label + '-' + stamp + '@example.test';
      const { user } = await sdk.createUserWithEmailAndPassword(setup, email, password);
      accounts.push({ uid: user.uid, email });
      await sdk.signOut(setup);
    }
    window.__qaSecondarySignIn = index => sdk.signInWithEmailAndPassword(window.auth, accounts[index].email, password);
    return { accounts, password };
  })()`);
  await run('window.openAppAuth("login")');
  await waitFor('#appAuthDialogShell [data-auth-submit]');
  await run(`(() => {
    document.getElementById('appAuthEmail').value = ${JSON.stringify(makeAccounts.accounts[0].email)};
    document.getElementById('appAuthPassword').value = ${JSON.stringify(makeAccounts.password)};
    return true;
  })()`);
  await click('#appAuthDialogShell [data-auth-submit]');
  await click('.saved-guest-dialog[open] [data-saved-guest-merge]');
  await until(() => run('window.auth.currentUser?.uid === ' + JSON.stringify(makeAccounts.accounts[0].uid) +
    ' && window.LootLinguaGuide.covered("dictionary")'), 'existing account receives the guest coverage');
  const state = await run('JSON.parse(localStorage.getItem("lootlingua:guide-checkpoint:v1:" + window.auth.currentUser.uid))');
  assert.equal(state.topic, 'search');
  assert.equal(state.owner, makeAccounts.accounts[0].uid);
  assert.notEqual(state.owner, guestUid);
  assert.equal(await run('window.LootLinguaGuide.covered("search")'), false);
  const peerOpen = await cdp('Runtime.evaluate', { expression:
    'Boolean(window.__qaOtherTab = window.open(location.origin + "/app/dictionary?firebaseEmulator=1", "_blank"))',
    returnByValue: true, userGesture: true });
  assert.equal(peerOpen.result.value, true);
  await until(() => run('window.__qaOtherTab.auth?.currentUser?.uid === ' + JSON.stringify(makeAccounts.accounts[0].uid) +
    ' && window.__qaOtherTab.__lootlinguaInitialDataReady === true && Boolean(window.__qaOtherTab.LootLinguaGuide)'), 'same account loaded in real second tab');
  const peerClick = selector => until(() => run(`(() => {
    const node = window.__qaOtherTab.document.querySelector(${JSON.stringify(selector)});
    if (!node?.getClientRects().length || node.disabled) return false;
    node.click();
    return true;
  })()`), 'second tab ' + selector);
  await peerClick('#onboardingResume[data-coach="sectionTour"]');
  try {
    await peerClick(opening + '[data-guide-topic="search"][data-guide-ready="true"] [data-guide-command="next"]');
  } catch (error) {
    console.error('Peer tour state', await run(`(() => {
      const peer = window.__qaOtherTab;
      const coach = peer.document.querySelector('#lootlinguaSectionTour');
      const input = peer.document.getElementById('wordInput');
      return { path: peer.location.pathname, visibility: peer.document.visibilityState,
        topic: coach?.dataset.guideTopic, ready: coach?.dataset.guideReady, inputDisabled: input?.disabled,
        blocked: peer.LootLinguaSmartOnboarding.busy(), entry: peer.__entryExperienceActive,
        anchor: input?.getClientRects().length, popover: peer.LootLinguaPopover.getActiveId() };
    })()`));
    throw error;
  }
  await until(() => run('window.__qaOtherTab.LootLinguaGuide.covered("search")'), 'real search step completed in peer');
  await until(() => run('window.LootLinguaGuide.covered("search")'), 'peer step acknowledged across tabs');
  assert.equal(await run('document.querySelectorAll("#legendDock [data-discovery-pending]").length'), 0);
  await run('window.__qaOtherTab.close(); window.__qaSecondarySignIn(1).then(() => true)');
  await until(() => run('window.auth.currentUser?.uid === ' + JSON.stringify(makeAccounts.accounts[1].uid) +
    ' && window.__lootlinguaAuthResolved !== false'), 'second account loaded');
  assert.equal(await run('window.LootLinguaGuide.covered("dictionary") || window.LootLinguaGuide.covered("search")'), false);
  assert.equal(await run('Boolean(localStorage.getItem("lootlingua:guide-checkpoint:v1:" + window.auth.currentUser.uid))'), false);
  return { guestMerged: true, resumedTopic: 'search', realSecondTab: true, separateAccount: true };
}
