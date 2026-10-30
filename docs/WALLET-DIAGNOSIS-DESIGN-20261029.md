# Wallet diagnosis (Market rework, second slice): design

**Date:** 29 Oct 2026. **Author:** Claude (design, and design review of the screens). **Builder:** Codex. **Advisor-reviewed** before the handoff.
**Owner request:** "continue build until sunday" (Market / wallet).
**Train:** train 2 only if the full gate passes by Fri 6 Nov; otherwise train 3. Wallet V2 (`e8b0533`) is untouched, so it ships on its own if this slice misses the gate.

## 1. Decision it drives
**For each Focus-band account, why aren't we winning it, and which ones haven't we diagnosed yet?**

Management records one **binding constraint** per open opportunity, with evidence and a confidence level. The Wallet list then shows "Why: Price" or "Not diagnosed", and the header counts the undiagnosed Focus accounts. This follows plan §4 (Engine B): **diagnose the constraint before discounting.**

**Why this slice and not the GP ranking.** Read-only on production, 29 Oct: in Jul–Sep the active economics run has 1,362 sale-line results, and only **28 lines (1 customer)** carry GP. The GP ranking (ADR-0006) is blocked on margin evidence, so this slice goes first.

**Release conditions (owner):**
- This implements **ADR-0008, which is still Proposed**: one `opportunity` entity, kind capture/defend/recover, shared later with Power Maps. **Accept ADR-0008 before release.**
- Nothing here recommends a price or an action. Actions and EV cards are a later slice.

## 2. Data (new migration `20261031090000_wallet_diagnosis.sql`; append-only)
| Table | Rules |
| --- | --- |
| `private.stockflow_commercial_opportunities` | `id uuid`; `customer_id` FK `stockflow_customers`; `kind` (`capture`, `defend`, `recover`); `opened_reason text` (3–500); `opened_by`; `opened_at timestamptz default clock_timestamp()`. |
| `private.stockflow_commercial_opportunity_closures` | `opportunity_id` **primary key** FK (so at most one closure); `outcome` (`won`, `lost`, `dropped`); `reason` (3–500); `closed_by`; `closed_at`. Open = no closure row. |
| `private.stockflow_commercial_constraints` | `id uuid`; `opportunity_id` FK; `category` (`price`, `portfolio`, `instrument`, `service`, `relationship`, `credit`, `availability`, `clinical`, `contract_tender`, `competitor_lock_in`, `unknown`); `evidence text` (3–1000, **required for every category**, including `unknown`, where it says what must be found out); `confidence` (`high`, `medium`, `low`); `recorded_by`; `recorded_at timestamptz default clock_timestamp()`. Current = latest by `(recorded_at, id)`. |

- Every table: `no_delete` trigger (`private.prevent_business_delete()`), `immutable` trigger (`private.prevent_immutable_pricing_update()`), RLS enabled, `revoke all … from public, anon, authenticated, service_role`.
- **One open opportunity per (customer, kind)** cannot be a unique index, because closures live in another table. It is enforced in the gateway under `pg_advisory_xact_lock(hashtextextended('opportunity:'||customer_id||':'||kind,0))` and has its own race test (D4).
- **Diagnosed** = the opportunity is open and its current constraint exists and is not `unknown`.

