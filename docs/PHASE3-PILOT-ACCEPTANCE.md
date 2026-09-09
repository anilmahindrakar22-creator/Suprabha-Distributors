# Phase 3 production pilot acceptance

Use this checklist for five representative working days before declaring the StockFlow OMS Phase 3 operationally complete. Record facts from normal work; do not create duplicate Tally transactions merely to exercise the application.

## Release under review

- Production baseline: Site version 37, source revision `9afdbda`.
- Pilot owner: to be assigned.
- Start and end dates: to be recorded.
- Participating roles: administrator, order desk/operations, accounts and warehouse where applicable.
- Tally company and financial year: record the exact company and year used.

## Daily checks

For each working day, confirm:

- Staff can sign in only with approved accounts and see only permitted actions.
- A normal order can be captured with a canonical Tally customer and any synced Tally product.
- Whole-number quantities, notes, priority and promised-delivery date save correctly.
- The saved order appears once, even after a slow response or retry.
- Confirmation and preparation update the same order without jumping away from the operator's position.
- Accounts can identify the correct current-year Tally sales invoice for the same customer.
- Invoice identity and item/quantity reconciliation show separate, accurate outcomes.
- Dispatch and delivery evidence can be recorded and appears in the activity log.
- Cancellation is restricted to administrators, requires a reason and preserves the order history.
- Search, date filters, customer history and operational queues include the expected orders.
- Tally remains responsive during normal billing and browser refreshes do not trigger extraction.

## Offline and recovery exercises

Run once on an explicitly trusted test device without using a live order that staff might fulfil twice:

1. Begin an order while online and allow the product/customer masters to load.
2. Disconnect, save the draft and close the browser.
3. Reopen while offline and confirm the draft remains attributable to the same account.
4. Reconnect and submit; confirm exactly one server order is created.
5. Repeat a submission after an uncertain response and confirm recovery finds the accepted order.
6. Switch accounts and confirm one account cannot view or submit the other account's protected draft.

Do not test confirmation, billing, cancellation, dispatch or delivery while offline; these operations require server acceptance.

## Two-user integrity exercises

- Open the same order in two approved sessions. Save a permitted edit in the first, then attempt a stale edit in the second. The second session must receive a conflict and must not overwrite the first change.
- Retry the same confirmation or fulfilment action with its original request key. It must not duplicate the transition or activity event.
- Verify that every accepted change records actor, role, time, action and request evidence.

## Measurements

Capture at least ten representative samples where practical:

| Measure | Acceptance target | Evidence to record |
|---|---:|---|
| Warm Orders screen | useful list within 2 seconds | p50, p95, failures, device and connection |
| Order save | p95 under 2 seconds | p50, p95 and any retry/recovery outcome |
| Product search | result under 200 ms after masters load | typical and worst observed value |
| Full normal capture | customer plus three products within 60 seconds | completion time and operator notes |
| Tally billing impact | no repeatable regression over 10% | before/after billing timings on office PC |
| Connector refresh | no overlapping extraction; browser refresh adds no Tally query | connector health timestamps and failures |

## Incident log

Record each issue with date/time, order number, user role, observable result, expected result, whether work could continue, and whether data was lost or duplicated. Never paste gateway keys, customer payloads or other secrets into the log.

Severity:

- Critical: unauthorized access, lost/duplicated order, wrong verified invoice, corrupted history or material Tally disruption.
- High: normal order flow cannot continue without administrator intervention.
- Medium: recoverable error or materially confusing result.
- Low: visual or wording issue with a safe workaround.

## Completion gate

Phase 3 can be accepted when all of the following are true:

- Five representative working days are complete.
- No unresolved critical defect remains.
- No repeatable duplicate, lost-edit or wrong-invoice outcome is observed.
- Offline recovery and two-user exercises pass.
- Performance evidence meets the agreed targets or has an explicitly accepted exception.
- Backup coverage and an isolated restoration procedure have been verified.
- Administrator, operations and accounts representatives sign off.

If a critical integrity or Tally-impact issue appears, pause the release acceptance, preserve the evidence and return to the last known safe workflow. Do not delete affected business records.
