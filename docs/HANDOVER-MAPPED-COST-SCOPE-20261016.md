# Mapped instrument costing correction — 16 October 2026

Codex owns integration/deployment and this correction. Production rollout is incomplete. The owner authorized release with visible incomplete-data warnings and has signed in privately as the existing Administrator. Preserve unrelated dirty work and Claude's recorded design ownership.

## Failure and correction

The initial production import exceeded the inherited eight-second database deadline. PR59 added measured query caching/indexes, no-change replay and a service-only RPC with a bounded twenty-second deadline. Its local source-sized import passed in 11.326 seconds, but the real production import still timed out. Both failed transactions rolled back completely: zero economic source vouchers and zero generations. Local timing was insufficient release evidence. Do not call PR59 a successful economic activation or increase the deadline again without resolving the workload.

Stock-only delivery is restored using the existing temporary `-DisableInstrumentEconomics` switch. The original task XML/settings and full failed economic snapshot are retained privately; existing atomic cache recovery preserved stock source time and credentials. Upload acknowledged at 11:37:06 IST in 4.4 seconds. This temporary task configuration must be restored exactly before declaring rollout complete.

The root workload mismatch is automatic costing of every imported product even when it cannot contribute to an instrument. New guarded migration `20261016061635_mapped_instrument_cost_scope.sql` computes a conservative company/product scope from all direct includes, included groups and descendants across all retained catalog versions, plus every native supplier-return product. It skips automatic sale costing only outside that scope. It retains all source evidence, unattributed sales, earlier consumption at every customer for relevant products, native Debit Note stock depletion, and existing manual allocations. Any product capable of attribution necessarily belongs to the scope. Historical/future/draft mappings intentionally remain included; this favors correctness over maximum pruning.

Attribution dates/hierarchy, exclusions, sales/FOC/net values, FIFO/batch selection, purchase cost evidence, event arithmetic, approval and authorization are unchanged. New mappings or catalog membership rebuild from preserved history through existing commands/imports. No UI, Worker, Edge, desktop runtime or global/role timeout changes are part of this correction.

## Verified candidate

Fresh full deployment-order local database replay: **44 PASS**, including existing GP/FOC/revision/cancellation/conservation/role/two-session concurrency checks. The new rollback-only regression verifies direct and subgroup mappings, earlier other-customer depletion, historical/future catalog membership, company isolation, unrelated-item omission, native supplier-return depletion and adding a mapping later. Ten focused preflight units PASS. The budget test now correctly expects no automatic cost allocation for its deliberately unmapped fixture; existing mapped-cost golden assertions remain intact.

Actual 1,799-voucher / 7,078-line source in a fresh local database with the final migration order: cold RPC **3,157 ms**, identical replay **1,038 ms**, 1,797 admitted voucher versions / 7,078 lines and exactly one generation. Adding the owner's SYS 480 group mapping and rebuilding: **1,367 ms**, 137 automatic cost links. This is a disposable workload benchmark without a registered placement; its cost subtotal is not a production GP or pilot reconciliation. Raw source stays private under `work/debit-native-20261016/production-rollout/`; logs `scope-db.log`, `scope-units.log`, `scale-scope-final.log` contain bounded results.

Source claims: this handover, the new migration and SQL regression, `supabase/tests/economic_import_execution_budget.sql`, `supabase/migration-history-map.json`, `tests/pricing-migration-local.ps1`, `tests/pricing-release-preflight.mjs`, and `tests/unit/pricing-release-preflight.test.ts`. Shared handover/rollout records are append-only; no unrelated dirty files staged.

## Remaining release checks

1. Review exact source and normal CI; merge only the reviewed head after reconciling shared logs.
2. Apply exact guarded migration to acceptance and production, independently read back its hash, function/ACL metadata and unchanged business fingerprints. Current production history is 133, latest `20261016055922`; expected prior rebuild hash is pinned by the migration.
3. Resume the normal economics connector and require a real acknowledged production source import and generation. Local timing is not a hosted pass.
4. Register the authorized MS Palya SYS 240 / A082606037 using actual production source IDs: 23 July 2026 billing and installation, purchase INR625,000, billing INR400,000, investment INR225,000; map SYS 480 group. Expectations remain unset. Use governed customer-link/setup commands, not copied acceptance rows.
5. Verify mapped-only lifetime item sales and purchase-backed GP from billing date, investment recovery and visible partial/unavailable states in the actual production session. Production figures may differ from acceptance because earlier all-customer consumption is retained.
6. Restore the exact original scheduled-task action/settings and verify successful fresh delivery; record final outcome and remaining source warnings. No financial completeness certification or invented staff-role session.
