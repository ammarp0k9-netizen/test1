(function attachDictionarySync(root) {
  'use strict';
  const scopeFor = worldId => worldId ? `custom:${worldId}` : 'personal';
  const id = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unavailable = () => Boolean(root.LootLinguaCloudBackoff?.reason());
  const temporary = error => Boolean(root.LootLinguaCloudBackoff?.classify(error).temporary);
  const aliasKey = (owner, wordId) => 'lootlingua:word-sync-id:v1:' + encodeURIComponent(owner) + ':' + wordId;
  const removedKey = (owner, wordId) => 'lootlingua:dictionary-removed:v1:' + encodeURIComponent(owner) + ':' + encodeURIComponent(wordId);
  const resolvedId = (owner, wordId) => wordId.startsWith('pending-word-')
    ? localStorage.getItem(aliasKey(owner, wordId)) || wordId : wordId;

  const outbox = root.LootLinguaOperations.createOutbox('dictionary', async (item, current) => {
    const { word, worldId, patch } = item.payload;
    if (worldId && root.isCustomWorldPendingSync?.(worldId, item.owner)) return { retryLatest: true };
    const originalId = String(word.id);
    const wordId = resolvedId(item.owner, originalId);
    if (item.type === 'transfer') {
      const { from, isMove } = item.payload;
      const result = await root.upsertUserWordWithSource({
        word, source: worldId ? { type: 'private-world', customWorldId: worldId } : { type: 'manual' },
        privateWorldMembership: Boolean(worldId), restoreHidden: !worldId, hiddenOnCreate: Boolean(worldId),
        personalDictionaryState: word.personalDictionaryState, operationId: item.id,
        removePrivateWorldId: isMove ? from : '', removePrivateMembershipId: isMove && from ? wordId : '',
        replayTransfer: true,
      });
      if (!(worldId ? result?.membershipWordId : result?.wordId)) throw Object.assign(new Error('The transfer was not confirmed.'), { code: 'failed-precondition' });
      return null;
    }
    if (item.type === 'add') {
      const lifecycle = root.upsertUserWordWithSource;
      if (!lifecycle) throw Object.assign(new Error('Dictionary storage is starting.'), { code: 'unavailable' });
      const result = await lifecycle({
        word, source: worldId ? { type: 'private-world', customWorldId: worldId } : { type: 'manual' },
        privateWorldMembership: Boolean(worldId), restoreHidden: !worldId, hiddenOnCreate: Boolean(worldId),
        personalDictionaryState: worldId ? 'moved-to-private-world' : 'active', operationId: item.id,
      });
      if (!current()) return;
      const realId = worldId ? result?.membershipWordId : result?.wordId;
      if (!realId) throw Object.assign(new Error('The word was not accepted.'), { code: 'failed-precondition' });
      localStorage.setItem(aliasKey(item.owner, originalId), String(realId));
      return { wordId: String(realId), word };
    }
    if (wordId.startsWith('pending-word-')) throw Object.assign(new Error('The word is not ready.'), { code: 'failed-precondition' });
    if (item.type === 'edit') {
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, word[key] ?? (key === 'starred' ? false : '')]));
      const result = worldId ? await root.updateCustomWorldDictionaryWordInCloud(worldId, wordId, patch, { expected })
        : await root.updateDictionaryWordInCloud(wordId, patch, { expected });
      if (result !== true) throw Object.assign(new Error('The word update was not confirmed.'), { code: 'failed-precondition' });
      return { wordId, word: { ...word, ...patch } };
    }
    if (!worldId && item.type === 'remove') {
      const summary = await root.getUserWordSourceSummary(word);
      if (!current()) return;
      if (summary?.hasJourneySource) {
        await root.hideUserWordFromDictionary(wordId);
        return { wordId, hidden: true };
      }
      const result = await root.deletePersonalUserWord(wordId, word, summary);
      if (!result?.deleted) throw Object.assign(new Error('The word could not be removed.'), { code: 'failed-precondition' });
      return { wordId, removed: true };
    }
    throw Object.assign(new Error('This action requires a choice in the dictionary.'), { code: 'failed-precondition' });
  }, {
    onChange(owner) { root.dispatchEvent(new CustomEvent('lootlingua:dictionary-outbox', { detail: { owner } })); },
    onConfirmed(item, result) {
      if (!item.payload.worldId && (result?.removed || result?.hidden) && result.wordId) {
        localStorage.setItem(removedKey(item.owner, result.wordId), String(Date.now()));
      } else if (item.type === 'add' && !item.payload.worldId && result?.wordId) {
        localStorage.removeItem(removedKey(item.owner, result.wordId));
      }
      root.dispatchEvent(new CustomEvent('lootlingua:dictionary-outbox-confirmed', { detail: { item, result } }));
    },
  });

  function enqueue(type, worldId, word, patch) {
    const next = type === 'add' ? { ...word, id: 'pending-word-' + id() } : { ...word };
    if (!next.id) throw new Error('The dictionary word is missing an ID.');
    const scope = scopeFor(worldId);
    outbox.enqueue(type, { worldId: worldId || '', word: next, patch }, { id: id(), lane: scope + ':' + next.id });
    return next;
  }

  function transfer(from, to, word, isMove, operationId) {
    outbox.enqueue('transfer', { from, worldId: to, word, isMove }, {
      id: operationId + ':' + word.id, lane: scopeFor(from) + ':' + word.id,
    });
  }

  function project(rows, owner, worldId, fromOfflineCache = false) {
    if (!owner) return rows;
    if (!worldId && fromOfflineCache) {
      try {
        rows = rows.filter(word => {
          const key = removedKey(owner, String(word.id));
          const stamp = Number(localStorage.getItem(key));
          if (!stamp) return true;
          if (Date.now() - stamp < 14 * 86400000) return false;
          localStorage.removeItem(key);
          return true;
        });
      } catch (_) {}
    }
    const items = outbox.list(owner);
    if (!items.length) return rows;
    const byId = new Map(rows.map(word => [String(word.id), word]));
    const blocked = new Set();
    for (const item of items) {
      if (String(item.payload.worldId || '') !== String(worldId || '')) continue;
      if (item.rejected) { blocked.add(item.lane); continue; }
      if (blocked.has(item.lane)) continue;
      const word = item.payload.word;
      const key = resolvedId(owner, String(word.id));
      if (item.type === 'remove') byId.delete(key);
      else if (item.type === 'add' && !byId.has(key)) byId.set(key, { ...word, id: key });
      else if (item.type === 'edit') {
        const patch = item.payload.patch;
        byId.set(key, { ...(byId.get(key) || word), ...patch, id: key,
          ...(Object.hasOwn(patch, 'meaning') ? { translation: patch.meaning } : {}) });
      }
    }
    return [...byId.values()];
  }

  root.LootLinguaDictionarySync = Object.freeze({ unavailable, temporary, enqueue, project, transfer });
})(window);
