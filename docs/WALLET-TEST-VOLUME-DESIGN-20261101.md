# Design: Tests per day and the wallet calculator

**Date:** 1 Nov 2026. **Author:** Claude. **Builder:** Codex. **Train:** `claude/train-20261113`, frozen Friday 13 Nov and released Sunday 15 Nov.

**Owner request (1 Nov):** "Build it into that. Also can we put estimate for no of tests per day approx". "It" is the visit checklist: how to estimate a lab's monthly reagent spend when we can't see other vendors' sales.

## Decision it drives
Wallet share needs each lab's total monthly reagent spend, across all vendors. Nobody can see that spend directly. Two facts are easy to collect at a visit:
1. **Approximate tests per day.** The lab knows this, or sales can judge it from the samples, staff and analyser they see.
2. **What the lab says it spends a month on reagents,** if it will say.

**From these, the wallet estimate is:** tests per day × working days a month × average ₹ per test.

Our own sales come from Tally and are exact. Only the size of the wallet is estimated, and the screen labels it as an estimate.

## Who sees what
- **Sales and management** can record **Lab size** on the customer sheet: tests per day, and optionally the lab's stated monthly spend.
  - Tests per day is a measure of size, not a wallet figure, so sales see it.
  - **The stated monthly spend is shown back only to administrators and management.** It uses the sheet's existing `financial` flag. Sales enter it, but no role without wallet access gets it back.
- **The wallet estimate stays administrator and management only,** as today (`stockflow_wallet_gateway`). Operations never sees wallet or purchase figures.

## Package P1: Wallet test-volume calculator (management)

### Data
New migration `20261102190000_wallet_test_volume.sql`. It adds three nullable columns to `private.stockflow_wallet_snapshots`. The table stays immutable, and adding columns doesn't change that.
- `tests_per_day integer check (tests_per_day between 1 and 100000)`
- `working_days_per_month integer check (working_days_per_month between 1 and 31)`
- `paise_per_test bigint check (paise_per_test between 1 and 100000000)`
- **Table check:** either all three are null, or all three are set **and** `monthly_wallet_paise = tests_per_day * working_days_per_month * paise_per_test`.

### Gateway (`record_wallet_snapshot`)
- **Optional `testVolume`:** `{testsPerDay, workingDaysPerMonth, paisePerTest}`, all integers.
- **When `method = 'test_volume'`, `testVolume` is required,** and `monthlyWalletPaise` must equal the product. Otherwise `22023 'Wallet total must equal tests per day × working days × price per test'`.
- **When the method is anything else, `testVolume` must be absent or null.**
- The read paths (`stockflow_wallet_account_read`, and the current snapshot in the workspace if it carries the method) return `testVolume` or null.
- **Everything else is unchanged:** lock, 409, lowering reason, divisions, audit, idempotency.

### UI: the per-lab estimate form (`components/wallet-workspace.tsx`)
- **When Method is "Test volume", three inputs appear above the total:**
  - Tests per day (approx)
  - Working days a month (default 26)
  - Average ₹ per test
- **The total is calculated:** read-only, with one muted line "≈ ₹52,000 / month (80 × 26 × ₹25)". Changing the method back makes the total editable again.
- **Prefill from the latest Lab size report (P2), when there is one:**
  - one muted line, for example "From visit: about 80 tests/day · Ravi · 3 Nov", which fills the tests box;
  - if the lab stated a spend, a second line "Lab said ₹50,000/month · Use", which switches the method to Customer stated and fills the total.
  - Nothing is filled without that tap, except the tests box in test-volume mode.
- **A collapsed "How to estimate" link (closed by default) holds these steps, in this order of reliability:**
  1. Ask the lab what it spends a month on reagents (Customer stated).
  2. Ask how many tests a day it runs, or judge from samples, staff and the analyser, then use Test volume.
  3. Your own judgement of its size (Manager estimate). Improve it at the next visit.

  It also carries one line: "If our sales are above the estimate, the estimate is too low."
- **SnapshotDetails** shows "80 tests/day × 26 days × ₹25" under the method when `testVolume` is present.

### UI: Quick entry (`lib/wallet-quick-entry.ts` and its component)
- When the shared Method is Test volume, the shared fields gain **Working days (26)** and **Average ₹ per test**.
- Each row's input becomes **Tests/day**, with a muted "≈ ₹X/month" beside it. Each row is sent with `testVolume` and the calculated total.
- The lowering-reason rule applies to the calculated total.

### Acceptance
- **SQL test `supabase/tests/wallet_test_volume.sql`, run in the local replay:**
  - **TV1:** a test_volume snapshot with matching inputs saves, and the account read returns `testVolume`.
  - **TV2:** a mismatched total raises 22023, with no row.
  - **TV3:** test_volume without inputs raises 22023.
  - **TV4:** `testVolume` sent with manager_estimate raises 22023.
  - **TV5:** the table check rejects a direct insert of partial inputs (as postgres, inside a savepoint).
  - **TV6:** existing snapshots read `testVolume: null`, and the existing wallet tests pass unchanged.
