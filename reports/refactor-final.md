# LootLingua limited refactor — final report

## Outcome

The runtime source was split conservatively without renaming APIs, changing source expressions, changing CSS, or introducing a framework/bundler. Each extraction used byte-preserving slices and retained the original classic-script order. Firebase modules remain modules in their original positions and order.

## Runtime files and responsibilities

- `script.js`: shared application state, UI preferences, feature locks, routing, onboarding, profile persistence/migration bridges, and pre-XP bootstrap code.
- `js/core.js`: smart loading overlay and the initial core/UI shell (performance, notifications, profile and daily-quest shell).
- `js/core-runtime.js`: keyboard shortcuts, `window.onload`, sidebar wrappers/tooltips, mobile hamburger behavior, and final runtime initialization that originally appeared at the end.
- `js/storage.js`: local storage keys/scopes, guest/user word caches, custom-world caches, pending-world retry state, and cloud snapshot adapters.
- `js/cloud.js`: Firebase initialization, Auth, Firestore listeners and personal/world/mastery/quiz/AI/suggestion cloud operations.
- `js/profile-cloud.js`: debounced profile save/load and the existing profile Auth listener.
- `js/xp.js`: XP economy v2, dedup/pending events, ranks/themes, streak, daily goal, stats and XP UI.
- `js/dictionary.js`: personal dictionary actions, selection/reorder, AI search, OCR word hunter, import/export.
- `js/dictionary-render.js`: personal dictionary highlighting and virtualized rendering/windowing.
- `js/worlds.js`: treasure/titles, built-in game dictionaries, worlds/custom-world CRUD, copy/move/manage, and world/view routing.
- `js/srs.js`: mastery state/storage, exposure history, due/backlog/quota logic, balanced deck helpers, and the shared quiz state that precedes them in the original source.
- `js/srs-transitions.js`: `computeSrsUpdate` and transition-to-XP handoff. It stays between two quiz segments to preserve original source order.
- `js/quiz.js`: quiz setup, source/count configuration, session serialization/resume/exit, candidate scoring and deck construction, and the answer flow preceding SRS transition calculation.
- `js/quiz-runtime.js`: verified result commit, Flashcards completion flow, Time Attack and Scramble runtime.

Verification-only files:

- `tools/refactor-audit.mjs`: baseline/contract capture and comparison.
- `tools/browser-smoke.mjs`: local Chrome/CDP smoke and behavior probes.
- `tools/static-server.mjs`: local no-cache test server.
- `tools/refactor-split.mjs`: guarded mechanical split steps with recombination assertions.
- `reports/refactor-baseline.json`: immutable pre-refactor contracts and measurements.
- `reports/refactor-inventory.md`: system/dependency inventory.
- `reports/refactor-stages.md`: stage gates and results.

## Final load order

1. Early inline route bootstrap in `<head>` (unchanged because it must run before paint).
2. Google Analytics async + its inline bootstrap (unchanged).
3. `js/cloud.js` (`type="module"`).
4. `js/profile-cloud.js` (`type="module"`).
5. Tesseract external classic script.
6. `js/core.js`.
7. `js/storage.js`.
8. `script.js`.
9. `js/xp.js`.
10. `js/dictionary.js`.
11. `js/worlds.js`.
12. `js/dictionary-render.js`.
13. `js/srs.js`.
14. `js/quiz.js`.
15. `js/srs-transitions.js`.
16. `js/quiz-runtime.js`.
17. `js/core-runtime.js`.

Although the module tags appear before the classic application tags, browser module execution remains deferred. This preserves the original behavior where all classic application bridges are installed before Firebase Auth callbacks run.

## Dependency map

- `core.js` → storage/shared state at event time; it does not own duplicate state.
- `storage.js` → `window.auth` for user scope; dictionary/world shared state for snapshot application; cloud retry APIs at event time.
- `script.js` → core/storage and later XP APIs at event time; owns the single shared lexical state.
- `cloud.js` ↔ classic runtime through the existing `window.*` compatibility bridge. No ES import cycle was introduced.
- `xp.js` → storage, cloud XP claim/profile save, and core UI.
- `dictionary.js` → storage/cloud/XP/profile/quest helpers.
- `worlds.js` → dictionary storage/cloud plus shared `customWorlds`/`activeCustomWorldId`.
- `dictionary-render.js` → dictionary state/actions and shared mastery helpers.
- `srs.js` → storage, dictionary/world sources, XP constants; it does not import quiz.
- `quiz.js` → dictionary/world sources and SRS queue helpers.
- `srs-transitions.js` → SRS mastery helpers and XP API; it returns transition results to quiz.
- `quiz-runtime.js` → quiz state, SRS transition API and XP award flow.
- `core-runtime.js` → all previous systems for final initialization only.

