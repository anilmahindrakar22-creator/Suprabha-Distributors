# Order notifications — build and acceptance plan

Owner: ChatGPT / Codex, integration owner. 11 October 2026, Asia/Kolkata.

User instruction: start the order notification service, **inside the app first**; plan it properly and keep the Orders UI simple. Latest controlling correction: as an order moves through stages, notify the role responsible for the next task so they know work has arrived, with a fast processing workflow similar in purpose to Blinkit. This is an operational handoff service. The earlier passive update-inbox design is superseded wherever it conflicts with this revision. This document defines the build contract. It does not certify a running service.

## Outcome and UI

Staff receive incoming work at the stage they own, open the order and perform the next task. Reuse the **existing bell**, showing the count of distinct orders currently awaiting that user's/team's action. The badge is pending work, not a general unread activity count. No additional toolbar, dashboard, navigation entry, permission popup or mandatory settings form.

Open the bell to see two compact sections:

- **Work waiting:** actionable orders for the current user's operational roles, each showing customer, order number, task (for example "Pack this order"), priority and time waiting **in this stage**. New arrivals get a small New indicator. Tap opens that exact order with the correct next-action control. Overdue/urgent work comes first, then oldest waiting work; do not bury backlog behind the newest rows.
- **Exceptions:** blocked work, due follow-ups and delivery problems requiring that user/team. An order with multiple flags is still one pending order in the badge. Completion notices to the creator are secondary, available behind a small History toggle, and never increase the work badge.

Use the same stage colours and text labels as Orders. Red is for an actual problem; an ordinary new order is not an error. Use 44 px tap targets, a drawer on mobile and a small popover on desktop. Distinguish **New**, **Seen** and **Still waiting**. Reading is not completion. Do not sum overlapping summary categories to calculate a pending-order badge.

On a newly arrived handoff, animate/highlight the one bell briefly and announce "Order SO-123 ready to pack" once. Do not open a modal or repeat the signal on every refresh. A short optional sound toggle can be offered inside the bell if needed later; no sound/OS permission requirement in V1. Opening a task acknowledges that handoff only but leaves it in Work waiting until the underlying stage is completed. "Mark all seen" changes New indicators only, never removes or reduces pending work.

When a stage completes, all recipients of its role/team queue lose that completed task, and the next role receives a new handoff. If the next role is the same user (combined roles), they still see the distinct new task. Broad "ignore events created by yourself" filtering would miss this case and is forbidden. An internal status change within one task (such as confirmed → ready for picking) does not produce another arrival notification.

The bell must remain accessible while staff use other app sections. Integrate its final location with the existing frame header after Claude releases the relevant files; remove the old Orders-only bell at that same milestone, so there is exactly one.

## V1 signals and recipients

Server-side policy maps **current status to operational task owner**, rather than sending every historical event to everyone who can view an order. Use immutable audit events for stage entry time/identity and reassignment signals. Eligibility requires active membership, current access, a relevant operational role, and a valid next action; view permission alone does not make someone the task owner. Read the live transition/approval policy during implementation; do not grant privileges through notification routing.

| Order enters task/state | Primary receiving role and action |
| --- | --- |
| New / awaiting confirmation | Sales or Operations responsible for confirmation; "Confirm this order" |
| Approval required | Management/authorised approver; "Review approval". Pending approval does not enter the warehouse's ready-work queue |
| Confirmed / partially_reserved / fully_reserved / ready_for_picking / picked | Warehouse, with Operations fallback; "Pick & pack this order". Stock/price blockers are explicit, not a false ready signal |
| Packed / awaiting_tally_billing | Accounts, with authorised Operations fallback; "Bill this order in Tally" |
| billed_in_tally / ready_for_dispatch | Operations/dispatch responsibility; "Prepare / dispatch this order". Do not notify Accounts again merely because the invoice stage label still says Billing |
| dispatched | Operations responsible for delivery; "Track / confirm delivery". Track normal transit without repeatedly treating it as urgent |
| Delivered / cancelled | Close all active tasks; optional creator completion information, no next-role work notification |
| Assignment changes within a task | Eligible new assignee receives handoff; former assignee's task disappears. Invalid/inaccessible assignee produces a visible team-routing exception |
| Follow-up due / delivery exception / blocked task | Current responsible assignee/team; overdue/unowned items visible to Operations/Management oversight |

