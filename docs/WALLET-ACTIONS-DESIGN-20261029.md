# Wallet next actions (Market rework, fourth slice): design

**Date:** 29 Oct 2026. **Author:** Claude. **Builder:** Codex.
**Owner request:** "continue build until sunday".
**Train:** train 2 with the diagnosis slices if the Fri 6 Nov gate passes; otherwise train 3.

## 1. Decision it drives
**What are we doing about each diagnosed account, who owns it, and what's overdue?**

After a constraint is recorded, management records **one next action** with an owner and a due date. The Wallet gets an **"Actions due"** view, listing the actions open and due within 7 days or overdue, sorted overdue first. This is Engine C (plan §5, §12), kept deliberately small.

**Deviations (recorded):**
- **No expected-value cards, approvals or frozen economics** (ADR, `commercial_action` "expected economics frozen at approval"). There is no margin evidence yet (28 of 1,362 lines carry GP). The action records an optional *expected monthly sales gain* that the person types; it is a stated expectation, never computed.
- **Owners see their actions only through management in this slice.** Wallet stays administrator and management only. Showing sales users their own actions is a later slice.
- **Outcomes:** an action is closed as `done` or `dropped` with a result note. Measuring share change (the Learning engine) is later.

## 2. Data (new migration `20261031120000_wallet_actions.sql`; append-only)
| Table | Rules |
| --- | --- |
| `private.stockflow_commercial_actions` | `id uuid`; `opportunity_id` FK; `action_type` (`visit`, `demo`, `get_competitor_proof`, `add_product`, `fix_service`, `fix_supply`, `instrument_proposal`, `credit_terms`, `price_review`, `no_action`); `detail text` (3–500); `owner_email text` (an active member, lower-cased); `due_on date` (≥ today IST at creation, ≤ today + 180 days); `expected_monthly_gain_paise bigint` (null, or 1–9e13); `created_by`; `created_at timestamptz default clock_timestamp()`. |
| `private.stockflow_commercial_action_results` | `action_id` **primary key** FK; `result` (`done`, `dropped`); `note text` (3–500); `closed_by`; `closed_at`. Open = no result. |

- Both tables get `no_delete` and `immutable` triggers, RLS on, and revokes, the same as the diagnosis tables.
- **One open action per opportunity.** It is enforced under `pg_advisory_xact_lock(hashtextextended('opportunity-action:'||opportunity_id,0))` with a race test.
- **Business rules (22023):**
  - the opportunity must be open;
  - `price_review` is allowed only when the opportunity's current constraint is `price` and **not** `priceUnproven` (source ≠ `our_view`). This is the "never discount on a guess" rule, and a `price_review` action does not change any price; it only records that a review in Pricing is due;
  - `no_action` needs `detail` (why we deliberately do nothing).
- **Closing the opportunity** while an action is open gives 22023 ("Close the open action first").

## 3. Gateway: a new function in the new migration
Keep each slice separately shippable. Do not edit the diagnosis migration.
- **new function** `public.stockflow_action_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)`, with the same key check, roles (administrator and management, else PT403), idempotency, audit and grants as the opportunity gateway;
- the closing rule in §2 (no closing an opportunity with an open action) is enforced by a **trigger** on `private.stockflow_commercial_opportunity_closures` (before insert), defined in this migration and raising 22023.
- **Race safety (create versus close):**
  - the trigger first takes `pg_advisory_xact_lock(hashtextextended('opportunity-action:'||new.opportunity_id,0))`, then checks for open actions;
  - `create_action` takes the same lock first, then checks that the opportunity is open (no closure row) and that no open action exists.

**Actions:**
- `create_action {requestId, opportunityId, actionType, detail, ownerEmail, dueOn, expectedMonthlyGainPaise|null}`. PT409 if an open action exists.
- `close_action {requestId, actionId, result, note}`. PT409 if already closed.
- `get_actions_due {page}`:
  - open actions with `due_on ≤ today IST + 7`, ordered by `due_on`, then customer name, then id;
  - 50 per page;
  - each row: `actionId`, `customerId`, `customerName`, `city`, `opportunityKind`, `constraintCategory` (current, or null), `actionType`, `detail`, `ownerEmail`, `dueOn`, `overdue` (due < today), `expectedMonthlyGainPaise`;
  - plus `total` and `overdueCount`.
- `get_opportunity_actions {opportunityId}`: all actions for the opportunity, open first, then `created_at` desc, each with its result.
- `get_action_owners {}`: active members with roles administrator, management or sales, as `{email, name|null}`, sorted by email. Read the real `stockflow_members` columns, and report any substitution.

**Wiring:**
- all four places: the Edge allowlist and routing, the route `app/api/wallet/actions/route.ts`, the `GatewayAction` union, and the gateway;
- registration in `tests/pricing-migration-local.ps1`, `tests/pricing-release-preflight.mjs` and its unit test arrays, and `supabase/migration-history-map.json` (`not_deployed`).

