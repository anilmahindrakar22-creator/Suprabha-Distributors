# Wallet diagnosis evidence (Market rework, third slice): design

**Date:** 29 Oct 2026. **Author:** Claude. **Builder:** Codex.
**Owner question (29 Oct):** "how are we determining why we are not winning. What questions or data do we need exactly determine that it's accurate".
**Amends** `WALLET-DIAGNOSIS-DESIGN-20261029.md`. It is not deployed, so `20261031090000_wallet_diagnosis.sql`, its contract and its screen change in place. **Train:** with the diagnosis slice.

## 1. Decision and accuracy model
A diagnosis is trustworthy when four things hold:
1. **Fixed questions:** the visit question set, shown for Unknown.
2. **Category facts:** structured, never a note alone.
3. **A graded source:** confidence is derived and never chosen.
4. **Cross-checks against our own data:** the signals panel.

Outcome validation (did fixing the reason raise share?) is a later slice.

## 2. Data changes (in place, `private.stockflow_commercial_constraints`)
- **Drop** the chosen `confidence` input.
- **Add:**
  - `source text not null check (source in ('document','customer_stated','our_view'))`;
  - `source_person text` (2–120 characters; **required when** `source='customer_stated'`, otherwise null);
  - `observed_on date not null` (≤ today IST, ≥ today − 2 years);
  - `facts jsonb not null`.
- **`confidence`** stays a column but is computed by the gateway: `document` → `high`, `customer_stated` → `medium`, `our_view` → `low`. The check stays as it is.
- **`evidence`** stays, renamed in the UI as **Note**, 3–1000 characters.

**Facts per category** (the gateway validates; extra keys rejected; text fields trimmed, 2–200 characters; paise are integers 1–9e13; dates ISO):
| category | required keys |
| --- | --- |
| price | `competitor` text, `product` text, `competitorPricePaise`, `ourPricePaise` |
| portfolio | `product` text, `division` (an active wallet division code) |
| instrument | `analyser` text, `owner` (`customer`, `competitor_placed`, `rental`, `unknown`), `closedSystem` (`yes`, `no`, `unknown`), `division` code |
| service | `issue` text, `since` date |
| availability | `product` text, `issue` text |
| credit | `issue` text |
| relationship | `decisionMaker` text, `issue` text |
| clinical | `issue` text |
| contract_tender | `holder` text, `endsOn` date |
| competitor_lock_in | `competitor` text, `endsOn` date |
| unknown | `nextQuestion` text, `askBy` date (≥ today IST) |

- **Price flag:** a `price` constraint with `source='our_view'` is allowed but the reads return `priceUnproven: true`. The screen says "Price not proven: get the competitor's quote before any price action." The rule is "never discount on a guess".
- **Derived figure:** for price, `gapPermille = round((ourPricePaise − competitorPricePaise) × 1000 / ourPricePaise)`, half-up, in the reads.

## 3. Signals read (new action `get_account_signals`, payload `{customerId}`)
These are read-only facts for the last 90 days up to today IST, linked through `stockflow_orders.customer_id`:
- `priceExceptions90d`: count of `stockflow_price_exceptions` for the customer's orders, created in the window;
- `deliveryProblems90d` and `deliveryProblemsOpen`: from `stockflow_delivery_exceptions`;
- `serviceTicketsOpen` and `serviceTickets90d`: from `stockflow_service_tickets` (`status` open);
- `ourInstallations`: count of `stockflow_equipment_installations` for the customer's orders;
- `lastVisitOn`: max `stockflow_customer_visits.visited_on`, or null.