This matrix chooses responsibility; Administrator/Management oversight permissions are not a reason to duplicate every routine Warehouse/Accounts task in their personal work queue. The existing single `assigned_to_email` is an order-wide field, so do not blindly carry a Sales assignee into Warehouse or Accounts. Honour an assignee only if they are eligible for the current task; otherwise route to its role/team and show that it is unassigned for this stage. V1 does not require an extra Accept/Claim click: use existing assignment and order-version concurrency. Team task completion by one worker clears it for the others. Combined roles see a union, deduplicated by order/task occurrence. Recheck permissions on every read/action; removed roles or suspended users lose access immediately.

Role-work lists/counts include picking, billing and dispatch in V1: these are core handoffs, not optional later reminders. Existing summary values are useful checks but often count all accessible orders; they are insufficient to prove operational responsibility. Derive Work waiting and its distinct-order count from the same server task-owner predicate. Do not infer actual dispatch, delivery or stock arrival from Tally billing. Dates use the existing Asia/Kolkata clock; waiting time starts at task entry, not generic `updated_at`, which a note could reset. Use existing attention thresholds initially; no invented 10-minute delivery promise or silent policy change.

Example: Sales confirms SO-123 → Warehouse sees **New · Pack SO-123** → Warehouse packs → their task clears and Accounts sees **New · Bill SO-123** → Accounts bills → their task clears and Operations sees **New · Dispatch SO-123** → dispatch moves it to delivery tracking → confirmed delivery closes active work. Pricing approval or stock shortages interrupt this chain visibly and notify the role that can resolve the blocker.

## Source of truth and minimum storage

Verified repository seams:

- `private.stockflow_order_events`: immutable IDs, order ID, event type, actor, from/to status, metadata and creation time. Assignment and delivery-exception audit events already exist.
- `private.stockflow_outbox`: existing `order.created` and `order.status_changed` events are written with commands; its processing state may belong to other integrations.
- `/api/orders?summary=1` and `get_order_summary`: existing authenticated, role-scoped workload counts, with no catalog or Tally fetch.
- Existing order access, transition policies, idempotency keys and versions remain authoritative.

Use canonical current orders plus audit events as the current-task projection. Do not create a second order/event store or a separate microservice. Do not consume or mark shared outbox rows processed to implement a browser inbox. External delivery can use a separate consumer later.

Task identity is `(order_id, task_key, stage_entry_event_id)`; the entry event is the start of the current contiguous operational task, not every internal status change. Re-entering a task after correction/reopening has a new entry identity and notifies again. An assignment change creates a distinct recipient arrival without pretending the order changed stage. Current-state checks automatically resolve obsolete notifications even if they were never read. No custom Completed button: completion comes only from the existing order command. Historical stage entries remain in the audit trail.

New database objects, created in one additive migration:

1. `private.stockflow_order_notification_receipts`: canonical member email + canonical stage-entry/assignment audit event ID + task key as the unique identity; `seen_at` timestamp. Foreign key to the existing immutable event; no copied customer, product, totals, invoice or GP fields. Repeated acknowledgement is idempotent. Current membership, operational eligibility and access are validated. Seen receipts do not suppress active work.
2. `private.stockflow_order_notification_config`: one service configuration row with `enabled`, `starts_at`, and recorded activation actor/time. Initial state disabled. Activation time prevents a flood of historical updates; current pending work still appears in reminders.

No per-role settings UI, recipient fan-out worker or scheduler in V1. Eligibility is a server-side read projection over canonical events joined to their current orders/members. Keep it as one policy helper, not duplicated in React. Write read receipts only on explicit acknowledgement.