Potential cycles were kept as runtime bridges instead of imports: cloud/classic, profile/XP payload, and dictionary/world shared scope. No duplicate `window.words`, `customWorlds`, `activeCustomWorldId`, `userXP`, `quizSession`, `auth`, or `db` was created.

## Globals retained for compatibility

The pre-refactor `window.*` export contract remained 178 names before and after. The complete exact list is in `refactor-baseline.json > globals.windowExports`.

The 83 callable globals required directly by inline HTML handlers remained available because the UI still calls them by name:

`addWord`, `cancelLootChestCharge`, `cancelQuizExitPrompt`, `clearAllNotifications`, `closeCustomWorldModal`, `closeDailyQuestsSheet`, `closeProfileModal`, `closeStatsPanel`, `closeWordHunterModal`, `confirmBulkDeleteSelection`, `confirmDeleteCustomWorld`, `confirmGuestMigration`, `confirmLogout`, `confirmQuizExitWithoutLoss`, `confirmQuizForfeit`, `declineGuestMigration`, `dismissWelcomeModal`, `enterSelectionMode`, `exitBulkDeleteMode`, `exitSelectionMode`, `exportData`, `fetchSuggestions`, `flipCard`, `forfeitActiveQuizSession`, `goBackFromSubView`, `handleOnboardingReplayClick`, `hideModal`, `importData`, `loadGameDictionary`, `loadPersonalDictionary`, `loadQuizView`, `loadStarredView`, `loadTreasureView`, `loadWorldsView`, `login`, `markForgot`, `markRemember`, `moveLootChestCharge`, `moveSelectedWordsByStep`, `onDockFeatureClick`, `onSidebarFeatureClick`, `onWorldCardClick`, `openDailyLootBox`, `openGameGamerAiSearch`, `openQuizModeSettings`, `openStatsPanel`, `openWordHunterModal`, `openWorldManageModal`, `playQuizSound`, `releaseLootChestCharge`, `render`, `renderStarredWords`, `requestQuizExit`, `resumeActiveQuizSession`, `saveCustomWorldFromModal`, `searchGameWords`, `setDictionarySortMode`, `setQuizQuestionCount`, `setQuizSourceScope`, `setScrambleDirection`, `setTheme`, `setTimeAttackDirection`, `setWorldManageAction`, `showBackupHelp`, `showHint`, `showKeyboardShortcutsModal`, `showModal`, `showPerformanceModeHelp`, `showQuizModes`, `startActualQuiz`, `startConfiguredQuiz`, `startLootChestCharge`, `startVoiceSearch`, `submitScrambleAnswer`, `toggleAddFormExpanded`, `toggleDailyQuestsSheet`, `toggleDictionarySortMenu`, `toggleNotificationsPanel`, `toggleProfileModal`, `toggleReorderMode`, `toggleSidebar`, `toggleSortCategorySubmenu`, `toggleXpRanksGuide`.

Cloud/profile bridges remain on `window` because classic scripts and modules call each other at runtime: `auth`, `db`, login/logout, personal/custom-world save/update/delete, mastery save, XP claim, active quiz session save/load/clear, AI cache, suggestions, and profile save/load.

## JavaScript moved out of index.html

Main cloud module:

- Firebase imports/config/initialization and its Auth callback.
- `isIOSDevice`, `setLoginLoading`, `handleLoginRedirectResult`.
- `loadWordsFromCloud`, `mapWordDoc`, `loadCustomWorldsFromCloud`, `loadGlobalWordMasteryFromCloud`.
- login/logout and all personal/custom-world word cloud operations.
- mastery, XP event, active quiz session, AI cache and suggestion operations.
- `normalizeAiCacheDocId`, `readCacheEntry`.

Profile cloud module:

- `performProfileSave`.
- `saveProfileToCloud`, `_saveProfileToCloudNow`, `loadProfileFromCloud`.
- The existing profile `onAuthStateChanged` callback.

