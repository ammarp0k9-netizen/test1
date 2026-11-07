# Firestore read review — 2026-11-07

No production Firestore request, database write, rule deployment, billing change, or dependency installation was used for this review. Tests used local adapters. These measurements describe application requests, not the project's billed usage dashboard.

## Confirmed unnecessary work and changes

1. **Newest/oldest sorting fetched the complete dictionary.** The sort picker awaited `requireComplete`; the renderer also drained every page whenever a saved nonautomatic sort was active. Chronological modes now page from Firestore. Two bounded streams merge Timestamp and ISO-string `createdAt` values, since existing writers use both types. Opening a 2,000-word mixed-format fixture displayed 80 words and fetched 160 word documents instead of draining 2,000. Subsequent pages use buffered records and bounded cursor requests. Missing-date legacy records remain reachable through a bounded document-ID fallback at the end; they are not silently dropped. Alpha/category sorting and full substring search still need the complete source for accurate global results.
2. **Notifications already synchronized were uploaded again after the first snapshot.** Each record previously started a transaction, read its document and wrote it again. Only offline differences are now uploaded; an identical transaction payload is not rewritten. A 100-record fixture produced zero reconciliation transaction reads/writes, while one changed offline record produced one read and one write. The notification subscription's initial document reads remain necessary and are not included in these zero counts.
3. **Each notification fact evaluation queried the latest trusted quiz again.** Concurrent evaluations now share one request and reuse the result for five minutes. A trusted quiz completion or authentication change invalidates this cache. Failed reads/writes respect quota backoff.
4. **Overlapping visible word pages replaced their listeners.** Unchanged 30-ID subscriptions are retained. Moving from one 80-word page to that page plus its neighbor added only the neighbor's three subscriptions, without recreating the original three. Leaving the dictionary still releases visible listeners. Returning to a released page can legitimately incur new reads.
5. **Dictionary aggregation counts expired after one minute.** The cache now lasts five minutes and concurrent requests remain deduplicated. Aggregations still run at startup and when this cache expires; this change is not a removal of count reads.

## Logout

The logout confirmation lacked dialog registration while the profile focus manager isolated sibling content. Shared modal opening now assigns dialog semantics and registers the confirmation with the focus manager; its buttons can receive focus and real pointer clicks over the profile. Confirmation shows a busy state and suppresses duplicate clicks. Existing bounded save-before-logout and durable account outbox behavior remain in place.

Real Chrome verified a physical click on confirmation with the network blocked, Escape cancellation, and restoration of profile focus. This browser fixture stubs authentication; it does not sign a production user out.

## Remaining intentional reads and limits

- Full export, global substring search, alpha/category ordering, complete statistics and quiz-source preparation may load all words once within the current page store. Rendering fewer cards does not itself reduce source reads.
- A legacy scan is still necessary when older documents lack the fields required by a sorted query. Each request stays limited to 80; the total scan can exceed a single page.
- First snapshots, reconnects, another browser/device, administrative content queries, transactional checks, and security-rule dependent reads can contribute additional usage. This patch does not claim to eliminate those costs.
- Historical attribution of the exhausted daily quota requires project usage metrics; the code findings alone do not identify which device/user generated all previous reads.
- The string-date merge follows the ISO date representation written by the app. Arbitrary non-ISO imported strings are legacy data and do not have a guaranteed global chronological position before the complete source is loaded.

Firebase billing reference: https://firebase.google.com/docs/firestore/pricing

## Validation

125 related tests passed, followed by a focused 32-test pass after the final pagination guards. The network-blocked Chrome modal check passed nine checks, including the real logout-confirmation pointer click. No production quota was consumed by these fixtures.
