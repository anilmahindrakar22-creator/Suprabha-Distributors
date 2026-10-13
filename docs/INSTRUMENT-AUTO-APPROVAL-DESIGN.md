# Automatic approval for short-payback placements (D-15)

**Owner decision (13 Oct 2026):** placements whose expected payback is within `attractive_months` (24) are approved automatically.
**Ships with:** `claude/admin-tier` (D-04) and the Economics production cutover. Built on a branch off `claude/admin-tier`; no data restructure.
**Author:** Claude (design).

## Rule
A proposed **placement** (never a group; groups stay manual) is approved automatically when **all** hold, evaluated on the server inside the command that made it eligible:
1. approval is `proposed` and the target is open (`effective_to` null);
2. `stockflow_economic_approval_preview` returns `within_limit` (evidence current, approved baseline with positive GP);
3. **net investment > 0** (capital recorded). A placement with no capital is not "attractive", it's incomplete; it stays manual;
4. expected payback ≤ the `attractive_months` of the **same policy version** the preview used.

25–36 months stays with Management, 37–48 with an Administrator (D-04), > 48 blocked. Only an Administrator can change the bands (D-04).

**Switch:** `automatic_approval` on the policy versions (latest non-null value, default on), the same pattern as `automatic_purchase_cost`. Off restores manual-only approval. No screen control yet, so only the integration chat can switch it.
- **Switch-off procedure:** a switch row is a new policy version, and the preview reads its bands from the latest version. A bare `insert … (actor,reason,automatic_approval) values(…,false)` would silently reset the bands to the 24/36/48 defaults. Always copy the current thresholds:
  ```sql
  insert into private.stockflow_economic_policy_versions(attractive_months,review_months,exception_months,forecast_window_months,watch_revenue_percent,critical_revenue_percent,actor,reason,automatic_approval)
  select attractive_months,review_months,exception_months,forecast_window_months,watch_revenue_percent,critical_revenue_percent,'<administrator email>','<reason>',false
  from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
  ```
  (The same caveat applies to the existing `automatic_purchase_cost` switch.)

**Built:** branch `claude/auto-approval` (`af6e783`), migration `20261013130000_instrument_auto_approval.sql`.

## When it is checked
At the end of these target-scoped commands, after the existing rebuild, in the same transaction:
`set_expectation`, `record_capital`, `review_acquisition`, `link_instrument_billing`. Only Administrator and Management can run these (the gateway's existing role gate), so auto-approval can't be triggered by a role that can't approve.
- **Never** from `rebuild` or any bulk path: an approval must trace to one person's action on that target.
- If the rule doesn't hold, nothing happens and the command succeeds as today. Auto-approval can never make a command fail.
- Existing proposed placements are **not** bulk-approved by the migration. They approve the next time one of the commands above touches them, or a manager approves them manually as today.

## What it records (same evidence as a manual approval)
- `approval='approved'`, `version+1`.
- An audit row `action='approve_target'`, `entity_id=target`, actor = the person whose command triggered it, payload:
  `decision:'approved'`, `automatic:true`, `triggeredBy:<action>`, `reason:'Automatic: payback N months within the 24-month limit (policy <id>)'`, and the same frozen fields manual approval stores: `approvalExpectationId`, `approvalPolicyId`, `approvedNetInvestmentPaise`, `expectedPaybackMonths`, `approvalPreview`.
  This matters: `stockflow_economic_approved_expectation` reads the frozen baseline from exactly this audit row.
- A second rebuild runs only when an approval happened (approval changes which results the target owns).
- Command result gains `autoApproved: {paybackMonths, policyId}`. Idempotent replay returns the stored result unchanged.
- **No change to the workspace read** (keeps summary/full parity).

## Screen
- After a command whose result has `autoApproved`, the Economics screen refreshes and shows: "Approved automatically: payback N months (within 24)."
- Manual approval of a within-24 placement (for example, no capital yet) still works.
- There is no un-approve; the remedy is `close_target` (as today).

## Concurrency
The economics gateway already serialises every command with one advisory lock and checks `expectedVersion`; auto-approval bumps the version, so a stale screen gets PT409 and refreshes.

## Acceptance checks (written first)
1. Placement reaches ≤ 24 months on `record_capital` → approved automatically; audit payload's frozen fields equal the preview at that moment; `approved_expectation` returns the baseline.
2. Same on `set_expectation` (capital first, baseline second).
3. 25–36 months → stays `proposed`; Management manual approval works. 37–48 → stays `proposed`; Administrator only. > 48 → `limit_exceeded`.
4. Zero net investment → stays `proposed`.
5. `rebuild` never approves anything.
6. Replay of the triggering command returns the identical stored result, with no second audit row.
7. Migration leaves every existing target's `approval` and `version` unchanged.
8. A stale `approve_target` after auto-approval → PT409 ("Target already decided").
