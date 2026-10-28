# Rate units and Stock supply release — 28 October 2026

Both releases are live. The full acceptance role walkthrough is **partial**, awaiting the owner's role switches; see `ROLE-WALKTHROUGH-RESULTS-20261028.md`.

## Released versions

| Release | Acceptance Worker | Production Worker | Integration |
|---|---|---|---|
| Rate units01801ba /09837cd | c776285d-63bc-4b98-9c53-b1dd592bd5e0 | 0e6760a3-726d-452a-b112-996622bc178b | PR74 / dc1be701b7990e2e60dd5288582daf1ca4b9693d |
| Stock supply7b8d714 / c81b06a | c6cc0aa9-164d-4d7c-8f24-b5a83243c516 | 139ced3b-4cae-46b6-a496-f0c34bad5e05 | PR75 / 8c44bb5ac264742682315424cdedb82f049fc7fa |

Acceptance preceded production for each release. Production Worker139ced3b serves100% traffic. Rollback for the latest UI is0e6760a3. No rollback was needed. Worker rollback does not reverse additive database changes.

## Database and connector

- Only rate-units migration `20261026150000_rate_check_units.sql` was new: normalized SHA-256 `998361c4eb704a295545e08b3311eac08f4ba1e5fd26b9d7b0e40ea3adfae0e3`.
- Acceptance84→85, remote20261028054539. Production146→147, remote20261028054756. No anchor error. Both exact importer patch and complete rate-check function body verified.
- All prior migration hashes and4acceptance/12production sealed billing snapshot payloads preserved. Private helper direct EXECUTE remains denied to anon/authenticated/service_role; existing owner-executed public gateways retain access checks.
- Final production history147exact matches/0pending, map checked at2026-10-28T06:13:36.863635+00:00. Stock supply has no migration or Edge change.
- Copied only approved recovery.ps1 into the existing office task checkout after clean-baseline/diff review; backup remains private. Exact deployed file SHA-25623f7935133b23b77c25b0decf6711a5e59c9b58900866c3c4f51762926018191.
- Supported pwsh control-script restart succeeded11:22:52IST. An initial normal upload network failure retained its pending payload; existing retry succeeded11:39:58IST, then production Stock showed current11:54data. No forced re-import, extra diagnostic Tally request, execution-policy change or task/schedule change.
- Existing evidence identities/source versions are unchanged. Existing sales units remain null; new or changed evidence can carry units. No retrospective unit-import success is claimed.
- Production push remains OFF; acceptance's prior ON setting was preserved.

## Tests and audit

- Rate CI40324729201:54SQL,1633unit+1skip,38general/607pricing(+29skips)/20offline browser checks, zero advisories at that time. Tested PR merge tree equals09837cd tree8cbfa93023973edff381ceacdd71fc4c7c9f9fb2.
- Stock CI40642344950:54SQL,1660unit+1skip,44general/619pricing(+29skips)/20offline browser checks; types/lint/build/security-policy gate PASS. Tested/merged tree532c7e79953307bfbed67fcddc8a4a877f0a4d86.
- First Stock CI40640345846 passed all runtime tests but failed audit report consistency. pnpm's high filter omitted lower-severity details while retaining their totals. c81b06a requests complete low-threshold JSON and validates its exit status and counts. SECURITY.md's high/critical blocker, malformed-report rejection and expired exact-patch exception are unchanged.15audit regressions pass, including high/critical rejection; no ignores or expiry extension.
- Current visible audit: high0/critical0/moderate2/low1. Open: Satori GHSA-wx4j-mvgx-mqwp, qs GHSA-6pq8-jhm2-2vcw, deepmerge GHSA-gcqx-w48m-w2h4 (no published patched version). This is not a zero-advisory release claim.
-12focused migration-bookkeeping tests PASS after recording147deployed/0pending. An intermediate stale CRLF pending-count expectation was corrected; no checker weakened.
- Runtime Stock files are identical between frozen d54a1e4 builds and final c81b06a; only CI audit helper/test changed.420frozen artifacts verified. Kept deployed canonical/offline service-worker fixes and advanced cachev14→v15 rather than restoring sourcebranchv13.

## Hosted checks

- Nine public-shell/protected-API/private-no-store/exact-asset checks per environment passed for both releases.
- Acceptance Administrator rate fixture0032 opens, waits for Tally rates, no false mismatch badge. No artificial hosted invoice-unit evidence was inserted.
- Stock acceptance: real NikiteshAccounts session, desktop1366x900, Active renders; +Order and Edit removed, expected role navigation, retained0034billing1Nos×600=600. Phone375x812first Stock row fully visible; old dropdown replaced by explicit empty-sale-history line.
- Fresh production Administrator: Stock shows real compact Lastsold date/quantity/customer, and Orders rendersActive with existing real orders. Existing SW cache initially showed old Stock; one reload activatedv15 and displayed the new line. No order action submitted.
- Billing-only bell/notes and other role controls passed automated tests. Their complete hosted role walkthrough is not claimed as complete.

## Role walkthrough and ownership

- Owner approved Nikitesh's spare acceptance sign-in. Original and last verified role state remains active/accounts/[accounts], original updated_at unchanged. No roles changed; no restoration needed yet.
- Created only no-ledger customer ROLE WALK Test Lab774cb4a3-a03c-4b5a-9cea-3e327b95fa8b through Accounts UI. No ROLE-WALK order, visit or contact created yet.
- Partial Accounts checks are recorded separately. Other role steps await owner switching Sales only in the separate Administrator Users window; request remains pending. Chrome is unavailable to browser control and native URL verification blocked it; no bypass attempted. In-app browser is signed in as Nikitesh.
- No production business, role, Edge, notification-permission or connector-configuration mutations. Codex remains sole integrator/deployer; Claude checkout and unrelated dirty files preserved. Shared handover/rollout logs append-only.

Private evidence: `stockflow-push-release/work/release-20261028/`: target artifacts/deploy logs, CI summaries, database proofs, hosted hashes, rollback metadata and screenshots. Bookkeeping changes are limited to this checkpoint, role-results report, migration map and its focused test.
