/* Reward policy shared by the UI and owner-scoped transaction adapter. */
(function(root) {
  'use strict';
  const MASTERY = Object.freeze([{ target: 10, xp: 20 }, { target: 25, xp: 35 }, { target: 50, xp: 60 }, { target: 100, xp: 100 }]);
  const GROUP_SIZE = 3, STATION_XP = 25;
  const unique = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value))];
  function normalize(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    return { version: 1, masteredKeys: unique(input.masteredKeys).slice(0, 100),
      worlds: { ...(input.worlds || {}) }, rewards: { ...(input.rewards || {}) } };
  }
  function earnedMastery(entry) {
    return entry?.mastered_once === true && entry.hasEarnedMasteryXP === true &&
      (entry.earnedTransitions || []).includes('reviewing_mastered') &&
      Number(entry.quiz_seen_count) > 0 && Number(entry.last_quizzed_at) > 0;
  }
  function advance(input, mastery = {}, gates = []) {
    const state = normalize(input);
    state.masteredKeys = unique([...state.masteredKeys, ...Object.entries(mastery)
      .filter(([, entry]) => earnedMastery(entry)).map(([key]) => key)]).slice(0, 100);
    for (const gate of gates) {
      const key = `world:${gate.worldId}`, old = state.worlds[key] || {};
      state.worlds[key] = { count: Math.max(0, Number(old.count) || 0) + 1,
        worldId: gate.worldId, label: String(gate.worldLabel || old.label || 'العالم').slice(0, 160) };
    }
    const awards = [];
    for (const item of MASTERY) if (state.masteredKeys.length >= item.target) {
      const id = `mastery:${item.target}`;
      if (!state.rewards[id]) awards.push({ id, kind: 'mastery', target: item.target, xp: item.xp,
        title: `أتقنت ${item.target} كلمات`, reason: `مكافأة إتقان ${item.target} كلمة مختلفة لأول مرة.` });
    }
    for (const world of Object.values(state.worlds)) {
      const stations = Math.floor(Math.max(0, Number(world.count) || 0) / GROUP_SIZE);
      for (let index = 1; index <= stations; index++) {
        const target = index * GROUP_SIZE, id = `station:${world.worldId}:${target}`;
        if (!state.rewards[id]) awards.push({ id, kind: 'station', worldId: world.worldId,
          target, xp: STATION_XP, title: `أكملت المحطة ${index}`,
          reason: `اجتزت ${target} بوابات بالتعلّم في ${world.label || 'العالم'}.` });
      }
    }
    return { state, awards };
  }
  function nextMastery(input) {
    const state = normalize(input), count = state.masteredKeys.length;
    const next = MASTERY.find(item => !state.rewards[`mastery:${item.target}`]);
    return next ? { ...next, count, remaining: Math.max(0, next.target - count), kind: 'mastery' } : null;
  }
  function nextStation(input, worldId, options = {}) {
    const state = normalize(input), world = state.worlds[`world:${worldId}`] || {};
    const count = Math.max(0, Number(world.count) || 0);
    let target = GROUP_SIZE;
    while (state.rewards[`station:${worldId}:${target}`]) target += GROUP_SIZE;
    if (options.complete && target > count || Number(options.availableCount) > 0 && target > Number(options.availableCount)) return null;
    return { kind: 'station', worldId, count, target, remaining: Math.max(0, target - count), xp: STATION_XP };
  }
  root.LootLinguaMotivationPolicy = Object.freeze({ MASTERY, GROUP_SIZE, STATION_XP, normalize, earnedMastery, advance, nextMastery, nextStation });
})(typeof window !== 'undefined' ? window : globalThis);
