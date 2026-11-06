# Release package: trains 1–3 together (release today, Tue 3 Nov 2026)

**Owner, 3 Nov 2026:** "Ok let's release all trains. Prepare." Claude prepared this package; the **Codex integration chat releases it**.

**Owner, 3 Nov 2026, later:** "We will release it today." This brings the release forward from Sun 8 Nov to **tonight, Tue 3 Nov, after billing hours**. It is the owner's go-ahead for the production window (precondition 4) and for the production parity run inside the sequence (precondition 5). It does not cover the §7 data steps.

**Production re-checked read-only by Claude on 3 Nov, after this go-ahead:** last migration is still `20261028054756 rate_check_units`; `stockflow-orders` v34, `stockflow-sync` v12, `stockflow-push` v2. Nothing has changed since the drift check.

This document replaces the separate RELEASE TARGET lists for train 1 (`claude/train-20261028`), train 2 (`claude/train-20261113`) and train 3 (`claude/train-20261120`) in `CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md`. Where an older note conflicts with this one, this one wins.

**Read only this file plus the scripts it names.**

## 1. What ships
- **Branch** `claude/train-20261120` @ `c29604b` for code. That is the gated code `ccc050c` plus, on 3 Nov, the connector fix (`2ce0d92`), test-only fixes (`e4195b7`, `8983382`), the systeminformation override (`d483c96`) and the parity variant (`a1ee6df`); and, on 5 Nov, three acceptance UI fixes (`c29604b`). See §4. Later commits on the branch are docs only.
  - It contains train 2 head `f4a76a8`, base `feature/phase3-order-exceptions` (`9afdbda`), and every merged `codex/*` release branch. All were checked with `git merge-base --is-ancestor`.
  - Remote branches not merged into it are superseded `claude/*` feature branches (re-delivered through `codex/*` releases), parked work (`result-pruning-parked`, `market-w1`, `frequent-products`), old docs branches, and dependabot bumps. None is included.
- **Production today**, read-only on 3 Nov:
  - last migration `20261028054756 rate_check_units`;
  - Edge `stockflow-orders` v34, which equals the `f7f8453` source;
  - `stockflow-sync` v12 and `stockflow-push` v2, both unchanged by this release;
  - 7,573 economic source lines; 30 live orders, all test orders.
- **Features:**
  - **Train 1:** To order, delivery on challan, order list priority sort, supplier prices from Tally, purchase orders.
  - **Train 2:** instrument register, full-sales coverage and certification, the bounded economics rebuild, Wallet (estimates, diagnosis, actions, My actions, test volume, Quick entry), the power map, PO Tally receipts, contract windows, Today, the customer map with PIN placement, GPS check-ins, Tally rename-by-GUID and automatic customer linking, lab size, and rental registration.
  - **Train 3:** lab test mix, brand mapping and Prospects, wallet special tests, the Recover signal, wallet verification, and Focus-first Prospects.
- **Excluded:** Service visits, parts, downtime and maintenance schedule. These are deferred by the owner until further notice.

## 2. Preconditions (all before production)
1. **Role walkthrough on acceptance**, today before the production window, with the full branch deployed there. Deploy acceptance first; the owner walks it (about 30–45 min); then production.
   - Follow `docs/ROLE-WALKTHROUGH-ACCEPTANCE.md`. The owner signs in with a spare login; Codex never handles credentials.
   - A FAIL that shows prices or cost to a role that must not see them **stops the release**.
   - **Result (5 Nov):** all eight roles walked by the owner, and no prohibited money exposure was reported. These screen checks are owner-reported, because browser control timed out; order states are database-verified. Fresh price flow on `SO/26-27/0039`: Accounts ₹250, Management changed to ₹251 and approved. The spare login is back on Accounts only (read-only check, 5 Nov).
   - **Three findings** (Review order, Enter price focus, price guidance) are fixed in `c29604b`. Deployed to acceptance on 5 Nov (Worker `66d5db35-d33e-4167-9375-99ade46b486f`). **The owner checked all three there on 6 Nov** (owner-reported). Precondition 1 is met.
2. **The integration chat's own gate on the final SHA**, per the train rule:
   - `pnpm test:connector` with pwsh 7, which Claude cannot run;
   - CI.
