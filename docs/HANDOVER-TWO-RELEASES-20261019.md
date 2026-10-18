# 19 October 2026 — UI and financial-year numbering releases

Codex is the integration/deployment owner. Both releases are deployed. The only outstanding live check is the first real order after the numbering cutover; none existed at the final readback. No test order was created in production.

## UI release completed

- Reviewed source: `claude/next-step-v2` at `1e523e35078a79f30cd2523f4b457f739b04cae7`. Claude already applied the exact lint proposal as `2870324`; Codex did not reapply it.
- Includes the next-step bar, Administrator/Management Prices to approve filter, Active default and IST capture dates on rows and headers. No database, Edge or connector change in this release.
- GitHub CI `39153890772` succeeded. Independently read both logs: lint/types/connector checks, 1,484 units / 142 files, 36 general browser checks, 577 staff browser checks (plus intended project skips), 20 offline checks, 21 installed mitigation tests and complete database replay.
- All 712 source files matched committed Git blobs. Two frozen target builds contained 189 files each. Target/project/reset guards, dry runs and all 378 artifact hashes passed.
- Acceptance Worker: `c0bf767b-81a3-4ffb-81fc-a0404691dacd`.
- Production Worker: **`c6d70338-8a9e-4bd1-83d2-591c7d15360c` at 100%**.
- Retained UI rollback: `b9cad0da-363f-47e4-a1af-a1a986b1f96d`. No rollback was needed. Existing binding names/types and public authentication flags were retained.
- Nine hosted shell/privacy/alias/asset checks passed in each environment, including served Orders JS/CSS matching the frozen artifacts.
- Fresh private Administrator tab in acceptance: **2 successful GET `/api/orders` invocations in 15,135 ms**, Active/list rendered, dates visible and no Loading indicator at end.
- Same production check: **2 successful invocations in 15,174 ms**, Active/18 orders rendered, dates visible and no Loading indicator at end.
- Count method: read-only Worker tail; each included invocation had the unique fresh-tab marker in Referer and an event-start timestamp within the opening window. Excludes earlier reads and later polling. Counts server-received invocations, not browser ResourceTiming or network requests that never reached the Worker. Normal session restoration preceded fresh measurement. No instrumentation was added to the app.
- Production approval chip selected exactly one pending order and displayed **Approve ₹4,450 / Reject**. No price or order command was submitted; Active was restored afterward.
- PR63 merged as `86247951b219344c19fd2fdaf95567c4c54dc22b`. Its tested merge, reviewed source and merged tree matched `b04922e746eb65147d9e885714a0e0445e35ef1b`.

## Numbering release completed

- Reviewed source: `claude/order-numbering` at `8b60e53a10734b9b04d6fe06d7d914e47c793f03`.
- Exact migration: `supabase/migrations/20261019090000_financial_year_order_numbers.sql`, normalized SHA256 **`dfb27878bc2e684bf10cf900c40b6489515799c8548b2b4e97c84979001e0523`**.
- Existing SF identifiers remain unchanged. Future orders use `SO/YY-YY/NNNN`, with the financial year restarting on 1 April in IST. The transactional counter has RLS, no client grants and no client allocator execute permission.
- Fresh production history before release: all **135/135** version/content hashes matched. The existing uncommitted tally_recent_products deployed evidence was retained in `eb52ae8`.
- Integration merge `00196f53fe25ab2ddd4019820d1d8c0b5dee275f` resolved exactly the two anticipated map/preflight-test conflicts: 135 deployed, only the numbering migration pending, CRLF pending length 1. Four other release files matched the original branch exactly.
- Original branch deployment-order replay and fresh integrated deployment-order replay both passed **46 checks**. The combined code passed **1,484 unit tests**. Reconciled preflight passed 10 tests.
- Acceptance schema cutover: history 73→74; existing 3 orders, 7 events and identifier digest unchanged; counter 31; IST April boundary correct; client execute/table access denied and RLS enabled.
- Production quiet-window checks at 00:51 and 00:55 IST: no orders created in the prior 30 minutes and no active order gateway calls; max order_seq 49. Full history hashes were refreshed immediately before release.
- Production migration applied as **`20261018192522`**, `financial_year_order_numbers`, around **00:55 IST on 19 October**. No Worker/Edge/connector deployment was needed for this database release.
- Production readback: **136 migrations**, exact new SQL hash; all 135 previous version/hashes retained; counter **26-27 = 49**.
- Existing **38 orders / 234 events / 9 pricing decisions** and the complete identifier digest were unchanged. The inner gateway function matched the independently computed hash of the single reviewed assignment replacement; public wrapper hash was unchanged. RLS enabled, anon/authenticated allocator execute denied, authenticated table access denied. Security advisors showed no new findings.
- Post-deployment evidence commit `01891de3f06e6c809ef14ab99cd3f5bdb2464254` records **136 deployed / pending [] / CRLF pending length 0**; all 10 preflight tests passed. Integration commits were pushed normally; no force push or history repair.

## First real order — pending, follow-up arranged

Final read-only query for `order_seq > 49` returned no rows. **`SO/26-27/0050` is the expected next identifier, not a verified issued order number.** Codex did not invoke the allocator or create a production order for testing.

Heartbeat **`check-first-so-order-number`** is active in this chat. It checks quietly during daytime hours, records the first actual order, notifies only on completion or an actionable mismatch, then pauses. If no real order is available by 26 October it reports the remaining gap and pauses. This follows the owner's request to check the first real order; it makes no business, role, connector, deployment or rollback changes.

Future-number rollback is saved in `work/two-releases-20261019/revert-numbering.sql` and in Claude's original shared handover. It restores the old assignment in the inner gateway with an exactly-one-anchor guard; existing SO numbers stay valid. Do not drop counters or rewrite issued identifiers.

## Preservation and evidence

All **82 unrelated** previously recorded dirty/untracked file bytes remained identical. The other two owned evidence files were intentionally reconciled and committed. Shared logs were appended without staging unrelated changes. Original acceptance fixtures stayed archived, no pricing approvals or fulfilment actions were submitted, and production was left on Active in the checked Administrator browser tab.

Private evidence is under `work/two-releases-20261019/`: exact source/build/CI logs, artifact manifests, acceptance/production deployment and hosted checks, sanitized request windows/counts, screenshots, both database replay logs, before/after history and function/identifier digests, advisor comparison, preflight and preservation results. No credentials, raw request headers or API bodies were saved by the tail helper.

Next step: verify and record the first real order through the read-only follow-up. No further rollout hardening is queued. The existing bounded braces mitigation review remains due 25 October; this release did not renew it again.
