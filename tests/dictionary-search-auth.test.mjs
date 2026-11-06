import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/dictionary.js', import.meta.url), 'utf8');
const headers = source.slice(source.indexOf('async function buildAiRequestHeaders()'), source.indexOf('function bindSearchLockOverlays()'));
const search = source.slice(source.indexOf('async function fetchAiMeaningsWithCache('), source.indexOf('function clearGamerSuggestionsUI()'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness({ guest = false, responseStatus = 200, bodyGate = Promise.resolve() } = {}) {
  const calls = { requests: [], guestUsed: [], blocked: 0, cacheWrites: 0 };
  const root = { auth: { currentUser: guest ? null : { uid: 'a', getIdToken: async () => 'verified-token-a' } },
    __lootlinguaAuthGeneration: 1,
    saveAiGlobalCache: async () => { calls.cacheWrites++; },
  };
  const context = vm.createContext({ window: root, console: { warn() {} }, DICT_API_BASE: 'https://example.invalid',
    guardGuestAiSearch: () => true, isAiUserLoggedIn: () => Boolean(root.auth.currentUser),
    markGuestSearchUsed: type => calls.guestUsed.push(type), showGuestTrialBlocked: () => calls.blocked++,
    async fetch(url, options) {
      calls.requests.push({ url, ...options });
      return { status: responseStatus, ok: responseStatus >= 200 && responseStatus < 300,
        json: async () => { await bodyGate; return responseStatus === 200 ? [{ ar: 'meaning' }] : { error: 'Server error' }; } };
    },
  });
  vm.runInContext(headers + '\n' + search, context);
  return { root, calls, search: (type = 'normal') => context.fetchAiMeaningsWithCache('term', type),
    switchOwner(uid) { root.auth.currentUser = uid ? { uid, getIdToken: async () => 'verified-' + uid } : null; root.__lootlinguaAuthGeneration++; } };
}

test('a failed or empty account token never sends an anonymous request or spends a guest trial', async () => {
  for (const kind of ['rejected', 'empty']) {
    const h = harness(); h.root.auth.currentUser.getIdToken = async () => {
      if (kind === 'rejected') throw Error('offline'); return '';
    };
    await assert.rejects(h.search(), { code: 401 });
    assert.equal(h.calls.requests.length, 0); assert.equal(h.calls.cacheWrites, 0);
    assert.deepEqual(h.calls.guestUsed, []); assert.equal(h.calls.blocked, 0);
  }
});

for (const aba of [false, true]) test(`account changes while awaiting the token prevent network access${aba ? ' including A to B to A' : ''}`, async () => {
  const h = harness(), gate = deferred(); h.root.auth.currentUser.getIdToken = () => gate.promise;
  const pending = h.search(); h.switchOwner('b'); if (aba) h.switchOwner('a'); gate.resolve('old-a-token');
  await assert.rejects(pending, { code: 401 }); assert.equal(h.calls.requests.length, 0); assert.deepEqual(h.calls.guestUsed, []);
});

test('account changes during cache lookup cannot send the old search under the next account', async () => {
  const h = harness(), gate = deferred(); h.root.getAiGlobalCache = () => gate.promise;
  const pending = h.search(); h.switchOwner('b'); gate.resolve(null);
  await assert.rejects(pending, { code: 401 }); assert.equal(h.calls.requests.length, 0);
});

test('a valid signed-in search sends the exact Bearer token and never marks a guest trial', async () => {
  const h = harness(); assert.equal((await h.search()).ok, true);
  assert.equal(h.calls.requests.length, 1); assert.equal(h.calls.requests[0].headers.Authorization, 'Bearer verified-token-a');
  assert.equal(h.calls.cacheWrites, 1); assert.deepEqual(h.calls.guestUsed, []);
});

test('server 401 and signed-in 403 retain retry semantics without locking guest access or opening guest registration', async () => {
  for (const responseStatus of [401, 403]) {
    const h = harness({ responseStatus });
    await assert.rejects(h.search(), responseStatus === 401 ? { code: 401 } : { code: 'dictionary/forbidden', status: 403 });
    assert.equal(h.calls.requests.length, 1); assert.deepEqual(h.calls.guestUsed, []);
    assert.equal(h.calls.blocked, 0); assert.equal(h.calls.cacheWrites, 0);
  }
});

test('an actual anonymous 403 keeps the existing guest trial and registration contract', async () => {
  const h = harness({ guest: true, responseStatus: 403 });
  await assert.rejects(h.search('gamer'), { code: 403 });
  assert.equal(h.calls.requests[0].headers.Authorization, undefined);
  assert.deepEqual(h.calls.guestUsed, ['gamer']); assert.equal(h.calls.blocked, 1);
});

test('a response finishing after an auth change cannot consume trials or publish a cache entry for the new owner', async () => {
  const gate = deferred(), h = harness({ bodyGate: gate.promise });
  const pending = h.search();
  await Promise.resolve(); await Promise.resolve(); h.switchOwner('b'); gate.resolve();
  await assert.rejects(pending, { code: 401 }); assert.equal(h.calls.cacheWrites, 0); assert.deepEqual(h.calls.guestUsed, []);
});
