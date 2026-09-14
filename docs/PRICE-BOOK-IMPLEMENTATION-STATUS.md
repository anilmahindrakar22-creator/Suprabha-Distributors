# Price book implementation checkpoint — 14 September 2026

Branch: feature/customer-pricing-engine. Pricing checkpoint committed as f0d167f; unpublished.
Approved requirements: CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md.
Validation is batched to conserve usage; this checkpoint records remaining release work explicitly.

## Usage-reserve stop — 14 September 2026

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
- Next ticket: simultaneous pricing approvals/bulk edits and associated rollback validation.

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

- Authenticated browser acceptance for customer selection, row approval, base price save,
  bulk review, mobile layout, keyboard use, paging, and errors. Fixture tests now cover
  customer selection, tabs, row submission, Accounts restrictions and order pricing options.
- Real two-session concurrency and injected-failure rollback tests for the new bulk mutations.
  Existing new tests exercise stale optimistic writes sequentially.
- Additional billing-boundary regression cases for agreement/policy/book changes; the new
  generic evidence-hash gate covers those sources but the transition regression changes cost.
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
- Still uncommitted and unpublished; remaining release blockers above continue to apply.