**Current work never expires after 30 days or hides at activation.** Backlog is included with "Already waiting" at first activation; only newly committed stage arrivals trigger a New-work signal. Optional completion history has a 30-day display window, while source audit history remains intact. No automatic deletion of audit events. Closed orders remain accessible for legitimate completion information through existing access rules.

## API and concurrency contract

Proposed route `app/api/order-notifications/route.ts`, through the existing authenticated gateway pattern:

- `GET`: `{ enabled, work, pendingOrderCount, newWorkCount, exceptions, nextPage, checkedAt }`. Each work row includes stable task occurrence identity, canonical order ID, display number/customer, task/next action, stage entry time, owner role, seen state and priority. At most 50 rows per page; financial details excluded. Counts and list share one operational eligibility/access predicate. Response is `private, no-store`.
- `POST`: `{ action: 'mark_seen', taskOccurrences: [...] }`; at most 50 explicit canonical identities. Actor comes from the trusted session, never the body. Unique receipt insertion makes repeats idempotent. Unauthorised IDs fail closed; the acknowledgement transaction is atomic. A superseded task returns its resolved state, not a misleading new task acknowledgement. Existing versioned order commands perform the work.

Start without a client event cursor for correctness. Query active task occurrences with deterministic priority/entry-time/ID ordering and stable page boundaries. Never assume `max(event_id)` means all lower-ID transactions committed. Every refresh reconciles current work, so the previous role's completed task disappears and the next role's task arrives even when their overall counts are unchanged. Seen receipts/task identities deduplicate arrivals across repeated reads; one browser tab leads arrival signalling where feasible so two tabs do not repeatedly flash the same handoff. New arrivals are never acknowledged by a "mark all seen" operation started earlier.

Opening an update requires an **exact-order navigation contract**, including orders outside the current queue/page or already delivered. The server loads that order only after access validation. Existing queue-only `stockflow-open-orders` navigation is insufficient. Do not substitute a broad queue link and call it an exact-order link.

## Foreground service and failure behaviour

- One active request per mounted staff session. Target **within 15 seconds** for another user's committed handoff in a visible online app; foreground reads every 15 seconds initially, with indexed bounded queries and no Tally/catalog fetch. Refresh immediately after this user's successful stage transition and on opening the bell/resume. Do not ship the earlier 60-second prototype as a fast-work guarantee. Consider authenticated live change signals only if needed after measuring this bounded approach; no direct private-table access from the browser.
- No polling when hidden/offline; abort outstanding reads on session change or unmount and ignore late responses from the previous session. Clear notification memory on account change/sign-out. No inbox/customer data in localStorage or the offline vault.
- Requests time out after 15 seconds. Network/server failures use 1/2/4/5-minute bounded backoff and visible "Updates unavailable · Retry" within the bell. Last successful data is labelled stale; a failure never means zero notifications.
- 401/403 clear private results and stop polling; show sign-in/access status through existing session handling. Do not auto-retry authentication failures forever.
- Acknowledgement failure leaves the New indicator with Retry. Opening/processing the order still works. Stage advancement, rather than reading, resolves active work. Notifications never bypass order transition permissions, expected versions, command idempotency or ACID correctness.
- Current work remains available after closing/reopening the app because it is projected from persisted current state and audit events. If an order already moved on while the app was closed, show only its current eligible task, not a stale stack of old-stage notifications.

No browser push, email, WhatsApp, background app-closed delivery or paid provider is included. This channel limitation is explicit, not a silent failure.

## Files, ownership and sequence

Claude currently owns Orders, frame/navigation and redesign tests. This chat must not edit those files concurrently. Reread handover/rollout before each integration step. No deployment of unfinished Claude changes.

