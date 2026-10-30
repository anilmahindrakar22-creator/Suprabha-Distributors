# Design: Today, the decision screen (Action Center v1)

*Claude, 30 Oct 2026. Train `claude/train-20261113`. This implements a first slice of `docs/intelligence/ACTION-CENTER.md`, scoped by the owner's direction:*

> "The stockflow app should make it possible to bring 50 cr revenue by faster easier targeted decision making and not just track revenue. Decisions should bring revenue."

## 1. What it is
The landing screen for administrator and management. It shows two lanes of ranked decisions. Each card shows an icon, a decision verb, the ₹ at stake, and **one tap** that opens the existing flow.

| Lane | Unit | Decision types |
| --- | --- | --- |
| **Unblock today** | ₹ waiting in orders (one-off) | U1 approve price; U2 stock arrived that covers waiting orders; U3 order stuck over 24 h |
| **Grow** | ₹ per month (recurring) | G1 Focus lab with no diagnosis; G2 deadline without a plan (lock-in, tender or open question); G3 overdue commercial action |

The two units are **never added together or compared**.

## 2. Invariants
- **T-1 Read-only composition.** Today reads existing entities: orders and pricing decisions, stock alerts, wallet read, opportunities, constraints, actions, and contract windows. There are no new tables and no new decision entity (ADR-0008 spirit).
- **T-2 Versioned ranking.** The policy is `today-v1`. Within a lane:
  1. ₹ known comes before ₹ unknown;
  2. then ₹ descending;
  3. then the soonest due or oldest waiting;
  4. then a stable id.

  The response carries `policyVersion` and, per row, `rankReason`, which is one of `value_known`, `value_unknown` or `due_soon`.
- **T-3 Fail closed.** Wallet gaps appear only when sales coverage is certified (as `stockflow_wallet_read` already enforces); otherwise G1 is absent and G2's value is unknown. An unknown ₹ shows as "₹ ?", never 0.
- **T-4 No purchase rates or GP.** Order values use the **customer rate**: `approved_rate × remaining quantity` on lines with an approved pricing decision. For a pending approval (U1), the value is `proposed_rate × quantity`, marked `approximate: true`. Cost, GP and margin never appear.
- **T-5 Bounded.** At most 5 rows per lane, plus each lane's total count. Administrator and management only (`PT403` otherwise). Target: first render ≤ 2 s warm (Action Center §2). The gateway runtime is measured on a replayed database and reported.

## 3. Read gateway
`public.stockflow_today_gateway(p_gateway_key, p_actor_email, p_action, p_payload)`. Action `get_today`, with payload `{}`. Key check as in the other gateways.

Response:
```
{ policyVersion:'today-v1', generatedAt,
  unblock:{ total, rows:[{ type:'approve_price'|'stock_covers'|'stuck_order', title, subtitle, valuePaise|null, approximate, since, rankReason, target:{kind:'order', orderId}|{kind:'stock', itemKey} }] },
  grow:{ total, rows:[{ type:'diagnose'|'deadline'|'overdue_action', title, subtitle, valuePaisePerMonth|null, valueKind:'gap'|'expected'|null, due, rankReason, target:{kind:'lab', customerId} }] } }
```

Sources:
- **U1:** orders whose lines have a **pending** pricing decision. Use the same "pending approval" predicate the price inbox (`order-price-inbox` gateway action) uses; read it, don't invent one. One row per order: the customer name, the number of lines and the waiting time.
- **U2:** stock-increase alerts from the last 7 days where Tally stock now covers every waiting order. Use the same coverage computation the requirements alerts already return (`coveredOrders = waitingOrders`). The value is the sum of the known order values; it's null if any covered order has an unpriced line.
- **U3:** open, non-archived orders matching the existing urgent-exception rule (`stockflow_operations_summary.urgentExceptions`: `awaiting_approval` or `partially_reserved` not updated for 24 h), plus orders in `packed` or `ready_for_picking` not updated for 24 h. Exclude orders already listed under U1.
- **G1:** wallet-read rows in the Focus band with no open opportunity whose current constraint is known. The value is the gap per month, with `valueKind:'gap'`. Present only when coverage is certified.
- **G2:** `stockflow_contract_window_gateway` page 1, called with the same key. The value is that lab's gap per month when certified; otherwise null.
- **G3:** open commercial actions (no result row) with `due_on` < today. The value is `expected_monthly_gain_paise`, with `valueKind:'expected'`, or null.

## 4. Screen
- **Surface:** a new `today` surface, the **first** nav item and the **default landing** for administrator and management only. Every other role is unchanged.
- **Layout:** two lanes, using the V1 primitives (`ToneIcon`, `StatusChip`). Each card has:
  - an icon by type (§3 of the visual design);
  - the title and the subtitle;
  - the ₹ value on the right: `₹48k`, `≈ ₹48k` when approximate, `₹60k/mo gap`, `₹25k/mo expected`, or a muted `₹ ?`;
  - one button: Approve / Release / Open / Start / Plan / Follow up.

  Each lane header shows its total, and a "Show all n" link opens the existing queue: price inbox, requirements, the orders attention filter, the Wallet focus view, or Actions due.
- **Taps:**
  - an order opens that exact order, through the same mechanism the work bell uses;
  - stock opens Requests → requirements;
  - a lab opens Accounts → Wallet with that lab's sheet open. Add an `initialCustomerId` to the Wallet workspace if it doesn't exist.
- **Empty lane:** one muted line, "Nothing to unblock" or "No growth decisions yet". For Grow, while uncertified, the line is "Growth decisions need wallet estimates and certified Tally sales". This is honest about why it's empty.
- **Phone:** 375px; the lanes stack (Unblock first), with no horizontal scroll.

## 5. Not in v1 (an amendment to ACTION-CENTER.md)
These are deferred until real data and use exist:
- the proposal lifecycle (PROPOSED → APPROVED → … with frozen economics);
- the decision drawer with seven questions;
- the role views for sales and operations;
- GP and capital columns.

## 6. Checks
**SQL** `supabase/tests/today_decisions.sql`, on a real database, asserting only on fixture rows:
- **T1:** U1 shows a pending approval with the approximate value from the proposed rate.
- **T2:** U2 appears only when coverage is complete.
- **T3:** U3 is stuck past 24 h, and is excluded when the same order is in U1.
- **T4:** G2 and G3 values and `valueKind` are correct, and ranking is known-before-unknown.
- **T5:** at most 5 rows per lane, with the total counted.
- **T6:** sales and operations get `PT403`, and no response contains `cost`, `margin`, `gross` or `purchase`.
- **T7:** uncertified coverage → no G1, and G2's value is null.

**Browser** `today.spec.ts` at 375 and 1280:
- the lanes render with values and the "≈" and "₹ ?" states;
- each button opens the right place;
- the empty and uncertified lines;
- administrator lands on Today while sales doesn't see it;
- no overflow.
