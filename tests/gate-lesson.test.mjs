import assert from 'node:assert/strict';
import test from 'node:test';
import '../js/gate-lesson.js';
import '../js/entry-experience-contract.js';

const lesson = globalThis.LootLinguaGateLesson;
const entry = globalThis.LootLinguaEntryExperience;
const sample = count => Array.from({ length: count }, (_, i) => lesson.wordRecord({
  contentWordId: 'word-' + i, word: 'term' + i, translation: 'معنى ' + i,
  example: i % 3 ? 'We use term' + i + ' here.' : '', pronunciation: i === 0 ? 'term' : '',
  imageUrl: 'https://example.test/unused.png',
}));

function journey(words, initial = lesson.start(words)) {
  let state = initial;
  const steps = () => lesson.build(words, state);
  const step = () => lesson.stepAt(steps(), state);
  const act = (event, value, id = step()?.id) => {
    state = lesson.interact(state, steps(), id, event, value);
    return state;
  };
  function finish({ miss = false } = {}) {
    const activity = step();
    const expected = lesson.expectedFor(activity);
    if (activity.phase === 'teach') {
      if (activity.rehearse || activity.practice === 'cloze') act('practice');
      else act('guided', expected);
    } else if (activity.phase === 'reinforce') act('connect');
    else if (lesson.resultFor(state, activity)) act('next');
    else if (activity.practice === 'link') act('guided', expected);
    else if (miss) act('reveal');
    else act('answer', expected);
    return activity;
  }
  return { get state() { return state; }, steps, step, act, finish };
}

for (const count of [1, 10, 15, 30, 42]) {
  test('compact learning teaches, applies and retrieves every eligible word for ' + count, () => {
    const words = sample(count), course = journey(words);
    const trace = [];
    while (course.step()) {
      const active = course.step();
      if (active.phase === 'retrieve') assert.ok(course.state.study.applied.includes(active.word.id));
      trace.push(course.finish());
    }
    assert.equal(lesson.complete(course.state), true);
    assert.ok(!words.some(word => 'imageUrl' in word));
    for (const word of words) {
      const i = phase => trace.findIndex(s => s.word.id === word.id && s.phase === phase);
      assert.ok(i('teach') >= 0 && i('teach') < i('retrieve'));
      const after = Math.max(i('teach'), i('apply'));
      if (count > 1) assert.ok(trace.slice(after + 1, i('retrieve')).some(step => step.word.id !== word.id), word.id);
      else assert.equal(trace[i('teach') + 1].phase, 'apply');
    }
    const recalls = trace.filter(step => step.phase === 'retrieve');
    assert.equal(recalls.length, count);
    assert.ok(recalls.every(step => step.members.length <= 5));
    if (count === 15) {
      const stations = new Set(recalls.map(step => step.scene));
      assert.ok(stations.size >= 3 && stations.size <= 5);
      assert.ok(trace.length <= 40, 'Actual transitions, including all recall answers');
    }
    assert.deepEqual(course.state.study.applied, words.map(word => word.id));
    assert.equal(course.state.study.retried.length, 0);
  });
}

test('content changes the mix and timing; a restored course keeps the same station ids', () => {
  const words = sample(15);
  const rich = words.map(word => ({ ...word, definition_ar: word.translation }));
  const sparse = words.map(word => ({ ...word, example: '', pronunciation: '' }));
  const scenes = words => [...new Set(lesson.build(words, lesson.start(words))
    .filter(step => step.phase === 'retrieve').map(step => step.scene))];
  assert.notDeepEqual(scenes(rich), scenes(sparse));
  const course = journey(words);
  assert.deepEqual(lesson.build(words.slice().reverse(), course.state), course.steps());
  const richWord = lesson.wordRecord({ contentWordId: 'rich', word: 'revive', translation: 'إنعاش',
    example: 'We can revive our teammate.', exampleTranslation: 'يمكننا إنعاش زميلنا.',
    definition: 'Bring back to life.', definition_ar: 'الإنعاش.', pronunciation: '/rɪˈvaɪv/', partOfSpeech: 'verb',
    audioUrl: 'https://example.test/revive.ogg' });
  assert.equal(richWord.definition, 'Bring back to life.');
  assert.equal(richWord.definition_ar, 'الإنعاش.');
  const pair = [words[0], richWord];
  const plan = journey(pair).steps();
  assert.equal(plan.find(s => s.id === 'teach:rich').practice, 'cloze');
  assert.equal(plan.find(s => s.id === 'retrieve:rich').gap[0], 'We can ');
  assert.equal(plan.find(s => s.id === 'retrieve:word-0').answerField, 'translation');
  assert.equal(lesson.cloze({ ...richWord, example: 'Revive them before they revive us.' }), null);
});

