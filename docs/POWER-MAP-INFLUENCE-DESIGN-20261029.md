# Power Map influence (slice 2 of 2): design

**Date:** 29 Oct 2026. **Author:** Claude. **Builder:** Codex.
**Owner request:** "also enhance power maps" and "Ui is too cluttered" (apply the declutter rule: problems first, details behind a toggle).
**Train:** with Power Map slice 1.

## 1. Decision it drives
**Through whom do we reach the decider?**

Record who influences whom at a lab ("the owner listens to the chief pathologist"). The screen then shows **one line: the best route to the decision maker** from our strongest supporter. The full list of links stays behind a toggle.

**Deviation (recorded):** `POWER-MAPS.md` asks for a graph view as well as a list. The diagram is **deferred**. Production has 2 contacts and 1 assessment, so a diagram can't drive a decision yet, and the owner asked for less clutter. The route line plus the list carry the decision. Revisit the diagram when accounts have 5 or more assessed contacts.

**Visibility:** the same as assessments today. Administrator and management only (`v_can_power` = administrator/management in the accounts gateway). Owners don't see it yet, the same as the October slice.

## 2. Data (new migration `20261031150000_power_map_influence.sql`; append-only)
| Table | Rules |
| --- | --- |
| `private.stockflow_contact_influences` | `id uuid`; `customer_id` FK; `from_contact_id` and `to_contact_id` FK to `stockflow_account_contacts` (both current contacts of `customer_id`, and different); `strength` (`strong`, `medium`, `low`); `evidence text check (evidence is null or char_length(btrim(evidence)) between 3 and 300)`, required on insert by the gateway, nullable only for erasure; `recorded_by`; `recorded_at timestamptz default clock_timestamp()`. |
| `private.stockflow_contact_influence_ends` | `influence_id` **primary key** FK; `reason` (3–300); `ended_by`; `ended_at`. Current = no end row. |

- **One current link per (from, to)** under `pg_advisory_xact_lock(hashtextextended('influence:'||from||':'||to,0))`. Changing the strength means ending the old link and adding a new one; the screen does both in one gateway call, `set_influence`.
- Both tables get `no_delete` and `immutable` triggers, RLS, and revokes.
- **Erasure (privacy, D-07). Do NOT patch the accounts gateway or `erase_contact`.**
  - `erase_contact` already inserts a `private.stockflow_account_contact_events` row with `action='erased'` and the contact id (see `20261014180000_power_map.sql` line ~171).
  - Add an **AFTER INSERT trigger on `private.stockflow_account_contact_events`** that runs when `new.action='erased'` and sets `evidence=null` on every `stockflow_contact_influences` row whose `from_contact_id` or `to_contact_id` is that contact. Read that table's contact-id column name first.
  - The links' immutability guard (modelled on `private.stockflow_power_map_history_guard`) allows exactly one kind of UPDATE: `evidence` becoming null with every other column unchanged.
  - The rows themselves stay as audit.

## 3. Gateway `public.stockflow_power_map_gateway(p_gateway_key, p_actor_email, p_action, p_payload)`
- **Roles:** administrator and management, else PT403. Idempotency, audit and grants are the same as the other new gateways.
- **`get_power_map {customerId}`** returns:
  - `contacts`: current contacts `{id, name, businessRole, decisionRole, stance, influence, lastMetOn}` from the latest assessment, `unknown` if none;
  - `links`: current links `{id, fromContactId, toContactId, strength, evidence, recordedBy, recordedAt}`;
  - `route`: from `private.stockflow_power_route(customer)`, null if none.
- **`set_influence {requestId, customerId, fromContactId, toContactId, strength, evidence}`:** ends any current link for that pair (reason "Replaced") and inserts the new one, atomically.
  - 22023 if from = to, if a contact is not a current contact of that customer, or for an invalid strength or evidence.
- **`end_influence {requestId, influenceId, reason}`:** PT409 if already ended.
- **`private.stockflow_power_route(p_customer uuid) returns jsonb`**, deterministic:
  - **Start:** our best supporter, meaning the contact with `stance='supporter'` ordered by role (champion, then coach, then any other), then influence (high > medium > low > unknown), then name, then id. If there's none, return null.
  - **Target:** the decision makers (`decision_role='decision_maker'`). None → null. If the start is itself a decision maker, return a one-step route.
  - **Search:** start at the best supporter and follow current links **forward**, from `from_contact_id` to `to_contact_id`, stopping at the first decision maker reached. The path S → … → D uses links S→X, X→…, …→D. Search breadth-first up to 4 hops; on ties prefer fewer hops, then more `strong` links, then names.
  - **Return:** `{steps:[{contactId,name,decisionRole,stance}], strengths:[...]}`, or null when no path exists.
  - **Write the SQL carefully and simply:** a recursive CTE with a hop limit and path arrays to avoid cycles.
