# Service, Milestone 4: design (Claude, 12 Oct 2026)

**Status:** design only. Nothing is built yet.
- This work is **not part of the current release**. That frozen candidate (`e3a4a08`, plus `b42c633` once revalidated) ships first.
- The slices below land as a separate, later release, with their own migrations, reviewed after the 15 pending ones.

**Roadmap source:** `docs/ROADMAP.md` Milestone 4. Three items remain there:
- visits, parts and downtime on tickets;
- a preventive-maintenance queue;
- an estimated reagent-consumption gap.

## Starting point (verified in code)
- **Service screen:** since `b42c633`, the Service screen (`components/service-workspace.tsx`) holds the whole equipment register. It has status badges, Open/Urgent filter tiles and installation details.
- **Tickets:** `private.stockflow_service_tickets` (migration `20260908173500`).
  - Fields: `category` (includes `preventive_maintenance`), `priority`, and `status` open/resolved.
  - Edits use optimistic `version`.
  - Every command is idempotent through `begin_/finish_stockflow_command`.
  - Events are append-only (`opened` / `resolved`), and rows can't be deleted.
  - Everything goes through the single `stockflow_service_gateway(...)`.
- **Roles:**
  - creating a ticket: administrator, operations, sales, management;
  - resolving a ticket: administrator, operations, management.
- **Historical installations:** they come from Tally sale lines and have no order (migration `20261010071925`).

- **The live gateway is NOT the September text.** It was patched in place by two later migrations, so new migrations must never copy the September `create or replace` body:
  - `20261005054431_remaining_role_union_gateways` (role unions);
  - `20261010071925_historical_instrument_registration` (historical customers through `coalesce(o.customer_name, historical_customer.name)`, and nullable ticket `order_id`).

  New migrations either patch the definition the same way, starting from `pg_get_functiondef`, or start from the effective definition reconstructed after all three files.

## Branch and release rule
- Build S1–S3 on a **new branch off `b42c633`**, never on `codex/staff-signin-session-redirect`. That branch is the release candidate being revalidated.
- New migration timestamps must sort after every pending migration. They must stay out of the 15-migration production set.

## Principles carried over
- **Tally stays the only inventory authority.** Parts recorded on a visit are an engineer's note. They never move, reserve or adjust stock.
- **Reported is not proven.** Downtime is "reported downtime", entered by a person, and it is labelled that way everywhere. The economics plan already warns that tickets don't prove physical downtime.
- **No new screens.** Everything appears inside Service as badges, a tile, the ticket card and its forms. One clear next action per card.
- **Every new command:**
  - is idempotent, version-checked and role-checked on the server;
  - writes an append-only event;
  - can't be deleted.

## Slice S1: preventive-maintenance schedule ("PM due")
**User outcome:** Operations sees which instruments are due or overdue for maintenance, and logs it in one step.

**Data**
- New table `private.stockflow_maintenance_plans`:
  - `installation_id` (unique, references installations);
  - `interval_months` (1–24);
  - `next_due_on` (date);
  - `version`;
  - `created_by_email` / `updated_by_email` and the timestamps.
- Delete is blocked.
- Changes are recorded in `stockflow_service_ticket_events`-style plan events: a new `stockflow_maintenance_plan_events` table holding the old and new interval and due date, and the actor.

**Commands**
- **`set_maintenance_plan`** `{installationId, intervalMonths, nextDueOn, expectedVersion?, idempotencyKey}`:
  - creates the plan, or updates it (requires `expectedVersion`);
  - roles: administrator, operations, management.
- **Resolving a `preventive_maintenance` ticket** on an installation that has a plan advances `next_due_on`:
  - the new date is the resolved date (Asia/Kolkata) plus `interval_months`;
  - it happens in the same transaction, with a plan event `advanced_by_ticket`;
  - **lock order is fixed:** the ticket `FOR UPDATE` first, then the plan `FOR UPDATE`. `set_maintenance_plan` locks only the plan. The advance bumps the plan `version`, so a concurrent edit fails with `40001` instead of being silently overwritten;
  - **month end:** Postgres `date + interval 'N months'` clamps to the month's last day (31 Jan + 1 month = 28/29 Feb). This is accepted and stated in the UI as "every N months".
  - Resolving any other category leaves the plan alone.

**Read model**
- `get_service_workspace` adds `maintenancePlan` per asset: `{intervalMonths, nextDueOn, version}` or null.

**UI**
- **Per asset card:** a badge with these states:

  | Plan state | Badge |
  | --- | --- |
  | overdue | "PM overdue · 3 Oct" (red) |
  | due within 14 days | "PM due 20 Oct" (amber) |
  | later | "Next PM 12 Jan" (muted) |
  | no plan | nothing |

  The badge sits beside the existing status badge.
- **Summary strip:** a new tile "PM due", counting overdue plus due within 14 days. It filters the register the same way as the Open and Urgent tiles.
- **Inside "Installation details":** "Maintenance schedule: every N months, next due D". It has a small form for allowed roles: interval select (1, 2, 3, 4, 6, 12 months) and a first-due date.
- **On a due or overdue asset:** the main action becomes "Log maintenance visit". It opens the existing ticket form, pre-set to category Preventive maintenance and priority Normal.