## 3. Contract: `lib/wallet-diagnosis-types.ts` (exact)
```ts
export type OpportunityKind = 'capture' | 'defend' | 'recover';
export type OpportunityOutcome = 'won' | 'lost' | 'dropped';
export type ConstraintCategory = 'price' | 'portfolio' | 'instrument' | 'service' | 'relationship' | 'credit' | 'availability' | 'clinical' | 'contract_tender' | 'competitor_lock_in' | 'unknown';
export type ConstraintConfidence = 'high' | 'medium' | 'low';
export type WalletConstraint = { id: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; recordedBy: string; recordedAt: string };
export type WalletOpportunity = {
  id: string; customerId: string; kind: OpportunityKind; openedReason: string; openedBy: string; openedAt: string;
  closure: { outcome: OpportunityOutcome; reason: string; closedBy: string; closedAt: string } | null;
  constraint: WalletConstraint | null; history: WalletConstraint[];
};
export type WalletDiagnosisRow = { customerId: string; kind: OpportunityKind; category: ConstraintCategory | null; confidence: ConstraintConfidence | null };
export type WalletDiagnoses = { rows: WalletDiagnosisRow[]; undiagnosedFocusCount: number | null; focusCount: number | null };
export type WalletDiagnosisCommand =
  | { action: 'get_wallet_diagnoses'; payload: { customerIds: string[] } }
  | { action: 'get_account_opportunities'; payload: { customerId: string } }
  | { action: 'open_opportunity'; payload: { requestId: string; customerId: string; kind: OpportunityKind; reason: string } }
  | { action: 'record_constraint'; payload: { requestId: string; opportunityId: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; expectedCurrentConstraintId: string | null } }
  | { action: 'close_opportunity'; payload: { requestId: string; opportunityId: string; outcome: OpportunityOutcome; reason: string } };
```
**Validator** `validateWalletDiagnosisCommand(input)` throws `Error('Invalid wallet diagnosis request')`:
- ids and `requestId` match the uuid regex used in `lib/wallet-types.ts`;
- `customerIds`: an array of 0–50 unique uuids;
- `reason` 3–500 characters, `evidence` 3–1000;
- enums exactly as above;
- `expectedCurrentConstraintId` is null or a uuid.

## 4. Gateway `public.stockflow_opportunity_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)`
- **Signature, gateway-key check, actor-role lookup and grants:** copied from `public.stockflow_wallet_gateway` (`20261030130000`). Executable by `service_role` only.
- **Roles:** administrator and management for every action. Everyone else gets **PT403**.
- **Writes:** `begin_/finish_stockflow_command` for idempotency, plus an audit event in `private.stockflow_economic_audit`, in the same way as the wallet gateway.

**`get_wallet_diagnoses`:**
- `rows`: one per requested customer that has an open opportunity, for its most recently opened open opportunity. `category` and `confidence` come from its current constraint, or null if it has none.
- `focusCount` / `undiagnosedFocusCount`: from `private.stockflow_wallet_read(today IST)`. **Call it; do not copy its body.**
  - If `coverage.certified` is false, both are **null** (fail closed).
  - Otherwise, `focusCount` is the number of rows with `inFocusBand` true, and `undiagnosedFocusCount` counts those with no diagnosed open opportunity of any kind.

**`get_account_opportunities`:**
- the customer's opportunities, open first, then by `opened_at` desc;
- each carries its closure, its current constraint and its constraint history (newest first);
- 22023 if the customer is missing.

**`open_opportunity`:**
- take the advisory lock first;
- PT409 if an open opportunity of that kind exists for the customer;
- 22023 if the customer is missing;
- returns the new `WalletOpportunity`.

**`record_constraint`:**
- take `pg_advisory_xact_lock(hashtextextended('opportunity-constraint:'||opportunity_id,0))` **before** reading the current constraint;
- 22023 if the opportunity is missing or closed;
- PT409 if the current constraint id ≠ `expectedCurrentConstraintId`.

**`close_opportunity`:**
- PT409 if it is already closed (map the closures-table `unique_violation` to PT409);
- 22023 if the opportunity is missing.

**Wiring, all four places:**
1. the Edge allowlist and routing in `supabase/functions/stockflow-orders/index.ts`;
2. the Next route `app/api/wallet/diagnosis/route.ts` (GET for the two reads, POST for the three writes), following `app/api/wallet/route.ts`;
3. the `GatewayAction` union in `lib/order-gateway.ts`;
4. the gateway.

**Registration:**
- the migration and both tests go in `tests/pricing-migration-local.ps1` and `tests/pricing-release-preflight.mjs`;
- the migration's `not_deployed` sha256 goes in `supabase/migration-history-map.json`.

## 5. Screen (Accounts → Wallet; no new view)
**Wallet list:**
- After the page loads, one call to `get_wallet_diagnoses` with that page's customer ids. If it fails or the shape is wrong, render nothing extra.
- **Row chip**, only on rows with an estimate:
  - "Why: Price" (category label) when diagnosed;
  - "Not diagnosed" when there is no open opportunity, or the current constraint is null or Unknown.
