# Orders clarity integration — 14 October 2026

Owner/integrator: Codex. Released Claude branch `claude/order-clarity` at `f2dcc7a`; actual Git parent `b99cbe1` (handover prose said `e13c993`). Current base RC `2949906`. Integration branch `codex/handover-orders-clarity`.

## Observable behavior

- Each order quantity displays the exact current Tally unit. A blank unit says "units" with "Unit not set in Tally"; no pack conversion or invented unit.
- A possible-repeat warning checks overlapping canonical item keys in the selected customer's already-loaded recent OMS history, considering open orders within the last rolling seven days. Cancelled/delivered orders, future/invalid dates and non-overlapping items are excluded. Most overlap wins, then newest. It is advisory and bounded to the existing 20-order page, not an exhaustive duplicate guarantee or full Tally history.
- Show/Hide order expands matching items/status/date inside the draft. Quantity and customer stay intact; staff can still save a legitimate repeat.
- Requirements contributing rows open the corresponding order through the existing frame navigation/detail path and server access controls. No new API, query, migration, Edge, connector or financial logic.

Resolved the one frame conflict by retaining Accounts and adding the Requirements callback. Existing notification reconciliation, cross-user Orders refresh, scoped caches and offline command recovery remain intact. Requests is included in the existing lint command. Fixed one actual accessibility lint diagnostic: labelled warning region, semantic live output for the message, separate detail controls. No rule disabled.

## Checks and evidence

Separate frozen candidate: `work/orders-clarity-release-20261014/` (ignored).

- Initial combined unit run: 1,194 tests / 135 files pass.
- Initial selected browsers: 109 pass, one intentional phone-only Accounts layout skip. Covers order clarity, keyboard capture, entry layout at 320/375/768/1280 widths, offline order recovery, Requirements, cross-user refresh and Accounts.
- After semantic markup correction, focused units: 12 / two files pass. Final focused browsers, static checks and builds pending at this note's initial creation.
- Full exact-head CI required before normal merge and guarded acceptance-only Worker promotion.

The previous Accounts freeze helper was mistakenly reused before new verification. Its candidate/archive were restored from exact verified `fe33407`; all original 534 final source hashes match. Earlier hosted/build/CI evidence was unchanged; audit note saved beside the previous evidence. Orders now has its own separate candidate. Repository source and hosted app were unaffected by that helper error.

## Coordination and release limits

Read both shared logs before starting and merging. Preserve all existing dirty documents/images/AGENTS/standalone work. Prior Accounts release readback and canonical status are explicitly owned documentation reconciliation in this slice, not source behavior changes.

Acceptance rollback is Worker `0664bfbe-645f-4c14-a9fb-5f8e949e9326`. Keep its public values and secret binding shapes. Database history remains 62; Orders Edge v12 / Sync v4 remain unchanged. Capture current source/artifact hashes, exact-head CI and current Worker version before promotion; then independently verify served assets, private APIs, real-session read-only screens and phone fit. No hosted order or business fixture should be created for a screenshot.

Production, financial/Tally reconciliation, real financial Accounts/Sales/Operations sessions and register release remain gated. PO/GRN references wait for the owner/connector decision recorded by Claude. No production deployment in this slice.