JavaScript intentionally left inline:

- 19-line/851-byte early route normalization bootstrap, because it must run before rendering.
- 6-line/162-byte Google Analytics bootstrap, because it belongs to the external async analytics snippet.

## Contract confirmations

- IDs and Classes: unchanged by automated exact-set comparison.
- `style.css`: unchanged; SHA-256 stayed `a322fc472b264d4d24618bad186601d0862f0eb2278fa5f2275af58d99ea075a`.
- localStorage/sessionStorage key constants and call contracts: unchanged.
- Firestore `collection()`/`doc()` paths: unchanged.
- Firebase config: moved byte-for-byte; one `initializeApp` call remains.
- Auth listeners: two remain (main data listener + profile listener), matching baseline.
- No local runtime script is loaded twice.
- Inline handlers: 149 before/after; required handler globals: 83 before/after; missing: 0.
- SRS statuses/quotas/source expressions and XP reward block: unchanged.

## Tests actually executed

- `node --check` on every classic and module runtime JavaScript file.
- `node --check` on all verification tools.
- `git diff --check`.
- Baseline contract verification after every stage.
- Duplicate local script-source check: none.
- Static Firebase initialization/listener count check: 1 init, 2 intentional Auth listeners.
- Chrome headless smoke after every stage:
  - document reached `readyState=complete`;
  - main content present;
  - Smart Loading Overlay dismissed;
  - Firebase `window.auth`/`window.db` ready;
  - sampled cloud bridges present;
  - no runtime exceptions;
  - no missing HTML handler globals;
  - Worlds → Minecraft → Back → Personal navigation passed;
  - all four currently available themes applied in a temporary browser profile;
  - balanced decks of 5 and 10 returned the requested sizes;
  - Flashcards rendered and did not change XP;
  - Time Attack and Scramble rendered;
  - serialize/apply Resume retained the exact deck order;
  - SRS probe produced New → Learning → Reviewing → Mastered;
  - XP values remained 2/4/8/3.

## Acceptance items not executed end-to-end

These require credentials, real external state, a second device, file-picker/download interaction, or destructive data mutation. They were not claimed as passed:

- Real Google login/logout and the full guest-migration decision flow.
- Real Firestore writes/transactions, offline pending retry, refresh dedup against production data, and second-device sync.
- Live personal dictionary add/edit/delete/star/reorder/bulk/import/export workflows.
- Live custom-world create/edit/delete/copy/move/bulk and cloud refresh workflows.
- Full verified quiz completion/forfeit/penalty against a real account, world-source quiz, difficult-word quiz, and production Resume document.
- Chest `lockedXP`, opening/rewards, titles, quests, streak/freeze and their cloud refresh behavior.
- OCR/camera/file picker, speech recognition/audio and actual download behavior.
- A performance benchmark; the audit only proved no duplicate scripts/listeners were introduced by loading.

## Existing issues observed and intentionally not fixed

- Browser log contains one pre-existing 404 resource request (likely a missing site icon/resource). It is unrelated to the split.
- Existing duplicate declarations/assignments such as `renderProfileTitlePicker` and the later `window.deleteWord` replacement were retained; merging them could change behavior.

## Before/after measurements

- `script.js`: 483,234 bytes / 11,911 lines → 110,366 bytes / 2,722 lines (77.2% smaller by bytes).
- JavaScript inline in `index.html`: 39,435 bytes / 892 lines / 4 blocks → 1,013 bytes / 25 lines / 2 blocks (97.4% smaller by bytes).
- `index.html`: 103,591 bytes → 65,646 bytes.
- Local runtime JavaScript files: 1 external project file plus 2 inline Firebase modules → 14 external project files (13 new files plus `script.js`).
- Explicit `window.*` export names: 178 → 178.
- HTML-required callable globals: 83 → 83.

## Explicit non-change statement

- No feature was added or removed.
- No design/CSS selector/ID/Class was changed.
- SRS logic and constants were not changed.
- XP logic, rewards, event IDs and dedup behavior were not changed.
- Firebase config, paths, schema, listeners and cloud operation bodies were not changed.
- Storage keys and user-data structures were not changed.
- Guest and signed-in code paths were not intentionally changed.
- No framework, bundler, library, minification or deployment change was introduced.
