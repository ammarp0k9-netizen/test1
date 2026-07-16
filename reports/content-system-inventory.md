# LootLingua ready-content inventory (before implementation)

Date: 2026-07-13

This inventory was captured before implementing the ready-content system. The new naming convention is `worldId` → `rankId` → `gateId`; the existing `customWorlds` feature remains a separate user-owned system.

## 1. Runtime and systems to reuse

- `index.html` loads two Firebase ES modules followed by the classic runtime. The effective local order is `core.js`, `storage.js`, `script.js`, `xp.js`, `dictionary.js`, `worlds.js`, `dictionary-render.js`, `srs.js`, `quiz.js`, `srs-transitions.js`, `quiz-runtime.js`, `core-runtime.js`.
- `js/cloud.js` owns the only Firebase `initializeApp` call, exposes `window.auth` and `window.db`, and owns the main Auth listener plus the personal-word, custom-world, custom-world-word, and global-mastery listeners.
- `js/profile-cloud.js` reuses `getApps()[0]`; it must not initialize Firebase again.
- `js/script.js` owns the current router and shared lexical state (`currentView`, `customWorlds`, `activeCustomWorldId`, profile/quiz state). New views must extend its route boundary without renaming old routes, IDs, or classes.
- `js/storage.js` owns user/guest scoping and existing localStorage contracts. New content may add new prefixed keys but must not rename or reinterpret existing keys.
- `js/dictionary.js` owns the personal/custom dictionary CRUD and the central text normalizer (`lowercase + trim + collapsed spaces`). It already escapes dynamic HTML through `escapeHtml`, although new UI should prefer DOM creation plus `textContent`.
- `js/srs.js`, `js/quiz.js`, `js/srs-transitions.js`, and `js/xp.js` provide the current mastery, scheduling, quiz, and XP systems. Ready content must enter through a new quiz-source adapter, not through a second SRS algorithm.
- Existing `reports/refactor-*` and `tools/refactor-*` capture the previous file-split contracts and are verification references only.

## 2. Protected behavior and functions

The following are protected and must not be changed except for a narrow source-boundary adapter in `quiz.js`:

- `XP_ECONOMY_VERSION`, `XP_REWARDS`, `XP_REASON_AMOUNTS`, `awardXP`, and the cloud XP transaction.
- `SRS_STATUSES`, `getDefaultMasteryState`, `getInlineWordMasteryState`, `computeSrsUpdate`, and `earnedTransitions` handling.
- `QUIZ_QUOTAS`, `QUIZ_QUOTA_CAPS`, backlog thresholds/fallbacks, `applyRecentExposurePenalty`, `calculateQuizQuotas`, `buildBalancedQuizDeck`, and `buildSmartQuizDeck`.
- Flashcards, Time Attack, Scramble, verified-result commit, Resume serialization, streak/chest/lockedXP behavior.
- Existing personal dictionary and `customWorlds` CRUD, storage keys, Firestore paths, listeners, HTML IDs/classes, and the single Firebase initialization.

Baseline values are XP economy v2 with transition rewards `2 / 4 / 8 / 3`, and SRS states `New / Learning / Reviewing / Mastered`.

## 3. Current word schema and serialization

The personal and custom-world runtime shape is:

```text
id, word, meaning, example, category, starred, forgetCount, xpValue,
mastery_status, mastery_streak, last_recalled_at, first_recalled_at,
last_recall_day, last_recall_session_id, last_quizzed_at, quiz_seen_count,
mastered_once, firstMasteredAt, hasEarnedMasteryXP, earnedTransitions,
remasteryAwardCount, xpEconomyVersion, order, createdAt
```

Firestore uses `text` for the word and `meaning` for its Arabic translation. `js/cloud.js` maps `text` back to runtime `word`. Ready-content documents may use the clearer administrative fields `word` and `translation`, but the learning adapter must map `translation` to runtime `meaning`.

Current personal-word writes use auto IDs. Custom-world word IDs are caller-provided stable IDs. Neither path currently stores `normalizedWord` or `contentSources`.

## 4. How a word currently enters SRS

There is no independent SRS queue collection. A word becomes schedulable only when it is returned by `getQuizSourceWords()`, normalized by `normalizeQuizWord()`, classified by current mastery, and passed to `buildBalancedQuizDeck()`.

Therefore ready-content enrollment must:

1. create a separate user-owned membership/source collection (`users/{uid}/contentWords/{wordKey}`), not insert into `users/{uid}/words` or `customWorlds`;
2. expose those enrolled words through a narrow `content` quiz source;
3. keep the existing deck builder, quotas, transitions, exposure penalty, and XP award path unchanged;
4. never write a default `New` state into the shared mastery document during enrollment, because that could overwrite a stronger state arriving from another device.

## 5. Unified word identity

- `normalizeWord()` lowercases, trims, and collapses spaces.
- `getWordMasteryKey()` further replaces non Latin/Arabic letters or digits with `_`, trims underscores, and limits the key to 180 characters.
- `getBestKnownMasteryState()` checks the account-wide shared mastery store and all personal/custom copies, choosing the strongest state.
- `propagateMasteryStateAcrossAccount()` updates the shared mastery store and existing copies.
- XP event IDs include the same word key, preventing a second transition reward for the same normalized word.

