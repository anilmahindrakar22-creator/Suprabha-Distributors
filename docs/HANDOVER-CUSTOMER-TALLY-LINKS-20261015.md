# One-time Tally links and customers for visits

Owner's final direction, 15 October 2026: continue the earlier one-time confirmation design and allow new customers for visits without a ledger. This supersedes the temporary withdrawal; its checkpoint is reused, not discarded. Codex owns integration/deployment. Claude's released source claim remains released.

## Behaviour and scope

- Accounts has an Add customer action for its existing Sales/Operations/Management/Administrator roles. Only the name is required; town and phone are optional. The customer lives in the existing master with a null Tally key, and can have visits and app contacts immediately.
- After saving, Accounts switches from Mine to All, clears filters, searches the new name and opens its visit form. No assignment or ledger is required. Unlinked financial fields remain unavailable, rather than zero.
- Management/Administrator can review exact same-company matches and confirm selected links once. Nothing is preselected. Confirmation saves canonical company/ledger identity; ordinary future sales do not need repeated matching.
- If an exact-name Tally debtor later arrives for a visit customer, source sync retains the original record for confirmation rather than creating another customer. Only the actual Sundry Debtor customer export makes a ledger-free customer eligible; a same-name unrelated ledger in the general reference dictionary is insufficient.
- Accepted canonical GUID evidence allows subsequent directory sync to retain the customer UUID after a ledger rename. Visits, contacts and all other UUID references remain attached. Old invoice and confirmation evidence stays immutable.
- Duplicate active names fail with a searchable explanation. For different branches, include the location in the customer name. V1 does not fuzzy-match names, silently merge two existing histories, or provide a canonical-identity correction screen.
- Lost responses keep the exact original command and prevent edits until the same save is retried. A successful link receipt must identify exactly the selected customers; malformed source lists and success bodies never become a success notice.

## Files and invariants

Restored package: `app/api/customer-links/route.ts`, `components/customer-links.tsx`, lazy entry in `components/accounts-workspace.tsx`, `lib/customer-link-types.ts`, `lib/order-gateway.ts`, Orders Edge action routing, `20261015100000_customer_link_confirmation.sql` and its SQL/source-integrity/concurrency/unit/browser tests. Connector reference export uses the already-loaded ledger index in `desktop-connector/economics.ps1`, tested by `tests/connector-economics.ps1`.

Addition: `components/new-visit-customer.tsx`, Accounts entry and ledger state, `lib/account-types.ts`, create_customer Edge routing, CLI-created `20261015082020_visit_customers_without_ledger.sql`, `supabase/tests/visit_customers_without_ledger.sql`, `supabase/tests/visit_customers_concurrency.sql`, creation command/API/Edge tests and `tests/pricing-browser/visit-customers.spec.ts`. Replay runner, read-only migration allowlist/evidence and its expectations include both undeployed migrations. No deployed migration file changes.

Reuse existing current-role gateway authorization and command receipts. Creation, snapshot customer sync and link confirmation share the first Economics advisory lock. Creation provenance is private, RLS-enabled, immutable and has no direct client/service-role grants. The master write, event and receipt are atomic. Confirmation retains canonical unique keys, verified source generation and all-or-nothing batch writes. Source master observations are immutable/rebuildable; reused-version conflicts, stale observations and explicit empty/rejected generations cannot silently fall back. No new customer master or name-based financial attribution.

## Evidence and release state

Candidate branch `codex/customer-tally-link-review`, resumed from local checkpoint `c52761b`; base reconciliation `94ab7ca` includes RC `157b7c7` and Claude package `479b806`. Primary Accounts React/accessibility fixes are preserved.

Evidence directory: `work/customer-links-resume-20261015/`. Initial creation regression failed because the action was absent. First focused units passed 323 tests. `replay-third.log` passed the full disposable database replay, including create/visit/contact with no ledger, no duplicate on first ledger, one-time confirmation and rename preserving history. Additional final concurrency, static, full-unit and phone-browser results are recorded below when complete. Earlier failures are retained: outdated linked-row count, wrong SQLSTATE catch in the immutability test, and pending migration count25 rather than27; enforcement was not relaxed.

Unrelated starting dirty/untracked contents were copied to `starting-local-work/` with hashes before source edits. Browser/static checks use an isolated candidate and separate port3131; existing preview files must not be regenerated in the main checkout.

This is a local candidate, not a hosted release. Existing acceptance remains PR52 Worker8656ce49 with recorded backend66/OrdersEdge13/Sync4. No production/database/role/business mutation occurred for this work. Native full-sales reconciliation, financial cutover/class completeness and instrument-register gates remain open. Before integration/deployment, reread both shared logs, reconcile concurrent work, review final migration hashes and run exact-source CI. Connector ledger export must be rolled out with the source package; do not present fixtures as live Tally validation.

## Final local verification

- `replay-final.log`: full disposable deployment-order database replay, **40 PASS** checks, including independent-session duplicate creation, stored replay, snapshot/link concurrency, canonical source integrity and financial regressions.
- `units-bounded-final.log`: **1,455 tests in 139 files passed**, coverage thresholds passed. The first unconstrained run passed1,454 and timed out one offline cryptography test under parallel load. Final run used two workers and unchanged timeouts; it passed the full suite, not just the failed test.
- `browsers-first.log`: existing Accounts tests passed; the two failures were new-form Cancel focus on both devices. Primary fixed focus after React reenables the opener. `browsers-final.log`: **33 passed, one intended desktop skip**, covering all final customer-link and new-customer tests on desktop/phone. Includes Sales create→visit on the same UUID, optional fields, duplicate feedback, focus restoration, no horizontal overflow and identical retries after network/malformed/408/429/502 responses. Existing Accounts checks remain in the first run; no claims of live staff testing.
- Final complete lint plus new component lint, clean-candidate typecheck, offline/staff build and connector economics fixtures passed. `preflight-final.log` accepts both normalized SQL hashes as **not deployed**, with27 pending production migrations and `releaseReady:false`; live history has not been recertified.
- `final-integrity.json`: **545 tested source/test files match** the main checkout; **68 unrelated starting files preserved byte-for-byte**, including all existing preview images. Five decision/status/shared-log files have intentional updates. No root browser screenshots were generated.

Acceptance, production, role memberships, emails and business records remain unchanged. Local implementation is ready for the next integration review; hosted connector/backend rollout and exact-source CI are outstanding. Keep the instrument register and financial completeness/class gates held. Next integrator should read this final decision rather than reinstate either the old withdrawal or repeated matching work.
