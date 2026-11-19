(function attachGateLesson(root) {
  'use strict';

  const version = 2;
  const keyFor = ({ worldId, rankId, gateId }) => JSON.stringify([worldId, rankId, gateId]);
  const time = value => value?.toMillis?.() || (value instanceof Date ? +value : Number(value)) || 0;
  const isLegacy = (value, activatedAt) => time(value) > 0 && time(value) < time(activatedAt);
  const compare = value => String(value || '').trim().normalize('NFKC').toLowerCase();

  function gateContext(source) {
    const stored = source?.gateContext || source;
    if (stored?.worldId && stored?.rankId && stored?.gateId) {
      return { worldId: stored.worldId, rankId: stored.rankId, gateId: stored.gateId };
    }
    if (source?.journeyWorldId && source?.journeyRankId && source?.journeyGateId) {
      return { worldId: source.journeyWorldId, rankId: source.journeyRankId, gateId: source.journeyGateId };
    }
    const match = /^(?:journey|gate-gap):([^~]+)~([^~]+)~([^~]+)$/.exec(String(source?.source || source || ''));
    return match ? { worldId: match[1], rankId: match[2], gateId: match[3] } : null;
  }

  function hasGateIntent(source) {
    return Boolean(source?.gateContext || source?.officialReviewGate || source?.journeyGateId ||
      /^(journey|gate-gap):/.test(String(source?.source || source || '')));
  }

  function wordRecord(source) {
    return {
      id: String(source.contentWordId || ''),
      word: String(source.word || ''),
      translation: String(source.translation || ''),
      example: String(source.example || ''),
      exampleTranslation: String(source.exampleTranslation || ''),
      definition: String(source.definition || ''),
      definition_ar: String(source.definition_ar || ''),
      pronunciation: String(source.pronunciation || ''),
      audioUrl: String(source.audioUrl || ''),
      partOfSpeech: String(source.partOfSpeech || ''),
    };
  }

  function cloze(word) {
    if (!word.example || !word.word) return null;
    const example = word.example.toLowerCase();
    const target = word.word.toLowerCase();
    let match = null;
    for (let index = example.indexOf(target); index >= 0; index = example.indexOf(target, index + target.length)) {
      const before = word.example.slice(0, index);
      const after = word.example.slice(index + word.word.length);
      if (/[\p{L}\p{N}]$/u.test(before) || /^[\p{L}\p{N}]/u.test(after)) continue;
      if (match) return null; // A second visible occurrence would give away the answer.
      match = [before, after];
    }
    return match;
  }

  const listFields = ['explained', 'details', 'taught', 'hinted', 'applied', 'remembered', 'recalled', 'reinforced', 'retried'];
  const mapFields = ['applications', 'misses', 'retries'];
  const outcomes = new Set(['correct', 'wrong', 'revealed', 'assisted']);
  const union = (a = [], b = []) => [...new Set([...a, ...b])];

  function emptyStudy() {
    return Object.fromEntries([...listFields.map(key => [key, []]), ...mapFields.map(key => [key, {}])]);
  }

  function start(words, creditedIds = []) {
    const wordIds = words.map(word => word.id);
    const credited = wordIds.filter(id => creditedIds.includes(id));
    return {
      version, wordIds, creditedIds: credited, legacyCompletedIds: [],
      answers: {}, passed: [], study: emptyStudy(), completedWordIds: credited,
    };
  }

  function sameWords(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const members = new Set(right);
    return members.size === right.length && new Set(left).size === left.length && left.every(id => members.has(id));
  }

  function recalculate(state) {
    const study = state.study;
    const remembered = new Set(study.remembered);
    const completed = new Set([...state.creditedIds, ...state.legacyCompletedIds, ...study.retried,
      ...study.recalled.filter(id => remembered.has(id))]);
    return { ...state, completedWordIds: state.wordIds.filter(id => completed.has(id)) };
  }

  // Only a confirmed saved v1 record may carry forward its old completion.
  // Old answers are useful for resuming the explanation, but never become v2 attempts.
  function upgrade(source, { confirmed = false } = {}) {
    if (![1, version].includes(source?.version) ||
        !Array.isArray(source.wordIds) || !source.wordIds.length || source.wordIds.length > 2000 ||
        !source.wordIds.every(id => typeof id === 'string' && id) ||
        !sameWords(source.wordIds, source.wordIds)) return null;
    const state = start(source.wordIds.map(id => ({ id })), Array.isArray(source.creditedIds) ? source.creditedIds : []);
    const ids = new Set(state.wordIds);
    const keep = (values, allowed = ids) => Array.isArray(values) ? [...new Set(values.filter(id => allowed.has(id)))] : [];
    const map = (value, allowed, valid) => Object.fromEntries(Object.entries(value || {}).filter(([id, outcome]) =>
      allowed.has(id) && valid.has(outcome)));
    const oldSteps = new Set(state.wordIds.flatMap(id => ['learn:' + id, 'recall:' + id]));
    state.answers = map(source.answers, oldSteps, outcomes);
    state.passed = keep(source.passed, new Set(Object.keys(state.answers)));
    if (source.version === 1) {
      const passed = new Set(state.passed);
      if (confirmed) state.legacyCompletedIds = keep(source.completedWordIds).filter(id =>
        passed.has('learn:' + id) && passed.has('recall:' + id));
      state.study.explained = state.wordIds.filter(id => Object.hasOwn(state.answers, 'learn:' + id));
    } else {
      state.legacyCompletedIds = keep(source.legacyCompletedIds);
      const data = source.study || {};
      const study = state.study;
      study.explained = keep(data.explained);
      study.details = keep(data.details, new Set(study.explained));
      study.taught = keep(data.taught, new Set(study.explained));
      study.hinted = keep(data.hinted, new Set(study.taught));
      study.applications = map(data.applications, new Set(study.taught), outcomes);
      study.applied = keep(data.applied, new Set(Object.keys(study.applications)));
      study.remembered = keep(data.remembered, new Set(study.applied));
      study.misses = map(data.misses, new Set(study.applied), new Set(['wrong', 'revealed']));
      study.recalled = keep(data.recalled, new Set([...study.remembered, ...Object.keys(study.misses)]));
      const missed = new Set(study.recalled.filter(id => Object.hasOwn(study.misses, id)));
      study.reinforced = keep(data.reinforced, missed);
      study.retries = map(data.retries, missed, new Set(['correct', 'wrong', 'revealed']));
      study.retried = keep(data.retried, new Set(Object.keys(study.retries)));
    }
    return recalculate(state);
  }

  function merge(current, incoming) {
    if (current && incoming && !sameWords(current.wordIds, incoming.wordIds)) return current;
    const left = upgrade(current);
    const right = upgrade(incoming);
    if (!left || !right) return left || right;
    const study = {};
    for (const key of listFields) study[key] = union(left.study[key], right.study[key]);
    for (const key of mapFields) study[key] = { ...right.study[key], ...left.study[key] };
    // Keep accepted feedback when reconciling it with a response from a stale tab.
    for (const [key, passed] of [['applications', 'applied'], ['retries', 'retried']]) {
      const accepted = left.study[passed];
      for (const id of right.study[passed]) if (!accepted.includes(id)) study[key][id] = right.study[key][id];
    }
    return recalculate({
      ...left, creditedIds: union(left.creditedIds, right.creditedIds),
      legacyCompletedIds: union(left.legacyCompletedIds, right.legacyCompletedIds),
      answers: { ...right.answers, ...left.answers }, passed: union(left.passed, right.passed), study,
    });
  }

  function teachingMode(word) {
    if (word.example || word.definition_ar || word.definition) return 'context';
    return word.audioUrl || word.pronunciation ? 'listen' : 'discover';
  }

  function retrievalStations(words) {
    const groups = [];
    let group = [];
    let weight = 0;
    for (const word of words) {
      const cost = teachingMode(word) === 'context' ? 2 : 1;
      if (group.length === 5 || (group.length >= 3 && weight + cost > 7)) {
        groups.push(group);
        group = [];
        weight = 0;
      }
      group.push(word);
      weight += cost;
    }
    if (group.length === 1 && groups.length) group.unshift(groups.at(-1).pop());
    if (group.length) groups.push(group);
    return groups;
  }

  function build(words, state) {
    const byId = new Map(words.map(word => [word.id, word]));
    const credits = state?.creditedIds || [];
    // Confirmed v1 lessons are still in the published order used to anchor the course.
    const inOrder = (state?.wordIds || words.map(word => word.id)).map(id => byId.get(id))
      .filter(word => word && !credits.includes(word.id));
    const known = words.filter(word => credits.includes(word.id));
    const oneWordLeft = inOrder.filter(word => !state?.legacyCompletedIds?.includes(word.id)).length === 1;
    const groups = retrievalStations(inOrder);
    const steps = [];
    let cursor = 0;
    let covered = 0;
    for (const [index, group] of groups.entries()) {
      covered += group.length;
      // Look ahead so even the last word in the group has intervening work.
      const lookahead = groups[index + 1] ? (group.some(word => teachingMode(word) === 'context') ? 2 : 1) : 0;
      while (cursor < Math.min(inOrder.length, covered + lookahead)) {
        const word = inOrder[cursor++];
        const gap = cloze(word);
        const mode = teachingMode(word);
        const hasContrast = known.some(candidate => distinct(candidate, word));
        const practice = gap && hasContrast ? 'cloze' : hasContrast ? 'match' : 'link';
        const scene = 'word:' + word.id;
        steps.push({ id: 'teach:' + word.id, scene, phase: 'teach', kind: mode, practice, rehearse: oneWordLeft,
          answerField: practice === 'link' ? 'word' : 'translation', word });
        steps.push({ id: 'apply:' + word.id, scene, phase: 'apply', kind: practice === 'cloze' ? 'use' : mode,
          practice, answerField: practice === 'match' ? 'translation' : 'word', gap, word });
        known.push(word);
      }
      const scene = 'station:' + group[0].id;
      const members = group.map(word => word.id);
      const available = known.map(word => word.id);
      for (const word of group) {
        // Vary the cue with the content. A translated example gives learners
        // a contextual cue; an audio or definition-led entry can prompt meaning.
        const gap = word.exampleTranslation ? cloze(word) : null;
        const answerField = !gap && teachingMode(word) !== 'discover'
          ? 'translation' : 'word';
        steps.push({ id: 'retrieve:' + word.id, scene, members, available, phase: 'retrieve', kind: 'recall',
          answerField, gap, word });
      }
    }
    return steps;
  }

  function retrySteps(steps, state) {
    const remembered = new Set(state.study.remembered);
    return steps.filter(step => step.phase === 'retrieve' && Object.hasOwn(state.study.misses, step.word.id) &&
      !remembered.has(step.word.id) && !state.legacyCompletedIds.includes(step.word.id));
  }

  function stepAt(steps, state) {
    const study = state.study;
    const legacy = new Set(state.legacyCompletedIds);
    const done = { teach: new Set(study.taught), apply: new Set(study.applied), retrieve: new Set(study.recalled) };
    const incomplete = steps.filter(step => !legacy.has(step.word.id) && !done[step.phase].has(step.word.id));
    // Older drafts could pause on a correct answer before pressing Next.
    // Keep that feedback in reach before continuing with the shorter plan.
    const feedback = incomplete.find(step => resultFor(state, step));
    if (feedback || incomplete.length) return feedback || incomplete[0];
    const retries = retrySteps(steps, state);
    const pending = retries.find(step => !study.retried.includes(step.word.id));
    if (!pending) return null;
    const id = pending.word.id;
    const last = steps.findLast(step => !legacy.has(step.word.id));
    const members = retries.filter(step => step.scene === pending.scene).map(step => step.word.id);
    const scene = 'return:' + pending.scene;
    // When nothing else separates the two attempts, ask for a guided
    // form–meaning rehearsal before asking for recall again.
    if (pending === retries[0] && pending === last && !study.reinforced.includes(id)) {
      return { ...pending, scene, members, id: 'reinforce:' + id, phase: 'reinforce', kind: 'discover' };
    }
    return { ...pending, scene, members, available: state.wordIds, id: 'retry:' + id, phase: 'retry', gap: null };
  }

  function resultFor(state, step) {
    const id = step.word.id;
    const study = state.study;
    if (step.phase === 'retrieve') return study.remembered.includes(id) ? 'correct' : Object.hasOwn(study.misses, id) ? study.misses[id] : undefined;
    if (step.phase === 'apply' && Object.hasOwn(study.applications, id)) return study.applications[id];
    if (step.phase === 'retry' && Object.hasOwn(study.retries, id)) return study.retries[id];
  }

  function expectedFor(step) {
    return step.word[step.answerField || 'word'];
  }

  function distinct(candidate, word) {
    return compare(candidate.word) !== compare(word.word) && compare(candidate.translation) !== compare(word.translation);
  }

  function choices(step, words, state) {
    if (step.practice === 'link' || step.phase === 'reinforce') return [];
    const field = step.answerField;
    const expected = expectedFor(step);
    const used = new Set([compare(expected)]);
    const taught = new Set([...state.study.taught, ...state.legacyCompletedIds, ...state.creditedIds]);
    const allowed = step.available ? new Set([...step.available, ...state.creditedIds]) : null;
    // Prefer the neighboring studied words, using the saved order on every device.
    const cohort = new Set(step.members || []);
    const byId = new Map(words.map(word => [word.id, word]));
    const ordered = state.wordIds.map(id => byId.get(id)).filter(Boolean);
    const candidates = cohort.size ? [...ordered.filter(word => cohort.has(word.id)), ...ordered] : ordered;
    const items = [];
    for (const candidate of candidates) {
      if (!taught.has(candidate.id) || (allowed && !allowed.has(candidate.id)) || !candidate[field] ||
          !distinct(candidate, step.word) || used.has(compare(candidate[field]))) continue;
      items.push(candidate[field]);
      used.add(compare(candidate[field]));
      if (items.length === 2) break;
    }
    if (!items.length) return [];
    const slot = [...step.word.id].reduce((total, char) => total + char.charCodeAt(0), 0) % (items.length + 1);
    items.splice(slot, 0, expected);
    return items;
  }

  function interact(state, steps, stepId, event, value = '') {
    const step = stepAt(steps, state);
    if (step?.id !== stepId) return state;
    const { id } = step.word;
    const study = { ...state.study };
    const add = key => { study[key] = union(study[key], [id]); };
    const put = (key, outcome) => { study[key] = { ...study[key], [id]: outcome }; };
    const result = resultFor(state, step);
    const matches = compare(value) === compare(expectedFor(step));
    if (step.phase === 'teach') {
      if (event === 'details') {
        add('explained');
        add('details');
      } else if (event === 'practice' && (step.practice === 'cloze' || step.rehearse)) {
        add('explained');
        add('taught');
      } else if (event === 'guided' && step.practice !== 'cloze' && !step.rehearse && compare(value)) {
        add('explained');
        add('taught');
        put('applications', matches ? 'assisted' : 'wrong');
        if (matches) add('applied');
      } else return state;
    } else if (step.phase === 'reinforce') {
      if (event !== 'connect') return state;
      add('reinforced');
    } else if (event === 'hint' && !result && step.phase === 'apply' && step.practice !== 'link') {
      add('hinted');
    } else if (!result && event === 'guided' && step.phase === 'apply' && step.practice === 'link' && matches) {
      // An old draft can already have taught this word and be waiting to apply it.
      put('applications', 'assisted');
      add('applied');
    } else if (!result && (event === 'reveal' || (event === 'answer' && compare(value)))) {
      const outcome = event === 'reveal' ? 'revealed' : !matches ? 'wrong' :
        step.phase === 'apply' && study.hinted.includes(id) ? 'assisted' : 'correct';
      if (step.phase === 'apply') {
        put('applications', outcome);
        if (['correct', 'assisted'].includes(outcome)) add('applied');
      } else if (step.phase === 'retry') {
        put('retries', outcome);
        if (outcome === 'correct') add('retried');
      } else if (outcome === 'correct') {
        add('remembered');
        add('recalled');
      } else put('misses', outcome);
    } else if (event === 'next' && result) {
      add({ apply: 'applied', retrieve: 'recalled', retry: 'retried' }[step.phase]);
    } else return state;
    return recalculate({ ...state, study });
  }

  function checkpointKey(state) {
    if (!state) return '';
    const sorted = values => [...(values || [])].sort();
    const entries = values => Object.entries(values || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return JSON.stringify([
      sorted(state.wordIds), sorted(state.creditedIds), sorted(state.legacyCompletedIds),
      sorted(state.completedWordIds), entries(state.answers), sorted(state.passed),
      ...listFields.map(key => sorted(state.study?.[key])), ...mapFields.map(key => entries(state.study?.[key])),
    ]);
  }

  function complete(state, ids = state?.wordIds) {
    const checkpoint = state?.version === version ? upgrade(state) : state?.version === 1 ? state : null;
    return Boolean(ids?.length && sameWords(checkpoint?.wordIds, ids) && sameWords(checkpoint?.completedWordIds, ids));
  }

  root.LootLinguaGateLesson = Object.freeze({
    version, time, isLegacy, keyFor, gateContext, hasGateIntent, wordRecord,
    build, cloze, start, upgrade, merge, sameWords, stepAt, interact, resultFor, expectedFor, choices, complete, checkpointKey,
  });
})(typeof window === 'object' ? window : globalThis);