The ready-content membership document must use this same `wordKey` as its document ID and merge unique content sources; it must not create an independent mastery/XP history.

The current key algorithm can collide for distinct punctuation-heavy words (for example `C++` and `C#`) and can become empty for unsupported scripts. Ready content will store `normalizedWord`, `masteryKey`, and `normalizationVersion`, reject empty keys, and report or block a collision between different normalized words rather than silently merge them. This preserves the current algorithm without pretending the collision is safe.

## 6. Existing Firestore paths (must remain unchanged)

- `users/{uid}/words/{wordId}`
- `users/{uid}/customWorlds/{worldId}`
- `users/{uid}/customWorlds/{worldId}/words/{wordId}`
- `users/{uid}/meta/profile`
- `users/{uid}/meta/active_quiz_session`
- `users/{uid}/meta/word_mastery`
- `users/{uid}/meta/xp_event_{eventId}`
- `ai_global_cache/{normalizedId}`
- `suggestions/{suggestionId}`

No local `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`, `functions/`, or root `package.json` existed at inventory time. Production rules therefore cannot be inferred or claimed as deployed.

## 7. Security risks found

- There is no existing Admin role or `/admin` authorization model.
- Hiding an Admin entry would not protect Firestore; Custom Claims plus Rules and backend claim checks are required.
- Existing production Firestore Rules are not present locally, so their behavior cannot be verified from this workspace.
- Several legacy owner writes, including profile/XP-related data, are client-driven. The new `contentProgress` path must not be able to mutate those documents or carry XP/streak/lockedXP fields.
- Direct client-side recursive deletion, large import, trusted audit logging, count repair, and multi-device rank activation are unsafe; these belong in Admin SDK Cloud Functions.
- Admin SDK credentials or service-account JSON must never be shipped with the frontend.
- Dynamic ready-content UI must not interpolate stored data into `innerHTML`; it should use `textContent`, safe attributes, and URL validation.
- Auth/account changes can leave stale UI privileges unless Admin state is cleared before each token-claim refresh and keyed to the current UID.
- Legacy rendering contains stored-XSS risk where highlighted dictionary/game text and some AI suggestion data reach `innerHTML` or inline handlers. New content must never reuse those renderers; remediation of unrelated legacy rendering is outside this phase.
- The current XP transaction validates transition-shaped values in browser code, and profile sync writes client-derived profile state. Secure server authority for the legacy XP system is a remaining risk; ready-content operations must not call or mutate either path.
- `window._profileLoaded` is not visibly reset on every account transition, and logout clears local dictionary state before `signOut()` settles. These are pre-existing auth-state risks; the new Admin state must use its own UID-bound reset and must not inherit this flag.

The Firebase web API key already in `cloud.js` is a public client configuration value, not an Admin secret. It is not an authorization mechanism.

## 8. Full-rank activation risks

- Writing rank words into the personal dictionary would change dictionary counts, unlock/title behavior, and personal UI, and would mix ready content with user content.
- Duplicate rank starts, double-clicks, refresh, two devices, or a retry after partial failure can duplicate sources unless the backend uses a deterministic operation ID and idempotent document IDs.
- A single atomic client batch is unsuitable for arbitrary rank size. Firestore documents are limited to 1 MiB, API requests to 10 MiB, and a WriteBatch to 500 writes; implementation should keep headroom (for example 400 writes per chunk) or use server BulkWriter.
- The existing shared `meta/word_mastery` map is a single document and can approach the 1 MiB limit after roughly a few thousand populated mastery states. Enrollment must not add empty `New` entries.
- Verified quiz Resume stores the selected quiz session and its selected words. Starting a rank must not serialize the whole rank into a single active session.
- Counter documents can become contention points. They are caches and must be recalculable, not the sole source of truth.

## 9. Planned new paths and integration boundaries

- Content: `content_worlds/{worldId}/ranks/{rankId}/gates/{gateId}/words/{wordId}`.
- User progress: `users/{uid}/contentProgress/{worldId}/ranks/{rankId}/gates/{gateId}`.
- Enrolled learning sources: `users/{uid}/contentWords/{wordKey}` with idempotent source membership under `sources/{sourceId}`. A subcollection avoids an unbounded array while the parent holds only lightweight cached fields.
- Idempotent operations: `users/{uid}/contentOperations/{operationId}`.
- Audit: `admin_audit_logs/{logId}`.

Integration points are limited to:

- the existing Auth callback for account-safe Admin/content-state reset events;
- the existing router for additive `journeys` and `admin` views;
- `quiz.js` source selection/read/update boundary for the separate content source;
- shared `getWordMasteryKey()` and `propagateMasteryStateAcrossAccount()` for account-wide mastery;
- callable backend functions for rank activation and high-risk administration.

No final rank/gate unlock algorithm will be implemented. `unlockConfig.mode = "manual_placeholder"` and manual `locked / available / active / completed` progress states remain data, not inferred completion rules.

## 10. Repository/diff constraint

The directory is a Git worktree without a valid `HEAD`; all current project files are untracked. `git diff` cannot provide a before/after patch for them. `reports/content-system-baseline.json` records pre-change SHA-256 hashes, while the previous refactor baseline records legacy IDs/classes/paths. Verification must combine those baselines, `git diff --check`, syntax/tests, and explicit protected-source comparisons.
