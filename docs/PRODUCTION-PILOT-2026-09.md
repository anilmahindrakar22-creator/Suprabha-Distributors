# StockFlow production acceptance and pilot

## Acceptance run — 11 September 2026

Production order `SF-260911-00031` was created as `ZZ TEST - PRODUCTION ACCEPTANCE 11 SEP 2026` and completed through confirmation, fulfilment, pick and pack, Tally billing handoff, billed status, dispatch and delivery. The test references are deliberately labelled `TEST-ACCEPTANCE-00031`, `TEST-DOCKET-00031` and `TEST-POD-00031`. The invoice reference is not a Tally voucher and correctly remains “Invoice not found”. The order is retained as immutable operational evidence.

The run found one defect: saving fulfilment with a blank optional promised-delivery date sent an empty string and was rejected. The local fix now omits the field when blank; it requires the normal release process before production is corrected.

## Performance baseline before changes

- Orders screen became usable 562 ms after selecting Orders on the measured warm session.
- Recent production order-list requests took 465–1,004 ms at the worker.
- Production order mutations during the acceptance run took 376–1,289 ms at the worker, excluding one 400 response from the blank-date defect.
- Current snapshot: approximately 545 KB total, containing 371 KB of catalogue data and 78 KB of cached invoice data.
- Current customer directory: approximately 92 KB for 457 active customers.
- Current active-order page data: approximately 7 KB for five active orders.
- Built client assets include approximately 209 KB CSS, 190 KB framework JavaScript and 112 KB StockFlow screen JavaScript before transfer compression.

These are single-run baselines, not percentile service-level claims. The catalogue and customer payloads are the first optimization candidates; order data itself is currently small.

## Five-working-day device checklist

Run this once on each staff device and each approved account. Record device, account, date and result without entering passwords or customer-sensitive data in this file.

1. Sign in, open Orders and confirm the `+ Order` control appears.
2. Enable trusted-device draft saving and enter a clearly labelled test customer and one product, but do not submit.
3. Disconnect the device, close and reopen StockFlow, and confirm the same account recovers the draft.
4. Reconnect and submit once; confirm only one order is created.
5. Create another unsent draft, sign out and sign in with the second approved account. Confirm the first account’s draft content is not displayed.
6. Sign back into the first account, confirm its draft is still recoverable, then discard it.
7. Record any loading delay, duplicate order, stale data, lost draft, cross-account data display or unclear message as a pilot incident.

Do not use real patient data. Do not change Tally, connector, permissions or Service settings during the pilot.

## Pilot exit gate

Proceed only if five working days complete without duplicate submissions, lost committed orders, cross-account draft exposure, unexplained Tally slowdowns or unresolved critical workflow failures. Service expansion remains deferred.
