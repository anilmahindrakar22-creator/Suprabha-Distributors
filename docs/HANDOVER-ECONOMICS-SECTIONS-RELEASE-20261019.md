# Economics detail response release — 19 October 2026

Owner requested `claude/economics-sections` at `89cc2a7ef886e3de4111fb3eb3c3016d6b246ac9`, database migration `20261019150000_economics_trim_unplaced_rows.sql` only. Codex is the integrator/deployer. Integration merge `a9bf8dc8ba47ac74d416de1e71cbf4a3d3b43854` on current production `07aefb2`; [PR67](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/67).

## Scope

The full Economics response retains all targeted attribution rows, other reasons, and unplaced rows for customers with a target in that company. Unplaced exceptions are grouped per company/customer with line count and total. All other exceptions and open import problems remain. Source lines, instrument figures, summary logic, permissions and mutations are unchanged. This intentionally changes the full response checksum; an unchanged checksum is not a release gate.

Reviewed consumers: lifetime, cost verification, target breakdown, suggested items, To do and the read-only Exceptions table. The independent needed-row check also conservatively covers customer matches across companies, matching the current UI filter. No needed rows are dropped on either live dataset.

## Evidence before release

- Exact normalized migration SHA256 `3ce4e58d0ae6158c3130ab00eb481e87b6eeedf52b72fdbd783f67ad87f386e0`; exactly one of each replacement anchor in both live functions. Saved exact expected post-change definitions and guarded reverse replacement privately.
- All137 production migration version/content hashes match the integration map. All1,500 unit checks /145 files pass on an isolated Git archive; 13 focused checks pass; fresh PostgreSQL deployment-order replay has46 PASS markers and exits0.
- Acceptance baseline:851 attribution rows ->89 kept,77 needed,0 needed-but-dropped.803 unplaced lines ->75 customer groups; both totals391367978 paise.12 ordinary exceptions +3 open import problems ->90 exception rows.
- Production baseline:5,534 attribution rows ->165 kept,153 needed,0 needed-but-dropped.5,490 unplaced lines ->165 customer groups; both totals1719589229 paise (INR1,71,95,892.29).12 ordinary exceptions +370 open import problems ->547 exception rows. The earlier177-row estimate omitted subsequently recorded import problems; these remain visible. No importer or Accounts policy change is included.

## Acceptance

Applied as remote migration `20261019104342`, history75 ->76. All75 prior version/content hashes retained. Stored function exactly equals the two reviewed substitutions; owner, execute ACL, volatility, security mode and search path unchanged. Post-apply count check matches baseline: needed-but-dropped0, equal grouped amount and line count. No Worker/Edge/connector or business data writes.

The actual acceptance full function read returns89 attribution rows,90 exceptions,75 customer groups covering803 lines and391367978 paise, with sourceLines1274 andtodoCount3. Hosted Administrator To do renders; Advanced -> Exceptions displays90 data rows plus a header, including grouped customers and line counts. No command was submitted; temporary acceptance tab closed.

## Production and integration

Applied production as remote migration `20261019105613` at approximately16:26 IST, history137 ->138. Immediately refreshed the count/function/history baseline before cutover. Post-change definition exactly equals the two reviewed substitutions; function owner, ACL, volatility, security mode and search path match. All137 historical hashes remain; the one new migration hash matches the reviewed SQL.

Post-change count check:5,534 ->165 attribution rows,153 needed,0 needed-but-dropped.5,490 unplaced lines ->165 customer groups; original/grouped totals both1719589229 paise. Current549 exceptions comprise165 groups +12 ordinary exceptions +372 open import problems. Two additional import problems arrived between the initial count of370 and the cutover baseline; all372 remain. Active run unchanged. The full result checksum intentionally changes and was not used as a gate. No source, ledger, order, pricing, role or connector business mutation; no Worker or Edge deployment. Existing Worker2b8a27b6 remains live.

Final CI `39239544609` succeeded:1,500 unit tests /145 files,36 general browser,583 staff browser with15 intended skips,20 offline,21 installed-dependency mitigation and46 SQL replay/integrity/concurrency checks, plus lint, types, connector, build and audit. Complete logs reviewed and saved. PR67 merged as `9637a39542c34139425e40913e6c356c557d735c`; reviewed source, CI merge and integrated trees equal `58cdfa851fbe7fd5ebe1dc2af4dec6bdfe3756e5`.

Production history map is updated to138 deployed / no pending migration; ten preflight bookkeeping tests pass. Only the map, its explicit count assertions and this new checkpoint are staged for the evidence commit. All84 unrelated saved files remain byte-identical; shared logs append-only, Claude checkout unchanged. Guarded reverse-anchor SQL remains private at `work/economics-sections-release-20261019/revert-trim.sql`; no revert needed.

## Single full-view measurement — owner assigned to Claude

The owner explicitly answered: “Claude will record the single measurement.” After the LIVE handoff in both shared logs, Claude should use exactly one fresh production Administrator tab full Economics request (`GET /api/instrument-economics`, `x-stockflow-economics-view: full`) and record timestamp, status, duration, response size (transferred versus decoded) and full-screen outcome. Do not repeat or warm-loop on production, even on slow/503 results. Credentials and response business payload stay private. The in-app browser cannot expose Network response size/timing. Codex has issued no full production workspace read during this release, reserving the single observation for Claude. Size/time remain unmeasured; no speed or byte-reduction claim is made. Record the result here and in the shared handover when available.

Migration release and integration complete; one owner-assigned measurement remains. Private evidence: `work/economics-sections-release-20261019/`. No further hardening is queued.