Every count is an integer ≥ 0, never null. A missing source shows as 0, and the screen labels the panel "From StockFlow records" so nobody reads zero as proof.
- **Credit / receivables:** there is no source (Tally outstanding isn't imported). The panel says "Receivables: not available".
- **Roles:** administrator and management (PT403 otherwise). 22023 if the customer is missing.
- If the column names in §3 differ from the actual tables, read the migrations and use the real columns. Report any substitution.

## 4. Contract changes (`lib/wallet-diagnosis-types.ts`)
```ts
export type EvidenceSource = 'document' | 'customer_stated' | 'our_view';
export type ConstraintFacts =
  | { category: 'price'; competitor: string; product: string; competitorPricePaise: number; ourPricePaise: number }
  | { category: 'portfolio'; product: string; division: string }
  | { category: 'instrument'; analyser: string; owner: 'customer' | 'competitor_placed' | 'rental' | 'unknown'; closedSystem: 'yes' | 'no' | 'unknown'; division: string }
  | { category: 'service'; issue: string; since: string }
  | { category: 'availability'; product: string; issue: string }
  | { category: 'credit'; issue: string }
  | { category: 'relationship'; decisionMaker: string; issue: string }
  | { category: 'clinical'; issue: string }
  | { category: 'contract_tender'; holder: string; endsOn: string }
  | { category: 'competitor_lock_in'; competitor: string; endsOn: string }
  | { category: 'unknown'; nextQuestion: string; askBy: string };
// WalletConstraint gains: source: EvidenceSource; sourcePerson: string | null; observedOn: string; facts: Omit<ConstraintFacts,'category'>; priceUnproven: boolean; gapPermille: number | null
// WalletDiagnosisRow gains: priceUnproven: boolean
// record_constraint payload becomes: { requestId; opportunityId; category; facts (without category); evidence; source; sourcePerson: string | null; observedOn; expectedCurrentConstraintId }
// new: { action: 'get_account_signals'; payload: { customerId: string } } -> WalletSignals
export type WalletSignals = { priceExceptions90d: number; deliveryProblems90d: number; deliveryProblemsOpen: number; serviceTicketsOpen: number; serviceTickets90d: number; ourInstallations: number; lastVisitOn: string | null };
```
The validator mirrors the gateway rules exactly.

## 5. Screen
- **Record constraint form, in order:**
  1. Category (no default).
  2. The category's fact fields, with plain labels. Prices are entered in ₹ and converted with `rupeesToPaise`. Division is a select of the wallet divisions.
  3. Source, as three radio options: "Seen a document (quote, invoice, tender)", "Told by someone at the lab", "Our own view".
  4. "Who told us" (shown only for told-by).
  5. "When" (date, default today).
  6. Note.
- **Confidence is shown, not chosen:** "Confidence: High (document)".
- **Unknown:** above the fields, show the visit question list as a numbered list. The five questions are in the owner reply of 29 Oct and below.
  1. Which analysers do you run in each department, and who owns them: you, a supplier's placement, or a rental?
  2. Who supplies the reagents for each, and why them?
  3. What would make you move this business to us?
  4. Any problem with our delivery, service or billing in the last 3 months?
  5. Who decides purchases, and when does any contract or tender end?
- **Current constraint display:**
  - the label and the facts as one line, for example "Price · Acme Diagnostics, Glucose kit: ₹1,200 vs our ₹1,400 (14% higher)";
  - the source and person, and the observed date;
  - the "Price not proven" warning when flagged.
- **Row chip:** "Why: Price (not proven)" when flagged.
- **Signals panel:** in the "Why we're not winning" section, above the buttons, titled "From StockFlow records (90 days)". It shows one compact line per signal, plus "Receivables: not available". If the read fails, show nothing.

## 6. Acceptance (before code)
**SQL** (extend `supabase/tests/wallet_diagnosis.sql`; the existing D1–D9 keep passing with updated payloads):
- **E1:** for each category, a valid facts payload succeeds. A missing key, an extra key or a wrong type gives 22023 (cover at least price, instrument, unknown and contract_tender).
- **E2:**
  - `customer_stated` without `sourcePerson` gives 22023;
  - `document` with `sourcePerson` gives 22023;
  - a future `observedOn` gives 22023;
  - an `unknown` with a past `askBy` gives 22023.
- **E3:** confidence derives from the source (all three). The input field `confidence` is rejected as an extra key.
- **E4:** price + `our_view` gives `priceUnproven` true in the account read and in the diagnoses row. `gapPermille` is hand-checked: our 140000, theirs 120000 → 143.
- **E5:** signals count fixtures in and out of the 90-day window, for one customer and not another. `lastVisitOn` is null without visits. PT403 applies to the other roles.

Fixture rules (CONSTRAINTS.md):
- go through gateways where they exist;
- read the unique and check constraints first;
- use new requestIds for expected errors;
- no DO-variable/column name clashes;
- derive dates from today IST.

**Unit:** the validator (every category, valid and invalid) and the route (the new GET action).
**Browser** (`wallet-diagnosis.spec.ts`):
- the price facts flow (POST body facts in paise, source, derived confidence text);
- the Unknown question list;
- told-by shows "Who told us";
- the "not proven" chip and warning;
- the signals panel with "Receivables: not available";
- a failed signals read hides the panel.

Phone 375 and desktop, no horizontal scroll.
