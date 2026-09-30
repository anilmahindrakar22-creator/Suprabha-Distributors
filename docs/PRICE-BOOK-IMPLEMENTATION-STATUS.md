# Price book implementation checkpoint — 14 September 2026

Branch: feature/customer-pricing-engine. Pricing checkpoint committed as f0d167f; unpublished.
Approved requirements: CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md.
Validation is batched to conserve usage; this checkpoint records remaining release work explicitly.

## Usage-reserve stop — 14 September 2026

## Migration content comparison — 15 September 2026

- Recovered the two exact production bootstrap migrations from read-only migration history:
  private snapshots and the full member allowlist (identity, auth binding, constraints, RLS
  and grants). Their normalized hashes match the evidence recorded on 15 September.
- Added `test:pricing:deployment`, which replays a disposable clean install in verified
  production deployment order, followed by the eight pending pricing migrations.
  It excludes the obsolete gateway-secret rotation. The historical archive migration keeps
  its `archived_at` schema and access predicate, but the disposable copy removes its one-time
  command that archived every order. Repository migration files remain unchanged.
- Fresh deployed-order replay passed: existing-order preservation, complete pricing integrity,
  billing evidence, atomic rollback, idempotency and two-session concurrency checks.
  This resolves the missing-bootstrap/dependency-order clean-install blocker without touching
  production or Tally. Fresh live-history comparison is still required immediately before release.

- Added a read-only local preflight: `node tests/pricing-release-preflight.mjs`.
  It validates the recorded project, complete local file inventory, normalized SQL hashes,
  unique mappings/remote versions and reviewed match statuses; returns deployed dependency
  order and only the eight explicitly allowed pending pricing migrations. Historical scripts
  cannot be relabeled as pending, and changed/unmapped files fail closed.
- This checks saved evidence, NOT fresh remote state. Output explicitly sets releaseReady
  and liveHistoryRechecked to false. It cannot execute SQL or repair migration history.
  Clean-install bootstrap recovery/replay remains incomplete; no database or Tally changes.
- Eight focused preflight tests pass, including drift, missing/new files, duplicate mappings,
  historical replay exclusion, unknown statuses, incorrect hashes and wrong-project evidence.
  Typecheck and targeted lint pass after removing an unnecessary type suppression and
  adding explicit sort comparators. The CLI successfully validates the current saved map.
- Next ticket: authenticated acceptance on an isolated deployed candidate, followed by the
  final consolidation checkpoint. The pricing branch remains unpublished.

- Read-only remote history query compared 71 local migration files against 65 deployed entries.
  Of 63 shared names, 60 SQL hashes match after CR removal and surrounding whitespace trim.
  Three formatting differences (user_management_gateway, archive_and_reset_test_orders,
  return_created_order_state) have identical non-whitespace content and quoted literals.
- Eight local pricing migrations are not deployed. Two remote bootstrap migrations
  (private snapshots and member allowlist) are absent from the local migration directory.
- Evidence is saved in supabase/migration-history-map.json; it is NOT an executable plan.
  Names/timestamps have not been rewritten, and remote migration history is untouched.
- Clean-install repair must include the two real bootstrap definitions and the deployed
  dependency order. Do not use the reduced test scaffold as a production baseline: deployed
  stockflow_members also contains id, user_id and created_at, absent from that scaffold.
- Checks performed: read-only history hashes, three SQL/literal comparisons and member
  column metadata. No application tests were needed for these evidence-only files.
- Next ticket: prepare and validate a clean-install/deployment mapping using this evidence;
  exclude historical archive/reset and credential rotation from any live replay.

Latest read-only deployment investigation:
- Supabase project aormuidjbdqruglmyseh lists delivery_exceptions at 20260902054643,
  equipment_installations at 20260902054942, then harden_business_history at 20260902081149.
  Production therefore applied dependencies in a different order/timestamp mapping from
  repository filenames. Both no-delete triggers were queried and are enabled (O).
- Remote history ends at 20260912081315 order_follow_up_queue; pricing migrations are not
  listed. Do not blindly push repository timestamps or mark migrations applied by name alone.
- Next: compare migration SQL/schema content before preparing a mapped deployment baseline.
  No remote writes, history repair, migrations, or publication performed.
- Investigation stopped at five-hour 19% remaining (weekly ignored). No tests run this turn.

- Latest recovery implementation commit: 74c09c5; still unpublished.
- Start-of-turn usage check: five-hour remaining 5%; weekly remaining 24%.
- Stopped under the approved 20% minimum reserve; no implementation or tests run this turn.
- Next ticket: unresolved pricing-save recovery and retry safety in existing contract/policy forms.
- Existing migration working change and two untracked validation logs preserved.

## Implemented locally

- Usage instruction updated: only the five-hour 20% reserve controls stopping; weekly
  allowance is no longer a user-imposed stopping threshold.
- Contract proposals, approval/rejection and policy creation now reuse unchanged commands
  after uncertain responses while Pricing stays mounted. Keys are scoped by actor, role,
  action and complete payload; edited decisions use new keys. No database safety controls
  changed. Four targeted desktop browser checks, targeted lint and typecheck passed.
- Contract/policy reload recovery now uses the existing account-scoped receipt panel and
  status-only recovery gateway. Forms remain disabled until earlier receipts are confirmed.
  The browser stores action/key only, never commercial values. Additive migration
  20260914140000 extends the gateway allowlist without changing transaction controls.
- Fresh validation: six targeted desktop browser tests, targeted lint, typecheck and pricing
  migration replay/integrity tests passed, including role denial and cross-account isolation.
- Unresolved receipts now offer an explicit Close only if unsaved action. The database
  takes the existing command lock non-blockingly, preserves completed requests and leaves
  in-flight requests unresolved. If unsaved, it atomically records a non-replayable result
  and audit event; the original key cannot apply later. No financial data is changed.
- Migration 20260914160000 adds this behavior without changing the shared command helper.
  Fresh checks passed: three targeted browser tests, lint/typecheck, pricing migration replay
  and database integrity including a real second-session lock, late-request rejection,
  duplicate closure, completed-save preservation and injected audit-failure rollback.
- Remaining limitation: browser-session closure may lose receipts. No automatic resubmission.
- Two-session customer-price approval tests now prove lock contention, stale row rejection,
  stale bulk rejection and duplicate-command replay without extra decisions. A second-row
  audit failure proves all bulk decisions, events, outbox entries and command results roll back.
  Fresh pricing database replay/integrity suite passed; no production code changed.
- Migration validation now has -StrictHistory mode (no historical edits or deferral).
  It fails at 20260902080651_harden_business_history.sql: private.stockflow_delivery_exceptions
  does not yet exist. This is a clean-install release blocker, not a passing replay.
- Default local replay now leaves all migrations from 20260913130000 byte-identical to the
  repository, verifies file hashes, and checks preservation of a pre-upgrade order and lines.
  This upgrade check plus pricing integrity/concurrency tests passed. Older baseline setup
  still uses documented compatibility adjustments; deployed schema/history has not been checked.
- Next release requirement: compare the deployed migration history and agree a clean-install
  baseline/repair process. Do not silently rewrite already-applied migration files.

- Customer-first Purchased / Exceptions / All Products worksheet, 50-row pages.
- Shared database calculation for order lines, customer book, and product cost-change impact.
- Continuity = last eligible rate + max(current comparable cost - historic cost, 0).
- Independent rounded target-margin calculation; recommendation = max(continuity, target).
- Fixed agreements preserve their rate and flag margin deterioration.
- Base/default rates apply only without eligible customer history and fixed agreements.
- Missing cost or comparable historic evidence and ambiguous latest-date sales are explicit.
- Management row and bulk approvals, evidence fingerprints, append-only decision records,
  audit events, transactional outbox references, idempotent retries, stale-decision rejection.
- Accepted book decisions feed order pricing while their evidence remains current.
- Order submission requires preview fingerprints; pending exception approval rechecks evidence.
- Entered rates below the minimum margin, and changes to fixed contract rates, require approval.
- Four additive migrations: 20260913130000, 20260913131000, 20260913132000,
  20260914100000 (revalidate approved evidence at the billing boundary).
- Order pricing offers Maintain / Recommended / Custom with independent economics and
  recommendation reasons. Fixed agreements cannot use the continuity option.
- The TypeScript calculator now follows the approved continuity/target/base rules too.
- Exceptional correction history is excluded even when its exceptional boolean is false.
- Earlier migration restored to its committed content instead of rewriting migration history.
- No Tally writes or live deployment performed.

## Fresh validation

- pnpm run ci: PASS on 14 September, lint/typecheck, connector checks, unit tests, production build,
  8 desktop/mobile access-denial E2E tests plus 6 pricing browser tests,
  production dependency audit (no known vulnerabilities).
