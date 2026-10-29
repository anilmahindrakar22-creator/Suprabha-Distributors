# Power Map enhancement (slice 1 of 2): design

**Date:** 29 Oct 2026. **Author:** Claude. **Builder:** Codex.
**Owner request (29 Oct):** "also enhance power maps. look at the details".
**Train:** train 2 if the Fri 6 Nov gate passes; otherwise train 3.

## 0. What exists (read before building)
- **Doc versus code:** `docs/intelligence/POWER-MAPS.md` says "Nothing is built". That is stale. `20261014180000_power_map.sql` and `20261014190000_social_styles.sql` built:
  - contacts;
  - per-contact assessments (`decision_role` decision_maker/influencer/user/gatekeeper/unknown, `stance`, `influence`, `reason`);
  - visit contacts and last met;
  - Social Style observations and overrides;
  - `private.stockflow_power_alerts(customer, today)`, which returns `no_decision_maker`, `decision_maker_not_met` (60 days) and `influential_blocker`. They are shown and filterable in Accounts.
- **Production (read-only, 29 Oct):** 2 contacts, 1 assessment, 3 visit contacts, 1 style observation.

## 1. Gaps versus the approved design, and this slice
| Design item | Status | This slice |
| --- | --- | --- |
| Roles: Champion, Technical evaluator, Coach (plus Economic buyer = Decision maker) | missing | **add** |
| Rule: a high-influence person who is sceptical, blocking **or unknown** → meet them | the unknown case is missing | **add** `influential_unknown` |
| Rule: the only champion is a user, so no access to the decider | missing | **add** `no_influential_supporter` |
| Rule: a decider not contacted in the policy window | exists (60 days) | keep |
| Rule: a Focus account with no known decision maker → coverage queue | missing in Wallet | **add** the Wallet header count |
| Feeds the RELATIONSHIP constraint; "can cite an assessment" | missing | **add** an optional `contactId` to relationship facts |
| Power-map alerts visible while diagnosing | missing | **add** to the diagnosis signals panel |
| Influence edges (A influences B), graph, strongest path | missing | **slice 2** |
| Assessment evidence/confidence | missing | slice 2 (with edges) |

## 2. Data and SQL (new migration `20261031140000_power_map_enhancement.sql`)
1. **Roles.** Widen the `stockflow_contact_assessments.decision_role` check to add `champion`, `technical_evaluator` and `coach`.
   - Drop and re-add the constraint **by its real name**; read it from the catalog in a DO block rather than guessing.
   - Existing rows are unchanged. Update every SQL validator of `set_assessment` that lists roles. Read the latest accounts gateway (`20261015082020…` and anything later) and patch the list through the same "old/new text replace" technique those migrations use, or the clean equivalent, so the gateway accepts the new roles.
2. **Alerts.** `create or replace private.stockflow_power_alerts(p_customer uuid, p_today date)`, keeping the three existing codes in the same order and adding:
   - `influential_unknown`: a current contact whose latest assessment has `influence='high'` and `stance='unknown'`;
   - `no_influential_supporter`: the account has at least one assessed contact **and** no contact with `stance='supporter'` and (`influence='high'` or `decision_role in ('decision_maker','champion')`).
   - Every SQL list of valid alert codes (for example an Accounts filter validator) must accept the two new codes. Find them all.
3. **Wallet coverage and signals: edit `20261031090000_wallet_diagnosis.sql` in place** (not deployed), and refresh its `not_deployed` hash. It already runs after the Oct power-map migration, so it may call `private.stockflow_power_alerts`.
   - Add `private.stockflow_wallet_power_coverage(p_today date)` returning `{focusCount, focusWithoutDecisionMaker}`:
     - computed from `private.stockflow_wallet_read(p_today)` rows with `inFocusBand` true, counting those whose `stockflow_power_alerts` contains `no_decision_maker`;
     - **both null when coverage isn't certified** (fail closed).
   - `get_wallet_diagnoses` also returns `focusWithoutDecisionMaker` from that helper.
   - `get_account_signals` also returns `powerAlerts` (the array from `private.stockflow_power_alerts(customer, today)`) and `decisionMakerLastMetOn` (the max last-met date over current contacts whose latest role is `decision_maker`, or null).
   - **The new migration `20261031140000_power_map_enhancement.sql` holds only** the roles widening (step 1) and the new `stockflow_power_alerts` body (step 2). Because it runs later, the diagnosis code picks up the new alert codes automatically.
