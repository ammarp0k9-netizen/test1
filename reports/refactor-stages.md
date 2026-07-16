# LootLingua refactor stage log

This log records the gate result after each conservative extraction stage.

## Stage A — inventory and baseline

- Status: passed.
- Scope: read-only inventory plus the local `tools/refactor-audit.mjs` verification utility.
- No application runtime code changed in this stage.
- Static parse: `node --check script.js` passed.
- Contract snapshot: 149 inline handlers, 83 required handler globals, 0 missing.
- Baseline sizes: `script.js` 483,234 bytes; inline JavaScript 39,435 bytes; `index.html` 103,591 bytes.
- Browser smoke: page reached `readyState=complete`, main content present, smart-loading overlay dismissed, no runtime exceptions, no missing handler globals.
- Browser log: one unrelated 404 resource entry (likely a missing favicon); retained and not changed because it is outside refactor scope.

## Stage B — core and local storage extraction

- Status: passed.
- `js/core.js`: 51,609 bytes; loading overlay and the first core/UI shell segment.
- `js/storage.js`: 16,743 bytes; storage keys, guest/user word caches, custom-world caches/pending sync, and cloud snapshot bridges.
- `script.js`: reduced from 483,234 to 414,882 bytes.
- Mechanical recombination check: exact match with the original 483,234-byte source.
- Static parse: all three runtime classic files passed `node --check`.
- Contract verification: handlers, globals, IDs/classes, storage, Firestore, quiz/SRS/XP, and CSS hash unchanged.
- Browser smoke: complete, overlay dismissed, 0 exceptions, 0 missing inline-handler globals.

## Stage C — Firebase/cloud extraction

- Status: passed.
- `js/cloud.js`: exact 34,331-byte extraction of the main Firebase/Auth/Firestore module.
- `js/profile-cloud.js`: exact 4,091-byte extraction of the profile sync module.
- Both module tags remain in their original document positions and order.
- `index.html`: reduced to 65,286 bytes; only the early route bootstrap and analytics bootstrap remain inline.
- Static parse: both modules and all classic runtime files passed `node --check`.
- Contract verification: Firestore path calls, storage keys, globals, inline handlers, IDs/classes, XP/SRS/quiz invariants unchanged.
- Browser smoke: `window.auth` and `window.db` ready, all sampled cloud APIs present, overlay dismissed, 0 exceptions, 0 missing inline-handler globals.
- Listener audit: one main Auth listener plus one profile Auth listener remain, matching the pre-refactor design; Firebase `initializeApp` remains a single call.
- Audit-tool correction: DOM classes/IDs now exclude JavaScript source text inside `<script>`; only that markup-contract slice was refreshed.

## Stage D — XP and SRS extraction

- Status: passed.
- `js/xp.js`: 23,194 bytes; XP economy, dedup/pending events, ranks, streak, daily goal, and XP UI.
- `js/srs.js`: 16,975 bytes; mastery state, shared mastery storage, exposure history, due/backlog/quota/deck helpers, plus the existing shared quiz state declared before them.
- `js/srs-transitions.js`: 4,689 bytes; exact later source segment containing `computeSrsUpdate` and transition XP handoff.
- Two temporary quiz/application segments preserve the exact original source order around SRS; they are scheduled for stages E/F.
- `script.js`: reduced to 110,366 bytes.
- Mechanical recombination checks: exact for both splits.
- Static parse and full contract verification: passed.
- Browser smoke: 0 exceptions, Firebase ready, 0 missing handlers/cloud APIs.
- Runtime invariant probe: XP rewards remained `2/4/8/3`; three separated successful recalls produced `Learning`, `Reviewing`, `Mastered` and the original transition IDs.

## Stage E — dictionary and worlds extraction

- Status: passed.
- `js/dictionary.js`: 83,299 bytes; personal-word actions, AI/OCR, selection/reorder, and import/export.
- `js/worlds.js`: 84,558 bytes; loot/titles, game dictionaries, worlds/custom worlds, move/copy/manage, and view routing in their original source order.
- `js/dictionary-render.js`: 20,316 bytes; highlight and virtualized personal dictionary rendering.
- Shared state (`window.words`, `customWorlds`, `activeCustomWorldId`) remains declared once in `script.js`.
- Mechanical recombination, static parse, and full contract verification: passed.
- Browser smoke: Worlds and Personal views both navigated successfully, 0 exceptions, 0 missing handlers/cloud APIs; XP/SRS probe still passed.

## Stage F — quiz extraction and final verification

- Status: passed.
- `js/quiz.js`: 43,488 bytes; setup/session/deck and pre-transition quiz flow.
- `js/srs-transitions.js`: intentionally remains between quiz segments to preserve original source order.
- `js/quiz-runtime.js`: 13,467 bytes; verified commit and mode runtimes.
- `js/core-runtime.js`: 14,530-byte final initialization tail retained at the end.
- Temporary stage files removed; no duplicate local script sources.
- Static parse, `git diff --check`, and full baseline contract: passed.
- Browser acceptance probes: startup/overlay/Firebase/globals, views/back routing, available themes, 5/10 decks, Flashcards without XP, Time Attack, Scramble, Resume deck stability, SRS transitions and XP values all passed with 0 runtime exceptions.
- One unrelated pre-existing 404 resource log remains; no application exception resulted.