test('no unseen word is a distractor and the cloze remains behind teaching', () => {
  const words = sample(10), course = journey(words);
  assert.strictEqual(course.act('answer', words[1].word, 'apply:word-1'), course.state);
  assert.deepEqual(course.state.study.applied, []);
  assert.deepEqual(course.act('next').study.explained, []);
  assert.equal(course.step().practice, 'link');
  course.act('guided', words[0].word);
  assert.deepEqual(course.state.study.applied, ['word-0']);
  assert.equal(course.step().id, 'teach:word-1');
  assert.equal(course.step().practice, 'cloze');
  course.act('practice');
  assert.equal(course.step().id, 'apply:word-1');
  assert.ok(course.state.study.explained.includes('word-1'));
  assert.deepEqual(lesson.choices(course.step(), words, course.state).sort(), [words[0].word, words[1].word].sort());
  assert.equal(course.act('next').study.applied.includes('word-1'), false);
  course.act('hint');
  const restored = journey(words, lesson.upgrade(JSON.parse(JSON.stringify(course.state))));
  assert.equal(restored.step().id, 'apply:word-1');
  assert.deepEqual(restored.state.study.hinted, ['word-1']);
  restored.act('answer', words[1].word);
  assert.equal(restored.state.study.applications['word-1'], 'assisted');
  assert.ok(restored.state.study.applied.includes('word-1'));
});

test('mid-station reload keeps the exact prompt, accepted answers, and pending correction', () => {
  const words = sample(15), course = journey(words);
  while (course.step().phase !== 'retrieve') course.finish();
  const first = course.step();
  course.act('answer', 'an unrelated answer');
  const feedback = journey(words, lesson.upgrade(JSON.parse(JSON.stringify(course.state))));
  assert.equal(feedback.step().id, first.id);
  assert.equal(lesson.resultFor(feedback.state, feedback.step()), 'wrong');
  feedback.act('next');
  assert.equal(feedback.step().scene, first.scene);
  assert.notEqual(feedback.step().id, first.id);
  const next = feedback.step();
  feedback.finish();
  const resumed = journey(words.slice().reverse(), lesson.upgrade(JSON.parse(JSON.stringify(feedback.state))));
  assert.ok(resumed.state.study.recalled.includes(first.word.id));
  assert.ok(resumed.state.study.recalled.includes(next.word.id));
  assert.equal(resumed.step().scene, first.scene);
  assert.notEqual(resumed.step().id, next.id);
  assert.equal(resumed.state.study.misses[first.word.id], 'wrong');
});

test('wrong answers and reveals are repaired once each with intervening work', () => {
  const words = sample(15), course = journey(words), trace = [];
  while (course.step() && !['retry', 'reinforce'].includes(course.step().phase)) {
    const step = course.step();
    if (step.id === 'retrieve:word-0' && !lesson.resultFor(course.state, step)) course.act('answer', 'wrong');
    trace.push(course.finish({ miss: step.id === 'retrieve:word-1' }));
  }
  const restored = journey(words.slice().reverse(), JSON.parse(JSON.stringify(course.state)));
  assert.equal(lesson.complete(restored.state), false);
  assert.equal(restored.state.completedWordIds.length, 13);
  assert.equal(restored.state.study.misses['word-0'], 'wrong');
  assert.equal(restored.state.study.misses['word-1'], 'revealed');
  for (const id of ['word-0', 'word-1']) {
    assert.ok(trace.findIndex(s => s.id === 'retrieve:' + id) < trace.length - 1);
    assert.equal(restored.step().id, 'retry:' + id);
    restored.act('answer', 'still wrong');
    assert.equal(lesson.resultFor(restored.state, restored.step()), 'wrong');
    restored.act('next');
  }
  assert.equal(restored.step(), null);
  assert.ok(lesson.complete(restored.state));
});

test('one word has a guided bridge for a final miss, with no retry loop', () => {
  const words = sample(1), course = journey(words);
  course.finish();
  course.finish();
  assert.deepEqual(lesson.choices(course.step(), words, course.state), []);
  course.finish({ miss: true });
  course.finish();
  assert.equal(course.step().phase, 'reinforce');
  course.finish();
  assert.equal(course.step().phase, 'retry');
  course.finish({ miss: true });
  course.finish();
  assert.equal(course.step(), null);
  assert.ok(lesson.complete(course.state));
});