**Acceptance checks (written first)**
- A unit check of the due-state function: overdue, due-soon and later at the 14-day boundary, in the Asia/Kolkata date. Include a 31-Jan plan advanced by 1 month.
- A SQL check that a historical installation (no order) still appears in `get_service_workspace` after the migration, and can still take a ticket and a plan. Same check for S2.
- A SQL check that a PM resolve racing a `set_maintenance_plan`: one wins, the other gets `40001`, and there's no deadlock.
- A SQL check that resolving a PM ticket advances `next_due_on` exactly once. Replaying the same idempotency key doesn't advance it twice.
- A SQL check that a stale `expectedVersion` on `set_maintenance_plan` raises `40001`.
- A SQL check that the sales role can't set a plan (`42501`).
- A browser check that the "PM due" tile filters to the due asset only, then clears.

## Slice S2: visits, parts and reported downtime on tickets
**User outcome:**
- An open ticket shows what happened on site and whether the instrument is down.
- Resolving it records when the instrument was back in use.

**Data**
- **Visits:** new append-only table `private.stockflow_service_visits`:
  - `ticket_id`;
  - `visited_on` (date, not in the future);
  - `engineer_email` (an active member);
  - `notes` (3–1000 characters);
  - `parts` as jsonb `[{name, quantity}]`, at most 20 entries. The name is 1–200 characters, and a Tally catalog name is suggested but not required. The quantity is a positive integer ≤ 999;
  - `created_by_email` and `created_at`.
- **Tickets:** gain `reported_down_at timestamptz null` and `reported_up_at timestamptz null`.
  - A check constraint requires `up >= down`, and `up` only when `down` is set.
  - The version bumps on change.
- **Event types:** the event `event_type` check is extended with `visit_logged`, `downtime_reported` and `back_in_use`.

**Commands**
- **`log_service_visit`** `{ticketId, expectedVersion, visitedOn, notes, parts, idempotencyKey}`:
  - only on open tickets;
  - roles: administrator, operations, management.
- **`report_downtime`** `{ticketId, expectedVersion, downAt, idempotencyKey}`:
  - on open tickets only;
  - `downAt` can't be later than now;
  - roles: create-ticket roles, since sales often hears about a breakdown first.
- **`resolve_service_ticket`** gains an optional `backInUseAt`:
  - required when the ticket has `reported_down_at`;
  - it must be at or after the down time and not in the future.

**Read model (bounded)**
- Today `get_service_workspace` returns every ticket with every event, unpaged. S2 must not add visits to every ticket.
- **Included in the workspace:** visits and parts for open tickets only, plus each asset's last 3 resolved tickets.
- **Fetched on demand:** older history comes per ticket from a new `get_ticket_history {ticketId}` read when the person opens it.
- **Measure:** record the workspace response size and time before and after, with the same dataset.

**UI (on the ticket card)**
- **Down badge:** when down, a red badge "Reported down since 9 Oct, 10:30 am" at the top of the card.
- **Visits:** listed newest first, as "12 Oct · engineer@… · notes". Parts show as small chips "Probe seal × 2".
- **The one button** depends on the ticket state:

  | Ticket state | Button |
  | --- | --- |
  | not yet visited | Log visit |
  | visited | Resolve |

  "Report instrument down" is a secondary text link.
- **Resolve form:** when the ticket was down, it asks "Back in use at" (date and time, default now).
- **Parts label:** "Parts used (engineer's note; stock is managed in Tally)".

**Acceptance checks (written first)**
- A unit check of command validation: empty parts, 21 parts, quantity 0, a future `visitedOn`, `up < down`.
- SQL checks:
  - a visit on a resolved ticket is rejected;
  - resolving a down ticket without `backInUseAt` is rejected;
  - concurrent visit and resolve with the same version: exactly one wins;
  - there's no stock-table write anywhere in the new functions (a grep check over the migration).
- A browser check: report down, the badge shows; log a visit with two parts; resolve with back-in-use; the badge clears and the history shows four events in order.

## Slice S3: reagent-consumption gap (link, not new math)
- The Economics screen already has reagent leakage (expected vs actual purchases, with reason codes that include instrument downtime and service issue). The roadmap's "estimated consumption gap" is therefore mostly built. **No second calculation.**
- **S3 shows reported downtime as context evidence** inside the Economics leakage review: "Reported down 4 days in Sep (2 tickets)". It is read-only and labelled as reported. That way a reviewer can choose the downtime reason with evidence.
- Overlapping down intervals on the same installation are merged before days are counted, so two tickets for one outage aren't counted twice. An open interval counts up to now and shows "still down".
- **Dependency and discovery:**
  - S3 needs S2.
  - It also needs a confirmed link from an economics placement target to its installation. Discovery step: read `instrument-economics` targets and the historical installation link before the design is final.
  - The finance-only visibility of Economics is unchanged.

## Order and ownership
1. **S1, then S2.** Both change `stockflow_service_gateway` and the same tables, so they run one after the other, never in parallel. **S3 last.**
2. **Each slice:**
   - Claude writes the spec and checks;
   - Codex implements (Sol tier, because of the migrations);
   - Claude reviews the diff and runs SQL, unit and browser checks, and reviews the screenshots;
   - Claude commits.
3. **Under primary review (AGENTS.md):** migrations, permissions and concurrency. The final integration and the hosted release stay with the integration chat.

## Decisions needed from the owner (defaults used if none given)
1. **Who sets the maintenance schedule?** Default: administrator, operations, management.
2. **Typical PM interval per instrument model?** Default: none preset. The interval is set per instrument when first needed.
3. **Can sales report "instrument down"?** Default: yes. Logging visits and resolving tickets stay with operations, management and administrator.
4. **Parts names:** free text with Tally catalog suggestions (default), or catalog-only?
