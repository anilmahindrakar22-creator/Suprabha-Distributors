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
