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

## Completed release readback

PR [#49](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/49) merged normally at `7f67fcaf642f43ef07713cf077cf35515a5b7e2b`. Exact source head `a54e3b1f0c05695e618db1cf590ffe45c78f113e` passed [GitHub run 38535111865](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/actions/runs/38535111865): full Linux disposable SQL replay, 1,194 units / 135 files, static/build/connector checks, 36 general / 407 staff browser checks plus three intended device skips / 20 offline checks, dependency audit and 21 contract checks. Validated build stored. Final local eight clarity browsers, typecheck, full lint, offline/staff builds and Wrangler dry-run passed. No check disabled. This UI-only slice added no migration; local SQL was not redundantly replayed, while CI replayed the combined tree.

Acceptance Worker `9ee38923-9294-4991-ada1-f3a8c14686a9` independently serves 100% of traffic. Rollback: `0664bfbe-645f-4c14-a9fb-5f8e949e9326`. The promotion guard checked all 536 source and 162 artifact files, exact source tree/head, CI success, acceptance project and immediately preceding Worker. Public binding values and secret binding shapes were preserved. Thirteen hosted checks passed: shell, private API denial, served asset hashes and Edge denial. Database history remains 62 (latest `20261014073049`), Orders Edge v12 and Sync v4 unchanged; existing economic/order/customer/member/receipt/snapshot fingerprints unchanged after the unsaved-draft check.

Real Administrator browser evidence at 375 × 812: an unsaved Acceptance Laboratory draft displayed quantity `1 Nos` for Acceptance Glucose Reagent, with no horizontal overflow. Closed without saving. Requirements' Acceptance Analyzer Cleaner waiting row opened the correct existing `SF-260926-00021` detail for Acceptance Laboratory through the usual Orders access path. No order transition or hosted business/financial/source command executed. The live history contained no qualifying seven-day repeat; positive warning, inline draft preservation and permitted repeat submission are demonstrated by automated fixtures, not claimed as real-data acceptance. Temporary viewport reset and agent-created tab closed.

Screenshots and machine-readable evidence are in ignored `work/orders-clarity-release-20261014/`: `acceptance-order-unit-mobile.png`, `acceptance-requirements-order-mobile.png`, `ci-result.json`, `promotion-guard.json`, `hosted-http-verification.json` and `backend-verification.json`. Local RC fast-forward preserved all 70 remaining dirty file contents byte-for-byte. These final release-note/status/shared-log updates are intentional local post-merge documentation, outside the validated source head.

Both shared logs reread at completion. Claude's latest released Accounts stack is `claude/social-styles` (`7ed837e`: classes → pin check → app-only contacts → Power Map → Social Styles); the active `claude/erase-contact-ui` claim still owns Accounts route/types/workspace/tests. No Accounts source edit or new stack deployment in this slice. Do not integrate superseded Tally-contact mirror or change the connector for it. Next: reconcile the final released top branch, primary-review financial/access/erasure/concurrency semantics and map migrations, then combined replay before any promotion. Full-sales completeness and financial reconciliation remain prerequisites for showing account classes; the shipped proposal seam stays false. Production, real staff-role checks and register gates remain open. Orders clarity source/integration claim released.