- **Header, certified:** add "· N of M Focus accounts not diagnosed" when `undiagnosedFocusCount` is non-null and greater than 0.

**Account sheet:** a "Why we're not winning" section below the figures. "Update estimate" stays the one primary button.
- **No open opportunity:** a secondary button "Start diagnosis" opens a form with the kind (Capture · Defend · Recover, default Capture) and a reason.
- **Open opportunity:**
  - the current constraint: label, confidence, evidence, who and when; or "Not diagnosed yet";
  - a secondary button "Record constraint", whose form has the category select, evidence and confidence;
  - a quiet link "Close" with outcome and reason;
  - the history is collapsed.
- **Category labels:** Price, Portfolio gap, Instrument, Service, Relationship, Credit, Availability, Clinical, Contract / tender, Competitor lock-in, Unknown.
- **Evidence hints:**
  - Price: "Competitor, product and their price";
  - Unknown: "What we need to find out";
  - otherwise: "What we saw or were told".
- **Idempotency:** keep the pending `requestId` after 5xx, 408, 429 or a network error. Drop it only after success, a 409 or another definite 4xx. A 409 reloads the account and shows "Someone else just updated this. Reloaded."

## 6. Acceptance (written before code)
**SQL** (`supabase/tests/wallet_diagnosis.sql`). Fixtures go only through the gateways; read the unique constraints before inserting; DO-block variables must not share column names; an expected-error call uses its own requestId.
1. **D1** Update or delete on each of the three tables raises an exception.
2. **D2:**
   - `open_opportunity` twice for the same customer and kind gives PT409;
   - a different kind for the same customer succeeds;
   - after `close_opportunity`, the same kind can be opened again.
3. **D3:**
   - a stale `expectedCurrentConstraintId` gives PT409;
   - `record_constraint` on a closed opportunity gives 22023;
   - closing twice gives PT409;
   - a missing customer or opportunity gives 22023.
4. **D4** Two-session race (`supabase/tests/wallet_diagnosis_concurrency.sql`, in the pattern of `wallet_v2_concurrency.sql`): two `open_opportunity` calls for the same customer and kind give one success and one PT409.
5. **D5** Sales, operations, warehouse, billing, accounts and viewer get PT403 on all five actions.
6. **D6** Not certified: `focusCount` and `undiagnosedFocusCount` are null, and `rows` still return.
7. **D7** Certified (fixture as in `wallet_v2.sql` W7/W8): with 3 Focus accounts, where one is diagnosed (price), one is unknown and one has no opportunity, `undiagnosedFocusCount` = 2 and `focusCount` = 3.
8. **D8** `get_wallet_diagnoses` returns the most recently opened open opportunity, and its current constraint is the latest recorded one.
9. **D9** Replaying the same `requestId` returns the original result and inserts no second row.

**Unit:**
- `tests/unit/wallet-diagnosis-types.test.ts`: a valid and an invalid case per rule;
- `tests/unit/wallet-diagnosis-route.test.ts`: unauthenticated, invalid payload, passthrough, and mapping of PT403 and PT409;
- an Edge routing case for the five actions.

**Browser** (`tests/pricing-browser/wallet-diagnosis.spec.ts`, phone 375 and desktop, mocked API):
- the row chips (diagnosed, not diagnosed, no chip without an estimate);
- the header count;
- start a diagnosis, record a constraint, then close it;
- the Price evidence hint;
- a 409 reload message;
- a diagnoses read that fails or returns the wrong shape leaves the list unchanged;
- no horizontal scroll.

## 7. Not in this slice
Actions and EV cards; the Action Center; outcomes; scoring snapshots; any price link; verification of estimates; prospects.

## 8. Refinement (30 Oct): opportunities can be scoped to a division (ADR-0008 refined)
**Why:** the plan's second Pareto pass works inside an account, by division. With one open opportunity per (lab, kind), a lab can't carry "capture Immunoassay" and "capture Haematology" separately, each with its own reason and action.

