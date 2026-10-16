# Instrument Economics: production cutover plan

Integration owner: ChatGPT / Codex in the coordination chat. Originally prepared by Claude Code on 11 October 2026 from read-only checks and handed off. The integration checkpoint below records subsequent acceptance changes; production remains unchanged.

**Status: not ready to cut over.** The blockers below must close first. This plan records the verified starting point and the exact order to follow once they do.

## 1. Blockers (all must be closed)

| # | Blocker | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Packing-charge policy | **Resolved and integrated in acceptance 11 Oct.** Production configuration remains staged. | Packing is excluded like freight using the existing `charge` role. Re-extracted/admitted the eight affected canonical purchase documents, retaining whole vouchers and excluding unrelated uploads. Current packing failures are resolved; all failure evidence is retained. No connector code change. |
| 2 | 11 open import exceptions (19 retained audit records) | Accounts | 8 unclassified voucher types and 3 accounting-only documents needing item/original-sale linkage. Unsupported purchase Debit Notes are within the voucher-type category, not an additional count. Classify or explicitly accept unsupported scope; never assign roles silently. |
| 3 | LDL-C duplicate item in Tally | Accounts (**owner confirmed 11 Oct that Accounts will fix it**) | Batch 0802603 was bought as "LDL C Direct Fs (Diasys)" (MO/0362, MO/0570) but sold as "SYS 480 LDL-C Direct FS". Correct the April purchase lines or merge the items in Tally. This is the pilot's only unavailable cost. |
| 4 | Separate-role acceptance | Owner | Signed-in Accounts and Sales/Operations sessions on acceptance, per `INSTRUMENT-ECONOMICS-CANDIDATE-ACCEPTANCE.md`. Administrator is already observed. |
| 5 | Financial reconciliation sign-off | Accounts | Pilot figures are calculations, not certification. This includes zero-value supplier lines (owner policy: genuine ₹0) and historical stock depletion. |
| 6 | Frozen, reviewed change set | **Checkpoint done 11 Oct**; integration review still due by ChatGPT / Codex | Local commit `afbb17e` on `codex/staff-signin-session-redirect` (parent `6925c91`), 101 files, not pushed. Only `.codex/` (local tooling, key-setup scripts and an old dry-run build) is left uncommitted on purpose. A secret-pattern scan of committed files found none. The integration owner still reviews the change set; later changes (such as packing) need their own commit. |
| 7 | Gateway source check | **Closed 11 Oct by ChatGPT / Codex** | Downloaded acceptance version 11 source. Both `index.ts` and `request-gate.ts` match local files after CRLF normalization/trailing whitespace trim. Bundle remains `82b966e8b785cfcc1786c73d0a36e500d7adaa30fcd03ee7af3ebf946acdfdb4`. Recheck if either source changes before release. |

## 2. Verified starting point (11 Oct 2026, read-only)

**Production** (`aormuidjbdqruglmyseh`):
- 103 migrations, latest `20261005061401`. Versions and normalized content hashes match `supabase/migration-history-map.json` exactly (fingerprint `3c1b617639bb39e13385dd40fb8cdb08`).
- No economics tables or functions exist.
- PostgreSQL 17.6.

**Production rollback references:**
- Worker `suprabha-staff` `167e2b20-a56d-4057-87ab-9a5f3302b752` (100% traffic).
- `stockflow-orders` version 30 (bundle `9703da17…`), with its source preserved in the ignored rollback folder.
- `stockflow-sync` version 10 and `stockflow-sync-candidate` version 3 (unchanged by this release).

