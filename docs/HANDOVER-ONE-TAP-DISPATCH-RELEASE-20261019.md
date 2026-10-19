# One-tap dispatch release — 19 October 2026

## Production deployed; signed-in production observation pending

Owner authorized `claude/one-tap-dispatch` at `a87f35f06608e4f7e1afcf6a64e829f261528c7c`, acceptance first, then production. Codex remains the sole integrator/deployer. Integrated candidate `8da1a5a63deda321ecf7c79ff8029bff526c98a1` on `codex/one-tap-dispatch-release`, PR69: https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/69. Source and GitHub CI merge tree both `2dad92ba281e54656856572d121a95cc7b0f0866`.

Six package files only: `components/order-workspace.tsx`, `components/product-request.tsx`, `lib/dispatch-options.ts`, `tests/pricing-browser/order-next-step.spec.ts`, `tests/unit/dispatch-options.test.ts`, `tests/unit/ui-input-bounds.test.ts`. Client-only; no API, database migration, Edge, connector or financial policy change.

Local delivery is now an immediate dispatch command for eligible Operations/Administrator users; outstation opens the dispatch form. Shared delivery/courier options, IST date default, pricing-only stale notices and Product requests accessible name are included. Primary review confirmed existing role/stage, version, idempotency and recovery checks remain in the existing command path; failed commands do not claim success. Hosted checks must not click Local dispatch, Save dispatch, delivery or price actions on real orders.

## Evidence so far

- Isolated exact Git archive, 736 tracked blobs checked, no mismatch. Private evidence: `work/one-tap-dispatch-release-20261019/`.
- Independent local unit suite: 1,504 passed in 146 files.
- Focused order/pricing/request browser suite: 52 passed, 6 intended skips, desktop and phone; includes mocked exact local payload and outstation/Other path. No hosted business mutation.
- Normal local quality/build chain advanced through lint and TypeScript with successful exit; a separate diagnostic lint invocation timed out at 60 seconds and is not counted as a pass. Final integrated CI remains the authoritative complete lint gate.
- CI run 39263352715: database job log reviewed in full, 47 PASS checks. Quality job still pending at this entry; do not claim overall green yet.
- Frozen acceptance and production builds are being prepared; no deployment has happened at this entry.
- Browser-control MCP and PR-attachment MCP currently return `Transport closed`. PR exists on GitHub but is not attached in the app. Signed-in hosted UI checks are pending; production must wait for acceptance verification.

## Cutover and remaining work

Current production rollback: `830904dc-a9ce-4553-a224-0dc771bebc84`; acceptance previous Worker: `ff7b3cce-245f-40b4-b8ca-8229f58df79b`. Refresh live deployment metadata before cutover.

1. Finish target builds, verify source again, freeze/hash artifacts and dry-run both target configurations.
2. Deploy acceptance, verify public assets and private API authentication/cache behavior.
3. Restore browser-control connection; use a fresh signed-in Administrator tab, verify Active renders with bounded `/api/orders` calls. Inspect an existing ready-for-dispatch order: Local delivery and Outstation controls; open only Outstation, inspect form/phone scroll and cancel. Submit nothing.
4. Require final integrated CI green and review complete quality log; reconcile both shared logs.
5. Deploy production from frozen build only after acceptance passes. Repeat read-only fresh-tab checks; immediate rollback on real stall/regression. Do not repeat Economics benchmarks or completed numbering follow-up.
6. Reconcile/merge pinned PR69, record Worker IDs and checks, commit only this new checkpoint; leave all existing unrelated uncommitted files untouched. Shared logs remain append-only. Verify saved unrelated hashes before finishing.

Existing first-real-order heartbeat is completed and PAUSED; do not resume it. No new fixtures, accounts, roles or real dispatches are authorized or needed for this release.

## Acceptance outcome — 19 October, 14:00 UTC / 19:30 IST

- Both builds completed successfully, 193 files each. All 736 source blobs and 386 artifact hashes verified; target project/name guards and both deployment dry-runs passed.
- Acceptance Worker `4df95ba5-eac5-468a-98d6-bf777ba4ce23` deployed from integrated `8da1a5a6`, and deployment metadata confirms it at 100%.
- All 11 hosted checks pass: root, unauthenticated private/no-store APIs, legacy alias, stock HTML, Orders/Pricing/Economics chunks and stylesheet hashes. First immediate post-deployment observation had one Orders chunk 404; the same URL subsequently returned 200 with its exact expected hash, and a full recheck passed. Original observation retained privately; no source change or redeploy was needed. Do not infer a signed-in UI pass from these public asset checks.
- Latest observed production remains `830904dc-a9ce-4553-a224-0dc771bebc84` at 100%; no production deployment or business mutation occurred. Refresh that baseline again before resuming cutover.
- Browser control rewrite/reconnect/reset all return `Transport closed`, preventing the signed-in Active/list request-count and hosted outstation/phone check. No browser action was submitted. Production and PR69 integration remain held for these checks and final quality CI.
- 85 unrelated saved files verified byte-identical and index empty. Claude checkout/source unchanged. New checkpoint and shared append-only logs remain local until release integration; private artifacts retained for resumption.