- Pricing browser tests use actual components with fixture APIs, not authenticated live data.
- pnpm run test:pricing:db: PASS on disposable PostgreSQL 15, complete migration replay,
  existing pricing integrity scenarios and new customer price-book integrity scenarios.
- New database checks cover the approved arithmetic example, fixed/base/history precedence,
  protected bulk rows, role denial, replay, stale previews, order cost changes, immutable history,
  ambiguity, missing evidence, exceptional/zero/future sales and cost-decrease behavior.
- Billing regression verifies unchanged evidence permits handoff and changed cost evidence
  rejects billing without altering the order state or immutable snapshot reference.
- git diff --check: PASS.

## Remaining before calling this complete or release-ready

- Added actual pricing-route/auth-header/gateway serialization tests with simulated gateway
  responses: trusted actor identity, unauthenticated denial, pricing-role denial propagation,
  no-store headers, safe recovery GET/POST, invalid input and generic internal errors.
  Eleven new API cases plus five pricing-validation cases passed; targeted lint and typecheck
  passed. Tests simulate the upstream authenticated headers, not a real staff login or live RBAC.
- Authenticated end-to-end acceptance remains blocked on an isolated deployed candidate with
  test accounts/data. Production was not mutated and the unreleased branch was not published.

- Authenticated browser acceptance for customer selection, row approval, base price save,
  bulk review, mobile layout, keyboard use, paging, and errors. Fixture tests now cover
  customer selection, tabs, row submission, Accounts restrictions and order pricing options.
- Two-session price-book/bulk and same-exception approval concurrency, plus failure rollback,
  are verified locally. The losing exception approval is rejected as stale without duplicate
  snapshots, audit/outbox records or command results; the winner remains idempotently replayable.
- Billing-boundary regressions now cover Tally cost, customer-contract replacement, pricing-policy
  change and a newer accepted customer price-book decision. Each stale handoff is rejected while
  preserving the awaiting-billing order and immutable snapshot. The verified deployed-order
  PostgreSQL replay and complete pricing ACID/concurrency tests pass with these cases.
- Strengthen base-price preview UI (current rate, effective dates and margin evidence) and
  show accepted customer decisions clearly; consolidate older contract controls into exceptions.
- Reload recovery now retains only opaque action/key receipts in account-scoped session
  storage. The existing recovery gateway checks the same actor's committed command and
  returns status only, never commercial results. An unresolved receipt blocks approvals;
  absence is not treated as failure. Five targeted browser recovery/retry checks and the
  pricing database replay/integrity checks pass. In-memory unchanged retries retain their
  original payload/key. No automatic resubmission or persisted price values are introduced.
  A genuinely unresolved save needs operational reconciliation; closing the browser session
  can lose the receipt. Other pricing forms are unchanged.
- Performance review of product impact aggregation: responses are paginated, but server-side
  preview still calculates all buyers; approval is currently bounded to 1,000 customers.
- Reliable volume evidence is absent. Monthly GP values are explicitly unavailable, and
  impact ranking currently uses absolute per-unit change rather than monthly economic impact.
- No live read-only Tally evidence validation, management policy setup or office pilot performed.
- Existing migration replay harness normalizes historical Windows function text and defers
  two legacy triggers; this is not proof that an untouched raw historical chain replays directly.

This is a tested development checkpoint, not implementation-complete or pilot-ready.

## Release consolidation — 19 September 2026

- `pnpm run ci`: PASS. Fresh results: lint, typecheck, connector recovery/retention,
  80 unit files with 385 tests, production build, 8 desktop/mobile access-denial browser
  tests, 26 desktop/mobile pricing browser tests, and production dependency audit with no
  known vulnerabilities. Coverage: 95.21% statements, 88.35% branches, 100% functions,
  98.95% lines.
- Both disposable PostgreSQL 15 paths passed in this combined run: the compatibility replay
  and verified deployed-order clean install. Each completed existing-order preservation,
  pricing integrity, billing evidence, rollback, idempotency and two-session concurrency tests.
- Release preflight and branch diff checks pass. Production, Tally, remote migration history,
  hosting and customer/order data were not changed.
- Authenticated acceptance verdict: PARTIAL. Fresh browser tests cover customer selection,
  customer/base decisions, retries/failure handling, role restrictions and desktop/mobile UI;
  API tests cover trusted identity and denial; database tests exercise real transactions.
  These layers do not constitute a genuine staff login against an isolated deployed database.
- Consolidation verdict: no demonstrated implementation defect, but NOT pilot-ready and not
  approved for merge/publication until isolated staff-login acceptance passes and live migration
  history is refreshed immediately before release. Service expansion remains deferred.
- Branch `feature/customer-pricing-engine` was 14 commits ahead of its remote before this
  checkpoint; `origin/main` was `9afdbda`. No PR, merge, push or deployment was performed.
- Next action requires an explicitly authorized isolated candidate environment; do not perform
  pricing mutations against the current production company merely to satisfy acceptance.

## Additional authorized integrity slice

Completed after the user requested one more slice:

- Exception approval now revalidates all active decisions in its batch, including automatically
  approved siblings and siblings approved earlier by management.
- A regression test first reproduced successful approval with stale sibling cost evidence.
- Both sibling scenarios now reject with a concurrency error before creating any approval,
  billing snapshot, audit/outbox changes or idempotency result. Unchanged first approval and
  its idempotent replay are also checked.
- Fresh complete migration replay and both pricing database integrity suites passed.
- Application code did not change in this slice, so the earlier application/build results
  were not rerun or represented as newly executed.
- Committed as `71c62c7` and unpublished; remaining release blockers above continue to apply.

## Concurrent exception approval integrity — 19 September 2026

- Added a deterministic two-session race for two managers approving the same pending price
  exception. The test proves real lock contention rather than sequential calls.
- The first approval atomically creates the approved decision, immutable billing snapshot,
  audit event and outbox entry. The stale second approval returns `40001` and persists no
  command result or partial/duplicate state. Replaying the winner returns the original result.
- Fresh verified deployed-order pricing migration/integrity replay passed.
- No production, Tally, hosting or live customer/order data was changed. The isolated
  authenticated staff-login acceptance blocker remains.

## Pre-deployment gate refresh — 19 September 2026

- Refreshed the live Supabase migration list read-only. The production project is healthy and
  still ends at `order_follow_up_queue` (`20260912081315`); none of the eight pricing migrations
  has been applied and no unexpected later migration was found.
- Fresh verified deployed-order replay passed, including existing-order preservation, pricing
  integrity, rollback, idempotency and two-session concurrency checks.
- The current public Site is healthy, but it still targets that production database. Publishing
  the pricing UI before its database boundary exists would create a broken partial release.
- Deployment is therefore held. The remaining release gate is authenticated staff acceptance
  in an isolated candidate followed by a controlled migration/app release. A free isolated
  database environment is not currently configured; production must not be used as the test bed.
- No production database, Tally data, Site version, access policy or hosting configuration was
  changed during this check.

## Isolated authenticated candidate — 19 September 2026

- Created a zero-cost isolated Supabase project and private Sites candidate. It contains only
  synthetic acceptance data; production orders, production Tally data and the production Site
  were not changed.
- Applied the verified deployment-order schema with historical credential rotation and the
  one-time order archival command excluded. The pricing gateway, immutable snapshots and both
  approved administrator accounts are present in the isolated environment.
- Authenticated administrator access reached the restricted Pricing workspace and loaded the
  synthetic Customer × Product price book from the isolated database.
- PostgreSQL 17 exposed a release-blocking ambiguous `contract` reference in the customer-price
  listing gateway that PostgreSQL 15 did not reject. The row variable and result alias now have
  distinct names; the private candidate and local deployment replay both pass afterward.
- The candidate is deployed privately at
  `https://suprabha-pricing-acceptance.anil-mahindrakar22.chatgpt.site`.
- Full mutation acceptance (customer proposal/approval, base-price decision, bulk approval and
  recovery) remains to be completed before production migration and publication.

## Isolated mutation acceptance and independent approval guard — 19 September 2026

- Added the synthetic Tally catalogue snapshot required by the private candidate; production
  stock, production Tally and the production Site remain untouched.
- Authenticated customer-price entry passed: the administrator selected the synthetic customer
  and product, submitted an effective-dated ₹800 proposal, and the candidate persisted the
  pending contract and approval audit path.
- Acceptance then demonstrated that the same administrator could approve their own proposal.
  This violated the stated four-eyes control even though role authorization, optimistic locking
  and audit persistence were otherwise working.
- Added a database trigger that rejects a transition to `approved` when `approved_by_email`
  equals `created_by_email`. The guard applies below the API/UI boundary and therefore cannot be
  bypassed by a hidden frontend control.