3. **Backup** per `docs/BACKUP-RESTORE-RUNBOOK.md`, taken just before the production migrations.
   - **6 Nov:** full CI passed at `2165fd5` (integration chat). The first restore drill failed because the runbook had no stand-in for the `auth` schema; the dump itself is not at fault. The runbook is corrected and trial-restored by Claude. The fingerprint comparison still has to pass.
   - The 12:47 IST dump was taken during billing hours. It proves the procedure, but it is **not** the pre-migration backup. Take a fresh export just before the migrations, and restore and compare that one too.
4. **Owner's final go-ahead** for the production window: the 3 Nov go-ahead ("We will release it today") has **expired**. A new one is needed, naming the night. Run outside billing hours.
5. **Economics parity** (train 2 condition): run `supabase/scripts/economics-candidate-parity.sql` (begin, then rollback; it holds the economics lock) after migration `20261030110000`.
   - Run it on acceptance first. On production it is covered by the 3 Nov release go-ahead; run it outside billing hours.
   - Production has 7,573 lines, inside the 10,000 limit.
   - If parity fails, stop and report. Do not continue with the later migrations.
   - **Use `supabase/scripts/economics-candidate-parity-result.sql`** when the SQL tool hides notices. It is the same check, but it always ends with an error whose message is the result (`PARITY OK: …` or `PARITY FAILED: …`), and that error rolls everything back. An error starting `PARITY OK` is a pass.
   - **Acceptance result (Claude, 3 Nov, 20:2x IST):** `PARITY OK: results 851, automatic cost links 104, GP/contribution events 36, summary and full reads`. Checked afterwards: 0 `candidate-parity` runs, and the active run is unchanged (16 Oct). Fully rolled back.
   - **Why 10,000:** production's current rebuild refuses to run above 10,000 total sales lines (error 54000). Without the containment migration, that failure would also roll back the nightly sales import. Lines grow by about 580 a month, so production reaches 10,000 around mid-March 2027.
     - This release replaces that rebuild with the bounded one. Its limit is 10,000 *candidate* lines per rebuild (lines that touch a changed instrument), not total lines, so crossing 10,000 total lines is then harmless.
     - The parity script compares the new rebuild with the old one, and the old one keeps its guard. So parity can only be run while total lines are 10,000 or fewer: **run it in this release, not later.**

## 3. Production steps, in order
1. **Database:** apply the 37 migrations below **in filename order, one at a time**. Each is its own transaction, so a failure leaves a known applied prefix. **Stop at the first failure** and report it; do not hand-edit.
   - **Acceptance only:** `20261028090000_to_order_list` is already there (remote `20261028132839`). Skip it on acceptance only.
2. **Edge function:** deploy `stockflow-orders` from this branch. The diff from v34 is `git diff f7f8453 ccc050c -- supabase/functions/stockflow-orders`, which is additive: new purchase, challan, wallet, map, Today, lab, brand and verify actions. Leave `stockflow-sync` and `stockflow-push` alone.
3. **App (Worker):**
   - deploy `build:staff:production`;
   - the service-worker cache goes from v15 to v16;
   - new route files are under `app/api/*` (brand-mapping, customer-map, me, my-actions, power-map, purchase-orders, today, wallet*);
   - **no new environment variables or secrets**: there are no new `process.env`, `Deno.env.get` or `$env:` reads since `f7f8453`;
   - new dependency `leaflet@1.9.4`.
4. **Office-PC connector:** install `desktop-connector/{recovery,dashboard,economics}.ps1` from this branch.
   - Use the same reviewed copy and restart path as the rate-units release: baseline diff and hash, then the pwsh control restart.
   - The connector update is what supplies supplier prices, the Tally GUID per customer (rename safety and auto-link), and nightly sales coverage.
   - The connector and database can go in either order; both directions are safe.
5. **Push alerts stay OFF** in production.