- **Wiring, all four places:** the Edge allowlist and routing, `app/api/power-map/route.ts`, the `GatewayAction` union and the gateway.
- **Registration:** in the ps1 (after `power_map_enhancement`), the preflight mjs and its unit-test arrays, and the history map (`not_deployed`).

## 4. Contract `lib/power-map-types.ts`
```ts
export type InfluenceStrength = 'strong' | 'medium' | 'low';
export type PowerMapContact = { id: string; name: string; businessRole: string | null; decisionRole: string; stance: string; influence: string; lastMetOn: string | null };
export type InfluenceLink = { id: string; fromContactId: string; toContactId: string; strength: InfluenceStrength; evidence: string; recordedBy: string; recordedAt: string };
export type PowerRoute = { steps: Array<{ contactId: string; name: string; decisionRole: string; stance: string }>; strengths: InfluenceStrength[] } | null;
export type PowerMap = { contacts: PowerMapContact[]; links: InfluenceLink[]; route: PowerRoute };
export type PowerMapCommand =
  | { action: 'get_power_map'; payload: { customerId: string } }
  | { action: 'set_influence'; payload: { requestId: string; customerId: string; fromContactId: string; toContactId: string; strength: InfluenceStrength; evidence: string } }
  | { action: 'end_influence'; payload: { requestId: string; influenceId: string; reason: string } };
```
The validator `validatePowerMapCommand` throws `Invalid power map request`.

## 5. Screen: Accounts → customer → contacts area, only when `canSeePowerMap`
Use the declutter rule.
- **One summary line** (always):
  - with a route: `Route to decider: {A} → {B} → {Decider}`, with names only and the decider in bold;
  - with no supporter: `No supporter yet: find a champion`;
  - with no decision maker: `No decision maker known`;
  - when no path is found: `No known route to {Decider}: ask who they listen to`.
- **A quiet toggle `Influence ({n})`** opens:
  - the list, one row per link: `{From} → {To}` · strength chip · a quiet `End` link; the evidence goes on a muted second line;
  - a secondary button `Add influence`, whose form has From (select), To (select), Strength (Strong/Medium/Low, no default) and Evidence, with the hint "What you saw; don't write personal details".
- **No diagram in this slice** (deviation, §1).
- **Phones:** no horizontal scroll.
- **Retry and conflicts:** the idempotent retry and 409 handling are the same as the other forms.

## 6. Acceptance (before code)
**SQL** (`supabase/tests/power_map_influence.sql`):
- **Fixture rules:**
  - contacts through `add_contact` with an `assign_account` first, as in `power_map_enhancement.sql`;
  - unique ids with prefix `b2a00000-` (grep first);
  - keys at least 16 characters, with their own keys for expected errors;
  - `exception when others` re-raising only the test's own failure;
  - no variable/column name clashes;
  - `(...)::jsonb`;
  - the transaction ends in rollback.
- **I1:** update or delete on both tables raises, except the erasure path.
- **I2:** from = to gives 22023; a contact of another customer gives 22023; a removed contact gives 22023.
- **I3:** `set_influence` twice for the same pair leaves exactly one current link (the old one ended "Replaced"). `end_influence` twice gives PT409.
- **I4: route.**
  - (a) Supporter champion C, C influences P, P influences D (the decision maker): the route is C → P → D.
  - (b) With an extra direct strong link C influences D: the route is C → D.
  - (c) No supporter: null. (d) No decision maker: null. (e) A cycle doesn't hang.
- **I5:** sales, operations, warehouse, billing, accounts and viewer get PT403 on all three actions.
- **I6:** erasing a contact nulls the evidence on its links and keeps the rows.
- **I7:** replay returns the original result.

**Unit:** the validator, the route, and the Edge routing.

**Browser** (`tests/pricing-browser/power-map.spec.ts`):
- the summary line for each state;
- the toggle list;
- adding an influence (POST body);
- End;
- no horizontal scroll at 375.
