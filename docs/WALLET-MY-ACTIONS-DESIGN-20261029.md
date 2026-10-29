# My actions (Market rework, fifth slice): design

**Date:** 29 Oct 2026. **Author:** Claude. **Builder:** Codex.
**Owner request:** "continue build until sunday". **Train:** with the actions slice.

## 1. Decision it drives
**What have I been asked to do, for which lab, and by when?**

Management assigns actions (`docs/WALLET-ACTIONS-DESIGN-20261029.md`) to members, including sales staff, who can't open Wallet. This slice shows each person **only their own open actions** and lets them close one with a result. Management keeps seeing everything in Wallet → Actions due.

**What the owner sees:** customer, city, action type, detail, due date and overdue state. **Never shown:** wallet estimates, sales, share, gap, the expected gain, constraint facts and evidence, and competitor or our prices. Only the constraint *category label* is shown ("Why: Price"), so the visit has context. Operations never sees purchase rates, and nothing here carries a rate.

## 2. Data
No new tables. Closing reuses `private.stockflow_commercial_action_results`.

## 3. Gateway (new migration `20261031130000_wallet_my_actions.sql`)
**`public.stockflow_my_actions_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)`**: the same key check, idempotency, audit and grants as `stockflow_action_gateway`.
- **Roles:** administrator, management, sales and operations, as active members. Everyone else gets PT403.
- **`get_my_actions {page}`:**
  - open actions where `owner_email = lower(btrim(actor))`, ordered by `due_on`, then customer name, then id, 50 per page;
  - each row: `actionId`, `customerId`, `customerName`, `city`, `actionType`, `detail`, `dueOn`, `overdue` (due < today IST), `constraintCategory` (the opportunity's current constraint category, or null);
  - plus `total` and `overdueCount`.
  - Put the logic in `private.stockflow_my_actions_read(p_actor text, p_today date, p_page int)`.
- **`close_my_action {requestId, actionId, result ('done'|'dropped'), note (3–500)}`:**
  - take the same `opportunity-action:` advisory lock as `stockflow_action_gateway`;
  - 22023 if the action is missing **or not owned by the actor** (one message, "Action not found", so nobody can probe other people's actions);
  - PT409 if it is already closed.
- **Wiring, all four places:** the Edge allowlist and routing (both reads/writes), `app/api/my-actions/route.ts`, the `GatewayAction` union and the gateway.
- **Registration:** in `tests/pricing-migration-local.ps1`, `tests/pricing-release-preflight.mjs` plus its unit-test arrays, and `supabase/migration-history-map.json` (`not_deployed`).

## 4. Contract `lib/my-actions-types.ts`
```ts
import type { ActionType, ActionResult } from '@/lib/wallet-action-types';
export type MyActionRow = { actionId: string; customerId: string; customerName: string; city: string | null; actionType: ActionType; detail: string; dueOn: string; overdue: boolean; constraintCategory: string | null };
export type MyActions = { page: number; pageSize: 50; total: number; overdueCount: number; rows: MyActionRow[] };
export type MyActionCommand =
  | { action: 'get_my_actions'; payload: { page: number } }
  | { action: 'close_my_action'; payload: { requestId: string; actionId: string; result: ActionResult; note: string } };
```
The validator `validateMyActionCommand` throws `Invalid my actions request`.

## 5. Screen
In `components/accounts-workspace.tsx`, add a **"My actions"** entry next to the existing Accounts views, visible to administrator, management, sales and operations. It is lazily loaded from `components/my-actions.tsx`.
- **Header:** "N open actions · M overdue", with correct plurals ("1 open action").
- **Row:**
  - line 1: lab name and city, then the due date (red "Overdue" when overdue);
  - line 2: action label · detail;
  - line 3: "Why: {category label}" when present.

  Use the diagnosis category labels and the action labels from the existing components; share them, don't duplicate.
- **Action:** "Mark done" (primary) and "Drop" (quiet link). Both open a small form with a Result note (3–500 characters).
  - Successful saves reload the list.
  - Use the same idempotent retry and 409 handling as the other forms.
  - On 22023 "Action not found", show "This action is no longer yours or no longer exists." and reload.
- **Empty state:** "No open actions. Management assigns these from Wallet."
- On a phone at 375 px there is no horizontal scroll, and tap targets are at least 44 px.

## 6. Acceptance (before code)
**SQL** (`supabase/tests/wallet_my_actions.sql`):
- **Fixture rules:**
  - create through the real gateways;
  - requestIds are at least 16 characters and unique; expected-error calls use their own;
  - dates are relative to today IST;
  - assert only on fixture rows;
  - DO-block variable names never equal column names;
  - `(...)::jsonb` for built payloads.
- **M1:** a sales owner sees only their own open actions (another owner's are excluded, and so are closed ones). The order and the overdue flag come from `private.stockflow_my_actions_read` with `p_today` = today + 2.
- **M2:** `close_my_action` on someone else's action gives 22023 "Action not found". On their own action it succeeds. Closing twice gives PT409.
- **M3:**
  - warehouse, billing, accounts and viewer get PT403 on both actions;
  - operations and sales are allowed;
  - an inactive member gets PT403.
- **M4:** a row exposes only the keys in §4: no wallet, gain or evidence keys. Assert the exact key set.
- **M5:** replaying the same `requestId` returns the original result.
- **M6:** after the owner closes an action, management's `get_actions_due` no longer lists it.

**Unit:** the validator and the route, including mapping 22023 "Action not found" through, and the Edge routing for both actions.
**Browser** (`tests/pricing-browser/my-actions.spec.ts`, phone 375 and desktop, mocked):
- a sales role sees My actions; a warehouse role does not;
- the rows, Overdue and the header plurals;
- Mark done (POST body);
- Drop;
- the not-yours message;
- the empty state;
- no horizontal scroll.

## 7. Addendum (29 Oct): closing a Visit action records the visit
**Why:** today a done visit leaves no visit record, so the diagnosis "Last visit" signal never moves.

**Gateway change** (`20261031130000_wallet_my_actions.sql` is not deployed, so amend it in place):
- `close_my_action` takes an optional `visit: { outcome: 'met'|'not_available'|'order_taken'|'issue_raised'|'other'; nextVisitOn: string | null } | null`.
- **Allowed only when** the action's type is `visit` **and** `result = 'done'`. Otherwise a non-null `visit` gives 22023.
- **When present:** in the **same transaction**, call
  `public.stockflow_accounts_gateway(p_gateway_key, p_actor_email, 'log_visit', jsonb_build_object('idempotencyKey', requestId||':visit', 'customerId', <action customer>, 'visitedOn', today IST, 'outcome', …, 'note', left(note,500), 'nextVisitOn', …))`.
  - Pass the caller's own key and actor through.
  - All of `log_visit`'s rules, roles and idempotency apply.
  - Any error aborts the close (all-or-nothing).
  - The close result gains `visitId`.
- Replaying the same `requestId` returns the original result (including `visitId`) and logs no second visit.

**Contract:** add `visit` to the `close_my_action` payload in `lib/my-actions-types.ts`; the validator mirrors the rules above.

**Screen:**
- On **Mark done** for a Visit action, the form adds "Visit outcome" (select: Met, Not available, Order taken, Issue raised, Other; required) and an optional "Next visit" date (after today, within 180 days).
- Drop and non-visit actions are unchanged.

**Acceptance:**
- **M7:** closing a visit action as done with a visit inserts exactly one `stockflow_customer_visits` row for the action's customer, dated today IST, by the actor. `get_account_signals` `lastVisitOn` then equals today.
- **M8:** a visit on a non-visit action, or with result `dropped`, gives 22023 and closes nothing.
- **M9:** an invalid `nextVisitOn` (≤ today) makes `log_visit` fail. The action stays open: assert there's no result row.
- **M10:** a replay inserts no second visit.
- **Browser:** the outcome select appears only for a Visit with Mark done; the POST body carries `visit`.