## 4. Contract `lib/wallet-action-types.ts`
```ts
export type ActionType = 'visit' | 'demo' | 'get_competitor_proof' | 'add_product' | 'fix_service' | 'fix_supply' | 'instrument_proposal' | 'credit_terms' | 'price_review' | 'no_action';
export type ActionResult = 'done' | 'dropped';
export type WalletAction = { id: string; opportunityId: string; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; expectedMonthlyGainPaise: number | null; createdBy: string; createdAt: string; result: { result: ActionResult; note: string; closedBy: string; closedAt: string } | null };
export type ActionDueRow = { actionId: string; customerId: string; customerName: string; city: string | null; opportunityKind: 'capture' | 'defend' | 'recover'; constraintCategory: string | null; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; overdue: boolean; expectedMonthlyGainPaise: number | null };
export type ActionsDue = { page: number; pageSize: 50; total: number; overdueCount: number; rows: ActionDueRow[] };
export type ActionOwner = { email: string; name: string | null };
export type WalletActionCommand =
  | { action: 'get_actions_due'; payload: { page: number } }
  | { action: 'get_opportunity_actions'; payload: { opportunityId: string } }
  | { action: 'get_action_owners'; payload: Record<string, never> }
  | { action: 'create_action'; payload: { requestId: string; opportunityId: string; actionType: ActionType; detail: string; ownerEmail: string; dueOn: string; expectedMonthlyGainPaise: number | null } }
  | { action: 'close_action'; payload: { requestId: string; actionId: string; result: ActionResult; note: string } };
```
The validator `validateWalletActionCommand` mirrors §2 and §3. Error text: `Invalid wallet action request`.

## 5. Screen
- **Wallet chips:** add **"Actions due"** as the first chip after Focus.
  - It is a **client-side mode** of the Wallet screen. It calls `/api/wallet/actions?action=get_actions_due&page=` and **never** sends a `view` to `/api/wallet`.
  - Do not change `WalletView`, `lib/wallet-types.ts` or `20261030130000_wallet_v2.sql`.
- When selected, the list shows `ActionDueRow`s instead of accounts:
  - line 1: customer and city, then the due date (red "Overdue" text when overdue);
  - line 2: action label · detail;
  - line 3: owner · "Why: {constraint}" · expected gain "+₹X/mo expected" if present.
- Tapping a row opens the account sheet.
- **Header** in this view: "N actions due this week · M overdue".

**Account sheet, "Why we're not winning" section, under the current constraint:**
- **No open action:** a secondary button "Plan next action". The form has:
  - action type (select; Price review is disabled, with the hint "Needs a proven price reason" unless the current constraint is price and not unproven);
  - detail;
  - owner (select from `get_action_owners`);
  - due date (default today + 7);
  - expected gain ₹/month (optional, `inputMode="decimal"`, hint "Your expectation, not a calculation").
- **Open action:** a card with the action label, detail, owner, due date (Overdue in red), expected gain, and a quiet link "Close action" (result Done or Dropped, plus a note).
- **Close opportunity** while an action is open: show the server's 22023 message.
- The idempotent-retry and 409 behaviour is the same as the diagnosis forms.

**Action labels:** Visit, Demo, Get competitor proof, Add product, Fix service issue, Fix supply issue, Instrument proposal, Credit terms, Price review, No action (deliberate).

**Polish carried in:** Wallet V2 snapshot details show lowercase "high" and "customer stated". Capitalise them: "High"; "Customer stated", "Test volume", "Manager estimate".

## 6. Acceptance (before code)
**SQL** (`supabase/tests/wallet_actions.sql`; fixtures through the gateways, dates relative to today IST, own requestIds for expected errors, no variable/column name clashes, `(...)::jsonb` for built payloads, counts never global):
1. **A1** Update or delete on both tables raises an exception.
2. **A2:**
   - a second open action on the same opportunity gives PT409;
   - after `close_action`, a new one succeeds;
   - closing twice gives PT409.
3. **A3:**
   - `price_review` with no constraint, a non-price constraint, or price with `our_view` gives 22023;
   - price with `document` succeeds.
4. **A4:**
   - due in the past, or more than 180 days ahead, gives 22023;
   - an inactive or unknown owner gives 22023;
   - a closed opportunity gives 22023.
5. **A5** Closing an opportunity with an open action gives 22023. After `close_action`, closing the opportunity succeeds.
6. **A6** Put the due logic in a private helper `private.stockflow_actions_due_read(p_today date, p_page int)`; the gateway passes today IST. Create actions due today, today + 3 and today + 20, plus one closed action due today + 1. Then call the helper with `p_today` = today + 2:
   - the action due today is included and `overdue`;
   - the one due today + 3 is included and not overdue;
   - the one due today + 20 is excluded, and so is the closed one;
   - check the order (due today first) and that `overdueCount` counts the fixture actions.
   - Assert only on fixture rows, never on global totals.
7. **A7** PT403 for sales, operations, warehouse, billing, accounts and viewer on all five actions.
8. **A8** Replaying the same `requestId` returns the original result.
9. **A9** Races (`supabase/tests/wallet_actions_concurrency.sql`):
   - two `create_action` calls on one opportunity give one success and one PT409;
   - one `create_action` and one `close_opportunity` (via `stockflow_opportunity_gateway`) on a fresh opportunity, run at the same time: exactly one succeeds. Afterwards there must never be an open action on a closed opportunity.

**Unit:** the validator (each rule), the route, and the Edge routing for the five actions.

**Browser** (`tests/pricing-browser/wallet-actions.spec.ts`, phone 375 and desktop):
- the Actions due chip, rows, Overdue and the header;
- planning an action (POST body; the default due date is today + 7; the Price review option is disabled without a proven price);
- closing an action;
- the close-opportunity error message;
- retry keeps the requestId;
- a failed read shows the error with Retry;
- no horizontal scroll;
- the capitalised Wallet V2 labels.