- Added a regression scenario proving self-approval rolls back and a different Management user
  can approve the unchanged pending contract. The migration applied successfully to the isolated
  PostgreSQL 17 candidate. Both the focused rollback-only trigger check and the complete
  `pricing_engine_integrity.sql` transaction suite passed there.
- The local deployment replay could not be rerun in this session because the local PostgreSQL
  `createdb` executable is unavailable. Its last fresh pass remains recorded above; this new
  migration still requires the normal deployment-order replay at the final release checkpoint.
- Base-price and bulk-price mutation acceptance, opaque recovery acceptance, and a clean
  two-account UI approval pass remain release blockers. Production deployment stays held.

## Base and bulk mutation acceptance — 20 September 2026

- Ran the real pricing gateway against the isolated PostgreSQL 17 candidate using synthetic
  Cleaner evidence inside a rollback-only transaction. Production, Tally and the production
  Site were not contacted or changed.
- Base-price acceptance passed: an Administrator-approved effective-dated base price persisted
  with one audit event and one idempotency result; replaying the same command returned the exact
  original result without a duplicate price or audit event.
- Bulk-price acceptance passed after adding rollback-only historical purchase-cost evidence:
  the preview produced eligible continuity evidence, the recommended-price command created the
  expected customer decisions, audit events and transactional outbox entries, and an identical
  replay returned the original result without duplicates.
- The second approved staff identity (`nikitesh.am@gmail.com`) completed ChatGPT authentication,
  but the private candidate Site remains owner-only and denied application access. No Site access
  policy was changed. A clean two-account UI approval pass therefore remains blocked until that
  identity is explicitly granted candidate access.
- Remaining release blockers: opaque recovery acceptance, two-account browser approval, and the
  final deployment-order replay/consolidation. Base-price and bulk-price database mutation
  acceptance are complete. Production deployment remains held.

## Production release and pilot handoff — 20 September 2026

- Released commit `e7646c2cf831d8c90950d2322cbdb17cf8310acb` to GitHub `main` and
  `feature/customer-pricing-engine`, production Site version 47, and `stockflow-orders`
  Edge Function version 17.
- Applied the nine reviewed pricing migrations after refreshing the live production migration
  history. The release excluded historical credential rotation, one-time archival and all Tally
  write operations.
- Pre/post migration counts remained unchanged: 23 orders, 26 order lines, 458 customers,
  2 members and 142 order audit events. Pricing tables and the restricted pricing gateway are
  present after migration.
- The clean release gate passed: lint, typecheck, connector recovery, 385 unit tests, production
  build, 8 desktop/mobile access tests, 26 desktop/mobile pricing tests and the production
  dependency audit. Coverage was 95.21% statements, 88.35% branches, 100% functions and 98.95%
  lines; no known production dependency vulnerability was reported.
- Authenticated production smoke acceptance passed with `nikitesh.am@gmail.com`: Orders loaded
  existing operational queues and Pricing loaded the restricted price book and policy. No order,
  price, access policy or Tally data was changed during smoke acceptance. Recent production Worker
  error logs were empty.
- Supabase security advice contains informational `RLS enabled, no policy` notices for deliberately
  inaccessible private-schema tables. Performance advice includes optional covering indexes; no
  error-level database advice or release blocker was reported.
- Local database replay was unavailable because PostgreSQL `createdb` is not installed on this
  workstation. The PostgreSQL 17 isolated candidate integrity run and controlled production
  migration verification provide the release evidence for this environment.
- Deployment is complete and the combined Orders + Operations + Pricing build is ready for a
  controlled office pilot. The pilot must validate real staff handoffs and must keep Tally
  read-only; production test mutations are not required for this checkpoint.

## Administrator self-approval policy — 20 September 2026

- Owner policy now permits an active Administrator or Management user to approve a customer-price
  proposal they created. Approval remains denied to Accounts and operational roles by the pricing
  gateway.
- The forward migration removes only the independent-review trigger. Optimistic version checks,
  idempotency, immutable pricing history and pricing audit events remain unchanged.
- Focused integrity coverage now verifies administrator self-approval, exact idempotent replay,
  one command result and a durable approval audit event.
- The migration is committed for the next release but has not been applied to production in this
  ticket.

## Pricing-evidence import correction — 21 September 2026

- Tally has no reliable tender, scheme or special-price marker. The read-only connector therefore
  does not infer commercial intent from voucher references or other free text. Only objectively
  detectable FOC/zero-rate sales are marked exceptional; governed special prices belong in the
  explicit Customer × Product price book.
- Fixed populated Tally voucher-reference parsing so provenance remains available without stopping
  an otherwise valid sales-history refresh.
- Added an immutable private import-run record with received, accepted, duplicate, unmatched and
  rejected counts. Invalid or unmatched pricing evidence is now observable without exposing
  customer names, prices or other restricted commercial values in general application payloads.
- Focused connector recovery, classification and pricing-import tests pass. Local database replay
  remains unavailable because PostgreSQL `createdb` is not installed on this workstation, so the
  new migration is committed but not claimed as applied or deployed.

## Customer price-book visibility — 21 September 2026

- Customer rows now show the governed price source, current selling rate, current cost, gross
  profit per unit and margin without another disclosure click. Cost provenance and percentage
  change remain visible in the same compact card.
- Continuity and recommended prices are direct one-click approvals with a deterministic audit
  reason when no optional note is entered. Custom prices still require an explicit reason.
- The Exceptions view now includes both fixed customer agreements and calculated
  `REVIEW_REQUIRED` rows from genuine customer sales history. Pricing-role checks remain enforced
  in the database gateway, and the underlying gateway is no longer directly executable.
- Focused unit, type, lint and desktop/mobile browser checks pass. The forward migration is
  committed but not deployed; local database replay remains unavailable without `createdb`.

## Governed prices in routine orders — 21 September 2026

- Accounts, Administrator and Management can apply all current governed prices to a routine order
  with one action. Operational order-entry roles still receive no restricted commercial values.
- The shortcut is available only when every line exactly matches an effective approved customer
  agreement, the approved base price itself, or a price-book decision bound to the current evidence.
  Missing evidence, an unapproved suggestion, a changed cost/source or a review-required guardrail
  fails closed into the existing manual exception workflow.
- The action delegates within the same database transaction to the existing idempotent pricing
  decision, immutable billing-snapshot, audit-event and outbox workflow. A lost response retries
  with the same client request key.
- Focused authorization-contract, UI-contract, idempotency, release-preflight, lint and type checks
  pass. The forward migration and Worker routing change are committed but not deployed; local
  database replay remains unavailable without `createdb`.

## Simplified pricing administration — 21 September 2026

- The daily Pricing workspace keeps the customer price book and pending price decisions visible,
  while customer-agreement setup, agreement history and commercial-policy controls are grouped
  under a collapsed `Pricing administration` section.
- Removed stale four-eyes and independent-review wording. The interface now matches the approved
  policy: an Administrator or Management user can approve a price, including their own proposal.
- Focused unit, lint, type and desktop/mobile browser checks pass. This is a UI-only ticket: no
  database, pricing transaction or read-only Tally behavior changed, and it has not been deployed.

## Migration replay checkpoint — 21 September 2026

- The pending pricing release contains 13 forward migrations, ending with governed routine-order
  pricing. The repository deployment-order runner and migration-history map are present.
- Restored the official PostgreSQL 17.11 portable runtime after confirming PostgreSQL had been
  removed and the current Winget installer URL returned HTTP 403. `createdb` now creates and drops
  isolated local databases successfully; the user-local `bin` directory is on the user `PATH`.
- A fresh deployment-order replay exposed and fixed an ambiguous member-email reference in the
  price-book gateway. The concurrency fixture was also split at its transaction boundary so its
  committed setup cannot hold the evidence lock needed by the two independent approval sessions.
- Fresh deployment-order replay, existing-order preservation, pricing ACID checks, two-session
  concurrency and injected bulk-rollback checks all pass on isolated PostgreSQL 17.11. No
  production database or Tally data was changed.

## Authenticated acceptance refresh — 21 September 2026

- Fresh desktop/mobile pricing acceptance passed all 26 scenarios, covering customer and base
  decisions, bulk impact approval, pagination tabs, role restrictions, opaque account-scoped
  recovery, unchanged idempotent retries and failure handling.
- `nikitesh.am@gmail.com` authenticated successfully against production and loaded the restricted
  Pricing workspace. No application error appeared; only unrelated authentication-provider
  telemetry-size warnings were present in the browser console. The smoke remained read-only.
- The isolated mutation candidate still rejects that approved staff identity at the hosting layer
  before the application loads. Therefore two-account authenticated browser mutation acceptance
  remains partial; no Site access policy was changed and no production price, order or Tally data
  was mutated for this check.

