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
