# LootLingua integrity and accessibility fixes — 2026-11-05

Baseline: `c072ba6f1497fc4e791daa926ea687a74ff5314c`.

## What changed

- Dictionary edits, stars and ordering use dedicated acknowledged dictionary writes. SRS writers remain restricted to learning fields, including when Quiz supplies a whole word object. Readable aliases are written together. Changing a word's normalized identity is rejected; adding a different word must create a separate entry so existing learning is not transferred.
- Signed-in additions require a real server ID before local success or the first-word event. Failed saves retain the draft. Guest success requires local persistence; quota failures roll back additions and preserve edits. Duplicate submissions and late acknowledgements cannot erase a newer draft or a different account's state.
- Explicit private-world-to-personal moves preserve saved dictionary edits atomically before deleting their source membership. Destination learning state and official canonical content remain intact. A missing source membership rejects the operation rather than displaying an unpersisted success.
- Profile reads, deferred writes, guest migration and pending recovery are bound to their original account and auth session. A stale continuation cannot reset another account, purge its guest recovery data or mark its readiness complete. A verified guest profile remains recoverable until all migration stages succeed.
- Theme, Oasis mode and introductory-theme receipts save only preference fields. Product Entry uses the same limited API with verification and stays resumable if it fails. These appearance operations no longer carry stale XP or reward counters.
- Search suggestion content is encoded as data and text, with delegated click/keyboard handlers. Untrusted response fields are never interpolated into executable event attributes. Native more/less controls retain their own result group and focus behavior.
- A rejected, unavailable or pending chest claim preserves locked XP and qualification. Only a confirmed award or confirmed duplicate resolves it. Claims are isolated across auth sessions and cannot clear a newer chest after an await.
- Streak protection follows its one-day description. XP single and batch award continuations and retries are isolated across account changes; an in-flight request is not a confirmed duplicate.
- Theme choices use native keyboard controls and announce selection, including theme relocking. Auth and coach action text uses measured contrast colors without changing the theme palette or unlock rules.
- Statistics reuse one mastery snapshot per calculation and use the local calendar date for the activity heatmap. Missing local CSS/favicon references were removed or corrected.

## Rendering remains virtual

The existing dictionary paging and variable-height virtualization remain in place: source pages contain at most 80 records, and distant card DOM nodes are removed in both scroll directions. Returning to the top removes distant rendered cards.

The scrollbar describes the logical list through spacers. Its thumb stays short after many records have been loaded even when those cards are absent from the DOM. Shrinking those spacers would collapse the scroll range and cause jumps. Already fetched word data can remain cached in memory for the visit; this is distinct from rendered card nodes. Explicit whole-dictionary operations such as global search, export and Quiz preparation may finish fetching pages. This change does not introduce cache eviction or promise a fixed RAM ceiling.

## Verification and evidence

- `npm run test:integrity`: **172/172 pass**, covering dictionary writes/UI, account isolation, preferences, guest migration, suggestions, paging, Quiz learning regressions and reward integrity.
- `npm run test:entry:integration`: **58/58 pass**, Product Entry persistence and recovery integration tests.
- `node --test tests/chest-claim-integrity.test.mjs tests/streak-freeze.test.mjs`: reward rejection, retry, auth isolation and calendar boundaries.
- `npm run test:integrity:browser`: real Chrome with 2,000 synthetic words at 1280, 390 and 320 px, scroll down/up, page failures/retries, cancellation, expansion retention, safe suggestions and rejected/acknowledged dictionary writes. Source requests are bounded at 80 records; observed DOM card counts remain about 21–34. See [after.json](after.json) and [320 px screenshot](after-320.png).
- The same browser command also runs theme keyboard/contrast verification: **5 interaction scenarios and 42 color measurements pass**, across normal/hover/active states; the minimum measured ratio is **5.15:1**. See [theme measurements](theme-accessibility.json) and [theme screenshot](theme-keyboard.png). Measurements include defined glass/frost styles, while their existing unavailable/coming-soon status remains unchanged.
- `node tools/entry-experience-browser-smoke.mjs --integrity`: 12 real Chrome DOM/input/reload scenarios, including guest/account entry, failed writes and account switching. All 12 pass without runtime exceptions. Firebase is replaced by deterministic adapters. See [entry matrix](entry/matrix.json).
- The broader local suite contains **773 tests: 749 pass, 24 fail**, compared with the pre-change baseline of 632 tests (608 pass, 24 fail) in [test-comparison.json](test-comparison.json). There are **zero new failures**. The 24 existing failures are not treated as green tests or silently deleted. Firestore emulator and external landing-routing checks are excluded from this local comparison.

Browser evidence uses synthetic local state and mocked cloud adapters. It verifies real DOM behavior and orchestration, not deployed Firestore permissions or real-device performance. No synthetic writes were sent to production.

## Remaining boundaries

- General progress/reward profile saves still require a separate concurrency design review. Isolating appearance writes and stale auth continuations does not make all multi-device profile writes atomic.
- This patch does not choose or deploy a new Firestore rules authority, change shared-cache permissions, or resolve the pre-existing conflict in the separate ignored `dictionary7` repository (`UU index.js`).
- No billing activation, Cloud Functions deployment, production test data or dependency installation is part of this work. Website commits are pushed under the user's existing authorization.
