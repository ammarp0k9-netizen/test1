# Firebase setup required for the ready-content system

Nothing in this repository assigns Admin privilege from the browser. The source of truth is the Firebase Authentication Custom Claim `admin: true`.

## Assign the first Admin

1. Use Node.js 22 or newer and authenticate Application Default Credentials for the Firebase project `quizapp-ede17` (for example with a trusted local Google Cloud/Firebase CLI session). Do not copy a service-account JSON file into this repository or the frontend.
2. From `functions/`, run `npm install`.
3. Find the target user's Firebase Authentication UID in the Firebase console.
4. Run `npm run set-admin -- <firebase-uid> grant`.
5. Have that user sign out and back in, or force-refresh their ID token.

To revoke the role, run `npm run set-admin -- <firebase-uid> revoke`.

The script preserves unrelated Custom Claims. It accepts a UID, not a hard-coded email, and uses the Admin SDK only in the backend directory.

## Deployment gate

The presence of local Rules or Functions does not mean they are deployed. Before production use:

- select the intended Firebase project explicitly;
- test Rules with the Emulator Suite;
- deploy Firestore Rules and indexes;
- deploy callable Functions only after their local tests and the remaining backend stages pass;
- run the documented anonymous/user/Admin security matrix against the emulator and then a non-production Firebase project.

## Trusted archived-world deletion

`deleteContentWorld` is a Firebase Functions v2 callable. It accepts only an authenticated token whose Custom Claim is exactly `admin: true`, then requires an archived world, an exact title confirmation, and (when supplied by the Admin UI) a matching positive `expectedVersion` before deleting the world and all nested ranks, gates, and words with the Admin SDK. A compact, backend-written record is added to `admin_audit_logs` only after recursive deletion completes.

The callable writes a short-lived internal lock in a Firestore transaction before it starts. This blocks ordinary browser updates to the world document and serializes concurrent calls. Firestore recursive deletion is not a database-wide transaction, however: a deliberately privileged writer could still race a descendant write, and a process failure can leave a partially deleted hierarchy. The lock expires after 15 minutes (longer than the function timeout), and an ordinary recursive-delete error triggers a best-effort lock release. Production operators should therefore alert on callable failures and inspect the archived hierarchy before retrying; the function does not claim atomic deletion.
