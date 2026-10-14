# Customer Accounts W1 integration — 14 October 2026

Integration owner: Codex. Released builder: Claude `claude/accounts-w1` at `14058cc`; released design `a8f9760`. Base RC `b99cbe1`. Integration branch `codex/handover-customer-accounts`.

## Behavior and scope

Accounts gives staff a coverage list, with Mine/All, search, 50-row pages, visit priority and one primary Log visit action. Owner and location editing are secondary inline forms. Administrator/Management create territories and assign an active eligible owner; Sales/Operations can record visits and locations, with actor provenance. D-16/D-17 are the recorded reversible recommended defaults used for this slice, not an invented explicit owner decision. D-18 territory names remain open; Management creates them.

All data refers to existing canonical customers. Assignment history closes once; visits and location events are immutable. Parent customer row locks serialize first owner/location writes, expected versions reject concurrent stale edits, and stored command receipts make retries idempotent. Reads use private no-store APIs and bounded pages. Existing Orders refresh and scoped caches are preserved.

Excluded: contacts/prospects, maps, receivables, wallet/Market, register migrations, connector changes and production cutover. This customer workspace does not satisfy the separately deferred real financial Accounts-role acceptance session. The parked Market customer-location migration is superseded and must not be applied alongside this one.

## Integration corrections

- Added a real two-session public-gateway SQL check: concurrent first assignment and first location each produce one winner, PT409 for the stale writer, one receipt/history event, and identical cross-session replay.
- Reproduced a visit duplication risk in a browser: a 502 after an uncertain save discarded the command key. The fixed form keeps its key for 5xx, 408, 429 and transport failures while the same payload is retried. Desktop/phone regression passes; definite conflicts refresh the list.
- Included Accounts in the existing lint command. Fixed actual compiler/accessibility/type diagnostics, without disabling rules: abortable scheduled load, semantic status output, function callback types and SubmitEvent.
- The visible due count now says "on this page", because it is derived from the current 50 rows.
- Windows replay startup now waits for pg_ctl itself, with a 30-second bound and a hidden process, rather than inherited native pipes or the detached server's process tree. Linux replay is unchanged. Initial environment stalls and initial lint/retry failures remain in evidence.
- New Edge routing unit executes the actual handler with real body/key/admission helpers and substituted remote transport. All five Accounts actions reach its gateway; unauthorized keys, role denial, stale-command cooldown and existing summary routing are checked.

## Fresh local evidence

Frozen candidate: `work/accounts-release-20261014/` (ignored).

- Full UTC disposable deployment-order SQL replay passed, including new Accounts correctness/concurrency checks, existing summary parity, money/ACID/access and economic/member/product concurrency suites. No hosted fixtures.
- Initial full unit run: 1,179 tests / 133 files passed. Final affected units: 89 / 4 files; additional executed Edge routing: 8 / 1 file.
- Accounts browser: 23 passed / one intentional desktop skip of the phone-only layout check. Includes the new unknown-save retry regression. Combined-role navigation: six passed.
- Final typecheck and lint passed. Offline/staff builds and exact-head CI pending at this record's initial creation.

Migration `20261014090000_customer_accounts.sql` normalized SHA-256: `c1485c0492393e5f519d998411c8f25475b6a46137f51d76fc624f3deb61a72a`. Production evidence records it as not deployed; pending count 21, existing deployed history unchanged. Acceptance migration, Edge and Worker promotion require exact source/artifact guard and independent readback.

## Coordination and next step

Both shared logs reread before integration. Claude's newly released `claude/order-clarity` `f2dcc7a` is a separate following slice; its additional Orders/Requirements/frame edits are excluded here. Preserve all existing dirty documents, previews, AGENTS and standalone dashboard work.

Next: complete builds and exact-head CI; normal PR integration; acceptance-only migration then compatible Edge update and Worker promotion. Record prior Edge v11 files/settings and Worker `e053201a-5dd5-4e09-8558-f7c7e73a53fa` for rollback. Verify real existing-session reads and phone layout without creating hosted visits/assignments. Production, financial sign-off, real Accounts/Sales/Operations sessions and register gates remain open.