**Acceptance** (`ayrvhemxzizpkfcycvip`):
- Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8`.
- `stockflow-orders` version 11.
- All 14 economics migrations are applied, including the current-queue fix below; application/gateway versions remain unchanged.

**Staged connector** (`work/instrument-economics-connector-release/`):
- Every file matches `manifest.json`, and the scripts match `desktop-connector/` source.
- Includes `-EconomicPurchaseHistoryMonths` (default 12) and filtered older history.
- `productionActivated: false`.

## 3. Migrations to apply to production, in this exact order

Several migrations patch earlier function text with guarded single-fragment replacements, so order matters. Apply the local files in filename order. Each must apply once with no error; a guard failure stops the release.

| # | Local file | Normalized SHA-256 | Acceptance hosted version | Acceptance content |
| --- | --- | --- | --- | --- |
| 1 | `20261007180000_instrument_economics_foundation.sql` | `f00abf0b…` | `20261010064628` | identical |
| 2 | `20261007181000_instrument_economic_import_and_rebuild.sql` | `f3ab94b1…` | `20261010064717` | identical |
| 3 | `20261007182000_instrument_economics_workspace.sql` | `339fbdae…` | `20261010064724` | identical |
| 4 | `20261007183000_instrument_economics_commands.sql` | `c6c7f81d…` | `20261010064732` | identical |
| 5 | `20261010071925_historical_instrument_registration.sql` | `f645c794…` | `20261010073042` | identical |
| 6 | `20261010170000_instrument_actuals_without_plan.sql` | `6c927972…` | `20261010170000` | applied by CLI as 6 split statements; hash comparison not applicable (see 3.1) |
| 7 | `20261010172000_optional_plan_health.sql` | `78d94694…` | `20261010172000` | applied by CLI as 4 split statements; hash comparison not applicable (see 3.1) |
| 8 | `20261010200000_source_voucher_number.sql` | `b31b676a…` | `20261010151545` | identical |
| 9 | `20261010210000_automatic_purchase_cost.sql` | `f0b3affd…` | `20261010151619` | identical |
| 10 | `20261010220000_auto_cost_batch_fallback.sql` | `b35c2b5a…` | `20261010153136` | identical |
| 11 | `20261010230000_auto_cost_one_year_lookback.sql` | `51bf0b88…` | `20261010154700` | identical |
| 12 | `20261010240000_unmapped_items_not_unresolved.sql` | `38f5d9a5…` | `20261010162559` | identical |
| 13 | `20261011000000_instrument_reagent_sale_date.sql` | `36f71cf4…` | `20261010171033` | identical |
| 14 | `20261011010000_active_economic_import_exceptions.sql` | `687980d1…` | `20261010191809` | identical |

Acceptance application time order equals this local order. Full hashes are in `supabase/migration-history-map.json`.

### 3.1 Before applying

- Rerun the production fingerprint query. It must still equal `3c1b617639bb39e13385dd40fb8cdb08`, with 103 versions and no economics objects.
- For rows 6 and 7, compare the CLI-split acceptance statements with the local files after removing whitespace and statement separators, or accept the earlier recorded readback match.
- Rerun `node tests/pricing-release-preflight.mjs` (or its unit test) with the frozen change set. Expect 13 pending migrations and no unreviewed files.
- Rerun the complete disposable deployment-order replay (`tests/pricing-migration-local.ps1 -DeploymentOrder`) on the frozen change set.

### 3.2 Applying

- Apply one file at a time to `aormuidjbdqruglmyseh` in table order, using the exact file content. Record each hosted version, then compare the hosted normalized hash with the table.
- Do not push the whole migrations folder, repair history or drop objects. The repository's Supabase CLI link points at acceptance, so name the production project explicitly every time.

## 4. Application, gateway and connector

1. Deploy `stockflow-orders` to production from the frozen, reviewed source after blocker 7. Record the new version and bundle hash. Keep version 30 as rollback.
2. Run `pnpm build:staff:production`. Never reuse an acceptance artifact. Guard `dist/server/wrangler.json` for name `suprabha-staff` and `STOCKFLOW_AUTH_EXPECTED_PROJECT=aormuidjbdqruglmyseh`, and refuse on any mismatch. Then run `pnpm exec wrangler deploy --config dist/server/wrangler.json --keep-vars` and record the version.
3. Connector: copy the staged package over the scheduled connector's scripts only after re-verifying `manifest.json`. Keep the existing state and credentials files untouched. Restart the scheduled connector. It already points to production. Defaults are `EconomicHistoryMonths=3` and `EconomicPurchaseHistoryMonths=12`.

## 5. Post-cutover verification

- The first connector sync is acknowledged, one economic rebuild is published, and import exceptions are visible rather than hidden.
- Expected size: about 150 vouchers per month and about 4 lines per voucher. 3 months of all vouchers plus filtered 12-month history should stay well under the 2,000-voucher envelope and 10,000-line rebuild limits. Confirm the actual counts.
- Signed-out probes: page 200 no-store; `/api/instrument-economics` and `/api/instruments` 401 private no-store.
- Signed in as Administrator: Instruments, To do, Set up, Advanced and per-item totals.
- As Accounts: read-only, no Set up/Advanced.
- As Sales/Operations: no financial data.
- Production starts with no instruments. Recreate the pilot through Set up (register, purchase, billing, approve, items) and compare its totals with acceptance before relying on them.

## 7. Withdrawn proposal: count packing charges as reagent cost

**Withdrawn 11 Oct 2026.** The owner decided to exclude packing for now (see blocker 1). Keep this section only as the design to use if packing should count in future. Do not implement it now.

This was never implemented. `desktop-connector/economics.ps1` is reserved for Claude RC, and integration belongs to ChatGPT / Codex.

**Tally packing ledgers** (read-only export, 11 Oct; all parent "Indirect Expenses", tax type "Others"):

| Ledger | GUID |
| --- | --- |
| Packing Charges 0% | `<ledger-id: packing charges 0%>` |
| Packing & Forwarding 18 | `<ledger-id: packing & forwarding 18>` |
| Packing Forwarding 5 | `<ledger-id: packing forwarding 5>` |

Real ledger IDs are kept in the private policy file, not in this repository.

Accounts should confirm that these three are all the packing ledgers and that none is used for anything else.

**Connector change** (`desktop-connector/economics.ps1`):
- Add a role `included_charge` to the allowed ledger roles (the line that lists `gst, discount, rounding, charge, trade`).
- Add `'included_charge' { $includedCharges+=$amount }` to the ledger-role switch.
- Include `$includedCharges` in the party-total reconciliation.
- Apportion it into line `netSalesPaise` with the existing exact-paise loop, using field `chargePaise` (as `discountPaise`/`roundingPaise` do).

This makes packing part of each line's net purchase value, and so part of automatic cost. Freight keeps role `charge` and stays excluded.

**Configuration:** add the three GUIDs with role `included_charge` to the ledger roles in `docs/INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json` and the staged `economic-ledger-roles.json`, then refresh the staged manifest.

**Sales side:** if a sales invoice carries a packing ledger, the same role adds it to that sale's net revenue. This is symmetrical, but confirm with the owner that customer-charged packing should count as reagent revenue.

**Server:** no migration is needed. The import and rebuild already use line `netSalesPaise`, and extra line fields are kept as evidence.

**Tests:**
- A connector fixture where a purchase with a packing ledger apportions exactly by line value into `chargePaise`/`netSalesPaise`.
- Freight stays excluded.
- An unconfigured packing ledger still raises "Unclassified document adjustment".

**After deployment:** re-extract and import the affected purchase invoices, so the packing import exceptions clear and their costs include packing.

## 8. Rollback

- App: redeploy Worker `167e2b20-a56d-4057-87ab-9a5f3302b752`.
- Gateway: redeploy `stockflow-orders` version 30 source from the rollback folder.
- Connector: restart with `-DisableInstrumentEconomics`, or restore the previous scripts. State and credentials are untouched.
- Database: leave the economics schema in place; it is inert without connector evidence and UI access. Never drop business tables or rewrite history. If a migration fails mid-way, its transaction rolls back. Stop and record the failure; do not hand-patch.

## Integration checkpoint — ChatGPT / Codex, 11 October 2026

Acceptance-only migration `20261010191809` derives unresolved import failures from admitted canonical revisions; the original 19 failure records remain immutable. Guarded targeted import: eight purchase vouchers / ten lines / 5,077 bytes, no catalog or complete-window claim. Source vouchers now 313; run `ab090976-9553-4cc9-a6ff-276e6c82b56b`; 11 open exceptions. Stock snapshot MD5 remains `b4aaf83908c54f978c9433759256d8f0`. Pilot sales ₹4,52,669.52, known GP/recovery ₹2,76,770.94, provisional balance ₹0 and one LDL-C unavailable cost are unchanged.

Validation: ten release-preflight units, existing connector fixtures, full disposable deployment-order SQL/integrity and two-session concurrency suites. The new eleven-case queue suite reproduces the old read-model bug and verifies immutable evidence, canonical company/revision isolation, newer/same-revision conflicts, later admission, cancellation, unknown revisions, global failures and private helper permissions. Hosted source/hash readback and Administrator browser verification passed. Existing Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` and gateway version 11 serve this database change without an app deployment. Claude's active Orders source changes are not included.

Production read-only count remains 103 migrations; the new helper is absent there. All 14 economics migrations remain pending production in the history map. Full fingerprint/hash refresh is still required immediately before cutover. Accounts/Tally LDL-C correction, explicit remaining source scope, financial sign-off and separate-role sessions remain open.
