/* Practice arcade entry points. Resources are only loaded on explicit launch. */
(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  let resources, pending = false;

  function loadGame() {
    if (resources) return resources;
    const link = document.createElement('link');
    const styles = new Promise((resolve, reject) => {
      link.rel = 'stylesheet'; link.href = new URL('loot-bots.css?v=2', base);
      link.onload = resolve; link.onerror = () => reject(new Error('Arena stylesheet unavailable'));
      document.head.append(link);
    });
    resources = Promise.all([styles, import(new URL('js/loot-bots-game.mjs?v=2', base))])
      .then(([, game]) => game)
      .catch(error => { link.remove(); resources = null; throw error; });
    return resources;
  }

  async function launch(button, { source, words, isSourceCurrent }) {
    if (pending || window.__lootlinguaRunnerInputActive) return;
    pending = true;
    const uid = window.auth?.currentUser?.uid, generation = window.__lootlinguaAuthGeneration;
    const isCurrent = () => uid === window.auth?.currentUser?.uid && generation === window.__lootlinguaAuthGeneration && isSourceCurrent();
    const heading = button.querySelector('strong') || button, label = heading.textContent;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); heading.textContent = 'جارٍ تجهيز الساحة…';
    try {
      const [game, deck] = await Promise.all([loadGame(), words()]);
      if (!isCurrent() || window.__lootlinguaRunnerInputActive) return;
      button.disabled = false;
      const result = game.openBattle({ words: deck, source, isCurrent, returnFocus: button });
      if (result === 'small') window.showToast?.('الساحة تحتاج كلمتين على الأقل بمعنيين مختلفين من هذا المصدر.', 'info');
    } catch (error) {
      if (isCurrent()) window.showToast?.('تعذّر تجهيز كلمات الساحة. حاول مرة ثانية.', 'warning');
    } finally {
      pending = false;
      button.disabled = false; button.removeAttribute('aria-busy'); heading.textContent = label;
    }
  }

  document.getElementById('lootBotsDictionary')?.addEventListener('click', event => {
    const button = event.currentTarget;
    void launch(button, {
      source: 'كلمات قاموسك الشخصي',
      isSourceCurrent: () => currentView === 'quiz' && document.getElementById('quizViewSetup')?.style.display !== 'none',
      words: async () => {
        const snapshot = await window.ensureQuizSourceReady('personal', { mode: 'lootBots' });
        if (!snapshot || snapshot.error || snapshot.stale) throw new Error('Dictionary source unavailable');
        return snapshot.candidates;
      },
    });
  });

  window.LootLinguaBots = {
    renderGate({ worldId, rankId, gateId, title, isSourceCurrent }) {
      const card = document.createElement('aside'); card.className = 'gate-runner-card loot-bots-gate-card';
      const copy = document.createElement('div'); copy.className = 'gate-runner-card-copy';
      const heading = document.createElement('strong'); heading.textContent = 'Loot Bots'; heading.lang = 'en';
      const desc = document.createElement('span'); desc.textContent = 'صوّب وقاتل وفكّ رمز محطة الطاقة بكلمات هذه البوابة. تدريب دون رفع الإتقان.';
      const button = document.createElement('button'); button.className = 'gate-runner-launch'; button.type = 'button'; button.textContent = 'ادخل الساحة';
      button.addEventListener('click', () => { void launch(button, {
        source: `كلمات بوابة ${title || ''}`.trim(), isSourceCurrent,
        words: () => window.LootLinguaPublishedContent.listAllPublishedGateWords(worldId, rankId, gateId),
      }); });
      copy.append(heading, desc); card.append(copy, button);
      return card;
    },
  };
})();
