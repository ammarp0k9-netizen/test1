(function attachDictionarySync(root) {
  'use strict';
  const scopeFor = worldId => worldId ? `custom:${worldId}` : 'personal';
  const id = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unavailable = () => Boolean(root.LootLinguaCloudBackoff?.reason());
  const temporary = error => Boolean(root.LootLinguaCloudBackoff?.classify(error).temporary);
  const aliasKey = (owner, wordId) => 'lootlingua:word-sync-id:v1:' + encodeURIComponent(owner) + ':' + wordId;
  const removedKey = (owner, wordId, worldId) => 'lootlingua:dictionary-removed:v1:' + encodeURIComponent(owner) + ':' + encodeURIComponent(worldId ? worldId + ':' + wordId : wordId);
  const resolvedId = (owner, wordId) => wordId.startsWith('pending-word-')
    ? localStorage.getItem(aliasKey(owner, wordId)) || wordId : wordId;

  const outbox = root.LootLinguaOperations.createOutbox('dictionary', async (item, current) => {
    const { word, worldId, patch } = item.payload;
    if (worldId && root.isCustomWorldPendingSync?.(worldId, item.owner)) return { retryLatest: true };
    const originalId = String(word.id);
    const wordId = resolvedId(item.owner, originalId);
    if (item.type === 'transfer') {
      const { from, isMove, targetId } = item.payload;
      if (wordId.startsWith('pending-word-')) return { retryLatest: true };
      const result = await root.upsertUserWordWithSource({
        word, source: worldId ? { type: 'private-world', customWorldId: worldId } : { type: 'manual' },
        privateWorldMembership: Boolean(worldId), restoreHidden: !worldId, hiddenOnCreate: Boolean(worldId),
        personalDictionaryState: word.personalDictionaryState, operationId: item.id,
        removePrivateWorldId: isMove ? from : '', removePrivateMembershipId: isMove && from ? wordId : '',
        replayTransfer: true,
      });
      const realId = worldId ? result?.membershipWordId : result?.wordId;
      if (!realId) throw Object.assign(new Error('The transfer was not confirmed.'), { code: 'failed-precondition' });
      if (!current()) return;
      if (targetId) localStorage.setItem(aliasKey(item.owner, targetId), String(realId));
      return { wordId: String(realId), word: { ...word, personalDictionaryState: 'active', hiddenFromDictionary: false },
        removedFrom: isMove ? from : undefined, originalId: wordId };
    }
    if (item.type === 'restore-personal') {
      if (wordId.startsWith('pending-word-')) return { retryLatest: true };
      const result = await root.upsertUserWordWithSource({
        word, source: { type: 'private-world', customWorldId: worldId }, privateWorldMembership: true,
        restoreHidden: true, personalDictionaryState: 'active', operationId: item.id,
      });
      if (!result?.wordId) throw Object.assign(new Error('The personal word could not be restored.'), { code: 'failed-precondition' });
      return { wordId: result.wordId, word: { ...word, personalDictionaryState: 'active', hiddenFromDictionary: false }, restored: true };
    }
    if (item.type === 'add') {
      const lifecycle = root.upsertUserWordWithSource;
      if (!lifecycle) throw Object.assign(new Error('Dictionary storage is starting.'), { code: 'unavailable' });
      const result = await lifecycle({
        word, source: worldId ? { type: 'private-world', customWorldId: worldId } : { type: item.payload.sourceType || 'manual' },
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
    if (item.type === 'restore-word') {
      const result = await root.upsertUserWordWithSource({
        word, existingWordId: wordId, source: { type: item.payload.sourceType || 'manual' },
        restoreHidden: true, personalDictionaryState: 'active', operationId: item.id,
      });
      if (!result?.wordId) throw Object.assign(new Error('The word could not be restored.'), { code: 'failed-precondition' });
      return { wordId: result.wordId, word: { ...word, hiddenFromDictionary: false, hiddenFromDictionaryAt: null,
        personalDictionaryState: 'active' }, restored: true };
    }
    if (item.type === 'edit') {
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, word[key] ?? (key === 'starred' ? false : '')]));
      const result = worldId ? await root.updateCustomWorldDictionaryWordInCloud(worldId, wordId, patch, { expected })
        : await root.updateDictionaryWordInCloud(wordId, patch, { expected });
      if (result !== true) throw Object.assign(new Error('The word update was not confirmed.'), { code: 'failed-precondition' });
      return { wordId, word: { ...word, ...patch } };
    }
    if (worldId && item.type === 'remove-private') {
      const result = await root.deleteCustomWorldWordFromCloud(worldId, wordId, word, {
        disposition: item.payload.disposition, propagate: true,
      });
      if (!result) throw Object.assign(new Error('The private word removal was not confirmed.'), { code: 'failed-precondition' });
      return { wordId, removed: true };
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
    rejectionReason: error => error?.code === 'word-lifecycle/disposition-required' ? 'private-disposition' : '',
    rejectionData: error => error?.code === 'word-lifecycle/disposition-required'
      ? { hasJourneySource: Boolean(error.impact?.hasJourneySource) } : undefined,
    onChange(owner) { root.dispatchEvent(new CustomEvent('lootlingua:dictionary-outbox', { detail: { owner } })); },
    onConfirmed(item, result) {
      if (result?.removedFrom && result.originalId) {
        localStorage.setItem(removedKey(item.owner, result.originalId, result.removedFrom), String(Date.now()));
      }
      if ((result?.removed || result?.hidden) && result.wordId) {
        localStorage.setItem(removedKey(item.owner, result.wordId, item.payload.worldId), String(Date.now()));
      } else if (['add', 'transfer', 'restore-personal', 'restore-word'].includes(item.type) && result?.wordId) {
        localStorage.removeItem(removedKey(item.owner, result.wordId, result.restored ? '' : item.payload.worldId));
      }
      root.dispatchEvent(new CustomEvent('lootlingua:dictionary-outbox-confirmed', { detail: { item, result } }));
    },
  });

  function enqueue(type, worldId, word, patch, sourceType) {
    const next = type === 'add' ? { ...word, id: 'pending-word-' + id() } : { ...word };
    if (!next.id) throw new Error('The dictionary word is missing an ID.');
    const scope = scopeFor(worldId);
    outbox.enqueue(type, { worldId: worldId || '', word: next, patch, sourceType }, { id: id(), lane: scope + ':' + next.id });
    return next;
  }

  function pendingPrivateRemoval(owner, worldId, wordId) {
    return outbox.list(owner).find(item => item.type === 'remove-private' && item.payload.worldId === worldId &&
      resolvedId(owner, String(item.payload.word.id)) === String(wordId));
  }

  function removePrivate(owner, worldId, word, disposition) {
    const prior = pendingPrivateRemoval(owner, worldId, word.id);
    if (prior && !prior.rejected) return;
    const payload = { worldId, word, disposition };
    if (prior && outbox.retryRejected(prior.id, payload)) return;
    outbox.enqueue('remove-private', payload, { id: id(), lane: scopeFor(worldId) + ':' + word.id });
  }

  function transfer(from, to, word, isMove, operationId) {
    const id = operationId + ':' + word.id;
    const targetId = 'pending-word-transfer-' + encodeURIComponent(id);
    outbox.enqueue('transfer', { from, worldId: to, word, isMove, targetId }, {
      id, lane: scopeFor(from) + ':' + word.id,
    });
  }

  function restoreWord(word, sourceType) { enqueue('restore-word', '', word, undefined, sourceType); }

  function restorePersonal(worldId, word, operationId) {
    outbox.enqueue('restore-personal', { worldId, word }, { id: operationId, lane: scopeFor(worldId) + ':' + word.id });
  }

  function project(rows, owner, worldId, fromOfflineCache = false) {
    if (!owner) return rows;
    if (fromOfflineCache) {
      try {
        rows = rows.filter(word => {
          const key = removedKey(owner, String(word.id), worldId);
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
      if (item.rejected) { blocked.add(item.lane); continue; }
      if (blocked.has(item.lane)) continue;
      const { word } = item.payload;
      const key = resolvedId(owner, String(word.id));
      if (item.type === 'transfer') {
        if (item.payload.isMove && String(item.payload.from || '') === String(worldId || '')) {
          if (worldId) byId.delete(key);
          else if (byId.has(key)) byId.set(key, { ...byId.get(key), personalDictionaryState: 'moved-to-private-world' });
        }
        if (item.payload.targetId && String(item.payload.worldId || '') === String(worldId || '')) {
          const identity = root.LootLinguaWordLifecycle?.wordKeyOf(word);
          const existing = identity && [...byId.values()].find(row => root.LootLinguaWordLifecycle.wordKeyOf(row) === identity);
          const id = existing?.id || resolvedId(owner, item.payload.targetId);
          byId.set(String(id), worldId ? { ...word, ...existing, id }
            : { ...word, ...existing, id, personalDictionaryState: 'active', hiddenFromDictionary: false });
        }
        continue;
      }
      if (item.type === 'restore-personal' && !worldId) {
        const identity = root.LootLinguaWordLifecycle?.wordKeyOf(word);
        const existing = identity && [...byId.values()].find(row => root.LootLinguaWordLifecycle.wordKeyOf(row) === identity);
        if (existing) byId.set(String(existing.id), { ...existing, personalDictionaryState: 'active', hiddenFromDictionary: false });
        continue;
      }
      if (String(item.payload.worldId || '') !== String(worldId || '')) continue;
      if (item.type === 'restore-personal' && byId.has(key)) byId.set(key, { ...byId.get(key), personalDictionaryState: 'active' });
      if (item.type === 'remove' || item.type === 'remove-private') byId.delete(key);
      else if (item.type === 'restore-word') byId.set(key, { ...word, ...byId.get(key), id: key,
        hiddenFromDictionary: false, hiddenFromDictionaryAt: null, personalDictionaryState: 'active' });
      else if (item.type === 'add' && !byId.has(key)) byId.set(key, { ...word, id: key });
      else if (item.type === 'edit') {
        const patch = item.payload.patch;
        byId.set(key, { ...(byId.get(key) || word), ...patch, id: key,
          ...(Object.hasOwn(patch, 'meaning') ? { translation: patch.meaning } : {}) });
      }
    }
    return [...byId.values()];
  }

  root.LootLinguaDictionarySync = Object.freeze({ unavailable, temporary, enqueue, project, transfer, removePrivate, pendingPrivateRemoval, restorePersonal, restoreWord });
})(window);
