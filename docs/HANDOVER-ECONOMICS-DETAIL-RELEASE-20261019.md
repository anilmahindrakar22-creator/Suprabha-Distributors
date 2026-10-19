# Economics detail view release — 19 October 2026

Owner requested `claude/economics-source-lines` at `c693944fca9ad845c9840fa7fe9941e36e8815bf`: migration `20261019180000_economics_detail_read.sql` plus Worker/client. Codex remains the integrator/deployer. Integration source `7fa45f07771e8b9c35216ac134b9df8ee405dc76`, [PR68](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/68), based on production `8ef462d`. Source and CI merge tree match `b2723f964b6f455393448f55fc0f778c89c10498`.

The additive detail function is cloned from the current full read with four guarded replacements; the gateway adds detail admission/routing with two guarded replacements. It keeps every non-sale source line and sales for customers with targets in the same company. The existing summary and full read remain unchanged. API rejects mismatched read models. Client view ranks preserve summary < detail < full: routine tabs and breakdown use detail; Setup, All actions and explicit Load all source lines use full. Existing role, command/version/idempotency and recovery behavior remains authoritative. Rollback to the old Worker restores its full-read behavior without requiring a database rollback.

## Verification and acceptance migration

- Normalized SQL SHA256 `4552cb4375272c7834b4eed6d562498ba20833ab2fe221cd0bae28764b5c5ef0`. Six exactly-once anchors checked against acceptance; no existing detail function before cutover.
- Exact Git archive:733 blobs verified. Typecheck, both target builds and all386 frozen artifact hashes pass. All1,501 unit tests /145 files pass. Fresh deployment-order SQL replay47 PASS markers, exit0, including actual detail/full parity and client-execute denial. All134 focused desktop/phone browser checks pass. Those tests regenerated14 tracked preview PNGs inside the private archive; restored those exact Git blobs there, then reverified733 sources and386 unchanged build artifacts. Main-checkout previews and other saved files were preserved.
- Acceptance remote migration `20261019114604`, history76 ->77. All76 historical migration hashes preserved. Full function unchanged byte-for-byte; new detail and patched gateway definitions exactly match reviewed substitutions. Existing function settings/ACL unchanged, new function stable/invoker and anon/authenticated execute denied.
- Summary MD5 before/after `7392f934c8d11e8d35813253da447448`; full MD5 before/after `f18263e191ac20bfe4494cc8edaabb04`. Both unchanged.1,274 full source lines,512 required detail lines;0 attributed source lines missing and0 purchases missing.

## Production migration

Refreshed the production baseline immediately before cutover and verified all138 historical migration version/content hashes against the map, all six anchors, and0 missing attributed/purchase sources. Applied exact migration as remote `20261019115837`, history138 ->139. All138 historical hashes retained; new SQL hash exact. Both checksums unchanged: summary `801dc0c512685693c3db66e4f1f9c5d3`, full `ebf6046c567e3d5f1a79897f7ea07091`. Existing full definition is byte-identical; gateway and detail definitions exactly equal the guarded substitutions; existing settings/ACL retained, new anon/authenticated execute denied. Source7112 ->1743 required detail lines,0 attributed lines and0 purchases missing. Active run unchanged. No checksum equality is asserted between detail and full because sourceLines intentionally differs.

Final CI `39246597114` succeeded:1,501 unit tests /145 files,47 SQL replay/integrity/concurrency checks,36 general browser,585 staff browser with15 intended skips,20 offline and21 dependency mitigation checks, plus lint, types, connector, build and audit. Both complete job logs were read and saved.

## Worker release and hosted checks

Acceptance Worker `ff7b3cce-245f-40b4-b8ca-8229f58df79b` deployed first. All11 hosted privacy/alias/asset checks pass, including the new Economics chunk. Private Administrator summary, To do/detail, Reports and All actions work. Detail sample835035 decodedJSONbytes; Reports labels512 shown and offers Load all source lines. All actions escalates to full, and Reports then lists1274 source lines. No command submitted. Temporary tab closed.

Refreshed production deployment metadata and both shared logs before cutover. Production Worker `830904dc-a9ce-4553-a224-0dc771bebc84` is confirmed at100%; all11 hosted checks pass. All10 binding names, types and public flags match saved rollback `2b8a27b6-92fa-40a4-8b45-b1c990090988`. No rollback needed. The additive migration remains compatible with that old Worker; a guarded reverse-gateway/drop-function script is saved privately if ever separately needed. No business, order, pricing, role or connector writes; no Edge publication.

## Single production observation — complete

A fresh private Administrator tab restored its normal session on Stock; restored the observation marker before entering Economics. One summary request preceded the one detail request. Sanitized Worker observation confirms exactly one `view=detail` GET, HTTP200, and zero full-view requests. No refresh, repeat or warm loop was made. Normal checksum validation SQL reads are distinct from the browser measurement.

Detail request event:19 October2026 at12:03:17.936UTC /17:33:17.936IST. Existing page DOM `data-load-sample` reports1,653,523 decoded UTF-8 JSON bytes; fetch+parse3,913.3ms, render-after-parse22.7ms, total3,936.0ms. Header timing as reported:stockflow3412ms, auth0ms, member576ms, RPC2836ms, JSON0ms. Worker event wall3537ms, CPU94ms. These are different timing boundaries, and timer resolution does not prove zero work. Response size is decoded JSON bytes from the existing server header, not compressed transfer size. Diagnostic sourceLineCount5534 is the active generation's existing count, not the filtered sourceLines array size; Reports correctly shows1743 source lines.

The same loaded detail was checked at phone375: page/scroll375 with header/navigation retained, screenshot visually reviewed; viewport restored. Reports continues to offer complete source evidence without loading it automatically. No additional API read was needed for Reports or the phone check. Production tab retained. Existing To do/import-problem count380 ->382 between summary/detail reflects incoming source activity; this release does not resolve those problems or change financial evidence.

Honest limit: the initial summary Worker wall time was7810ms, so cold summary loading remains slow. Previous full request was already observed once by Claude (HTTP200,5445ms,4258KB). No repeat of it was made; different timing boundaries/datasets do not establish a controlled all-app speed comparison.

## Integration and preservation

PR68 merged as `f282ab86bd025f6cc5396ffed7399f0c862c9827`. Reviewed source, CI merge and integrated trees match `b2723f964b6f455393448f55fc0f778c89c10498`. The139-deployed/no-pending history map and explicit preflight assertions are updated; all10 bookkeeping tests pass. Only that map, its test and this new checkpoint are staged for evidence. All84 unrelated saved files remain byte-identical; both shared logs append-only; Claude checkout unchanged. Release complete, source claims released. No further hardening queued.

Private evidence: `work/economics-source-lines-release-20261019/`, including complete CI/local logs, function definitions/history/checksums, frozen artifacts, guarded rollback, sanitized single-request observation, existing DOM sample and screenshots.
