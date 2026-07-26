async function awardXPBatch(entries = []) {
  const requests = (Array.isArray(entries) ? entries : []).map((entry) => ({
    amount: Math.max(0, Math.floor(Number(entry?.amount) || 0)),
    reason: String(entry?.reason || ''),
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
  }));
  const awards = new Array(requests.length).fill(0);
  const claimable = [];

  requests.forEach((request, index) => {
    const eventId = String(request.metadata.eventId || '');
    request.metadata.awardStatus = 'invalid';
    const fixedAmount = XP_REASON_AMOUNTS[request.reason];
    if (
      !request.amount ||
      !eventId ||
      !XP_ALLOWED_REASONS.has(request.reason) ||
      (fixedAmount && request.amount !== fixedAmount) ||
      request.reason === 'daily_chest_unlock'
    ) return;
    if (hasLocalXPEvent(eventId) || xpAwardsInFlight.has(eventId)) {
      request.metadata.awardStatus = 'duplicate';
      return;
    }
    xpAwardsInFlight.add(eventId);
    claimable.push({ ...request, index, eventId });
  });

  if (!claimable.length) return { awards, total: 0, pendingCount: 0 };
  let pendingCount = 0;
  try {
    if (hasSignedInUser()) {
      if (typeof window.claimXPEventsInCloud !== 'function') {
        claimable.forEach((request) => {
          request.metadata.awardStatus = 'unavailable';
          queuePendingXPEvent(request.amount, request.reason, request.metadata);
        });
        return { awards, total: 0, pendingCount: claimable.length };
      }
      const result = await window.claimXPEventsInCloud(claimable.map((request) => ({
        eventId: request.eventId,
        amount: request.amount,
        reason: request.reason,
        baselineXP: userXP,
        xpEconomyVersion: XP_ECONOMY_VERSION,
      })));
      claimable.forEach((request, resultIndex) => {
        const item = result?.results?.[resultIndex] || {};
        if (item.awarded) {
          request.metadata.awardStatus = 'awarded';
          awards[request.index] = request.amount;
          recordXPEvent(request.reason, request.amount, request.metadata);
        } else if (item.duplicate) {
          request.metadata.awardStatus = 'duplicate';
          recordXPEvent(request.reason, 0, request.metadata);
        } else {
          request.metadata.awardStatus = item.invalid ? 'invalid' : 'unavailable';
          if (request.metadata.awardStatus === 'unavailable') {
            pendingCount += 1;
            queuePendingXPEvent(request.amount, request.reason, request.metadata);
          }
        }
      });
      if (Number.isFinite(result?.userXP) && result.userXP > userXP) {
        applyXPDelta(result.userXP - userXP);
      }
    } else {
      claimable.forEach((request) => {
        request.metadata.awardStatus = 'awarded';
        awards[request.index] = request.amount;
        recordXPEvent(request.reason, request.amount, request.metadata);
      });
      const total = awards.reduce((sum, amount) => sum + amount, 0);
      if (total > 0) applyXPDelta(total);
    }
    saveInt('xpEconomyVersion', XP_ECONOMY_VERSION);
    return {
      awards,
      total: awards.reduce((sum, amount) => sum + amount, 0),
      pendingCount,
    };
  } catch (error) {
    claimable.forEach((request) => {
      request.metadata.awardStatus = 'unavailable';
      queuePendingXPEvent(request.amount, request.reason, request.metadata);
    });
    console.warn('[LootLingua XP] batch award failed', error?.message || error);
    return { awards, total: 0, pendingCount: claimable.length };
  } finally {
    claimable.forEach((request) => xpAwardsInFlight.delete(request.eventId));
  }
}

window.awardXPBatch = awardXPBatch;