### The 37 migrations
| Train | Migrations |
| --- | --- |
| Train 1 | `20261028090000_to_order_list`, `20261029090000_challan_delivery`, `20261029091000_order_list_priority_sort`, `20261029100000_supplier_purchase_orders` |
| Train 2 | `20261030090000_instrument_register`, `20261030091000_instrument_register_read`, `20261030100000_economic_rebuild_containment`, `20261030101000_sales_coverage`, `20261030110000_economics_candidate_rebuild` (economics parity runs here), `20261030130000_wallet_v2`, `20261031090000_wallet_diagnosis`, `20261031120000_wallet_actions`, `20261031130000_wallet_my_actions`, `20261031140000_power_map_enhancement`, `20261031150000_power_map_influence`, `20261102090000_po_tally_receipts`, `20261102100000_contract_windows`, `20261102110000_today_decisions`, `20261102120000_customer_map`, `20261102130000_customer_city_pin`, `20261102140000_pin_centroids`, `20261102150000_pin_placement_gateway`, `20261102160000_visit_checkins`, `20261102170000_customer_rename_by_guid`, `20261102180000_customer_auto_link`, `20261102190000_wallet_test_volume`, `20261102191000_lab_size_reports`, `20261102192000_instrument_rental_registration`, `20261102193000_pin_move_management_only` |
| Train 3 | `20261116090000_lab_mix_reports`, `20261116100000_brand_mapping`, `20261116110000_brand_prospects`, `20261116120000_wallet_special_tests`, `20261116130000_recover_signal`, `20261116140000_lab_size_specials`, `20261116160000_wallet_verification`, `20261116170000_prospects_focus_first` |

Timestamp `20261116150000` is intentionally unused (shelved Service). Hashes are in `supabase/migration-history-map.json`, `not_deployed`.

## 4. Evidence (Claude, local, 3 Nov)
- **Function drift:** all 162 `public`/`private` functions on production were compared (md5 of the definition, CR stripped) with a local deployment-order replay stopped at `rate_check_units`.
  - **160 are identical**, including every function the 37 migrations anchor-patch.
  - **2 differ:** `stockflow_user_gateway` and `private.stockflow_can_access_order(text,text,uuid)`. These are the known `formatting_difference_reviewed` September migrations. Neither is patched by this release; the new code only calls the `text[]` overload of `stockflow_can_access_order`.
