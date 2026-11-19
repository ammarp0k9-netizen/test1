(function attachGateLessonView(root) {
  'use strict';

  const contract = root.LootLinguaGateLesson;
  const tasks = new Map();
  const observed = new Map();
  const owner = () => root.auth?.currentUser?.uid || '';
  const gateKey = (uid, context) => uid + ':' + contract.keyFor(context);
  const storageKey = (uid, context) => 'lootlingua:gate-lesson:v1:' + gateKey(uid, context);
  let active = null;

  function read(uid, context) {
    try { return JSON.parse(localStorage.getItem(storageKey(uid, context)) || 'null'); }
    catch (_) { return null; }
  }

  function store(uid, context, state, words, interaction = false) {
    try {
      const previous = read(uid, context);
      const draft = contract.sameWords(previous?.state?.wordIds, state.wordIds)
        ? contract.merge(previous.state, state) : state;
      const checkpoint = contract.checkpointKey(draft);
      const unchanged = checkpoint === contract.checkpointKey(previous?.state);
      const activityAt = unchanged ? previous?.activityAt : interaction ? Date.now() : 0;
      localStorage.setItem(storageKey(uid, context), JSON.stringify({ state: draft, words, activityAt }));
      return draft;
    } catch (_) { return null; }
  }

  function status(context) {
    const uid = owner();
    if (!uid) return {};
    const local = read(uid, context);
    const remote = observed.get(gateKey(uid, context));
    return { ...remote, ...local, state: contract.merge(local?.state, remote?.state) };
  }

  function savedActivity(context, cloudState) {
    const uid = owner();
    const local = uid ? read(uid, context) : null;
    const remote = contract.upgrade(cloudState, { confirmed: true });
    const localState = contract.upgrade(local?.state);
    const state = contract.merge(remote, localState);
    const key = contract.checkpointKey(state);
    const localAt = contract.time(local?.activityAt);
    const remoteAt = contract.time(cloudState?.updatedAt);
    // A delayed upload does not restart inactivity on the device where the work happened.
    const activityAt = localAt && key === contract.checkpointKey(localState) ? localAt : Math.max(localAt, remoteAt);
    return { state, activityAt, key };
  }

  function inspect(context, progress) {
    const uid = owner();
    const key = gateKey(uid, context);
    const api = root.LootLinguaJourneyCloud;
    if (!uid || !api?.getGateLessonAccess || !progress?.loadedAt) return Promise.resolve(status(context));
    const cached = observed.get(key);
    if (cached && cached.progress === progress) return Promise.resolve(status(context));
    return api.getGateLessonAccess(context, { progress }).then(result => {
      if (owner() !== uid) return {};
      const saved = read(uid, context);
      const remote = contract.upgrade(result.state, { confirmed: result.confirmed === true });
      observed.set(key, { ...result, progress, state: contract.merge(remote, saved?.state) });
      return status(context);
    }).catch(() => status(context));
  }

  function dispatch(context, uid) {
    root.dispatchEvent(new CustomEvent('lootlingua:gate-lesson-changed', { detail: { ...context, uid } }));
  }

  function sync(view, immediate = false) {
    clearTimeout(view.timer);
    if (immediate) return flush(view);
    view.timer = setTimeout(() => void flush(view), 450);
    return Promise.resolve(false);
  }

  async function flush(view) {
    clearTimeout(view.timer);
    if (owner() !== view.uid) return false;
    const key = gateKey(view.uid, view.context);
    const previous = tasks.get(key) || Promise.resolve();
    const snapshot = view.state;
    const task = previous.catch(() => {}).then(async () => {
      if (owner() !== view.uid) return false;
      const state = await root.LootLinguaJourneyCloud.saveGateLessonState(view.context, snapshot);
      if (owner() !== view.uid) return false;
      view.state = contract.merge(view.state, state);
      view.state = store(view.uid, view.context, view.state, view.words) || view.state;
      observed.delete(key);
      dispatch(view.context, view.uid);
      return true;
    }).catch(() => false);
    tasks.set(key, task);
    const saved = await task;
    if (tasks.get(key) === task) tasks.delete(key);
    if (active === view && view.notice?.isConnected) {
      view.notice.textContent = saved ? '' : view.localSaved
        ? 'حُفظ على هذا الجهاز. سنحاول المزامنة عند عودة الاتصال.'
        : 'تعذّر حفظ موضعك. أعد المحاولة قبل الخروج.';
    }
    return saved;
  }

  function update(view, state, interaction = false) {
    const saved = store(view.uid, view.context, state, view.words, interaction);
    view.localSaved = Boolean(saved);
    view.state = saved || state;
    void sync(view);
  }

  function stopAudio(view) {
    view.soundToken += 1;
    view.audio?.pause();
    view.audio = null;
    if (view.spoke) root.speechSynthesis?.cancel();
    view.spoke = false;
    if (view.audioControl) setAudioState(view.audioControl, 'idle');
  }

  function audioSource(word) {
    let url = null;
    try {
      const candidate = new URL(word.audioUrl, root.location.href);
      if (word.audioUrl && (candidate.protocol === 'https:' ||
          (candidate.protocol === 'http:' && candidate.origin === root.location.origin))) url = candidate.href;
    } catch (_) {}
    const synthesis = typeof root.speechSynthesis?.speak === 'function' &&
      typeof root.SpeechSynthesisUtterance === 'function';
    return { url, synthesis, available: Boolean((url && typeof root.Audio === 'function') || synthesis) };
  }

  function setAudioState(control, state, message = '') {
    control.state = state;
    control.container.dataset.audioState = state;
    control.status.textContent = message;
    if (!control.button) return;
    control.button.setAttribute('aria-pressed', String(state === 'playing'));
    control.button.setAttribute('aria-busy', String(state === 'loading'));
    control.button.setAttribute('aria-label', (state === 'playing' ? 'إيقاف لفظ ' : 'اسمع لفظ ') + control.word);
    control.label.textContent = state === 'playing' ? 'إيقاف اللفظ' :
      state === 'loading' ? 'نجهّز الصوت…' : state === 'error' || state === 'blocked' ? 'حاول الاستماع مجددًا' : 'اسمع اللفظ';
    control.symbol.className = 'fa-solid ' + (state === 'playing' ? 'fa-stop' : 'fa-volume-high');
    control.button.hidden = state === 'unavailable';
  }

  function speak(view, word, control) {
    if (control.state === 'playing' || control.state === 'loading') {
      stopAudio(view);
      return;
    }
    stopAudio(view);
    view.audioControl = control;
    const token = view.soundToken;
    const current = () => active === view && token === view.soundToken;
    const source = audioSource(word);
    setAudioState(control, 'loading');
    function failed(error) {
      if (!current()) return;
      const code = error?.error || error?.name;
      view.spoke = false;
      if (code === 'canceled' || code === 'interrupted' || code === 'AbortError') return;
      if (code === 'NotAllowedError' || code === 'not-allowed') {
        setAudioState(control, 'blocked', 'أوقف المتصفح تشغيل الصوت. اضغط للمحاولة مرة أخرى.');
      } else if (['synthesis-unavailable', 'voice-unavailable', 'language-unavailable'].includes(code)) {
        setAudioState(control, 'unavailable', 'الصوت غير متاح هنا. يمكنك متابعة التعلّم باللفظ المكتوب.');
      } else {
        setAudioState(control, 'error', 'تعذّر تشغيل الصوت الآن. جرّب مرة أخرى أو تابع باللفظ المكتوب.');
      }
    }
    function synthesize() {
      if (!current()) return;
      if (!source.synthesis) return failed({ name: 'NetworkError' });
      const speech = new root.SpeechSynthesisUtterance(word.word);
      speech.lang = 'en-US';
      speech.onstart = () => { if (current()) setAudioState(control, 'playing'); };
      speech.onend = () => { if (current()) { view.spoke = false; setAudioState(control, 'idle'); } };
      speech.onerror = failed;
      view.spoke = true;
      try { root.speechSynthesis.speak(speech); }
      catch (error) { failed(error); }
    }
    if (source.url && typeof root.Audio === 'function') {
      const audio = new root.Audio(source.url);
      view.audio = audio;
      let fallbackStarted = false;
      const fallback = error => {
        if (!current() || fallbackStarted) return;
        fallbackStarted = true;
        if (error?.name === 'NotAllowedError') return failed(error);
        synthesize();
      };
      audio.addEventListener('playing', () => { if (current()) setAudioState(control, 'playing'); });
      audio.addEventListener('ended', () => { if (current()) setAudioState(control, 'idle'); });
      audio.addEventListener('error', fallback, { once: true });
      try { Promise.resolve(audio.play()).catch(fallback); }
      catch (error) { fallback(error); }
    } else synthesize();
  }

  function icon(name) {
    const node = element('i', 'fa-solid fa-' + name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function audioControl(view, word) {
    const container = element('div', 'gate-lesson-sound');
    const status = element('span', 'gate-lesson-audio-status');
    status.setAttribute('role', 'status');
    const control = { container, status, word: word.word, state: 'idle' };
    if (audioSource(word).available) {
      const label = element('span', '', 'اسمع اللفظ');
      const symbol = icon('volume-high');
      const button = action('', 'gate-lesson-audio', () => speak(view, word, control));
      button.setAttribute('aria-label', 'اسمع لفظ ' + word.word);
      button.setAttribute('aria-pressed', 'false');
      button.append(symbol, label);
      Object.assign(control, { button, label, symbol });
      const wave = element('span', 'gate-lesson-wave');
      wave.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 9; index += 1) wave.append(element('span', ''));
      container.append(button, wave);
    } else {
      container.append(element('span', 'gate-lesson-written-label', 'اللفظ المكتوب'));
      status.textContent = 'الصوت غير متاح في هذا المتصفح. تابع بالكلمة المكتوبة.';
      container.dataset.audioState = 'unavailable';
    }
    if (word.pronunciation) container.append(english(element('span', 'gate-lesson-pronunciation', word.pronunciation)));
    container.append(status);
    return container;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function action(label, className, run) {
    const button = element('button', className, label);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  }

  function english(node) {
    node.lang = 'en';
    node.dir = 'ltr';
    return node;
  }

  function close(view, { save = true, restoreFocus = true } = {}) {
    if (view !== active) return;
    active = null;
    stopAudio(view);
    clearTimeout(view.timer);
    root.LootLinguaModalFocus?.close(view.shell, { restoreFocus });
    view.shell.remove();
    document.body.classList.remove('gate-lesson-active');
    if (view.toastHost && view.toastParent) view.toastParent.insertBefore(view.toastHost,
      view.toastNext?.parentNode === view.toastParent ? view.toastNext : null);
    root.flushDeferredEntryToasts?.();
    root.LootLinguaSmartOnboarding?.schedule?.();
    root.dispatchEvent(new CustomEvent('lootlingua:gate-lesson-closed'));
    if (save && view.state) void flush(view);
    view.onClose?.();
  }

  const titles = { listen: 'اسمع الكلمة واربطها بمعناها', context: 'افهم الكلمة في سياقها',
    use: 'جرّب الكلمة في العبارة', recall: 'استرجع الكلمة', discover: 'تعرّف على الكلمة' };

  function sentence(word, gap = null, hideWord = false) {
    const line = english(element('p', 'gate-lesson-example'));
    if (!gap) {
      line.textContent = word.example;
      return line;
    }
    const focus = element('mark', hideWord ? 'gate-lesson-gap' : '', hideWord ? '…' :
      word.example.slice(gap[0].length, gap[0].length + word.word.length));
    if (hideWord) focus.setAttribute('aria-label', 'الكلمة الناقصة');
    line.append(gap[0], focus, gap[1]);
    return line;
  }

  function relation(word) {
    const pair = element('div', 'gate-lesson-relation');
    pair.append(english(element('strong', 'gate-lesson-answer-word', word.word)),
      icon('arrows-left-right'), element('span', 'gate-lesson-answer-meaning', word.translation));
    return pair;
  }

  function supportText(word, includeExample = true) {
    const group = element('div', 'gate-lesson-teaching-copy');
    if (word.example && includeExample) group.append(sentence(word, contract.cloze(word)));
    if (word.example && word.exampleTranslation) group.append(element('p', 'gate-lesson-translation', word.exampleTranslation));
    const definition = word.definition_ar || word.definition;
    if (definition) {
      const copy = element('p', 'gate-lesson-definition', definition);
      copy.lang = word.definition_ar ? 'ar' : 'en';
      copy.dir = word.definition_ar ? 'rtl' : 'ltr';
      group.append(copy);
    }
    return group;
  }

  function nextButton(footer, label, run, event = 'next') {
    const button = action('', 'gate-lesson-next', run);
    button.dataset.lessonAction = event;
    button.append(element('span', '', label), icon('arrow-left'));
    footer.append(button);
  }

  function choiceGroup(values, legend, field, act, event = 'answer') {
    const options = element('fieldset', 'gate-lesson-options');
    options.append(element('legend', '', legend));
    for (const value of values) {
      const button = action(value, 'gate-lesson-choice', () => act(event, value));
      button.dir = 'auto';
      if (field === 'word') button.lang = 'en';
      button.dataset.lessonAction = event;
      options.append(button);
    }
    return options;
  }

  function renderTeaching(view, step, prompt, response, footer, act) {
    const { word } = step;
    const linking = step.practice === 'link' && !step.rehearse;
    if (!linking) prompt.append(english(element('p', 'gate-lesson-word', word.word)));
    else {
      const link = english(action(word.word, 'gate-lesson-word gate-lesson-word-link', () => act('guided', word.word)));
      link.setAttribute('aria-label', word.word);
      link.setAttribute('aria-describedby', 'gateLessonLinkPrompt');
      link.dataset.lessonAction = 'guided';
      prompt.append(link);
    }
    if (word.partOfSpeech) prompt.append(english(element('span', 'gate-lesson-part-of-speech', word.partOfSpeech)));
    prompt.append(audioControl(view, word));
    if (word.example) {
      const context = element('div', 'gate-lesson-context');
      context.append(sentence(word, contract.cloze(word)));
      (step.practice === 'cloze' ? prompt : response).append(context);
    }
    const explanation = element('div', 'gate-lesson-explanation');
    explanation.id = 'gateLessonExplanation';
    explanation.append(element('span', 'gate-lesson-cue-label', 'المعنى'),
      element('strong', 'gate-lesson-answer-meaning', word.translation));
    response.append(explanation, supportText(word, false));
    if (word.definition_ar && word.definition && word.definition_ar !== word.definition) {
      const detail = element('details', 'gate-lesson-definition-more');
      detail.open = view.state.study.details.includes(word.id);
      detail.append(element('summary', '', 'التعريف بالإنجليزية'),
        english(element('p', 'gate-lesson-definition', word.definition)));
      detail.addEventListener('toggle', () => {
        if (detail.open && detail.isConnected && !view.state.study.details.includes(word.id)) {
          act('details', '', { repaint: false });
        }
      });
      response.append(detail);
    }
    if (linking) {
      const guide = element('p', 'gate-lesson-discover-prompt', 'المس اللفظ الإنجليزي لتربطه بهذا المعنى.');
      guide.id = 'gateLessonLinkPrompt';
      response.append(guide);
    } else if (step.practice === 'cloze' || step.rehearse) {
      nextButton(footer, step.practice === 'cloze' ? 'جرّب إكمال العبارة' : 'جرّب ربط اللفظ بالمعنى',
        () => act('practice'), 'practice');
    } else {
      response.append(choiceGroup(contract.choices(step, view.words, view.state), 'طابق الكلمة مع معناها الموضّح',
        'translation', act, 'guided'));
    }
  }

  function renderReinforcement(view, word, prompt, response, footer, act) {
    prompt.append(relation(word), audioControl(view, word));
    response.append(supportText(word), element('p', 'gate-lesson-discover-prompt',
      'اقرأ اللفظ ومعناه معًا. جرّب أن تقوله وأنت تستحضر المعنى، ثم حاول تذكّره مرة أخرى.'));
    nextButton(footer, 'حاول التذكّر', () => act('connect'), 'connect');
  }

  function answerForm(view, response, step, act) {
    const form = element('form', 'gate-lesson-answer-form');
    const label = element('label', '', step.answerField === 'translation' ? 'اكتب المعنى' : 'اكتب الكلمة بالإنجليزية');
    label.htmlFor = 'gateLessonAnswer';
    const input = element('input', 'gate-lesson-answer-input');
    input.id = label.htmlFor;
    input.type = 'text';
    input.lang = step.answerField === 'translation' ? 'ar' : 'en';
    input.dir = step.answerField === 'translation' ? 'rtl' : 'ltr';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.required = true;
    input.maxLength = 200;
    if (view.draftAnswer?.id === step.id) input.value = view.draftAnswer.value;
    input.addEventListener('input', () => { view.draftAnswer = { id: step.id, value: input.value }; });
    const submit = element('button', 'gate-lesson-answer-submit', 'تحقّق');
    submit.type = 'submit';
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (input.value.trim()) act('answer', input.value);
    });
    form.append(label, input, submit);
    response.append(form);
  }

  function exercisePrompt(view, step, prompt, result) {
    const { word } = step;
    if (step.kind === 'use' || (step.gap && !result && step.phase === 'retrieve')) {
      const copy = element('div', 'gate-lesson-context');
      copy.append(sentence(word, step.gap, !result));
      if (result && word.exampleTranslation) copy.append(element('p', 'gate-lesson-translation', word.exampleTranslation));
      prompt.append(copy);
    } else if (!result && step.answerField === 'translation') {
      prompt.append(english(element('p', 'gate-lesson-meaning', word.word)));
      if (step.phase === 'apply' && word.example) prompt.append(sentence(word, contract.cloze(word)));
    } else if (!result) {
      prompt.append(element('p', 'gate-lesson-cue-label', 'ما الكلمة التي تحمل هذا المعنى؟'));
      prompt.append(element('p', 'gate-lesson-meaning', word.translation));
    }
  }

  function exerciseQuestion(view, step, response, act) {
    const { word } = step;
    const options = contract.choices(step, view.words, view.state);
    const support = element('div', 'gate-lesson-assistance');
    if (step.phase === 'apply' && step.practice === 'link') {
      const wordButton = english(action(word.word, 'gate-lesson-choice gate-lesson-word-link', () => act('guided', word.word)));
      wordButton.dataset.lessonAction = 'guided';
      response.append(element('p', 'gate-lesson-discover-prompt', 'اقرأ المعنى، ثم اضغط اللفظ وجرّب أن تقوله من ذاكرتك.'));
      response.append(wordButton);
      return null;
    }
    if (options.length) {
      const legend = step.gap ? 'أعد الكلمة التي تعلّمتها إلى العبارة' :
        step.answerField === 'word' ? 'اختر اللفظ المطابق' : 'اختر المعنى المطابق';
      response.append(choiceGroup(options, legend, step.answerField, act));
    } else {
      response.append(element('p', 'gate-lesson-discover-prompt', 'حاول التذكّر أولًا. يمكنك كتابة الإجابة أو مقارنتها بالحل.'));
      answerForm(view, response, step, act);
    }
    let focus = null;
    if (step.phase === 'apply') {
      if (view.state.study.hinted.includes(word.id)) {
        const hint = step.answerField === 'word' ? word.translation : 'يبدأ المعنى بـ ' + Array.from(word.translation)[0];
        const copy = element('p', 'gate-lesson-hint-panel', 'تلميح · ' + hint);
        copy.tabIndex = -1;
        copy.setAttribute('role', 'status');
        response.append(copy);
        focus = copy;
      } else {
        const hint = action('', 'gate-lesson-hint', () => act('hint'));
        hint.dataset.lessonAction = 'hint';
        hint.append(icon('lightbulb'), element('span', '', 'أعطني تلميحًا'));
        support.append(hint);
      }
    }
    const help = action('', 'gate-lesson-reveal', () => act('reveal'));
    help.dataset.lessonAction = 'reveal';
    help.append(icon('eye'), element('span', '', 'قارن بالحل'));
    support.append(help);
    response.append(support);
    return focus;
  }

  function addReceipt(view, stage, step) {
    const receipt = view.receipt;
    if (!receipt) return;
    const normalize = value => String(value).trim().normalize('NFKC').toLowerCase();
    const contenders = step ? contract.choices(step, view.words, view.state) : [];
    const related = [receipt.word.word, receipt.word.translation].map(normalize);
    const sameAnswer = step && step.phase !== 'teach' && related.includes(normalize(contract.expectedFor(step)));
    const contender = contenders.some(text => related.includes(normalize(text)));
    const message = receipt.result === 'guided' ? 'ربطت اللفظ بالمعنى' :
      receipt.result === 'assisted' ? 'أجبت بمساعدة التلميح' : 'إجابة صحيحة';
    const strip = element('aside', 'gate-lesson-receipt');
    strip.dataset.outcome = receipt.result;
    strip.append(icon('check'), element('strong', '', message));
    if (!sameAnswer && !contender) {
      strip.append(english(element('bdi', '', receipt.word.word)), element('span', '', receipt.word.translation));
    }
    stage.insertBefore(strip, stage.querySelector('.gate-lesson-workspace'));
    if (view.liveResult) {
      view.liveResult.textContent = strip.textContent;
    }
  }

  function exerciseFeedback(view, step, response, footer, result, act) {
    const feedback = element('div', 'gate-lesson-feedback');
    feedback.dataset.response = result;
    feedback.dataset.assisted = String(result === 'assisted');
    const badge = element('span', 'gate-lesson-feedback-icon');
    badge.append(icon(result === 'correct' ? 'check' : result === 'wrong' ? 'arrows-rotate' : 'lightbulb'));
    const retrieval = step.phase === 'retrieve' || step.phase === 'retry';
    const message = result === 'wrong' ? 'لنثبّت الكلمة ومعناها' :
      result === 'revealed' ? 'راجع الكلمة ومعناها' : result === 'assisted' ?
        'ربطتها بالمعنى مع التلميح' : retrieval ? 'تذكّرتها' : 'هذا هو الربط الصحيح';
    const title = element('h3', 'gate-lesson-feedback-title', message);
    title.tabIndex = -1;
    title.setAttribute('aria-describedby', 'gateLessonRelation');
    const pair = relation(step.word);
    pair.id = 'gateLessonRelation';
    feedback.append(badge, title, pair, audioControl(view, step.word));
    if (step.kind !== 'use') feedback.append(supportText(step.word));
    if (step.phase === 'retrieve' && result !== 'correct') {
      feedback.append(element('p', 'gate-lesson-discover-prompt', 'ستعود الكلمة بعد قليل لتجرّب تذكّرها مرة أخرى.'));
    }
    response.append(feedback);
    nextButton(footer, result === 'wrong' || result === 'revealed' ? 'تابع بعد التصحيح' : 'تابع', () => act('next'));
    return title;
  }

  function render(view) {
    if (active !== view) return;
    stopAudio(view);
    const state = view.state;
    const steps = contract.build(view.words, state);
    const step = contract.stepAt(steps, state);
    const answered = step && contract.resultFor(state, step);
    const progress = element('progress', 'gate-lesson-progress');
    progress.max = state.wordIds.length;
    progress.value = state.completedWordIds.length;
    const number = value => value.toLocaleString('ar');
    const count = number(progress.value) + ' من ' + number(progress.max) + ' كلمة';
    progress.setAttribute('aria-label', 'تقدّم تعلّم الكلمات · ' + count);
    progress.dir = 'rtl';
    const header = element('header', 'gate-lesson-header');
    const identity = element('div', 'gate-lesson-identity');
    const identityCopy = element('div', '');
    identityCopy.append(element('span', 'gate-lesson-world', view.world), element('strong', '', view.title));
    const emblem = element('span', 'gate-lesson-emblem');
    emblem.append(icon('book-open'));
    identity.append(emblem, identityCopy);
    const exit = action('', 'gate-lesson-exit', async () => {
      if (view.localSaved || await sync(view, true)) close(view, { save: view.localSaved });
    });
    exit.append(icon('arrow-right-from-bracket'), element('span', '', 'احفظ واخرج'));
    header.append(identity, exit);
    const meter = element('div', 'gate-lesson-meter');
    meter.append(element('span', 'gate-lesson-count', count), progress);
    const stage = element('section', 'gate-lesson-stage');
    stage.classList.add(step ? step.kind === 'use' ? 'is-context' : 'is-' + step.kind : 'is-finished');
    stage.classList.toggle('is-context-practice', step?.kind === 'use');
    stage.classList.toggle('is-answered', Boolean(answered));
    stage.dataset.scene = step?.scene || 'finished';
    if (step) {
      stage.dataset.phase = step.phase;
      stage.dataset.wordId = step.word.id;
    }
    const title = !step ? 'أكملت درس البوابة' : step.phase === 'reinforce' ? 'ثبّت اللفظ والمعنى' :
      step.phase === 'retry' ? 'عودة قصيرة' : step.phase === 'retrieve' ? 'استرجع ما تعلّمته' :
        step.kind === 'use' ? titles.context : step.phase === 'apply' ? 'جرّب ربط الكلمة بمعناها' : titles[step.kind];
    const heading = element('h2', 'gate-lesson-heading', title);
    heading.tabIndex = -1;
    heading.id = 'gateLessonTitle';
    const footer = element('footer', 'gate-lesson-footer');
    const notice = element('div', 'gate-lesson-notice');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-atomic', 'true');
    if (!navigator.onLine) notice.textContent = view.localSaved
      ? 'موضعك محفوظ على هذا الجهاز. تتم المزامنة عند عودة الاتصال.'
      : 'تعذّر حفظ موضعك. أعد المحاولة قبل الخروج.';
    view.notice = notice;
    stage.append(heading);
    footer.append(notice);
    if (step?.members) {
      const position = step.members.indexOf(step.word.id) + 1;
      const marker = element('p', 'gate-lesson-station-position',
        number(position) + ' من ' + number(step.members.length) + ' في هذه المحطة');
      stage.append(marker);
      stage.dataset.stationSize = String(step.members.length);
    }
    view.liveResult.textContent = '';
    view.dialog.replaceChildren(header, meter, stage, footer, view.liveResult);
    if (view.toastHost) view.dialog.append(view.toastHost);

    if (!step) {
      const seal = element('div', 'gate-lesson-complete-seal');
      seal.append(icon('check'));
      const completeCopy = element('p', 'gate-lesson-complete-copy',
        'أكملت درس ' + number(state.wordIds.length) + ' كلمة. عد إلى البوابة لتتابع المراجعة حين تتاح.');
      stage.append(seal, completeCopy);
      const finish = action('', 'gate-lesson-next', async () => {
        finish.disabled = true;
        if (await sync(view, true)) {
          await view.preparing;
          if (active === view) close(view, { save: false });
        } else if (active === view) {
          finish.disabled = false;
          notice.textContent = 'بانتظار المزامنة. يمكنك حفظ الموضع والخروج ثم المحاولة عند عودة الاتصال.';
        }
      });
      finish.dataset.lessonAction = 'finish';
      finish.append(element('span', '', 'ارجع إلى البوابة'), icon('arrow-left'));
      footer.append(finish);
      addReceipt(view, stage, null);
      heading.focus({ preventScroll: true });
      return;
    }

    const workspace = element('div', 'gate-lesson-workspace');
    const prompt = element('div', 'gate-lesson-prompt');
    const response = element('div', 'gate-lesson-response');
    workspace.append(prompt, response);
    stage.append(workspace);
    const act = (event, value, { repaint = true } = {}) => {
      if (active !== view || !stage.isConnected) return;
      const plan = contract.build(view.words, view.state);
      const current = contract.stepAt(plan, view.state);
      if (current?.id !== step.id) return render(view);
      const next = contract.interact(view.state, plan, step.id, event, value);
      if (next === view.state) return;
      update(view, next, true);
      if (event === 'next' || event === 'answer' || event === 'reveal') view.draftAnswer = null;
      if (event === 'answer' || event === 'guided') {
        const result = event === 'guided' ? 'guided' : contract.resultFor(next, step);
        view.receipt = ['guided', 'correct', 'assisted'].includes(result) &&
          contract.stepAt(plan, next)?.id !== step.id &&
          (event !== 'guided' || next.study.applied.includes(step.word.id)) ? { word: step.word, result } : null;
      } else if (event !== 'details' && event !== 'hint') view.receipt = null;
      if (repaint) render(view);
    };
    let focus;
    if (step.phase === 'teach') renderTeaching(view, step, prompt, response, footer, act);
    else if (step.phase === 'reinforce') renderReinforcement(view, step.word, prompt, response, footer, act);
    else {
      exercisePrompt(view, step, prompt, answered);
      focus = answered ? exerciseFeedback(view, step, response, footer, answered, act) :
        exerciseQuestion(view, step, response, act);
    }
    if (!answered) addReceipt(view, stage, step);
    (focus || heading).focus({ preventScroll: true });
  }

  async function open({ context, title, world, progress, prepare, onClose }) {
    const uid = owner();
    if (!uid || active) return false;
    const shell = element('div', 'gate-lesson-overlay');
    const dialog = element('article', 'gate-lesson');
    dialog.dir = 'rtl';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'gateLessonTitle');
    const liveResult = element('div', 'gate-lesson-live-result');
    liveResult.setAttribute('role', 'status');
    const view = { uid, context, title, world, shell, dialog, onClose, soundToken: 0, liveResult };
    active = view;
    document.body.classList.add('gate-lesson-active');
    root.LootLinguaFeatureMiniOnboarding?.pause?.();
    root.LootLinguaPersonalDictionaryOnboarding?.pause?.();
    const toastHost = document.getElementById('toastHost');
    if (toastHost) {
      Object.assign(view, { toastHost, toastParent: toastHost.parentNode, toastNext: toastHost.nextSibling });
      dialog.append(toastHost);
    }
    shell.addEventListener('keydown', event => {
      if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
    }, true);
    shell.addEventListener('keydown', event => event.stopPropagation());
    shell.addEventListener('click', event => {
      if (event.detail < 2 || !event.target.closest?.('[data-lesson-action]')) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    const loading = element('h2', '', 'جارٍ فتح الدرس…');
    loading.id = 'gateLessonTitle';
    dialog.append(loading, action('العودة إلى البوابة', 'gate-lesson-exit', () => close(view, { save: false })));
    shell.append(dialog);
    document.body.append(shell);
    root.LootLinguaModalFocus?.open(shell, { dialog, onEscape: () => close(view) });
    try {
      const cached = read(uid, context);
      const api = root.LootLinguaPublishedContent;
      const cloud = root.LootLinguaJourneyCloud;
      const [published, access] = cached?.words?.length && !navigator.onLine ? [null, null] : await Promise.all([
        api.listAllPublishedGateWords(context.worldId, context.rankId, context.gateId).catch(() => null),
        cloud.getGateLessonAccess(context, { progress }).catch(() => null),
      ]);
      if (active !== view || owner() !== uid) return false;
      view.words = published?.map(contract.wordRecord).filter(word => word.id && word.word && word.translation) || cached?.words || [];
      if (!view.words.length || (published && published.length !== view.words.length)) throw new Error('Incomplete published words');
      const ids = view.words.map(word => word.id);
      const prior = cached?.state && contract.sameWords(cached.state.wordIds, ids) ? cached.state : null;
      const remote = contract.sameWords(access?.state?.wordIds, ids)
        ? contract.upgrade(access.state, { confirmed: access.confirmed === true }) : null;
      const creditedIds = prior || remote ? [] : await cloud.getLegacyLessonWordIds(context, progress).catch(() => []);
      if (active !== view || owner() !== uid) return false;
      view.state = contract.merge(remote, prior) || contract.start(view.words, creditedIds);
      update(view, view.state);
      render(view);
      if (prepare) view.preparing = Promise.resolve().then(prepare).catch(() => {}).finally(() => {
        if (active === view) dispatch(context, uid);
      });
      return true;
    } catch (_) {
      if (active !== view) return false;
      loading.textContent = 'تعذّر فتح كلمات البوابة. جرّب مرة أخرى.';
      dialog.append(action('إعادة المحاولة', 'gate-lesson-next', () => {
        close(view, { save: false, restoreFocus: false });
        void open({ context, title, world, progress, prepare, onClose });
      }));
      return false;
    }
  }

  root.addEventListener('lootlingua:auth-state', () => {
    if (active && owner() !== active.uid) close(active, { save: false, restoreFocus: false });
    observed.clear();
  });
  root.addEventListener('online', () => { if (active?.state) void flush(active); });
  root.addEventListener('pagehide', () => { if (active?.state) void flush(active); });
  root.addEventListener('lootlingua:dictionary-navigation', () => {
    if (active) close(active, { restoreFocus: false });
  });
  root.LootLinguaGateLessonView = Object.freeze({ inspect, open, status, savedActivity, isOpen: () => Boolean(active) });
})(window);
