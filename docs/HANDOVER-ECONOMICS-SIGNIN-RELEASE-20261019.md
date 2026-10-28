# Economics and sign-in performance release — 19 October 2026

Codex in the integration chat is the sole deployer. Source packages: `claude/economics-speed` at `b54e99b12674c85c9d1a446520411f78f6bb5785` and `claude/signin-cache` at `2c84b71522975f32be676b5e8de9438aec1fb16c`. PR65 combines both independent branches so the second Worker cannot drop Tokyo routing. Integration candidate `b0508cc2d89fa484f908274528f7cbb1634ebef8` contains one test-only correction: the sign-out cache fixture now expires an hour after the actual test clock. Its original fixed expiry had already passed; production correctly refused to cache it. Production cache code is unchanged from the requested package.

## Current release state

- Migration applied acceptance `20261019073621` (history 74 → 75), then production `20261019075404` (136 → 137). Exact reviewed SQL normalized SHA-256: `bceccd6e0bf84aa1013effc7e6cc40269914f8b27cb8ac5d3a3c73f75957af9c`.
- Acceptance speed Worker: `3d1ae7a6-94b7-4f13-83a6-369105d9cca6`.
- Acceptance combined cache Worker: `4ad1fe04-fbd7-4117-bea7-7748483cc246`.
- Production speed Worker: `0c9da1b1-ed66-4133-86d1-87ccbb75d5dc`, followed by final combined cache Worker `768d1a10-c054-42c4-914a-b3fdc0087d71` at 100%. Rollback for the final release is `0c9da1b1`; initial Worker `bc108530-f877-4466-9168-dff27529f9a2` is also retained. No rollback was needed.
- [PR65](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/65) merged as `d8904e14ba20e7d3febb6a3f1c87d670bce4d6f3`. Reviewed source, CI merge and final merge trees equal `2f4cd212f74af5a80801215f7a9d5d0858e762c0`. Integration checkout fast-forwarded without overwriting uncommitted work.

## Economics integrity

| Environment | Result | Before MD5 | After MD5 |
| --- | --- | --- | --- |
| Acceptance | Summary | `7392f934c8d11e8d35813253da447448` | `7392f934c8d11e8d35813253da447448` |
| Acceptance | Full | `10b457ac089fc8bbbfa4a6a5b4a093fc` | `10b457ac089fc8bbbfa4a6a5b4a093fc` |
| Production | Summary | `c8d31e749ec9407fcf9f9671d5819e3e` | `c8d31e749ec9407fcf9f9671d5819e3e` |
| Production | Full | `1b599f6fd0da63b86e7cc4978a81daae` | `1b599f6fd0da63b86e7cc4978a81daae` |

The primary review confirmed that ownership is false when result target_id is null. Both deployed function definitions match exactly the five intended prefilters; all other code and privileges are retained. All 136 historical production migration versions/hashes are unchanged, plus the one reviewed migration. Normal connector activity changed the production dataset between initial investigation and cutover, so the production comparison uses a fresh immediate pre-migration baseline. A guarded five-prefilter revert is saved privately; do not delete migration history when reverting.

## Verification

- Local deployment-order database replay: 46 checks pass, including economics summary parity, attribution, costs, audit, ACID, replay and concurrency.
- Final combined source: 1,494 unit tests / 143 files pass, isolated typecheck passes; standard lint passed. The main checkout typecheck initially exhausted its default heap while scanning nested private release archives; the same source passes in the isolated source archive without configuration or suppression changes.
- First CI `39216784648` exposed the expired test fixture. Corrected final CI `39217424184` passed: 1,494 unit tests, 36 general / 579 staff (15 intended skips) / 20 offline browser checks, 21 installed dependency-mitigation checks and 46 SQL replay checks, plus lint/types/connector/build/audit. Both complete job logs retained and reviewed.
- Each source stage: all 721 Git blobs verified. Each pair of acceptance/production builds: all 378 frozen artifact files verified. Both acceptance deployments pass nine hosted privacy, alias and asset checks.
- Speed acceptance: five successful `/api/orders` GETs in the first 15 seconds after opening Orders. Combined cache acceptance: three, all HTTP 200, Active and the order list visible at subsequent observation. Server-received counts use the marked tab's Referer and event-start window; they do not measure browser Resource Timing or initial render latency.
- Acceptance Economics renders the existing MS Palya totals read-only: investment ₹2,25,000; reagent sales ₹4,52,669.52 over 35 invoice lines; GP/recovered ₹2,98,537.06. Existing incomplete-data status is retained.
- Live `function_logs` for acceptance `stockflow-orders` function `064309fd-0b0f-4891-9163-50a11fbf2f35` report `region=ap-northeast-1` in current Boot/Shutdown events. The HTTP `function_edge_logs` stream only returns older entries, so this is runtime-region evidence, not a fresh `x_sb_edge_region` response-header observation.
- Production speed Worker: six successful Orders GETs in the first 20 seconds; Active with 18 orders rendered at the subsequent 27-second observation. Runtime logs recorded 26 new Tokyo boots after cutover, with no boots elsewhere. An older Zurich shutdown appeared during draining; it was not a new boot.
- Final production cache Worker: ten successful Orders GETs in the first 20 seconds; Active with 18 orders rendered at the subsequent 30-second observation. Eight were startup reads, followed by two summary reads near 17 seconds. This bounded startup duplication is recorded for a later performance review; these counts do not establish a cache hit rate or faster rendering. Runtime logs recorded 40 Tokyo boots and none elsewhere in the checked post-release window. All ten binding names/types/public flags match the preceding Worker. Each production stage passed nine hosted privacy/alias/asset checks.
- Final production Economics renders both existing SYS 240 placements. MS Palya: investment ₹2,25,000; sales ₹3,69,580.70 / 30 lines; GP/recovered ₹2,35,622.72. Yelahanka: investment/balance ₹2,25,000, zero attributed sales/GP. Both retain their existing incomplete-data state. These are current readbacks, not a reconciliation of source completeness. No financial events were written by release checks.
- Post-migration security-advisor groups/counts are unchanged: 84 existing RLS notes, three existing search-path warnings and one existing password-protection warning. No unrelated hardening was added.

## Timing handoff to Claude

The owner assigned fresh-tab `auth;dur` measurement to Claude. Use the existing private Administrator session, open a fresh tab and Orders/Active, then record `/api/orders?list=1` Server-Timing auth durations, statuses, sample size and Worker version here or in the shared log. Both final Workers are available: acceptance `4ad1fe04`, production `768d1a10`. Keep credentials/cookies private and submit no order/price commands. The in-app browser API cannot read response headers; no auth duration, cache hit rate or saving is claimed yet. This is the remaining release-evidence handoff.

The primary review verified token-hash keys, 256-entry bound, 60-second/JWT-expiry cap, success-only storage, fresh password/recovery verification and fresh database membership authorization on protected requests. Sign-out/reset eviction is isolate-local; the owner-approved cross-device revocation delay remains bounded by the cache TTL.

## Remaining work

The requested migration and both Worker releases are deployed and PR65 is merged. Deployed-history bookkeeping records 137 migrations and no pending migrations. Claude owns the remaining actual auth-duration measurements. The separately announced `claude/pricing-inbox` at `371e1bf` is excluded from these artifacts and needs its own release. Existing first-real-order numbering heartbeat is unchanged. Preserve the shared logs' concurrent/uncommitted history; the dedicated checkpoint and bookkeeping can be committed independently.

Private evidence: `work/economics-signin-release-20261019/`. No connector, Edge Function code, order, pricing, member-role or source-financial mutations are part of these release checks.