- **Deployment-order rehearsal** (`tests/pricing-migration-local.ps1 -DeploymentOrder`: production's real history, then the 37): **exit 0, 223 PASS lines**, on 3 Nov at `ccc050c`.
- **Filename-order replay** with all SQL tests: exit 0, on 3 Nov, at `518d674`. The only later commits are docs.
- **Vitest:** 197 files, 2,556 passed.
- **Playwright** (full pricing-browser suite, phone and desktop): **1,498 passed, 30 skipped, 0 failed** (47.7 min).
- **tsc 0. `npm run lint` 0.**
- **Connector gate (3 Nov, pwsh 7, at `2ce0d92`):** `connector-recovery`, `connector-sales-window`, `connector-control-status` and `connector-economics` all exit 0; `stock-sync-health` unit test passes (18).
  - Found by the integration chat: `test:connector` failed with `ConvertFrom-Json` "Unexpected character … s". Since train 2, `Publish-CloudSnapshot` parsed the payload unguarded on both the failure path and the success path.
  - The fix (`2ce0d92`) guards both parses, so a failed upload never throws and an accepted upload always saves its receipt. The recovery test now loads the real `Remove-PendingSalesCoverage` helper.
  - Real payloads are always JSON, so the live connector was never affected. Only `desktop-connector/dashboard.ps1` (3 lines) and `tests/connector-recovery.ps1` changed after `ccc050c`. No SQL, app or Edge code changed, so the database, browser and unit evidence above still applies.
- **Browser-suite fixes (3 Nov):**
  - `order-keyboard.spec.ts:4` failed in the integration run ("Expected 0, Received 1"). Since `855e789`, the Requests page reads the open count once on mount, but the spec still asserted zero reads after load, so it passed only by timing. `e4195b7` changes that test only and passes 20/20 (10 runs per project). No product code changed.
  - `brand-setup.spec.ts:40` timed out once in the integration run. It passed 36/36 (`--repeat-each 3`) on a fresh server; most likely a reused or stale `:3100` server.
- **Acceptance fixes (5 Nov, `c29604b`):** `components/order-workspace.tsx`, `components/pricing-options.tsx`, new `tests/pricing-browser/acceptance-order-price-fixes.spec.ts`. No SQL, Edge, permission or pricing-rule change.
  - Focused checks by Claude on a fresh server: new spec 12/12 on phone and desktop. Before the one-line lint correction, the order and pricing specs gave 76 passed, 20 skipped, 0 failed. After it, the new spec plus `order-next-step` and `remembered-price` gave 28 passed, 16 skipped, 0 failed. tsc 0, lint 0. Phone design review done by Claude.
  - The full suites (Vitest, full Playwright, `pnpm run ci`) have **not** been run at `c29604b`. The evidence above them in this section predates it.
  - A handover note quotes the owner waiving another test run for these fixes. The focused checks were run anyway; the waiver covers pushing only, not deployment.
- **Server reads at production scale:** every read is under about 0.11 s median (`docs/PERFORMANCE-BASELINE-20261102.md`).
- **Design reviews:** done by Claude per package (phone screenshots), recorded in the handover.

## 5. Smoke checks (at most 6, production, after step 4)
1. **Orders:** urgent and high orders come first, and the Recent chip works. Requests → To order lists items; after the connector's first upload, items show a lowest supplier.
2. **Today** opens for an administrator. Record the server time of `get_today`; the local baseline is 105 ms.
3. **Wallet** opens. The header honestly shows "not certified" until sales coverage certifies. **Quick entry** opens. As Sales, there are no amounts.
4. **The customer map** loads pins. "Move pin" shows only for administrator and management.
5. **Prospects** opens for a brand with no error. Until coverage is certified, no lab shows "Focus lab".
6. **As Operations,** no ₹ anywhere: Requests, purchase orders, map, Prospects.

## 6. Post-release checks (read-only, the same day and the next morning)
```sql
begin transaction read only;
-- auto-links: roughly 385 a few hours after the connector update (shows GUIDs are arriving)
select count(*) from private.stockflow_economic_customer_identities where verified_by = 'tally-auto-link';
-- rename or GUID conflicts recorded by sync: expect 0 or a handful, which Accounts reviews
select reason, count(*) from private.stockflow_customer_sync_conflicts group by reason;
-- supplier prices: check smoke step 1 (To order shows a lowest supplier) after the first connector upload
-- new tables exist and start empty
select (select count(*) from private.stockflow_wallet_snapshots) wallet, (select count(*) from private.stockflow_lab_size_reports) lab_size, (select count(*) from private.stockflow_wallet_verifications) verified;
rollback;
```
The table and column names were checked against the migrations and production on 3 Nov. Also run `supabase/scripts/pilot-verification.sql` on deploy day.

## 7. Production data steps (separate from the release, each with its own owner go-ahead)
1. **Clear the 30 test orders.** The owner approved this on 3 Nov. Use the app's audited cancel or close with the reason "test order cleared, owner 3 Nov". **No hard delete.**
2. **Certify sales Feb–Oct 2026** for Recover, as covered in the sales coverage notes. Until then Recover shows nothing, and that is correct.
3. **Customer links:** automatic linking (`20261102180000`) replaces the 30 Oct note that the owner had to confirm links by hand. Accounts only reviews the conflicts the auto-link records.

## 8. Rollback
- **Worker:** the previous production version (139ced3b at the 28 Oct release; confirm the current ID before deploying).
- **Edge:** `stockflow-orders` v34 code. Production has listed it as v35 since 6 Nov, with the same code hash `cf5592a4…` and no new deploy time, as all four functions moved up one version together. Match rollback by hash.
- **Connector:** the previous office copies.
  - `recovery.ps1` sha256 `23f7935133b23b77c25b0decf6711a5e59c9b58900866c3c4f51762926018191`;
  - `dashboard.ps1` = git blob at `f7f8453`;
  - `economics.ps1` = git blob at `f7f8453`.
- **Database:** the migrations are additive (new tables and columns, wrapper gateways, anchor patches that keep prior behaviour). Leave them in place.
  - A mid-sequence failure leaves a consistent prefix: fix forward, or restore the backup only with the owner's decision.
  - Never hand-delete audit, history or economics rows.

## 9. After release
- **Owner:** enter wallet estimates for the top 20–30 labs (Wallet → Quick entry).
- **Integration chat:** time Today on production and record it under the baseline.
- **Claude:** watch for walkthrough or pilot findings, which go into the next train.