4. **Relationship facts cite a contact.** In the diagnosis facts validator (`private.stockflow_constraint_facts_valid`, in the not-deployed diagnosis migration), `relationship` gains an **optional** `contactId`:
   - it must be a current (not removed) contact of the **opportunity's customer**;
   - the validator needs the customer, so add a `p_customer uuid` parameter and update its single caller;
   - the constraint JSON returns `contactName` when `contactId` is set.

## 3. Contract changes
- **`lib/account-types.ts`:** add `'champion' | 'technical_evaluator' | 'coach'` to `decisionRoles`, and `'influential_unknown' | 'no_influential_supporter'` to `powerAlerts`. Any client validator follows.
- **`lib/wallet-diagnosis-types.ts`:**
  - `WalletSignals` gains `powerAlerts: string[]` and `decisionMakerLastMetOn: string | null`;
  - `WalletDiagnoses` gains `focusWithoutDecisionMaker: number | null`;
  - relationship facts gain `contactId?: string`, and `WalletConstraint` gains `contactName?: string | null`.

## 4. Screen
**Accounts:**
- **Role labels:** Decision maker, Champion, Influencer, Technical evaluator, User, Gatekeeper, Coach.
- **Alert labels:**
  - "Influential person, stance unknown";
  - "No influential supporter".
- **Filter:** the Power Map filter lists the new alerts.

**Wallet header (certified):** a muted line, "N of M Focus accounts have no known decision maker", when the value is non-null and greater than 0. It goes under the "not diagnosed" line.

**Diagnosis signals panel:** add the lines
- `Power Map: <alert labels joined with " · ">` (or `Power Map: no gaps` when the list is empty);
- `Decision maker last met: <date>` (or `never`).

**Record constraint → Relationship:**
- an optional "Person" select listing the lab's current contacts (from `get_account_opportunities`, or a contacts list the screen already has; read how contacts are loaded);
- the fact line shows "· {contactName}".

## 5. Acceptance (before code)
**SQL** (extend `supabase/tests/wallet_diagnosis.sql`, and add `supabase/tests/power_map_enhancement.sql` for the roles and alerts):
- **P1:** each new role saves through `set_assessment` and is read back. An invalid role gives 22023.
- **P2:** `influential_unknown` fires for a high or unknown contact and clears after the stance changes. `no_influential_supporter` fires for an account with only a low-influence supporter and clears when a champion supporter exists. It never fires for an account with no assessed contacts. The three old codes are unchanged (regression).
- **P3:** `focusWithoutDecisionMaker` is null when not certified. When certified, it counts only the fixture Focus accounts without a decision maker (assert relative to the read, never fixed global totals).
- **P4:** `get_account_signals` returns `powerAlerts` and `decisionMakerLastMetOn`.
- **P5:**
  - relationship with a valid `contactId` succeeds and returns `contactName`;
  - a contact of another customer gives 22023;
  - a removed contact gives 22023;
  - no `contactId` still succeeds.
- **Fixture rules:**
  - requestIds and idempotency keys at least 16 characters, unique, with own keys for expected errors;
  - through the gateways;
  - no variable/column name clashes;
  - `(...)::jsonb`;
  - dates relative to today IST.

**Browser:**
- the new role and alert labels in Accounts;
- the Wallet header line;
- the signals panel Power Map lines;
- the Relationship person select and the POST body.

**Unit:** the validators.