- **Browser** (mocked; extend `tests/pricing-browser/wallet.spec.ts` and `wallet-quick-entry.spec.ts`):
  - Test volume shows the three inputs and a read-only total. 80 × 26 × ₹25 posts `monthlyWalletPaise 5200000` and `testVolume {80, 26, 2500}`.
  - Switching to Manager estimate hides the inputs and sends no `testVolume`.
  - In quick entry with Test volume, 3 rows post their calculated totals.
  - "How to estimate" is collapsed by default.
  - No horizontal scroll at 375 px.
- **Unit:** the calculation helper with integer paise, plus rejection of 0, negatives and non-integers.

## Package P2: Lab size on the customer sheet (sales and management)

### Data
New migration `20261102191000_lab_size_reports.sql`. It adds an immutable table `private.stockflow_lab_size_reports`:
- `id`, `customer_id` (FK), `tests_per_day integer not null check 1..100000`, `stated_monthly_spend_paise bigint null check 0..9e15`;
- `basis text not null check in ('lab_said','observed')`;
- `note text null` (3–500);
- `reported_by`, `reported_at`.
- Replay goes through the existing command path (see Order and ownership).

It has RLS on, all revoked, the no-delete and immutable triggers, and an index on `(customer_id, reported_at desc)`.

### Gateway
A new action `record_lab_size` on the existing accounts gateway used by the sheet (`/api/accounts` POST, as `check_in` is):
- **Roles:** sales, administrator and management.
  - Operations passes the gateway's member check, so the action needs its own role check, which refuses operations with PT403.
- **Replay:** the same `idempotencyKey` returns the original result, with one row.
- **Rate limit:** none needed, because the table is append-only and small.

The latest report joins the customer-sheet read (`/api/customer-map?customer=`) as `labSize`:
- `{testsPerDay, basis, reportedBy, reportedOn}`;
- `statedMonthlySpendPaise` **only when the actor is administrator or management.** Enforce this in SQL, not just the UI.

The wallet account read (P1) also returns the latest `labSize`, for the prefill.

### UI: the customer sheet (`components/customer-sheet.tsx`)
- **A compact "Lab size" section after Instruments:** "About 80 tests/day · Lab said · 3 Nov".
  - When there is no report, a quiet button: "Add tests/day".
- **The form, inline and short:**
  - Tests per day (required, a number);
  - "How do you know?": Lab said / My estimate;
  - Lab's monthly reagent spend (optional, ₹), with the hint "only if they tell you";
  - Note (optional).
  - Save is a single primary button. Use the same retry and idempotency pattern as check-in.
- **One muted prompt line above the form:** "Ask: how many tests a day? What do you spend on reagents a month?"
- **Phone at 375 px:** the form stacks, with no horizontal scroll.
- Visual restraint: no new colours, and no figures beyond tests/day for sales.

### Acceptance
- **SQL test `supabase/tests/lab_size_reports.sql`:**
  - **LS1:** sales records a report, and the sheet read returns `labSize` without `statedMonthlySpendPaise` for sales but with it for management.
  - **LS2:** operations is refused with PT403.
  - **LS3:** a replayed requestId returns the same row, and only one row exists.
  - **LS4:** invalid tests (0, or over 100000) raise 22023.
  - **LS5:** the newest report wins on the sheet.
  - **LS6:** update and delete are refused.
- **Browser** (mocked):
  - The sheet shows "Add tests/day" when there's no report.
  - Saving posts `record_lab_size` with the right fields.
  - The spend is hidden for a sales session.
  - No horizontal scroll at 375 px.

## Order and ownership
- **The packages run in series: P1, then P2.**
  - Both register migrations in the same four files: the replay list, the preflight list, its unit test and the history map.
  - Both touch the wallet account read.
- **P2 includes the wallet prefill.** It adds `labSize` to the wallet account read and puts the prefill lines in `wallet-workspace.tsx`, on top of P1.
- **Every function changed is patched in place** with the `pg_get_functiondef` anchor pattern used in `20261102160000_visit_checkins.sql`. Each anchor must match exactly once, or the migration raises. A copied body is never used. This keeps the later diagnosis, actions and check-in changes.
  - `stockflow_wallet_gateway` and `stockflow_wallet_account_read` were defined in `20261030130000_wallet_v2.sql` and not redefined since. `20261031090000_wallet_diagnosis.sql` calls the read and must keep working.
  - `stockflow_accounts_gateway` and `stockflow_customer_map_gateway` were last changed in `20261102160000_visit_checkins.sql`.
- **Transport:**
  - `record_lab_size` must be added to `accountActions` in `supabase/functions/stockflow-orders/index.ts` and to `lib/account-types.ts`.
  - `testVolume` must be added to `lib/wallet-types.ts` (`parseWalletCommand`) and `WalletSnapshot`.
  - **An edge redeploy of `stockflow-orders` is needed with this change,** and the handover must say so.
- **Replay:** `record_lab_size` uses the accounts gateway's existing `idempotencyKey` command path (`CommandBase`, `private.begin_stockflow_command`), not a separate `request_id` column.
- **Both migrations are registered** like `20261102180000`: in the replay list, the preflight list and its unit test, and the history map as `not_deployed`. That brings train2 to **12 not-deployed migrations**.
- **Claude reviews the design** of both packages on phone and desktop before handover.
