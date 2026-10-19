# Pricing approval inbox release — 19 October 2026

Owner request: release `claude/pricing-inbox` at `371e1bfc436702e90ad0d3765ef44cece21c2e73`, acceptance first, then production. Codex remains the sole deployer. [PR66](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/66) integrates the package on production `e3b35f0`, preserving Tokyo routing, the verified sign-in cache and all 137 deployed migrations.

## Scope and primary review

The Pricing approval inbox now shows pending order prices beside customer price proposals. Orders and Pricing share the same facts card: entered price, recent customer bills, purchase-cost evidence, margin, reason and requester. Administrators/Management see Approve and reason-required Reject; existing server authorization, exception versions and decision endpoints remain authoritative. The parent recovery fieldset is retained. The existing SQL workspace returns pending exceptions only; decided exceptions are not offered again.

The loader reads at most ten active-order pages and fetches pricing only for orders needing approval, four at a time. The primary review found one cap-notice defect: an empty match list hid its truncation warning. Integration-only correction `5edeb1121681bf374c0d1b06abd91cb22ba0f214` keeps the warning visible and limits the empty-state claim to loaded orders. Claude's checkout remains clean at the requested commit. No further design changes are included.

Exact source changes from current production: `components/order-price-inbox.tsx`, `components/order-workspace.tsx`, `components/price-approval-card.tsx`, `components/pricing-workspace.tsx`, `lib/order-price-approvals.ts`, `package.json` (lint coverage only), `tests/pricing-browser/pricing-order-inbox.spec.ts` and `tests/unit/order-price-approvals.test.ts`. No API, database, Edge Function or connector changes.

## Verification

- Original integrated candidate `5f996f3`: all 727 Git blobs verified, 1,497 unit tests / 144 files pass, standard lint/typecheck pass, 52 focused desktop/phone browser checks pass. Both inbox screenshots visually reviewed. A redundant direct lint diagnostic timed out at 60 seconds during contention; it was not used as pass evidence. Normal CI `39221411664` passed, but is superseded by the corrected candidate.
- Cap regression: initial mock omitted the separate customer-list response and crashed the harness; fixed before claiming product proof. The valid desktop/phone baseline then failed specifically because it rendered “No order prices are waiting for approval” without the first-200 notice. Corrected code passes all four inbox browser checks, including the existing approval payload test.
- Final source `5edeb11`: 727 source blobs and all 386 frozen target artifact files verified; both builds pass. CI `39223268385` passed: 1,497 unit tests / 144 files, 36 general browser checks, 583 staff browser checks with 15 intended skips, 20 offline checks, 21 installed-dependency mitigation checks and 46 database replay/integrity/concurrency checks, plus lint, types, connector, build and audit. Both complete job logs were reviewed. Reviewed source, CI merge and integrated PR trees equal `d9fe4e20be95ec7c159629b19a528cb520beb660`.
- Initial acceptance Worker `f417d785-efee-449e-a69b-0179c630af27`: ten hosted privacy/alias/Orders+Pricing asset checks pass; six successful Orders GETs in the first 20 seconds, Active/list rendered at subsequent observation. Pricing displays both empty inbox sections correctly. At phone width 375, page/scroll width is 375, inbox width/scroll is 326; scrolling reaches administration with header/navigation retained. Viewport reset. Acceptance has no pending order price; decision behavior is checked with isolated mocks, not by modifying hosted data.

## Release state

Corrected acceptance Worker `fb71404f-f3ea-4f7e-86d0-4430dbbb47f4` was deployed first. Ten hosted privacy/alias/asset checks pass, including the corrected Pricing chunk. A fresh Administrator tab made five successful Orders GETs in the first 20 seconds; Active/list rendered at the subsequent 25-second observation. Both Pricing inbox sections render with zero pending items, as expected for acceptance.

Production Worker `2b8a27b6-92fa-40a4-8b45-b1c990090988` deployed on 19 October 2026 at 08:46 UTC and is confirmed at 100%. Ten hosted privacy/alias/asset checks pass; all ten binding names, types and public values match the saved rollback metadata. Rollback `768d1a10-c054-42c4-914a-b3fdc0087d71` remains available; no rollback was needed.

A fresh production Administrator tab made four Orders GETs in the first 20 seconds, all HTTP 200. Active18/list was visible without a loading stall at the subsequent 23-second observation. Counts come from sanitized, tab-marked Worker observations; they do not measure browser latency or cache hits.

Production Pricing now shows Awaiting approval1, where the old page showed0 while Orders already showed1. The existing Vaatsalya Life Hospital order `SF-260920-00034` appears with Stromatolyser WH500Ml, quantity1, entered rate INR4,450, latest bill INR4,510 (INR60 below), cost INR3,465 from bill222/26-27, GP INR985 per unit and margin22.1% against25% minimum. Reason/requester/date and recent bills are present. Approve INR4,450, the rejection reason field and disabled Reject are reachable. Desktop and phone375 were visually reviewed: page/scroll widths375, inbox/scroll widths326. Both sections and bottom navigation remain reachable. Viewport restored. No real approval, rejection, order, membership or source-financial commands were submitted.

After rereading both shared logs and passing hosted checks, PR66 merged as `9e3aadf062adb761aa2b353359b5b6bfa83993df`; the integration branch was fast-forwarded. Its tree exactly matches the tested/deployed source. This checkpoint is the only staged documentation file; the two existing dirty shared logs are appended locally without staging unrelated work. All84 unrelated saved files remain byte-identical. No migration, API, Edge, connector, Tokyo-routing or sign-in-cache change was made. Existing first-real-order numbering follow-up remains untouched.

Release complete. Shared handover and rollout logs record each milestone; no additional hardening is queued for this package.

The previous release's actual `auth;dur` measurements remain assigned to Claude by the owner; no cache timing claims are inferred here. Private evidence: `work/pricing-inbox-release-20261019/`, final artifacts in its `final/` directory.