## Final consolidation checkpoint — 21 September 2026

- The deployment-order PostgreSQL 17.11 replay passes with byte-identical order preservation,
  pricing ACID integrity, two-session approval concurrency and injected bulk-rollback checks.
- The complete repository gate passes: lint, typecheck, connector recovery/retention, 397 unit
  tests, production build, 8 desktop/mobile access-security tests, 26 desktop/mobile pricing
  tests and the production dependency audit. Coverage is 95.21% statements, 88.35% branches,
  100% functions and 98.95% lines; no known high-severity production dependency vulnerability
  was reported.
- Consolidation detected and corrected the stale reviewed checksum for the fixed price-book
  visibility migration. The focused eight-case release-preflight suite passes afterward.
- Automated engineering evidence is green, but release readiness remains `PARTIAL`: live migration
  history must be refreshed immediately before release, and the isolated candidate must permit a
  second approved staff identity for authenticated mutation acceptance. No merge, push, deployment,
  production mutation or Tally write was performed.

## Customer-first correction in progress — 23 September 2026

- Current customer price now displays the accepted evidence-bound price-book decision, not
  merely the last Tally invoice. A changed evidence hash expires that decision; the calculated
  recommendation remains a proposal, not an automatically approved current price.
- A new confirmation transaction applies fully governed order prices and creates the immutable
  billing snapshot, audit events and outbox entry together. Missing or review-required evidence
  leaves pricing unapproved. Existing confirmed orders retain an explicit apply action; viewing
  an order never silently writes pricing decisions.
- Order entry offers bounded customer-price previews only to Administrator, Management and
  Accounts. The database gateway denies operational-role access to commercial values.
- Routine bulk and contract approvals no longer require typing a reason; deterministic audit
  reasons are supplied. Custom decisions and rejections still require an explicit reason.
- Local deployment-order migration replay, existing pricing integrity/concurrency checks and
  the new confirmation/authorization/injected-rollback tests pass. Lint, typecheck, the
  production build and all 401 unit tests pass. Read-only release preflight lists this
  correction as a pending migration. This is not yet a release claim: fresh live migration
  comparison and authenticated acceptance remain open.

## Fresh production migration-history check — 23 September 2026

- Read-only live Supabase inspection found 78 deployed migrations. Their versions, names and
  normalized SHA-256 SQL fingerprints match all 78 recorded deployed entries. The new
  customer-first correction is absent from production and remains the sole pending migration.
- No live SQL was modified. The saved comparison date and inspected branch HEAD were refreshed;
  the preflight intentionally still reports `releaseReady: false` because a saved comparison is
  not a deployment or an authenticated staff workflow acceptance.
- Next gate: isolated authenticated acceptance of the correction, including two approved staff
  accounts and a real confirmation/pricing exception flow. Do not mutate production orders or Tally.

## Customer-wide approval slice — 23 September 2026

- Selecting a customer now shows purchased items in a compact price table with last rate,
  historic/current cost, current GP, recommendation and approval status. Item details remain
  available on demand; exceptions have a one-click filter.
- An Administrator or Management user can approve all eligible recommendations in one
  evidence-bound, idempotent database transaction. Fixed prices, accepted decisions, inactive
  products and review-needed rows are excluded, counted and left unchanged. Audit events and
  outbox records are written atomically with the new decisions. Accounts can view but not approve;
  operational roles cannot read prices.
- The new migration is pending, not deployed. Isolated deployment-order replay, pricing ACID
  and concurrency checks, 24 focused unit tests, lint and typecheck pass. Authenticated candidate
  acceptance and fresh release-time migration comparison remain open; no production or Tally
  data was changed.

## Isolated Pricing browser acceptance — 23 September 2026

- The browser suite now checks the customer-wide preview, eligible/excluded counts, explicit
  approval checkbox, one bound approval request, and receipt-only recovery on desktop and mobile.
  Existing per-item checks were aligned with the collapsed detail panel, and routine approval
  tests with the current optional-note behavior.
- All 28 isolated desktop/mobile Pricing browser cases pass. These use fixture API responses,
  so they do not establish two-account authenticated acceptance against a deployed candidate.
  That gate and a fresh release-time migration comparison remain open. No production or Tally
  data was changed.

## Cost-increase exception correction — 24 September 2026

- The approved pricing design now treats a verified purchase-cost increase as an administrator
  exception, including under an approved fixed customer agreement. No automatic price increase
  or billing snapshot occurs on confirmation. With comparable unchanged/lower cost and a valid
  minimum margin, repeat orders proceed at the last genuine customer selling rate rather than
  silently adopting the higher target-margin recommendation.
- Added a forward migration that gates order resolution and automatic confirmation at the
  database boundary. Customer-wide bulk approval excludes cost-increase review rows; explicit
  administrator exception approval retains the existing ACID snapshot, audit and outbox path.
- Isolated PostgreSQL migration replay and deployment-order replay pass. The rollback-only
  regression verifies unchanged-cost auto approval, increased-cost hold for regular and fixed
  items, bulk exclusion and administrator exception approval. Focused pricing unit tests,
  lint, typecheck and the updated desktop/mobile browser cases pass. GitHub quality/security
  gates and CodeQL both passed for merge commit `989e287`.
- The separate private acceptance database now has the cost-increase migration, and acceptance
  site version 3 (`20346f6`) deployed successfully. The public app and production database remain
  unchanged; no Tally write has occurred. The isolated site's authenticated two-account acceptance
  still needs the owner's sign-in and approval of a synthetic proposal. Fresh release-time
  production migration comparison remains open, so the pricing release is not yet pilot-ready.

## Private acceptance gateway and order-entry handoff — 26 September 2026

- The private acceptance database confirms a synthetic customer-product proposal requested by
  `nikitesh.am@gmail.com` and approved by `anil.mahindrakar22@gmail.com`, with separate audit
  actors and an effective approved rate of ₹335. No production pricing data was changed.
- Authenticated order entry initially showed “Customer price unavailable” for that exact
  customer/product because the private acceptance Edge Function was still version 1, whose
  action allowlist lacked `preview_customer_prices`. The database resolver itself returned the
  approved contract correctly. Deployed the repository's existing `stockflow-orders` function
  to the private acceptance project as version 2; the same form then displayed
  “Current price ₹335.00 · GREEN”. No order was submitted, and public StockFlow and Tally were
  untouched.
- Fresh local `pnpm test:pricing:deployment` and `pnpm run ci` passed. The latter covered lint,
  typecheck, connector checks, 402 unit tests, production build, 8 access browser cases,
  28 pricing browser cases and the production dependency audit (no known high-severity finding).
- Release remains held: complete the authenticated pricing-to-order state transition on the
  private candidate, refresh production migration comparison immediately before release, and
  obtain review/merge approval. The pending migrations and pricing build are not public or
  pilot-ready yet.

## Authenticated pricing-to-order acceptance — 26 September 2026

- On the private acceptance site, `nikitesh.am@gmail.com` captured synthetic order
  `SF-260926-00021` for Acceptance Laboratory × Acceptance Analyzer Cleaner, then confirmed it.
  The database shows `confirmed`, `pricing_state=approved`, a version-1 immutable billing
  snapshot at the approved ₹335 rate, and matching order/pricing audit events. No Tally action
  or public production change was made.
- This closes the isolated pricing-to-order handoff check. A fresh production migration-history
  comparison, review and controlled release decision remain before public deployment or pilot.

## Fresh production migration comparison — 26 September 2026

- Read-only live inspection found 78 production migration records, ending at remote version
  `20260921103304`. All 78 versions, names, statement counts and normalized SHA-256 SQL
  fingerprints match the saved mapping; there is no unexpected live migration.
- Three local pricing migrations remain unapplied to production: customer-first correction,
  customer-wide bulk approval, and cost-increase exception gate. Local release preflight passed,
  but its static `releaseReady: false` result is intentionally not a deployment authorization.
- No production data or schema was changed. Next gate is final review of the three-migration application
  sequence and controlled public release decision; Tally stays untouched.

## Pending migration sequence review — 26 September 2026

- Reviewed the three pending migrations in timestamp order: customer-first correction,
  customer-wide bulk approval, then cost-increase exception gate. Each later migration wraps
  functions established by its predecessor; do not reorder or skip them. No direct business
  data rewrite or deletion was found. The revised decision CHECK constraints accept all three
  existing production decision rows (current values: `price_exception` and
  `last_tally_invoice`). Production runs PostgreSQL 17.6; the isolated replay used PostgreSQL
  17.11. The local deployment-order and injected-failure checks had passed before this review;
  they were not rerun here. No DDL down-migration rehearsal exists.