1. **Contract/checkpoint:** this plan, event/role/queue mapping review and exact-order navigation contract. A gateway query may provide notification data; it must preserve all existing gateway actions.
2. **Backend:** new additive receipt/config migration, server task-owner/stage-entry projection, role-work read RPCs, gateway actions and bounded API. Verify actual stage policy and pricing/stock blockers on disposable Postgres. Claim exact migration/test/API/gateway files before editing. Do not modify old migrations.
3. **Client:** evolve `lib/order-notification-service.ts` from summary prototype to the settled feed contract; implement one notification panel and single-flight lifecycle. No duplicate bell/toolbar. Deterministic timer/network tests first.
4. **Orders integration:** after owner handoff, claim exact header/Orders/navigation seams; connect the one bell and exact-order opening, remove the former bell. Verify actual mobile and desktop rendering and keyboard/focus behaviour.
5. **Acceptance:** replay migrations, deploy only the completed reviewed slice, activate from a recorded timestamp, verify authentic roles and sample order events. Record versions, tests and rollback. Production activation follows only the notification-specific acceptance checks; unrelated economics checks neither certify this service nor justify deploying unfinished economics changes.

Expected effort: roughly 2–3 focused engineering days (backend/policy ~1 day, client/integration ~1 day, verification/acceptance ~half to one day), plus the existing header/navigation handoff and real-role session availability. This is an estimate, not a promised deployment time.

## Acceptance checks required before release

- One bell; no added page-height strip; phone list density maintained at 375 px and no sideways scrolling at 320 px. Opening/closing the panel restores focus and does not hide the order's primary action.
- Exercise Sales/Operations confirmation → Warehouse pack → Accounts bill → Operations dispatch/delivery with distinct real-role sessions: incoming task within 15 seconds of commit, previous task resolved, exact order/action opened. Equal-count replacements still notify.
- An app closed during an update shows it after reopening; unchanged polls cause no duplicate rows or repeated announcements.
- Exact-order links work beyond page one and for delivered/cancelled updates; forbidden orders fail closed without displaying private details.
- Combined-role user sees one task occurrence per order; performing a transition that creates their own next-role task still signals incoming work. Acknowledgement cannot clear unfinished work; one team member completing it clears it for everyone. Assignment cannot strand an order with a person in the wrong operational role. Sales sees only permitted orders; suspended/removed memberships lose access.
- Re-entered stages notify again; internal statuses within one task do not spam. Backlog survives activation, date boundaries and display-history limits. Blockers route to their resolver; Management sees exceptions without every routine bill/pack task. Concurrent advances, repeated commands, late commits, two tabs and acknowledgement/new-arrival races preserve stage/seen correctness.
- Polling stops while hidden/offline; timeout/backoff/reconnect/session-switch checks pass. Failed reads remain visibly stale; failed acknowledgements remain unread.
- Order commands still succeed when notifications are disabled or unavailable. No Tally/catalog import, invoice/GP disclosure or order-state mutation from alert reads.
- Migration/API checks, relevant units, browser workflow tests, lint/typecheck and staff build pass on the combined reviewed slice. Hosted checks use actual staff access, not synthetic tests as certification.

Rollback: disable notification config to stop the feed, restore the previous Worker/gateway if needed; retain receipt/source history. Do not roll back or delete order transactions. Additive tables can remain unused safely.

## Current state

Plan complete; service **not integrated, activated or deployed**. An initial summary-only prototype exists in `lib/order-notification-service.ts` and `components/order-notification-service.tsx`, reachable only through an isolated test-fixture view. It is unverified and excluded from release. Its extra toolbar and group-count announcements are not the final UI or event delivery contract. The application mount was removed before deployment; `app/page.tsx` retains its original frame rendering. No migration, staff message, Tally read/import, paid service or hosted change occurred for notifications.

The prototype demonstrates the polling seam only. Queue totals cannot guarantee individual handoffs, resolve obsolete role-work or distinguish one new order replacing another. Its 60-second interval/passive update design is superseded and must not ship. Next implementation is the server role-work/task-occurrence contract and seen receipts, followed by the single-bell integration with Claude's current UI seam. Claude's proposed `updates/read` props must be reconciled with `work/seen/pending` semantics before integration; record this correction in the shared handover rather than editing their claimed UI files.
