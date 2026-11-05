# Personal dictionary pagination and bidirectional rendering

The online personal dictionary opens with 80 unique word records. The first bounded Firestore listener supplies that same first page; there is no second initial download and no unbounded personal-dictionary listener. Later source reads use `limit(80)` and a document-snapshot cursor. Counts use aggregate queries instead of downloading word documents.

Default ordering follows the stored `order` field. A second cursor phase, ordered by document ID, includes legacy records that have no `order` field. This preserves those records without a migration, schema change, new index deployment, Function, or billing change. The legacy phase may scan indexed records again to find missing-field records; requests remain bounded.

While browsing, another page is requested within 1800 pixels of the loaded list's end. Concurrent requests join the same read. A failed read preserves loaded words and offers retry from its original cursor. A late response cannot publish into a different account. A cleared search or abandoned navigation releases its full-source request; an in-flight page can finish, but the scan stops unless another operation still needs it.

Only visible cards plus overscan are mounted, both while scrolling down and returning up. Cards use measured variable heights and keep their DOM nodes while they overlap successive windows. Manual reorder mode also uses this window. During dragging, at most one extra offscreen source card stays attached until drop/dragend, so crossing a virtual window does not destroy the drag source.

Realtime subscriptions cover the 80-record head and up to two nearby cached 80-record buckets. Visible subscriptions are debounced and split into document-ID queries of at most 30 IDs; they are released when the view changes or the account changes. Queries use existing single-field indexes. Other unobserved cached pages are not a subscription to the entire collection.

## Full-dataset operations and cache limits

Pagination is not a permanent cap of 80 data objects in memory. Visited records remain cached during the session for immediate upward scrolling. Reaching the end of a 2000-word dictionary eventually caches those 2000 plain data records; it still mounts only the visible cards. No complete source scan runs just because the list is idle at the top.

Substring search across word/meaning/example, global sorting/filtering, duplicate-sensitive addition/import, export, full statistics, private-world transfers and full quiz preparation explicitly await the complete dataset through the same 80-record pages. They never treat the first page as the whole dictionary. All quiz entry paths prepare personal copies before starting, because shared mastery updates must find copies outside the initially loaded page. Journey's legacy index reads are likewise paginated, preserving raw legacy metadata.

Word-derived smart reminders are deferred while the dataset is incomplete; existing reminders are preserved rather than resolved from incomplete evidence. Review actions prepare the full dataset before choosing their words. Previously earned titles remain stored; new mastery-title checks use known canonical mastery instead of trusting potentially stale raw aggregate mastery fields.

Partial pages stay in the session cache and do not repeatedly serialize the complete dictionary to localStorage. Once a complete snapshot exists, its offline backup is debounced. An existing complete offline backup can be displayed with an explicit offline label after connection timeout; a partial offline response cannot silently become a complete quiz/export source. Guest and custom-world storage retain their existing paths.

## Evidence and reproduction

`after.json` records local headless Chrome tests with 2000 synthetic words and 120 ms simulated page latency. External traffic is blocked; Firebase modules are removed and the real paging/rendering code receives an in-memory adapter. No production account or database is used.

| Check | Result |
| --- | --- |
| Initial unique records / source requests while idle | 80 / 1 |
| Correct aggregate total before all records load | 2000 |
| Largest page request | 80 records |
| Card nodes after returning to the top | 21; distant bottom cards removed |
| Maximum card nodes in the 27 viewport/scroll snapshots | 34 |
| Reorder-mode card nodes at the top | 21 |
| Drag across a virtual window | Source retained, correct move, source released |
| Clear search during its scan | At most the in-flight 80-record page finishes |
| Navigate away during explicit quiz preparation | Quiz does not start; scan stops after its in-flight page |
| Request failure / retry | Loaded words retained; retry succeeds |
| Browser runtime exceptions | 0 |

The browser checks also cover expansion without a scroll jump, DOM-node reuse, searching for word 1999, updating an existing card, preserving expansion through a snapshot and feedback-form behavior. They verify absence of blank card windows at 1280/390/320 widths in the recorded snapshots. This is not a guarantee about every device, scroll speed or real network latency; if a connection cannot deliver the next page in time, the list displays a loading state at the loaded boundary.

```powershell
node --test tests/dictionary-pages.test.mjs tests/dictionary-render-feedback.test.mjs tests/dictionary-render-static.test.mjs tests/quiz-learning-regression.test.mjs tests/quiz-core.test.mjs tests/quiz-finish-transaction.test.mjs tests/smart-notification-system.test.mjs tests/performance-regression.test.mjs
node tools/dictionary-render-browser-smoke.mjs --paged
```

The focused suite has 87 passing tests. The wider comparison is saved in `test-comparison.json`; pre-existing failures are reported separately. The Level Placement fixture was extended to model Firestore cursors and query limits, retaining its existing behavioral assertions. No dependencies, production rules, billing settings, or user data were changed during these checks.

Implementation follows Firebase's [cursor pagination](https://firebase.google.com/docs/firestore/query-data/query-cursors) and [query constraints](https://firebase.google.com/docs/firestore/query-data/queries).
