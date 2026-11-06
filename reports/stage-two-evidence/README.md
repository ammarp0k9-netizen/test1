# LootLingua — completion of integrity fixes, 2026-11-06

## Delivered behavior

- Ordinary profile saves no longer upload cached XP, spendable balances or an independently merged streak/date tuple. Explicit operations run in Firestore transactions against the current account document, with durable operation receipts in the existing `meta/xp_event_profile_sync_v1_*` namespace. A retried operation, another tab replaying the outbox, or an acknowledgement lost after commit cannot grant the same credit again.
- Quiz activity and its learning day share a session identity; two devices cannot count the same completed session twice. Runner sends the earned delta and immutable run ID, not a cached wallet total. Guest imports have an immutable snapshot receipt, including compatibility with already committed legacy migrations.
- All current profile writers, including single/batch XP claims and appearance changes, share a monotonic revision. An older acknowledgement cannot overwrite a newer observed profile. Appearance writes contain only appearance fields and internal revision/timestamp metadata; verification tolerates unrelated concurrent progress updates.
- Chest XP grant, event receipt and lock resolution commit atomically. A legacy duplicate repairs only its own matching lock. Signed-in chest opening waits for a confirmed transaction, and delayed animations/results cannot grant or celebrate under a different account.
- A Freeze covers one absent calendar day. If the balance covers the entire gap, that many Freezes are spent and today's verified learning adds one to the existing streak. Missing days do not increase the streak. Insufficient balance starts a new streak without wasting partial protection. The day calculation is safe across months, years and DST. `freezeSaves` counts protected days consistently for guests and accounts. Chest-opening streak remains separate.
- The header displays the Freeze balance or “بدون فريز”, with a small circular help control. Its explanation gives the two-day example and insufficient-balance behavior. Confirmed grant/spend and canonical hydration update the display.
- Profile/statistics dialogs receive focus, isolate background controls, wrap keyboard navigation and restore focus. Nested auth/custom dialogs suspend the underlying trap. Route changes cancel deferred statistics opening and release isolation; rapid reopening cancels the old hide timer.
- Failed Firebase modules or prolonged startup expose retry without inventing guest authentication. Local guest continuation requires explicitly resolved guest identity and hydrated guest data, and still passes through Product Entry. Only the independent Oasis decoration is deferred until startup completion/idle.
- Dictionary search never silently downgrades a signed-in request to an anonymous trial when token retrieval fails. Token, cache and response continuations are guarded across account changes.

## Validation

- `npm run test:stage-two`: **126/126 pass**.
- `npm run test:entry:integration`: **58/58 pass** after updating the transaction fixture while preserving its newer-XP/wallet/appearance assertions.
- Separate `dictionary7`: syntax checks and **19/19 tests pass**, using temporary storage, loopback HTTP and mocked token/model services.
- [Modal browser evidence](modal-focus.json): **8 real Chrome interaction scenarios**, including same-account route cancellation and account switching, with no runtime exceptions.
- [Freeze browser evidence](streak-freeze-browser.json): **45 header layout cases**, **5 help-dialog theme cases**, keyboard/focus and balance/hydration interactions, with no runtime exceptions. Screenshots: [320 px header](streak-freeze-320.png), [help dialog](streak-freeze-help-320.png).
- Startup browser evidence is retained in `reports/integrity-evidence/startup-browser.json` and `startup-recovery-browser.json`: confirmed guest, failed module/account dependency, retained startup gate and retry. No live Firebase writes were used.
- [Test triage](test-triage.md): **18 of the 24 prior failures addressed**. Six assertions for absent historical rules validators remain failing and are explicitly documented. Their assertions were retained; no claim of equivalent server enforcement was made.

The user requested avoiding unnecessary repeated testing. Final verification used the focused affected suites above; the complete repository suite was not rerun merely to repeat unchanged historical rules failures.

## Boundaries

- The current simplified Firestore rules are the user's intended deployed rules. This change does not replace or deploy rules, enable billing, or deploy Cloud Functions.
- The measured throttled startup samples do **not** prove a general speed improvement: 13.55 s before and 15.46 s after in the recorded single samples. The confirmed change is recovery and postponement of optional decoration, not a claimed reduction in startup time.
- Refresh existing tabs/devices to use the new profile protocol. This client release cannot prevent an older already-open client from continuing its former full-profile writes.
- `dictionary7` is a separate repository. Its merge conflict was resolved and its authentication and atomic serialized JSON persistence were tested. Runtime deployment installs its declared dependencies, including Firebase Admin; no local dependency installation was performed. File persistence assumes one Node process per data directory and persistent storage. Distributed locking and crash-refund ledgers are not claimed; see `dictionary7/README.md`.
- No test feedback, dictionary words, accounts or reward data were written to production.
