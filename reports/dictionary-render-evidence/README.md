# Feedback and personal dictionary verification — 2026-11-05

Feedback now writes a small, validated document directly to the existing Firestore database. It does not call Cloud Functions or require enabling billing. Firestore free-tier quotas still apply. The deployed rule permits creation only, binds signed-in submissions to their Firebase UID, checks the server timestamp and field sizes, and retains admin-only reads. Anonymous submissions are supported; this is not server-side spam/rate limiting.

The feedback-only rules release was compiled, published with user approval, and read back to verify its SHA-256. See `../feedback-rules-review/review.json`. Every other deployed rule was preserved. No production feedback document was created during testing.

The dictionary uses measured variable card heights, keyed DOM reuse and a bounded visible window with overscan. It no longer replaces every rendered card or pins scrolling while changing windows. Expanded details are created on demand. A synchronous mastery snapshot avoids repeatedly parsing the same storage across a render/selection pass. Mobile card text and actions no longer compete for the same narrow row.

## Browser evidence

`before.json` and `after.json` were collected in local headless Chrome with 2,000 synthetic words at viewport widths 1280, 390 and 320. External network traffic was blocked, Firebase modules removed, and feedback exercised through an in-memory adapter. Screenshots therefore omit externally loaded icon fonts; they are layout evidence, not full production appearance.

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial dictionary render, one recorded sample | 272.8 ms | 29.9 ms |
| JSON parses during initial render | 104 | 1 |
| Initial card nodes | 48 | 22 |
| Scroll snapshots with visible cards | 18/27 | 27/27 |

These are local samples, not universal performance guarantees. The after-run also verifies zero horizontal overflow in those snapshots, retained overlapping card nodes, expansion without replacing its node or jumping the scroll position, searching for the last word, updating an existing card while retaining its neighbor, and preserving expansion through a cloud snapshot. Feedback tests verify one write despite double submission, success only after acknowledgement, recoverable permission errors, and cleanup of dialog keyboard listeners.

## Reproduce without production writes

```powershell
node --test tests/dictionary-render-feedback.test.mjs tests/dictionary-render-static.test.mjs tests/quiz-learning-regression.test.mjs tests/quiz-core.test.mjs tests/quiz-finish-transaction.test.mjs tests/smart-notification-system.test.mjs tests/performance-regression.test.mjs
node tools/dictionary-render-browser-smoke.mjs --baseline --baseline-ref=b27ecf5a
node tools/dictionary-render-browser-smoke.mjs
```

The browser harness requires an existing Chrome/Edge installation and the installed dependencies. It writes evidence files locally and creates a disposable browser profile in the OS temporary directory. It never uses the normal browser profile or production database.

Validation: 70 focused tests passed. The wider safe suite reported 591 passed and 24 failed out of 615; the 24 failure names matched the pre-change baseline. No packages were installed. Firestore's remote rule compiler passed; emulator authorization tests could not run because the emulator JAR was unavailable. Feedback transport was tested locally, without submitting synthetic data to production.
