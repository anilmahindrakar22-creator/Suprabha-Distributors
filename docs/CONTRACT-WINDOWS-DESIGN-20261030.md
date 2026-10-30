# Design: Contracts ending soon (next train)

*Claude, 30 Oct 2026. Train `claude/train-20261113`. Builds on the wallet diagnosis (`20261031090000`) and the wallet actions (`20261031120000`).*

## 1. Decision it drives
Diagnosis already records **when** a competitor's lock-in or a tender ends (`facts.endsOn` on `competitor_lock_in` and `contract_tender` constraints). Nothing uses that date yet.

The best moment to win a locked lab is shortly before the lock ends. Management needs to see "this lab's contract ends in 74 days and nobody has planned anything".

This doesn't depend on certified sales and carries no money, so it's useful from day one.

## 2. Rule
A **contract window** is an open opportunity (no closure) that meets both conditions:
- its **current** constraint (the latest by `recorded_at desc, id desc`, as everywhere else) has category `competitor_lock_in` or `contract_tender`;
- `facts.endsOn` is between `today - 30` and `today + 120` days, with `today` taken in Asia/Kolkata.

It is **planned** when the opportunity has an **open** action (no result row) with `due_on <= endsOn`. Otherwise it is **unplanned**.

Only **unplanned** windows are listed (the declutter rule: problems only). Planned ones are only counted.

## 3. Read
New gateway `public.stockflow_contract_window_gateway(p_gateway_key, p_actor_email, p_action, p_payload)`:
- **Access:** the same key check and roles as `stockflow_opportunity_gateway`. Administrator and management only; anyone else gets `PT403`.
- **Action:** `get_contract_windows` with payload `{page}`. `page` is an integer from 1 to 4000; anything else is `22023`. The action is read-only.
- **Returns:** `{rows:[…], total, plannedCount, page, pageSize:20}`. `total` counts unplanned windows; `plannedCount` counts planned ones.
- **Each row:**
  - `customerId`, `customerName`, `town`, `opportunityId`, `kind`, `divisionName` (nullable);
  - `category`;
  - `party`: `facts.competitor` for a lock-in, `facts.holder` for a tender;
  - `endsOn`;
  - `daysLeft`: `endsOn - today`, which is negative once it has ended;
  - `confidence`, `source`.
- **Order:** `endsOn` ascending, then customer name, then opportunity id.

Migration `20261102100000_contract_windows.sql` adds only the function and its revoke/grant, with no new tables.

## 4. App
- **Wiring:** follow `get_actions_due` exactly.
  - In the Edge function, add the action to the `actions` push list and to `readActions`, and route it to the new gateway.
  - In `app/api/wallet/actions/route.ts`, add a GET `action=get_contract_windows&page=n`.
  - Add the action to `lib/wallet-action-types.ts` and the `GatewayAction` union.
  - Register the migration in replay, preflight and the map (`not_deployed`).
- **UI:** in `components/wallet-workspace.tsx`, the **Actions due** view loads `get_contract_windows` page 1 alongside actions due.
  - **When `total > 0`:** a section **"Contracts ending soon (n)"** appears above the actions list. Each row is a button that opens the lab sheet, the same as an action-due row. It shows:
    - **line 1:** `Lab · Town`;
    - **line 2:** `Competitor lock-in: <party>` or `Tender: <party>`;
    - **line 3:** `Ends 12 Jan 2027 · 74 days left`, or `Ended 10 days ago` in the danger colour;
    - **line 4, muted:** `No action planned before it ends`.
  - **Load more:** shown when more pages exist.
  - **Planned count:** when `plannedCount > 0`, a muted line reads "n more already have an action planned".
  - **When `total = 0`:** nothing is shown, apart from the planned line when it applies.
  - **On a failed or malformed read:** the muted line "Contract dates could not load". It never blocks the actions list.

## 5. Acceptance checks
**SQL**, in `supabase/tests/contract_windows.sql` on a real database. Fixture dates are derived from the IST `current_date`. Assert on the rows for your own fixture customers, never on global totals.
- **C1:** a lock-in ending in 60 days with no action is listed, with `daysLeft` 60, the competitor as `party`, and the right customer and opportunity.
- **C2:** an open action due on or before `endsOn` → not listed, and `plannedCount` includes it. An open action due after `endsOn` → still listed.
- **C3:** an action that has a result (done) → listed again.
- **C4:** `endsOn` at 121 days or 31 days ago → excluded. Ended 10 days ago → listed with `daysLeft` -10. A tender shows its holder as `party`.
- **C5:** a newer constraint of another category on the same opportunity → excluded. A closed opportunity → excluded.
- **C6:** sales and operations get `PT403`. Page 0 or a non-integer page gets `22023`.
- **C7:** fixture rows come back ordered by `endsOn` ascending. No response contains `paise` or `wallet`.

**Browser**, in `tests/pricing-browser/contract-windows.spec.ts` at 375 and 1280:
- the section and its rows appear;
- tapping a row opens the lab sheet;
- an ended window shows the "Ended … ago" wording;
- `total` 0 hides the section;
- the planned-count line appears;
- a read failure shows the muted line while actions due still render;
- no horizontal overflow at 375.

Also run unit tests for the route validation and the Edge routing, plus tsc and oxlint.

## 6. Amendment (Claude, 30 Oct): one "Deadlines without a plan" section
This adds the `unknown` category's `askBy` date. That date is captured and validated, but nothing surfaces it yet. Adding it as one section, not a second one, follows the declutter rule.

- **Rule:** an open opportunity whose current constraint is `unknown`, with `facts.askBy` between `today - 30` and `today + 14`, is a deadline window.
  - `party` = `facts.nextQuestion`;
  - `endsOn` = `askBy` (the field name stays the same, for the contract);
  - planned = an open action due on or before `askBy`.
- The migration is still `not_deployed`, so edit it in place and recompute the map sha256.
- **UI:**
  - The section title becomes **"Deadlines without a plan (n)"**.
  - Line 2 for `unknown` reads `Open question: <party>`.
  - Line 3:
    - for `unknown`: `Ask by 5 Nov 2026 · 6 days left` (or `· today`), or `Ask-by passed 3 days ago`, in the danger colour;
    - for contracts: unchanged.
  - Line 4 becomes `No action planned` for every row.
- **SQL C8:** an `unknown` with `askBy` in 7 days and no action is listed with `party` = the question. `askBy` 15 days ahead is excluded. An action due on or before `askBy` makes it planned.
- **Browser:** an `unknown` row shows its question and the ask-by wording.
