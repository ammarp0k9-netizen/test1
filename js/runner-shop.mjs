// Shared prices for previews and the profile transaction.
const prices = Object.freeze({
  'map:forest': 110,
  'map:desert': 165,
  'map:harbor': 210,
  'map:summit': 265,
  'map:volcano': 335,
  'map:neon': 420,
  'character:mechanic': 90,
  'character:ranger': 115,
  'character:nomad': 155,
  'character:alpinist': 195,
  'character:courier': 245,
  'character:diver': 300,
});
const free = new Set(['map:classic', 'character:explorer']);

export function runnerPrice(item) {
  return free.has(item) ? 0 : Object.hasOwn(prices, item) ? prices[item] : null;
}

export function runnerUnlocks(items) {
  return [...new Set((Array.isArray(items) ? items : []).filter(item =>
    typeof item === 'string' && Object.hasOwn(prices, item)))];
}

export function runnerOwns(profile, item) {
  return free.has(item) || runnerUnlocks(profile?.runnerUnlocks).includes(item);
}

export function purchaseRunnerItem(profile, item) {
  const price = runnerPrice(item);
  if (typeof item !== 'string' || !price) return { reason: 'invalid-runner-item' };
  const owned = runnerUnlocks(profile?.runnerUnlocks);
  if (owned.includes(item)) return { reason: 'already-owned' };
  const balance = Math.max(0, Math.floor(Number(profile?.runnerCoins) || 0));
  if (balance < price) return { reason: 'insufficient-balance' };
  return { profile: { ...profile, runnerCoins: balance - price, runnerUnlocks: [...owned, item] } };
}