test('v2 feedback pending from the previous engine is resumed before the new station order', () => {
  const words = sample(10), course = journey(words);
  while (course.step().phase !== 'retrieve') course.finish();
  const original = course.step();
  course.finish();
  const oldStudy = { ...course.state.study, recalled: [] };
  const oldDraft = lesson.upgrade({ ...course.state, study: oldStudy });
  const resumed = journey(words, oldDraft);
  assert.equal(resumed.step().id, original.id);
  assert.equal(lesson.resultFor(oldDraft, resumed.step()), 'correct');
  resumed.act('next');
  assert.ok(resumed.state.completedWordIds.includes(original.word.id));
});

test('confirmed v1 completion, unconfirmed old answers, and monotonic v2 merges remain compatible', () => {
  const words = sample(10);
  const old = { version: 1, wordIds: words.map(w => w.id), creditedIds: ['word-9'],
    answers: { 'learn:word-0': 'correct', 'recall:word-0': 'revealed', 'learn:word-1': 'wrong' },
    passed: ['learn:word-0', 'recall:word-0'], completedWordIds: ['word-0', 'word-9'] };
  const trusted = lesson.upgrade(old, { confirmed: true });
  assert.deepEqual(trusted.completedWordIds, ['word-0', 'word-9']);
  assert.deepEqual(trusted.legacyCompletedIds, ['word-0']);
  assert.deepEqual(trusted.answers, old.answers);
  assert.deepEqual(trusted.study.explained, ['word-0', 'word-1']);
  assert.deepEqual(trusted.study.taught, []);
  assert.equal(journey(words, trusted).step().id, 'teach:word-1');
  const localOnly = lesson.upgrade(old);
  assert.deepEqual(localOnly.completedWordIds, ['word-9']);
  assert.deepEqual(localOnly.answers, old.answers);
  assert.equal(lesson.merge(trusted, localOnly).completedWordIds.length, 2);
  const left = journey(words, trusted), right = journey(words, trusted);
  left.finish();
  left.act('hint');
  right.finish();
  right.finish();
  const merged = lesson.merge(left.state, right.state);
  assert.deepEqual(merged.study.hinted, ['word-1']);
  assert.deepEqual(merged.study.applied, ['word-1']);
  assert.deepEqual(merged.study.applications, right.state.study.applications);
  assert.ok(merged.completedWordIds.includes('word-0'));
  assert.strictEqual(lesson.merge(merged, lesson.start(sample(30))), merged);
});


test('cohort membership and context are independent from the personal evidence source', () => {
  assert.deepEqual(lesson.gateContext({ source: 'gate-gap:world~rank~gate', sourceType: 'personal' }),
    { worldId: 'world', rankId: 'rank', gateId: 'gate' });
  assert.equal(lesson.hasGateIntent({ source: 'personal', words: [{ contentWordId: 'word-1' }] }), false);
  assert.equal(lesson.hasGateIntent({ source: 'journey:only-one-id' }), true);
  assert.equal(lesson.gateContext({ source: 'journey:only-one-id' }), null);
  const initial = lesson.start(sample(10));
  assert.equal(lesson.complete(initial), false);
  assert.equal(lesson.complete({ ...initial, completedWordIds: initial.wordIds }, sample(15).map(w => w.id)), false);
});

test('saved onboarding drafts preserve theme and interests while reaching the real worlds page', () => {
  let draft = entry.createEntryDraft({ audience: 'new', classification: 'brand-new' });
  for (const [command, expected] of [
    ['continue-welcome', 'theme'], ['continue-theme', 'interests'], ['skip-interests', 'discover'],
  ]) {
    draft = entry.transitionState(draft, { type: command });
    assert.equal(draft.currentStep, expected);
  }
  assert.equal(entry.isTerminalState(entry.transitionState(draft, { type: 'complete' })), true);
  const old = entry.normalizeEntryState({ ...draft, contractVersion: 2, currentStep: 'journey',
    themeStatus: 'selected', themeId: 'ocean', selectedWorldId: 'saved-world' });
  assert.equal(old.currentStep, 'discover');
  assert.equal(old.themeId, 'ocean');
  assert.equal(old.selectedWorldId, 'saved-world');
  assert.equal(entry.shouldPresent({ ...old, status: 'completed' }), false);
});