- Production `stockflow-orders` Edge Function version 18 lacks the new price-preview and bulk
  actions. The safe release order is: recheck live history and preserve a recovery point; apply
  the three migrations in order; deploy the repository gateway; verify its actions; deploy the
  application; then perform authenticated smoke and staff pilot checks. Do not expose the new
  application against the old gateway (the private candidate reproduced that failure).
- PR #29 is still draft at remote head `95a656e` with an outdated description claiming two
  pending migrations and incomplete two-account acceptance. Its quality/security and CodeQL
  checks passed at that remote head. Local documentation was ahead of the remote branch; no push,
  merge, production deployment or Tally change was made during this review.

## Final review security correction — 26 September 2026

- Independent PR review found the pending bulk-approval gateway could reach its write path when
  no active member role was found: SQL `NULL NOT IN (...)` does not reject that actor. The audit
  table's non-null role constraint prevented a committed approval in the reproduced case, but
  authorization must reject it directly. The gateway now explicitly rejects a null role.
- Added rollback-only integration checks for unknown and suspended actors. The pre-fix check
  failed on an audit constraint instead of an authorization error; after the fix, normal and
  deployment-order PostgreSQL replays pass, including ACID/concurrency checks. The pending
  migration hash and eight-case release-preflight unit suite were refreshed and pass.
- This correction is not deployed. PR checks must rerun on the new commit; the production
  recovery method remains unconfirmed. No public deployment or Tally change occurred.

## Release gate status — 26 September 2026

- PR #29 is open, review-ready and mergeable at `a8be161`. Quality/security and CodeQL
  both passed on that exact commit. No new code changes were made during this check.
- Production remains on Supabase Free. No verified, recoverable database export exists yet.
  The local PostgreSQL dump client is available, but no production database connection
  credential or URL is configured in this workspace, and the Supabase CLI is not installed.
  Supabase's Free-plan guidance recommends a manual logical export. Do not apply the three
  pending migrations or deploy the gateway/app until an export and recovery check are complete.
- Next release action: obtain a production read-only/dump connection securely, create a private
  logical backup, verify the artifact and an isolated restore, then recheck migration history
  immediately before the controlled migration → gateway → app rollout. Tally remains read-only.

## Backup gate follow-up — 27 September 2026

- The production project remains healthy and the public StockFlow page returned HTTP 200 after
  the owner reset the database password. Direct PostgreSQL connections are reachable, but the
  attempted manual `pg_dump` exports were rejected for the `postgres` role. Each attempt left
  only a zero-byte file; there is **no valid recovery backup**. Do not release on that basis.
- A private local helper now prompts for the database password without echoing it, and a
  separate verification helper checks archive size, required auth/business table entries,
  full archive streaming and SHA-256. Its empty-file rejection was exercised successfully;
  positive archive and isolated-restore checks remain pending a successful export. Neither
  helper nor any backup data is in the repository.
- PR #29 remains open, review-ready and mergeable at `c23b629`, with both quality/security and
  CodeQL checks successful. Production still lists 78 migrations, ending at
  `20260921103304`; the three pricing migrations remain unapplied. No production schema,
  pricing data, Edge Function, application or Tally change was made during this follow-up.

## Controlled release progress — 27 September 2026

- The owner explicitly waived the backup gate after being informed that production contained
  28 OMS orders, 458 customer records and 2 billing snapshots, identifying those records as
  test/disposable. No valid database backup was created. This is a release risk, not evidence
  that recovery is available. Tally remains untouched.
- Fresh deployment-order local replay passed: existing order/line preservation, complete
  migration chain, pricing ACID checks, two-session concurrency and bulk rollback. The remote
  PR quality/security and CodeQL checks passed on the preceding documentation head.
- Applied the three reviewed migrations in order as remote versions `20260927060906`,
  `20260927060927` and `20260927060946`. Their remote SQL normalized SHA-256 values exactly
  match the three local files. Production now lists 81 migrations; order, line, customer,
  customer-price and billing-snapshot counts were unchanged immediately afterward.
- Deployed `stockflow-orders` Edge Function version 20. Its retrieved source exactly matches
  the repository file and includes the price-preview and customer-book bulk-approval routes.
  The function retains its existing gateway-key authentication mode. The security advisor
  reports only informational no-policy notices on intentionally private RLS tables.
- The public Site deployment, authenticated production smoke, PR merge and office-pilot gate
  are still pending. Do not report the pricing release complete from migrations alone.

## Connector upload recovery — 28 September 2026

- PR #31 merged to `main` at `dd791a9ff937feed4e667d687eec434dd8d0415b` after the quality/security and CodeQL checks passed. The production-order migration replay, connector tests, 402 unit tests, typecheck, lint and production build also passed.
- Applied only `snapshot_pricing_import_privilege` as remote migration `20260928072110`. Its normalized SQL hash matches the local file. The private import trigger now runs under its trusted owner with a pinned search path; direct table/function access for app roles was not added.
- A Tally snapshot already saved on the office PC uploaded with HTTP 200. After restarting the scheduled connector, its own cloud upload logged `status=ok` and zero consecutive failures. No Tally voucher or setting was changed.
- The cloud snapshot advanced from 21 September to 28 September. The import recorded pricing evidence and removed it from the public snapshot. Orders and billing snapshots remained at 28 and 2; one customer ledger from the saved snapshot was imported, taking the customer count from 458 to 459.
- No verified production backup exists; the owner previously accepted the risk to test/disposable records. This connector fix does not prove the broader office pilot or resolve the pricing policy values and two-role acceptance. Continue observing upload freshness and Supabase resource use.

## Cloud Stock projection — 30 September 2026

- Continued on `feature/keyboard-order-entry` from `9fe41a3`, with a clean working tree. Recent connector/browser recovery work remains intact. No production deployment or Tally write was performed.
- Read-only production measurement: the current snapshot was updated at `2026-09-30T05:10:54.472Z`; JSON text measured 577,993 bytes versus 5,859 bytes for dashboard fields (approximately 99% less). This proves the payload opportunity, not a measured reduction in CPU or query latency.
- Added repository-controlled `stockflow-sync` source. `view=dashboard` selects only required JSON paths inside PostgREST; the app forwards this opt-in flag and retains its response projection/commercial-data sanitizer. Default reads and the atomic single-row snapshot upsert remain compatible. Upload bodies are bounded to 8 MiB using the existing streaming reader.
- Removed source-literal access keys from the new implementation. Before rollout, configure private Edge secrets `STOCKFLOW_READ_KEY` and `STOCKFLOW_UPLOAD_KEY` matching the server/office clients, and ensure the existing `SUPABASE_SECRET_KEYS.stockflowedge` backend key is present. No values are committed. Stage/review this function with custom-key authentication (`verify_jwt=false`) before deployment; do not deploy it without the secrets.
- Available last-24-hour diagnostics contain 36 PostgREST `Thread killed by timeout manager` messages. Log counts are not comprehensive traffic/CPU measurements and do not establish their cause. Follow-up: controlled function rollout, authenticated dashboard/upload smoke, and before/after cloud latency/load measurements. Live source still uses full-snapshot reads until rollout.
- Validation: 38 focused tests passed across Stock API, sync handler and existing request-gate tests; application lint/typecheck and separate sync-handler lint passed. Checks cover projection, credential rejection before database access, legacy response compatibility, controlled errors, atomic-upsert request semantics and streaming size bounds. No live upload, deployment, full-suite run or new production build was performed for this slice. TypeScript now permits explicit `.ts` imports so the tested Deno handler can reuse the existing bounded reader.

## Combined recovery batch — 30 September 2026

