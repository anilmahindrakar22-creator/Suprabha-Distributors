# Design: wallet split, routine and special tests

**Date:** 2 Nov 2026. **Author:** Claude. **Builder:** Codex. **Train:** `claude/train-20261120` (22 Nov).
**Owner:** "the tests per day is only for routine and special parameters is hard to tell" (1 Nov). On 2 Nov the owner said "continue" to the proposed reading of the two-price split: routine price and special price.

## Decision it drives
A lab's wallet is underestimated when it is built only from routine tests per day at one routine price. Special tests (hormones, serology panels, culture) are few but cost far more each. Adding them gives a truer 80% gap and Focus band, so management chase the labs where the money really is.

## Rule
The **Test volume** wallet becomes:

> routine tests a day × working days × routine ₹ per test **+** special tests a month × special ₹ per test

- Routine is required (as today). Special is optional, as a pair: both numbers or neither.
- Specials are counted **per month**, because labs think of them that way ("about 100 thyroid profiles a month").
- Existing snapshots are unchanged: special is empty, and the total stays as it is.

## Data
Migration `20261116120000_wallet_special_tests.sql`. It adds two nullable columns to `private.stockflow_wallet_snapshots`:
- `special_tests_per_month integer check (special_tests_per_month between 1 and 1000000)`;
- `paise_per_special_test bigint check (paise_per_special_test between 1 and 100000000)`.

It drops `stockflow_wallet_snapshots_test_volume_rule` and re-adds it with the same name:
- all five fields are null; **or**
- the routine three are set, the special two are both null or both set, and
  `monthly_wallet_paise = tests_per_day × working_days_per_month × paise_per_test + coalesce(special_tests_per_month × paise_per_special_test, 0)`.

Special values without routine values are rejected.

## Gateway (`record_wallet_snapshot`)
- `testVolume` gains optional `specialTestsPerMonth` and `paisePerSpecialTest` (integers, both or neither).
- The total must equal the new formula. Otherwise it raises `22023 'Wallet total must equal routine plus special tests × price'`.
- Everything else is unchanged: the method rules, the lock, 409, the lowering reason, divisions, audit and idempotency.
- The account read returns both fields inside `testVolume`, or null when they are empty.
- **Patch, don't copy:** patch `20261102190000`'s seams in place with the anchor pattern, each anchor matching exactly once.

## Screen (`components/wallet-workspace.tsx`, management only as today)
- In Test volume, under the three routine inputs, add a quiet link **"+ Special tests"**. It opens two inputs:
  - **Special tests a month (approx)**
  - **Average ₹ per special test**
- Removing the specials (a "Remove" link) clears both fields.
- The read-only total line becomes: "≈ ₹82,000 / month (80 × 26 × ₹25 + 100 × ₹300)". With no specials it is unchanged.
- SnapshotDetails adds "+ 100 special/month × ₹300" when the specials are present.
- The "How to estimate" guide gets one line: "Count specials (hormones, serology panels, culture) per month at their own price."
- Quick entry is unchanged: routine only. Specials are entered per lab.
- Visual restraint: no new colours; small muted text for the formula.

## Acceptance
- **SQL** `supabase/tests/wallet_special_tests.sql`, in the replay after `wallet_test_volume.sql`:
  - **WS1:** routine plus special with the right total saves, and the read returns all five values.
  - **WS2:** a wrong total raises 22023, and no row is saved.
  - **WS3:** only one special field sent raises 22023.
  - **WS4:** special fields sent without test_volume (for example manager_estimate) raise 22023.
  - **WS5:** a direct insert of special values without routine values is rejected by the table check (inside a savepoint).
  - **WS6:** routine-only saves exactly as before, and `wallet_test_volume.sql` still passes.
- **Browser** `tests/pricing-browser/wallet.spec.ts`:
  - "+ Special tests" opens two inputs. 80 × 26 × ₹25 plus 100 × ₹300 posts `monthlyWalletPaise 8200000` and the five-field `testVolume`.
  - Remove clears the special fields and posts routine only.
  - No horizontal scroll at 375 px.
- **Unit:** the calculation helper `lib/wallet-test-volume.ts` with and without specials, rejecting only one of the pair.

## Not in this package
- Specials in Quick entry.
- Prefill of specials from the lab's ticked special panels. Add this later if management ask for it.
- Prices per test area (one special price per lab is enough to start).