### Read-only acceptance check for Claude or owner

Acceptance is ready at https://suprabha-staff-acceptance.anil-mahindrakar22.workers.dev/ . Use the existing Administrator session privately. Open a fresh tab, select Orders and record `/api/orders` request count/status over 10–20 seconds and whether Active renders. Inspect an existing ready-for-dispatch order: verify **Dispatch · Local delivery** and **Outstation courier…**. **Do not click Local delivery**: it immediately dispatches. Open only **Outstation courier…**, inspect Delivery type, known couriers/Other, Docket number, IST date and optional vehicle; check phone scrolling, then cancel. Save/submit nothing. If no eligible order exists, record that limitation; create no fixture. Record results here and in the shared handover. Codex alone deploys production after the checks and final CI pass.

## Resumption decision

Owner supplied Claude signed-in acceptance evidence: phone 375×812; Orders list and history GETs both 200 (~1.47 s), Active selected and one order rendered, no loading stall. No ready-for-dispatch order exists. Codex accepts automated coverage for this client-only release: exact Local command/IST/version, Outstation Other/docket/vehicle/scroll, validator and unchanged server admission/replay/version safeguards; no test order is needed. Hosted dispatch UI remains unobserved. The restart-loop report is withdrawn: hidden-pane visibility wakes/aborts were an observation artifact, not an app defect.

Final integrated CI39263352715 is SUCCESS: 1,504 units/146 files, 36 general browser, 586 staff browser (+16 intended skips), 20 offline browser, 21 mitigation and 47 SQL checks, lint/types/connector/build/audit. Complete logs saved privately. All 736 source/386 artifacts reverified; 85 unrelated saved files unchanged. Production rollback830904dc confirmed100% before cutover. Browser-control MCP still fails; signed-in production fresh-tab check will be a separately recorded observation, not an inferred pass. Codex proceeds with production and immediate public/privacy/asset checks using the frozen build.

## Production outcome — 19 October, 14:24 UTC / 19:54 IST

Production Worker `6439a38f-b6c0-4996-b4bd-86d655a331d4` is live at 100%, following acceptance `4df95ba5-eac5-468a-98d6-bf777ba4ce23`. Frozen candidate source `8da1a5a6`; 386 artifact hashes verified. All 10 production binding names/types and public variable values match rollback `830904dc-a9ce-4553-a224-0dc771bebc84`. No rollback or database/Edge/connector/role/order mutation.

All 11 production hosted checks pass, including exact Orders/Pricing/Economics JS, CSS and stock HTML plus private/no-store unauthenticated APIs and legacy redirect. As on acceptance, the first Orders chunk request returned 404 immediately after cutover. At 14:24:21 UTC the same URL returned 200, 153,696 bytes, SHA256 `81894e6268654d4ab073c02d2a36fa55c5f32c1b5006b4d3eefbd6ab549ed10b`; the complete check then passed. Both first and subsequent observations are retained. This does not establish the cause of the brief 404 or signed-in order behavior.

**Remaining observation:** Claude/owner should record one fresh signed-in production tab's Orders/Active rendering and `/api/orders` count/status over 10–20 seconds in a visible tab. Submit nothing. Browser-control transport is unavailable in this chat; no authenticated production check is claimed. If a real stall appears, Codex should immediately roll back the Worker to `830904dc-a9ce-4553-a224-0dc771bebc84` using the saved production config and reconcile evidence. Hosted dispatch remains covered by automated tests only, as explicitly accepted above; no test order is needed.

## Integration and owner follow-up assignment

PR69 merged as `691e7ce8884526cf7d554a6df9e85a8c110258dc`, with expected head `8da1a5a63deda321ecf7c79ff8029bff526c98a1`. Reviewed source, CI merge and integrated tree all `2dad92ba281e54656856572d121a95cc7b0f0866`. Only this new checkpoint will be committed as release documentation; pre-existing dirty shared logs and all unrelated work remain preserved locally.

The owner explicitly assigned the remaining signed-in production observation to Claude: **“Claude will record the production check.”** This is the sole outstanding operational observation for this package, not a claim that it already passed. No new test order or live dispatch is required. PR app attachment could not be added because its MCP transport is unavailable; the GitHub PR and merge are confirmed directly.