- Starting point: clean `feature/keyboard-order-entry` at `ac204e7`. Kept the batch uncommitted until its combined validation finished; no remote push, merge, production deployment or Tally change.
- Fixed a reproducible indefinite-refresh lock: either Stock or order-summary response-body parsing could stall forever, leaving Refresh disabled and preventing all later automatic refreshes. Both browser requests now have a 20-second deadline; a missing summary does not discard valid Stock data. Stock upstream reads have a 15-second deadline, sync database HTTP requests 10 seconds, and order-gateway requests 30 seconds. These are HTTP cancellation deadlines, not proof of database rollback. Uncertain mutations are never automatically resubmitted or assigned a new idempotency key.
- Concurrent authorized Stock reads for the same view/current credential now share one in-flight upstream read and sanitization. Every caller still receives its own authorization check; legacy/dashboard views and credential rotations are separate. Settled/error results are removed immediately, not cached. This is per-handler-instance protection, not a distributed rate limiter or a measured live CPU improvement.
- Fixed another shared-device cache boundary: seven-day Stock chart history is now account-scoped after the trusted parent handoff. Legacy shared chart keys are discarded, not assigned to an unknown owner. Previous-account chart caches are cleared on account switch; unsent order drafts remain intact. Existing browser aggregate-chart history resets once; no server business records are deleted.
- Fresh production-dependency audit initially found 20 advisories, including six high-severity findings. Narrow version-range overrides update fast-uri to 3.1.8, undici 7.x to 7.29.1, brace-expansion 5.x to 5.0.12, and ip-address 10.x to 10.7.1; the lockfile contains only those dependency changes. Final production audit reports zero known advisories at all severities. No audit exception or security threshold was weakened.
- Final `pnpm test:ci` passed on the patched dependencies: lint, typecheck, both connector suites, 452 unit tests with coverage gates, and production build. Sync-handler lint and connector-control status checks also passed. Focused desktop/mobile freshness E2E passed all 16 cases. Deployment-order PostgreSQL replay passed snapshot import privilege, catalog version compatibility, existing-record preservation, pricing ACID checks, two-session concurrency and bulk rollback. One obsolete source-string test failed after the timeout wrapper rename; its expectation was updated and the full suite passed afterward.
- Remaining release boundary: configure/review sync secrets, stage the actual Edge function/runtime and both pending migrations, then perform authenticated read/upload acceptance and before/after live cloud measurements. The isolated tests do not replace production acceptance or the staff-device pilot. Service remains deferred; no new business feature or architecture expansion was added.

## Rejected connector payload retry safety — 30 September 2026

