# Learning milestone rewards

- First lifetime mastery of 10 / 25 / 50 / 100 distinct SRS keys earns an
  additional 20 / 35 / 60 / 100 XP. It does not replace normal word XP.
- Every three distinct, saved Gate Clears within a world earn 25 XP. Placement
  skips and failed attempts are excluded. Existing clears are reconciled when
  their rank/gate is opened; previous qualifying mastery is reconciled on load.
- The controller shows one contextual next goal in the dictionary and journey,
  and history in the treasure view. It avoids unreachable station targets for
  short/completed worlds and respects a gate's future review time.
- Title unlocks and milestone rewards share a queued celebration, delayed until
  the quiz ends. The existing focus manager and scroll lock handle the dialog.
  Confirmed rewards also become persistent, deterministic achievement records
  in the existing notification store, with a history action. They use its
  durable notice channel rather than adding competing reminder/toast rules.

Account rewards are calculated from saved mastery and Gate Clear documents in
an owner-scoped Firestore transaction. XP, the profile reward projection, and
immutable `xp_event_motivation_*` receipts are committed together. Profile
revision checks prevent older responses from replacing newer data. This uses
the existing profile/meta permissions: no Functions, rules deploy, indexes,
packages, or billing changes. Application validation follows the existing
client-owned learning model; this is not a new server anti-cheat service.

Lifetime mastery keys are retained only through the last configured target
(100), avoiding an unbounded extra dictionary copy in the profile. No complete
personal dictionary is loaded by this feature, and mastery reads stop after
all those targets are tracked. Gate reconciliation is bounded to 12 per batch.
Guest progress stays local (Web Locks serialize supported same-browser tabs);
guest reward history is included in the existing receipted account migration
so imported milestones do not pay a second time.

Verification:

- `npm run test:motivation`: milestone policy/transactions, two clients,
  duplicate receipts, failed writes/retries, placement exclusion, guest
  migration, and existing profile/notification regressions.
- `npm run test:motivation:browser`: actual controller, policy, notification
  store and focus manager in Chrome with an isolated in-memory cloud adapter.
  Covers combined celebrations after a quiz, focus/keyboard, history, offline
  retry, account switching, four themes, and 320/390px phones. Text contrast
  and overflow are checked. Screenshots and JSON are in this directory.

No test wrote production user data. Production Firestore writes were not used
as tests; browser cloud behavior is covered by the separate transaction tests.
