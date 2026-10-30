# Wallet quick entry (release W2): design

**Date:** 30 Oct 2026. **Author:** Claude. **Builder:** Codex.

## Decision it drives
Market screens are empty until labs have wallet estimates, and entering them one sheet at a time is slow. Quick entry lets management type monthly estimates for many labs in one pass. **No new SQL:** each row saves through the existing `record_wallet_snapshot` (same validation, lock, audit and idempotency).

## Screen: Wallet → "Quick entry" (administrator and management; a quiet link next to "Targets")
- **Shared fields at the top, one line each:**
  - Source (required, 3–500, for example "Owner estimate, Oct 2026");
  - Method (default `manager_estimate`);
  - Confidence (default `medium`);
  - As of (default today IST, ≤ today);
  - Note (default "Quick entry").
- **List:** the same paged read as the Wallet "No estimate" view by default (50 per page), with a search box and a toggle "Include labs with an estimate".
- **Row:** lab · city · current estimate (or "—") · an input "₹ / month" (`inputMode="decimal"`, converted with `rupeesToPaise`).
  - When the typed value is **lower** than the current estimate, an inline required "Reason for lowering" field appears.
- **Save:**
  - a single primary **"Save entered rows (n)"** saves only rows with a value, **one call per row**, sequentially, each with its own `requestId` and `expectedCurrentSnapshotId` (the row's current snapshot id or null);
  - **each row shows its status:** ✓ Saved / ⚠ message. 409 → "Changed by someone else, reload this row". The idempotent-retry rule applies per row.
  - rows that saved clear their input; failed rows keep theirs.
- **Leaving with unsaved values:** mark the form `data-unsaved="true"` while any value is typed (the role-refresh check respects this).
- **Declutter rule:** no extra totals; one muted line after saving, "Saved n of m".
- **Phone at 375 px:** the row stacks as lab/city above input; no horizontal scroll.

## Acceptance
**Browser** (`tests/pricing-browser/wallet-quick-entry.spec.ts`, mocked):
- the shared fields are required (Source);
- typing in 3 rows → 3 POSTs in order, with exact paise, the shared fields and the expected snapshot ids;
- a lowered value shows the reason field and sends `loweredReason`;
- a 409 on row 2 → row 2 shows its message, rows 1 and 3 save;
- a network failure on a row → retry keeps the same `requestId`;
- not visible to sales;
- no horizontal scroll at 375.

**Unit:** the helpers that build each row command.