- Continued from `9ae2935` on `feature/keyboard-order-entry`. Reproduced repeated HTTP 400 uploads of identical data with the real upload function and a mocked network boundary before fixing it.
- HTTP 400/413 now retain the local snapshot and persist a validated SHA256 rejection marker. Identical payloads are paused across restart; changed data remains eligible. The loop uses a precomputed pause flag rather than hashing every poll. Network failures, 429 and 5xx remain retryable; upload-key rejection stays separately credential-scoped. Successful upload clears the payload marker. Legacy receipts remain readable; status exposes no hash, key or business payload.
- Targeted recovery, control-status and sales-window suites passed in PowerShell 7. Regression coverage includes repeated rejection, durable restart state, changed payload recovery, 413, transient 429/500, receipt privacy and invalid-marker validation. `git diff --check` passed. No full application suite/build was rerun for this connector-only ticket.
- Recovery and control-status suites also passed on Windows PowerShell 5.1 using process-only execution-policy bypass (the machine's default policy blocked script launch; no persistent policy was changed).
- No deployment, Tally access or production mutation. Rollout and authenticated acceptance remain outstanding; this fix does not establish pilot readiness or measured live cloud-resource improvement.

## Five-update sync release-safety batch — 30 September 2026

- Started clean at `fd0e318` on `feature/keyboard-order-entry`; kept the five updates in one batch. A smaller-model worker handled only the independent package-script change. No production access, Tally read/write, push, merge or deployment.
- **Receipt recovery:** injected a local disk failure after cloud acceptance. The upload function previously retained rejection flags and advanced its in-memory acknowledgement before persistence. It now clears obsolete rejection flags, persists a new receipt atomically, advances acknowledgement only after success, and remains retryable if disk persistence fails. Regression also verifies subsequent recovery.
- **Company boundary:** the new sync handler previously accepted any company into the single `suprabha` snapshot row. It now requires the exact Suprabha company scope before database access, allowing the case/whitespace normalization already used by the office connector. No database constraints, import triggers or transaction boundaries changed.
- **Source freshness:** the handler no longer fabricates an extraction timestamp for a missing source time. It rejects missing/blank or invalid supplied ISO times, including impossible calendar dates, and stores ISO extraction time when supplied. Valid legacy display-only timestamps remain supported; upload time stays a separate `updated_at` value.
- **Error privacy:** Stock API reads no longer forward raw upstream JSON/text errors or malformed successful bodies to operational users. Non-success responses use a controlled message while retaining upstream status; invalid success bodies become 502. Valid response projection, commercial-field sanitization, authorization and in-flight read coalescing remain intact.
- **Continuous regression checks:** normal `test:connector` now includes the status/privacy suite; normal lint includes the repository-controlled sync handler. No new dependency or lockfile change.
- Files: `desktop-connector/dashboard.ps1`, `desktop-connector/README.md`, `lib/stock-handler.ts`, `supabase/functions/stockflow-sync/handler.ts`, `package.json`, `tests/connector-recovery.ps1`, `tests/unit/stock-handler.test.ts`, `tests/unit/stockflow-sync-handler.test.ts`, and this checkpoint.
- Fresh validation: 52 focused Stock/sync unit tests passed; all three connector suites passed through `pnpm test:connector`; recovery and control-status also passed on Windows PowerShell 5.1 with process-only execution-policy bypass. Typecheck, lint, 16 desktop/mobile Stock freshness/cache E2E cases and `git diff --check` passed. Regression failures were demonstrated before their fixes. No full application build, full test suite or database replay was rerun for this scoped batch; those remain release-checkpoint work.
- Largest remaining items, in dependency order: refresh the remote/local release mapping and stage the sync function plus queued customer-group gross-margin/catalog-version migrations; authenticated sync and pricing acceptance against that candidate; before/after cloud CPU/latency/payload and office billing-impact measurements; then actual staff-device offline/account-isolation acceptance and the five-working-day pilot. Restore-tested backup protection is still required before genuine business-data use; the earlier waiver covered disposable testing records only. No pilot-ready claim, paid infrastructure or Service expansion.

## Consolidation and private catalog staging — 30 September 2026

- Started clean at `0797310` on `feature/keyboard-order-entry`. Fresh fetch showed 0 behind / 18 ahead of `origin/main` before this checkpoint commit. No public deployment, push or merge. A smaller-model worker inspected existing release evidence; primary retained migration, security and integration decisions.
- Refreshed migration evidence: production has 84 migrations; all 83 previously mapped normalized hashes match. Customer-group gross margin is already deployed as `20260928113956`, matching local SQL exactly. Only `20260929180000_catalog_source_version.sql` remains pending in production. Updated the saved mapping and preflight assertions; do not reapply gross margin. Corrected diagnostic SQL whitespace normalization before comparison; no migration drift found.
- Fixed a demonstrated customer-search race: a delayed blur from a previous selection could close newly reopened suggestions. Cancel the old timer on refocus and clean it up on unmount. A deterministic desktop/mobile regression failed before the fix and passed afterward; customer-scoped history behavior remains intact.
- Updated the connector source assertion to require both authentication and payload rejection pause guards, matching the existing tested implementation.
- Final `pnpm run ci` passed: lint, typecheck, three PowerShell connector suites, 469 unit tests across 87 files, coverage gates (88.69% branches), production build, 24 access/Stock browser cases, 44 pricing/order-entry browser cases and production dependency audit (no known vulnerabilities). Fresh deployment-order PostgreSQL replay passed preservation, privilege, catalog compatibility, ACID, two-session concurrency and bulk rollback checks. `git diff --check` and evidence-only release preflight passed; preflight does not certify live release readiness.
- Applied the exact catalog migration only to existing private acceptance project `ayrvhemxzizpkfcycvip`, remote version `20260930090244`. Normalized hash matches local SQL: `2c8a3ce7a76fd89bafe06a7b7128536d33476f80ce17809b06cfb8e8c8d97e0b`. All three gateway definitions now use source catalog version with legacy fallback. Anonymous/authenticated execute remains denied; service-role execute remains restricted to public gateways, not the internal legacy gateway. The repository rollback-only SQL test passed against this candidate; member/order counts and snapshot/configuration fingerprints were unchanged afterward. Production business records and Tally were untouched.
- Read-only production baseline: project ACTIVE_HEALTHY; Site version 51/environment revision 4, Orders function 25, Sync function 4. At 08:54 UTC, extraction was 08:41:43.1196949Z and upload 08:41:44.321Z (about 13 minutes old). Snapshot JSON text measured 579,832 bytes versus 6,480 bytes for the core dashboard projection; these are SQL text sizes, not network compression, CPU or latency measurements. The bounded 08:00–09:00 UTC error query returned two PostgREST matches, insufficient to attribute cause or certify a full working day.
- Security advisors returned only INFO default-deny RLS/no-policy notices (36 production, 35 candidate); no broad grants or policies were added. See [Supabase advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). This does not replace authenticated acceptance or a complete security review.
- Files changed: `components/order-workspace.tsx`, `tests/pricing-browser/order-keyboard.spec.ts`, `supabase/migration-history-map.json`, `tests/unit/pricing-release-preflight.test.ts`, `tests/unit/stock-sync-health.test.ts`, and this checkpoint.
- Remaining release gates: verified matching Edge sync secrets and runtime candidate deployment; authenticated sync/pricing acceptance; production catalog migration rollout; measured CPU/p95 latency and office Tally impact; actual staff-device offline recovery/account isolation; five-working-day pilot; restore-tested backup before real business-data use. Sites returns redacted secret values, not evidence that they are absent or correctly matched; available Supabase tools do not expose Edge secret list/set operations. Do not deploy an unverified sync replacement. No paid services, reset credits, Service expansion or Tally writes used. Not yet pilot-ready.

### Seven-gate continuation — 30 September 2026

- Started clean at `befa5d7`. Fresh live checks now establish that the authenticated Edge Secrets dashboard has no custom secrets; secure owner configuration of matching read/upload keys is a concrete deployment blocker, not merely a redacted-tool limitation. The Windows user upload credential exists; its value was not displayed. Private candidate sign-in remains at browser security verification. No security bypass, credential change, public deployment or production business mutation was attempted.
- Latest production snapshot at 09:20:53 UTC was uploaded 09:11:59.823Z, extracted 09:11:58.7246899Z (579,832 JSON-text bytes). Sampled sessions: one active, five idle, one state unavailable. Available logs in the requested 29 September 10:00 UTC–30 September 10:00 UTC window show no `40001`/`42501` string matches and 27 timeout-related PostgREST error messages; their cause remains unresolved. This is not CPU/p95 or full-pilot evidence.
- Backup inspection found only a zero-byte archive; PostgreSQL tooling exists but the process has no database password. Archive verification and isolated restore remain blocked. Actual-device testing and five real working days of pilot observations cannot be replaced by fixtures or documentation.
- Recorded all seven gate statuses and next dependency in `docs/PRODUCTION-PILOT-2026-09.md`. Fresh evidence-only release preflight and `git diff --check` passed. No source change, full-suite rerun, paid service, reset credit, Service expansion or Tally access; prior full-suite results remain the preceding consolidation evidence, not newly executed tests.

### Secure sync cutover — 30 September 2026

- Owner saved both custom Edge secrets. Dashboard SHA-256 digests match the Windows user upload credential and the deployed legacy read constant; no secret values were printed, committed or rotated. The saved-name blocker is resolved.
- Fresh focused sync-handler suite: 32 tests passed. Current Supabase changelog and named-secret documentation were checked; no database upgrade, paid service or SDK redesign was performed.
- Deployed exact repository sources (`stockflow-sync/index.ts`, `stockflow-sync/handler.ts`, shared `stockflow-orders/request-gate.ts`) first as `stockflow-sync-candidate` version 1 in the existing production project. Custom-key authentication is retained with `verify_jwt=false`, as before. Candidate unauthenticated GET returned 401; authenticated malformed POST returned 400. Snapshot timestamp and SHA-256 fingerprint were unchanged before/after these probes.
- Replaced live `stockflow-sync`; returned deployment is ACTIVE version 7, bundle SHA-256 `d25d7989b55bbe0cfba982554969af9f49b27c384f18d98c9609a09f5d01385f`, identical to the candidate. Live invalid-upload/unauthenticated-read probes again returned 400/401. At 09:47:26 UTC (15:17 IST), snapshot remained the pre-cutover 09:42:17.934 UTC upload with source extraction 09:42:14.9546436Z and unchanged fingerprint. No valid synthetic upload or Tally request was made.
- Still required: observe a successful normal office upload after cutover and an authenticated projected dashboard read before claiming sync acceptance. Runtime rejection tests do not prove backend database success. Candidate endpoint remains deployed but idle; cleanup is outstanding. No app publication, production migration, order/pricing mutation, permission change or Tally write. Other release, device, pilot and backup gates remain open.

### Post-cutover office upload — 30 September 2026

- Read-only production check at 10:06:14 UTC (15:36 IST) confirms a normal upload at 09:57:23.716 UTC (15:27 IST), after the version-7 cutover, with extraction 09:57:22.7109449Z. No manual upload or Tally request was made. This confirms post-cutover snapshot persistence; it does not prove dashboard read acceptance or pricing acceptance.
- Opened production StockFlow and followed its sign-in link. Browser authentication remains at the OpenAI security-verification page; staff-login dashboard and pricing checks require the owner to finish that normal sign-in. No bypass, synthetic session or secret disclosure. Public application publication, pending catalog migration, performance percentiles, staff-device acceptance, five-working-day pilot and restore rehearsal remain unverified.
- No source changes or test-suite rerun in this read-only acceptance step. Updated this checkpoint and passed `git diff --check`.

### Signed-in production read acceptance — 30 September 2026

- Owner completed sign-in. The production Stock dashboard rendered current reorder rows and `Last Tally sync: 30 Sep, 03:42 PM` without a visible load/error banner. Combined with the observed post-cutover office upload, this confirms the normal signed-in stock read path; it does not separately measure projected response bytes or CPU.
- Production Pricing loaded its restricted overview and approval inbox (zero pending proposals). Base/default pricing displayed its governed form with approval disabled until inputs are supplied. No price, policy or business transaction was changed. Purchase-cost review was opened but no resolved product/customer evidence was inspected; full pricing mutation and two-role acceptance remain outstanding.
- Production Orders loaded its handoff queues, search/status controls, `+ Order` button and the empty awaiting-confirmation inbox. This is a read smoke check, not a timed p95 measurement or a full order lifecycle acceptance.
- Commercial release blocker remains visible: policy `bootstrap-review-only-v1` shows minimum gross margin 99.99%. Do not treat this bootstrap value as an approved operational margin or silently replace it with guessed customer/group values. The owner previously specified 25% for general items and variable reagent group/customer gross margins; the actual effective policy and scoped approvals still require governed verification/configuration before genuine use.
- No new code/tests, public app release, migration, order/pricing mutation, Tally operation or device/pilot/backup claim. Only this acceptance checkpoint changed; `git diff --check` passed.

### General gross-margin policy activation — 30 September 2026

- Through the signed-in production Pricing administration flow, activated `general-gross-margin-25-v1` effective `2026-09-30`, using the owner's approved 25% general-item gross-margin baseline. This is a default review guardrail, not a universal reagent margin or a bulk selling-price change. Existing customer/group-specific approvals retain their separate governed resolution; missing approvals still require review.
- Preserved existing controls: override approval threshold 0%, round-up increment ₹1, rounding version `ceil-rupee-v1`, target margin unset. Supplied a management reason recording the approved general baseline and preservation of reagent decisions/cost-increase review. No customer/product/group rates were invented or changed, and no Tally operation occurred.
- Application success was followed by an authoritative policy-list refresh showing 25%, the new policy version and unchanged approval/rounding controls. Expanded history shows both versions: bootstrap `2026-04-01` through `2026-09-29`, replacement from `2026-09-30`. No historical policy was overwritten or deleted. No blind retry or direct database write was used.
- This clears the bootstrap minimum-margin configuration blocker only. It does not establish each customer's reagent margins, full pricing acceptance, backup recovery, staff-device acceptance or pilot completion. Only this checkpoint changed in source control; no application source change, migration or publication.

### Six-task candidate preparation batch — 30 September 2026

- Started clean at `ce58e57`. Reused private Site and its clean `stockflow-acceptance` checkout; retained custom audience and candidate-specific hosting manifest. Integrated current implementation through merge `7c41ba83b6f71641a4f8d0c2af35f8d566e3e2e8`, without merging main or changing public StockFlow.
- Completed candidate source integration, frozen-lockfile dependency installation, typecheck, 21 Stock handler regression tests, affected-file lint/whitespace checks and a fresh production-format build. No complete CI rerun; prior full consolidation evidence is separate.
- Publishing preparation exposed Windows launch incompatibility for `.cmd` commands, corrected by invoking the existing package-manager Node entrypoint. Local build then passed; bundled packaging could not start Bash because it is unavailable. Did not alter plugin scripts or bypass archive checks. The supported source-only remote-build fallback saved candidate version 4 after the workflow pushed the exact source.
- Candidate version ID `appgprj_6aae9b06bf4081919a1f08183fb02465~appgver_2c53841e550081918c8a7eea95213915`; deployment `appgdep_6abcf6d33d14819189e3f88c4d0e8005`. Last checked status building, not successful. Do not claim version 4 live until a terminal status confirms it. Runtime environment revision needs confirmation in the successful result.
- Private backend function inventory contains only Orders version 2, no `stockflow-sync`. Therefore configured-endpoint source fix is necessary but insufficient for candidate Stock acceptance. A separately credentialed candidate sync endpoint/synthetic snapshot and current Orders action compatibility must be established before integrated acceptance. No production credentials/data were copied, no broad grants or authentication bypass, no Tally or production mutation.
- Authenticated latest-candidate checks cannot proceed until deployment completes and backend prerequisites are resolved. Six requested release tasks are not all closed: local preparation is complete, publication is pending and backend setup remains blocked. Current source fix and all previous pricing controls retained.

### Candidate Stock backend isolation fix — 30 September 2026

- Demonstrated source defect: Stock route hard-coded the production sync URL while candidate runtime `SUPABASE_URL` points to the isolated acceptance project. Orders/Pricing already use that configuration. Candidate's private read credential was therefore sent to the wrong project, consistent with its unauthorized Stock response.
- Stock now resolves its server-only configured backend per request, with no hard-coded production fallback. Missing configuration fails closed after existing authentication/membership checks. In-flight coalescing is scoped to resolved endpoint/view and credential, preventing sharing across backend changes. Sanitization, deadlines and private response headers remain intact.
- Added configured-backend/missing-configuration regression. Stock handler suite passed 21 tests; typecheck and affected-file lint passed. Initial typecheck caught an incorrectly inferred zero-argument test mock; corrected its fetch type and reran successfully. No database migration, credential rotation, production/Tally operation or new architecture.
- Source fix is not yet deployed to the private candidate. Candidate backend sync availability/credential match and signed-in Stock read still require verification after release preparation. Latest-source candidate publication and remaining pricing acceptance remain open; not pilot-ready.

### Five candidate acceptance checks — 30 September 2026

- Starting HEAD `e2cd264`, clean working tree. Used existing private acceptance Site, not a replacement. Checked deployment identity/access, administrator sign-in, Stock read, customer price book and base-price workspace as one batch. No business mutation, Tally operation or publication.
- Native Sites metadata: production remains ACTIVE version 51; private acceptance ACTIVE version 3, saved source `20346f6896013d0e43251eccf4cc632e71090522`. Custom access retains Anil as owner and Nikitesh as external viewer. The candidate is an older saved source: successful checks here do not certify current local source or the latest customer/group UI.
- Completed normal ChatGPT sign-in as `anil.mahindrakar22@gmail.com` using its existing account and approved consent. Restricted Pricing loaded, including synthetic `acceptance-v1` policy (20% minimum). This candidate policy is intentionally separate from production's approved 25% general baseline; no policy was changed.
- Candidate Stock displays `Unauthorized. Connect once to save the first offline snapshot.` This is a demonstrated candidate acceptance failure, not evidence that production Stock failed. Diagnose candidate runtime credential/backend wiring before certifying integrated acceptance; do not copy production credentials blindly or loosen access checks.
- Customer search resolved synthetic Acceptance Laboratory. Its price-book table displayed two purchased items with separate historical/current/recommended rates, GP%, review buttons, exception filter and page controls. Both rows are fixed/protected; summary reports zero eligible items and bulk approval remains disabled. This verifies rendering and protected-row behavior only, not eligible bulk mutation, multiple pages, cost-increase handling or second-role authorization.
- Base/default workspace rendered product selection, price/date/reason fields, unavailable evidence labels and a disabled approval button before valid inputs. No synthetic price was submitted. Remaining acceptance needs refreshed candidate source, candidate Stock wiring, eligible synthetic mutation/recovery cases and Accounts/noncommercial-role checks. Local fixture tests from the earlier batch are not substitutes.
- Checkpoint only; no suite/build rerun. `git diff --check` before commit. Candidate authentication blocker is cleared for Anil, but release/pilot readiness remains false.

### Bounded timeout investigation — 30 September 2026

- Read-only log investigation for 09:30–10:30 UTC. Discovered actual flattened attribute names before aggregating: `request.method`, `request.path`/`request.pathname`, `response.status_code`, `execution_time_ms`. Initial unqualified status/method aggregation returned empty fields; no result was interpreted as a successful request without correcting that query. No request headers, credentials, query strings or customer data were retrieved.
- Returned function logs: 20 Orders POST requests, all HTTP 200, maximum execution 2,490 ms; four normal sync uploads, all HTTP 200, maximum 5,453 ms; three sync reads, all HTTP 200, maximum 1,312 ms. Live/candidate sync each also recorded one 400 POST and one 401 GET, consistent with the deliberate rejection probes in the preceding cutover. These counts describe returned logs, not guaranteed exhaustive traffic, browser latency or p95.
- Returned REST logs for catalog, customer, order list/summary, pricing, users and snapshot reads/uploads all show HTTP 200. Eight PostgREST timeout-manager messages in the same window carry only infrastructure metadata, without request identifiers for attribution. Two PgBouncer timeout messages describe idle connection expiry. No demonstrable failed StockFlow request or application cause established; do not label the generic messages harmless or claim the issue fixed.
- No code/configuration changes, additional probes, database writes, Tally operations or test-suite rerun. Upload maximum remains a performance signal needing representative measurements; authenticated candidate acceptance and pending catalog release remain next dependencies. Checkpoint-only change; whitespace validation before commit.

### Five live release checks — 30 September 2026

- Started clean at `f5ada5e`. Checked live migration history, sync freshness, gateway permissions, timeout diagnostics and connection activity; no application or production changes.
- Live history still lists 84 migrations, ending with gross-margin migration `20260928113956`, hash `e07bf146a9a884dc27c78c47aba196c0af0669eded04046d0f8580162bd1b625`. Catalog-source migration remains absent. Retrieved current hashes; no new automated all-hash comparison or saved-map rewrite.
- At 10:35:19 UTC (16:05 IST), latest upload was 10:27:39.574 UTC and extraction 10:27:38.3842820Z. Snapshot JSON text is 579,832 bytes. Normal office uploads continue after cutover; this is not wire-size, latency or CPU evidence. Two diagnostic queries used incorrect schema names and were corrected against the repository; no writes occurred.
- Catalog/list/internal order gateways deny anon/authenticated execution. Service role can execute catalog/list, not the internal before-auto-pricing gateway. This verifies those grants, not complete pricing role acceptance.
- Logs from 29 September 10:30 UTC to 30 September 10:30 UTC contain 34 PostgREST timeout messages (Warp timeout-manager thread termination). Two separate PgBouncer messages describe idle server connection expiry, not demonstrated order failures. No `40001`/`42501` text matches in the returned window. Affected requests and timeout cause remain unknown; do not infer sustained CPU health or a recurrence of the former retry incident.
- Connection sample: one active connection (the diagnostic), five idle, one null state, no other active query at that instant. This is not sustained resource or p95 measurement.
- Fresh evidence-only preflight exited 0, correctly reporting `releaseReady=false` with catalog migration and authenticated isolated-candidate acceptance pending. No full suite/build rerun, merge, publication, Tally operation or pricing mutation. Staff-device acceptance, measured performance, working-day pilot and restore rehearsal remain outstanding. `git diff --check` passed before commit.

### Three-check pricing validation batch — 30 September 2026

- Started clean at `5b9159a`. Completed three verification slices as one batch: customer/group gross-margin behavior, cost-increase exception behavior and release-preflight assessment. Used existing synthetic fixtures and isolated local PostgreSQL, not real customer margin approvals or live pricing mutations.
- Group checks passed in deployment-order replay: 40% gross margin with mixed product costs produces separate ₹100/₹170 rates rather than one shared group rate; fixed contracts and individual decisions are excluded. Accounts/Sales restrictions, stale preview rejection, idempotent recovery, effective dates, immutable decisions/audit, second-item failure rollback and stable approved rate behavior passed. Cost/evidence changes reopen review rather than silently altering the saved rate.
- Cost checks passed: unchanged comparable cost retains the last genuine customer rate when the margin guardrail passes; increases pause pricing, including fixed agreements, and are excluded from routine bulk approval. Governed administrator review, billing snapshot safety and rollback/concurrency remain covered by the repository database tests.
- Fresh commands/results: focused Vitest (`customer-first-pricing-correction`, `governed-order-pricing`, `pricing-engine`, `pricing-api-auth`) passed 37 tests; `pnpm test:pricing:deployment` exited 0, including complete migration replay, snapshot-import privileges, catalog compatibility, byte-identical order preservation, ACID and two-session/bulk rollback checks; price-book Playwright file passed 30 desktop/mobile fixture cases covering customer/base/impact save recovery, policy/contract retry safety, account-isolated receipts, authorization, bulk preview and hash-bound group approval. `git diff --check` passed. No source changes, full CI/build rerun or new defect demonstrated.
- Evidence-only release preflight executed successfully but correctly reports `releaseReady=false` and production catalog-source migration pending in the saved map. Fresh database replay does not refresh live migration history or complete authenticated isolated-candidate acceptance. Actual staff devices, performance/resource measurements, timeout investigation, five-working-day pilot and restore-tested backup are still release/real-use gaps. No merge, public app publication, new migration, Tally operation, paid service or reset credit.