**Data:** edit `20261031090000_wallet_diagnosis.sql` in place (not deployed), and refresh its hash.
- `stockflow_commercial_opportunities` gains `division_id uuid null references private.stockflow_wallet_divisions(id)`. Read the divisions table's real key column; use its code if the key is the code. Null means the whole lab.
- **Open uniqueness:** one open per (customer, kind, division), where null counts as its own scope ("Whole lab").
  - The advisory lock key becomes `'opportunity:'||customer||':'||kind||':'||coalesce(division,'all')`.
  - The PT409 check compares `division_id is not distinct from` the requested one.
- `open_opportunity` takes an optional `divisionCode`: null or omitted means the whole lab, and an unknown or inactive code gives 22023.
- **Reads:**
  - every opportunity JSON gains `divisionCode` and `divisionName`, null for the whole lab;
  - `get_wallet_diagnoses` rows gain `divisionName` (the chosen row's).
- **"Undiagnosed Focus" and the row rule are unchanged:** any diagnosed open opportunity of the lab counts.
- The actions, My actions and route code need no change. They reference the opportunity id; check they still pass.

**Contract:**
- `WalletOpportunity` and `WalletDiagnosisRow` gain `divisionCode: string | null; divisionName: string | null`;
- the `open_opportunity` payload gains `divisionCode: string | null`.

**Screen** (declutter rule):
- the Start diagnosis form gains a "Division" select, defaulting to "Whole lab", using the account's divisions already loaded in the sheet;
- the opportunity's muted line shows `{Kind} opportunity · {Division or Whole lab} · {reason}`;
- the row chip stays `Why: {category}`; the division appears only inside the sheet.

**Acceptance:**
- **D11:**
  - open capture for Immunoassay and capture for Haematology at the same lab: both succeed;
  - a second capture for Immunoassay gives PT409;
  - capture for the whole lab is a separate scope and succeeds;
  - an unknown division gives 22023;
  - D4's race still holds per scope.
- **Browser:** the Division select, the POST body `divisionCode`, and the division in the muted line.

## 9. Suggested opportunities (30 Oct, ADR-0008 §6 provenance)
**Decision it drives:** turn each Focus-band lab that has no opportunity into work, in one tap. A suggestion is **never** an opportunity until a person opens it.

**Data:** edit `20261031090000_wallet_diagnosis.sql` in place (not deployed) and refresh its hash.
- `stockflow_commercial_opportunities` gains `origin text not null default 'manual'`, with a check constraint named `stockflow_commercial_opportunities_origin_rule`: `origin in ('manual','wallet_gap')`.
- `open_opportunity` takes an optional `origin`. Omitted means `manual`.
- **`wallet_gap` is accepted only when** wallet coverage is certified **and** the customer is currently `inFocusBand` in `private.stockflow_wallet_read(today IST)`. Otherwise 22023 "Not a current Focus account". This keeps provenance honest.
- Every opportunity JSON gains `origin`.

**Contract:** `WalletOpportunity` gains `origin: 'manual' | 'wallet_gap'` (optional in response checks). The `open_opportunity` payload gains `origin?: 'manual' | 'wallet_gap'`.

**Screen** (declutter rule; no new lines or counts):
- In the Wallet list, **only when** `coverage.certified` and the row is `inFocusBand`, and the diagnoses read shows **no open opportunity** for that customer: replace the "Not diagnosed" chip with a small secondary button **"Start diagnosis"**.
  - Tapping it opens that lab's sheet with the Start diagnosis form already open: kind Capture, division Whole lab, empty reason focused.
  - Saving sends `origin: 'wallet_gap'`.
- Rows with an open opportunity keep their existing chip ("Why: …" or "Not diagnosed").
- Starting from the sheet's own "Start diagnosis" button still sends `manual`.

**Acceptance:**
- **D12:**
  - `wallet_gap` on a certified Focus fixture lab succeeds and the JSON shows `origin: 'wallet_gap'`;
  - on a lab not in the Focus band it gives 22023;
  - with coverage uncertified it gives 22023;
  - omitting origin gives `manual`;
  - an invalid origin gives 22023.
  - Reuse the D7 certified-fixture approach (relative dates, every identity company certified).
- **Browser:**
  - the button shows only for a certified Focus row without an opportunity;
  - it's absent for a row with an opportunity, and when not certified;
  - tapping opens the form, and the POST carries `origin: 'wallet_gap'`;
  - no horizontal scroll at 375.
