import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Evidence-only: no database connection, SQL execution or migration-history repair.
const pricingReleaseFiles = new Set([
  '20261130175000_voucher_lookup_indexes.sql',
  '20261102100000_contract_windows.sql',
  '20261102110000_today_decisions.sql',
  '20261102120000_customer_map.sql',
  '20261102130000_customer_city_pin.sql',
  '20261102140000_pin_centroids.sql',
  '20261102150000_pin_placement_gateway.sql',
  '20261102160000_visit_checkins.sql',
  '20261102170000_customer_rename_by_guid.sql',
  '20261102180000_customer_auto_link.sql',
  '20261102190000_wallet_test_volume.sql',
  '20261102191000_lab_size_reports.sql',
  '20261102192000_instrument_rental_registration.sql',
  '20261102193000_pin_move_management_only.sql',
  '20261116090000_lab_mix_reports.sql',
  '20261116100000_brand_mapping.sql',
  '20261116110000_brand_prospects.sql',
  '20261116120000_wallet_special_tests.sql',
  '20261116130000_recover_signal.sql',
  '20261116140000_lab_size_specials.sql',
  '20261116160000_wallet_verification.sql',
  '20261116170000_prospects_focus_first.sql',
  '20261117090000_supplier_prices_safe_delete.sql',
  '20261118090000_control_null_and_source_time.sql',
  '20261118100000_deferred_economic_rebuild.sql',
  '20261118110000_reconciliation_rounding.sql',
  '20261118120000_cron_log_trim.sql',
  '20261118130000_catalog_current_columns.sql',
  '20261122090000_economic_result_pruning.sql',
  '20261122100000_sync_error_domain.sql',
  '20261122110000_omission_scope.sql',
  '20261122120000_company_gp_model.sql',
  '20261129090000_visit_reasons.sql',
  '20261129100000_accounts_no_territory.sql',
  '20261129110000_growth_read.sql',
  '20261129120000_growth_p1b.sql',
  '20261129130000_growth_tree_lists.sql',
  '20261129140000_growth_inbox.sql',
  '20261129150000_growth_gp.sql',
  '20261129160000_growth_item_kind.sql',
  '20261129170000_growth_margin.sql',
  '20261129180000_growth_billed_below.sql',
  '20261129190000_growth_price_cards.sql',
  '20261130090000_growth_integer_paise.sql',
  '20261130091000_growth_lab_coverage.sql',
  '20261130100000_coverage_exception_date.sql',
  '20261130110000_growth_lab_total_business.sql',
  '20261130120000_contact_decision_roles.sql',
  '20261130130000_batch_item_mappings.sql',
  '20261130140000_brand_line_tree.sql',
  '20261130150000_growth_brands.sql',
  '20261130160000_economic_covered_segments.sql',
  '20261130170000_growth_lab_months.sql',
  '20261130180000_economic_item_areas.sql',
  '20261130190000_brand_group_inherit.sql',
  '20261130200000_economic_prune_schedule.sql',
  '20261201090000_growth_target_margin_lift.sql',
  '20261201100000_growth_detail_by_tally_item.sql',
  '20261201110000_growth_lapsing_labs.sql',
  '20261206090000_stock_cover.sql',
  '20261206100000_price_outcomes.sql',
  '20261206110000_data_checks.sql',
  '20261206120000_idle_stock.sql',
  '20261213090000_observed_price_changes.sql',
  '20261214090000_unlinked_po_receipts.sql',
  '20261214100000_company_letterhead.sql',
  '20261215090000_growth_declining_labs.sql',
  '20261215100000_letterhead_extras.sql',
  '20261216090000_stock_on_po.sql',
  '20261216100000_stock_item_detail.sql',
  '20261216110000_idle_stock_speed.sql',
  '20261217090000_late_pos.sql',
  '20261217100000_reorder_check.sql',
  '20261217110000_idle_buyers.sql',
  '20261220090000_growth_period.sql',
  '20261220100000_growth_period_labs.sql',
  '20261220110000_growth_period_profit.sql',
  '20261227090000_economics_read_speed.sql',
  '20261227100000_economic_line_reads.sql',
  '20261227110000_economic_products_read.sql',
  '20261227120000_economic_cost_review.sql',
  '20261227130000_data_speed_report.sql',
  '20270103090000_po_quantity_corrections.sql',
  '20270103100000_item_forecast_trial.sql',
  '20270103120000_import_exception_hygiene.sql',
  '20261102090000_po_tally_receipts.sql',
  '20261031140000_power_map_enhancement.sql',
  '20261030090000_instrument_register.sql',
  '20261030091000_instrument_register_read.sql',
  '20261030100000_economic_rebuild_containment.sql',
  '20261030101000_sales_coverage.sql',
  '20261030110000_economics_candidate_rebuild.sql',
  '20261030130000_wallet_v2.sql',
  '20261031090000_wallet_diagnosis.sql',
  '20261031120000_wallet_actions.sql',
  '20261031130000_wallet_my_actions.sql',
  '20261031140000_power_map_enhancement.sql',
  '20261031150000_power_map_influence.sql',
  '20261029100000_supplier_purchase_orders.sql',
  '20261029090000_challan_delivery.sql',
  '20261029091000_order_list_priority_sort.sql',
  '20261028090000_to_order_list.sql',
  '20261016130829_tally_recent_products.sql',
  '20261019090000_financial_year_order_numbers.sql',
  '20261019120000_economics_owned_result_prefilter.sql',
  '20261019150000_economics_trim_unplaced_rows.sql',
  '20261019180000_economics_detail_read.sql',
  '20261025090000_billing_role.sql',
  '20261026090000_billing_rate_check.sql',
  '20261026100000_approver_price_change.sql',
  '20261026110000_remembered_customer_price.sql',
  '20261026120000_ist_dispatch_date.sql',
  '20261026130000_billing_snapshot_shapes.sql',
  '20261026140000_push_alerts.sql',
  '20261026150000_rate_check_units.sql',
  '20261016061635_mapped_instrument_cost_scope.sql',
  '20261016053720_economic_import_execution_budget.sql',
  '20261007180000_instrument_economics_foundation.sql',
  '20261007181000_instrument_economic_import_and_rebuild.sql',
  '20261007182000_instrument_economics_workspace.sql',
  '20261007183000_instrument_economics_commands.sql',
  '20261010071925_historical_instrument_registration.sql',
  '20261010170000_instrument_actuals_without_plan.sql',
  '20261010172000_optional_plan_health.sql',
  '20261010200000_source_voucher_number.sql',
  '20261010210000_automatic_purchase_cost.sql',
  '20261010220000_auto_cost_batch_fallback.sql',
  '20261010230000_auto_cost_one_year_lookback.sql',
  '20261010240000_unmapped_items_not_unresolved.sql',
  '20261011000000_instrument_reagent_sale_date.sql',
  '20261011010000_active_economic_import_exceptions.sql',
  '20261011060830_order_summary_revision.sql',
  '20261012184457_instrument_economics_summary_read.sql',
  '20261011070000_product_master_refresh.sql',
  '20261011090000_requirements_decision_view.sql',
  '20261013120000_administrator_long_payback_approval.sql',
  '20261013130000_instrument_auto_approval.sql',
  '20261014090000_customer_accounts.sql',
  '20261014120000_account_classes.sql',
  '20261014160000_account_contacts.sql',
  '20261014180000_power_map.sql',
  '20261014190000_social_styles.sql',
  '20261015082020_visit_customers_without_ledger.sql',
  '20261015100000_customer_link_confirmation.sql',
  '20261015120000_import_problem_details.sql',
  '20261015190800_native_tally_debit_notes.sql',
  '20261004070312_combined_member_role_assignments.sql',
  '20261004071246_combined_role_policy_helpers.sql',
  '20261004071720_combined_role_order_mutation_checks.sql',
  '20261004072232_combined_role_order_reads.sql',
  '20261004072544_combined_role_order_summary.sql',
  '20261004072837_combined_role_session_contract.sql',
  '20261004073444_combined_role_operational_gateways.sql',
  '20261004073931_combined_role_pricing_authorization.sql',
  '20261004074430_combined_role_recovery_billing_review.sql',
  '20261005053332_combined_billing_review_order_scope.sql',
  '20261005053856_governed_member_role_sets.sql',
  '20261005054431_remaining_role_union_gateways.sql',
  '20261005055748_activate_governed_role_union.sql',
  '20260912193000_customer_pricing_engine.sql',
  '20260913130000_customer_price_book.sql',
  '20260913131000_customer_price_book_resolution.sql',
  '20260913132000_price_book_gateway.sql',
  '20260914100000_billing_pricing_evidence_gate.sql',
  '20260914120000_pricing_submission_recovery.sql',
  '20260914140000_contract_policy_recovery.sql',
  '20260914160000_close_unresolved_pricing.sql',
  '20260919151500_enforce_independent_price_approval.sql',
  '20260920123000_allow_admin_self_price_approval.sql',
  '20260921110000_observable_pricing_evidence_import.sql',
  '20260921123000_customer_price_book_visibility.sql',
  '20260921143000_apply_governed_order_prices.sql',
  '20260921160000_customer_first_pricing_correction.sql',
  '20260923150000_customer_price_book_bulk_approval.sql',
  '20260924100000_cost_increase_exception_gate.sql',
  '20260927180000_snapshot_pricing_import_privilege.sql',
  '20260928110000_customer_group_gross_margin.sql',
  '20260928104500_non_retryable_business_conflicts.sql',
  '20260929180000_catalog_source_version.sql',
  '20260930125943_preserve_customers_on_partial_snapshot.sql',
  '20261001055456_controlled_product_requests.sql',
  '20261001061531_customer_demand_requirements.sql',
  '20261001070000_requirement_waiting_orders.sql',
  '20261001073000_reported_stock_increase_alerts.sql',
]);
const sha = (sql) => createHash('sha256').update(sql.replace(/\r/g, '').trim(), 'utf8').digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^\d{14}$/;

// Replay registration only; this evidence checker never executes SQL.
export const pricingReleaseSqlTests = [
  'supabase/tests/voucher_lookup_indexes.sql',
  'supabase/tests/sales_coverage.sql',
  'supabase/tests/wallet_v2.sql',
  'supabase/tests/wallet_v2_concurrency.sql',
  'supabase/tests/wallet_diagnosis.sql',
  'supabase/tests/wallet_diagnosis_concurrency.sql',
  'supabase/tests/wallet_actions.sql',
  'supabase/tests/wallet_actions_concurrency.sql',
  'supabase/tests/wallet_my_actions.sql',
  'supabase/tests/power_map_enhancement.sql',
  'supabase/tests/contact_decision_roles.sql',
  'supabase/tests/power_map_influence.sql',
  'supabase/tests/po_tally_receipts.sql',
  'supabase/tests/po_tally_receipts_concurrency.sql',
  'supabase/tests/contract_windows.sql',
  'supabase/tests/today_decisions.sql',
  'supabase/tests/recover_signal.sql',
  'supabase/tests/customer_map.sql',
  'supabase/tests/customer_city_pin.sql',
  'supabase/tests/customer_rename_guid.sql',
  'supabase/tests/customer_auto_link.sql',
  'supabase/tests/wallet_test_volume.sql',
  'supabase/tests/wallet_special_tests.sql',
  'supabase/tests/lab_size_reports.sql',
  'supabase/tests/lab_size_specials.sql',
  'supabase/tests/wallet_verification.sql',
  'supabase/tests/prospects_focus_first.sql',
  'supabase/tests/supplier_prices_safe_delete.sql',
  'supabase/tests/control_null_and_source_time.sql',
  'supabase/tests/deferred_economic_rebuild.sql',
  'supabase/tests/deferred_economic_rebuild_concurrency.sql',
  'supabase/tests/catalog_current_columns.sql',
  'supabase/tests/reconciliation_rounding.sql',
  'supabase/tests/economic_result_pruning.sql',
  'supabase/tests/economic_sync_error_domain.sql',
  'supabase/tests/economic_omission_scope.sql',
  'supabase/tests/company_gp_model.sql',
  'supabase/tests/visit_reasons.sql',
  'supabase/tests/accounts_no_territory.sql',
  'supabase/tests/growth_read.sql',
  'supabase/tests/growth_p1b.sql',
  'supabase/tests/growth_tree_lists.sql',
  'supabase/tests/growth_inbox.sql',
  'supabase/tests/growth_gp.sql',
  'supabase/tests/growth_item_kind.sql',
  'supabase/tests/growth_margin.sql',
  'supabase/tests/growth_billed_below.sql',
  'supabase/tests/growth_price_cards.sql',
  'supabase/tests/growth_integer_paise.sql',
  'supabase/tests/growth_lab_coverage.sql',
  'supabase/tests/coverage_exception_date.sql',
  'supabase/tests/growth_lab_total_business.sql',
  'supabase/tests/economic_covered_segments.sql',
  'supabase/tests/lab_mix_reports.sql',
  'supabase/tests/brand_mapping.sql',
  'supabase/tests/brand_prospects.sql',
  'supabase/tests/instrument_rental_registration.sql',
  'supabase/tests/pin_centroids.sql',
  'supabase/tests/pin_placement.sql',
  'supabase/tests/visit_checkins.sql',
  'supabase/tests/batch_item_mappings.sql',
  'supabase/tests/brand_line_tree.sql',
  'supabase/tests/growth_brands.sql',
  'supabase/tests/growth_lab_months.sql',
  'supabase/tests/economic_item_areas.sql',
  'supabase/tests/brand_group_inherit.sql',
  'supabase/tests/economic_prune_schedule.sql',
  'supabase/tests/growth_target_margin_lift.sql',
  'supabase/tests/growth_detail_by_tally_item.sql',
  'supabase/tests/growth_lapsing_labs.sql',
  'supabase/tests/stock_cover.sql',
  'supabase/tests/price_outcomes.sql',
  'supabase/tests/data_checks.sql',
  'supabase/tests/idle_stock.sql',
  'supabase/tests/observed_price_changes.sql',
  'supabase/tests/unlinked_po_receipts.sql',
  'supabase/tests/company_letterhead.sql',
  'supabase/tests/growth_declining_labs.sql',
  'supabase/tests/letterhead_extras.sql',
  'supabase/tests/stock_on_po.sql',
  'supabase/tests/stock_item_detail.sql',
  'supabase/tests/idle_stock_speed.sql',
  'supabase/tests/late_pos.sql',
  'supabase/tests/reorder_check.sql',
  'supabase/tests/idle_buyers.sql',
  'supabase/tests/growth_period.sql',
  'supabase/tests/growth_period_labs.sql',
  'supabase/tests/growth_period_profit.sql',
  'supabase/tests/economics_read_speed.sql',
  'supabase/tests/economic_line_reads.sql',
  'supabase/tests/economic_products_read.sql',
  'supabase/tests/economic_cost_review.sql',
  'supabase/tests/data_speed_report.sql',
  'supabase/tests/po_quantity_corrections.sql',
  'supabase/tests/item_forecast_trial.sql',
  'supabase/tests/import_exception_hygiene.sql',
];

export function pricingReleasePreflight(evidence, files) {
  if (evidence.projectId !== 'aormuidjbdqruglmyseh') throw new Error('Unexpected evidence project');
  const seen = new Set();
  const versions = new Set();
  const deployed = [];
  const pending = [];
  function addVersion(version) {
    if (!versionPattern.test(version ?? '') || versions.has(version)) throw new Error('Invalid or duplicate remote version');
    versions.add(version);
  }
  for (const bootstrap of evidence.remoteOnly) {
    addVersion(bootstrap.version);
    if (!hashPattern.test(bootstrap.hash)) throw new Error('Invalid bootstrap hash');
    if (!bootstrap.localFile || seen.has(bootstrap.localFile) || !files.has(bootstrap.localFile)) throw new Error('Missing or duplicate bootstrap migration');
    if (sha(files.get(bootstrap.localFile)) !== bootstrap.hash) throw new Error(`Migration hash changed: ${bootstrap.localFile}`);
    seen.add(bootstrap.localFile);
    deployed.push({ localFile: bootstrap.localFile, remoteVersion: bootstrap.version });
  }
  for (const entry of evidence.migrations) {
    const name = entry.localFile;
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || seen.has(name)) throw new Error('Invalid or duplicate local migration');
    seen.add(name);
    if (!files.has(name)) throw new Error(`Missing migration: ${name}`);
    if (sha(files.get(name)) !== entry.localSha256) throw new Error(`Migration hash changed: ${name}`);
    if (entry.status === 'not_deployed') {
      if (entry.remoteVersion !== null || entry.remoteSha256 !== null || !pricingReleaseFiles.has(name)) {
        throw new Error(`Unreviewed pending migration: ${name}`);
      }
      pending.push(name);
    } else {
      addVersion(entry.remoteVersion);
      if (!hashPattern.test(entry.remoteSha256 ?? '')) throw new Error(`Invalid remote hash: ${name}`);
      if (entry.status === 'exact_normalized_match') {
        if (entry.localSha256 !== entry.remoteSha256) throw new Error(`Inconsistent exact match: ${name}`);
      } else if (entry.status !== 'formatting_difference_reviewed' || !entry.review?.trim()) {
        throw new Error(`Unreviewed migration status: ${name}`);
      }
      deployed.push({ localFile: name, remoteVersion: entry.remoteVersion });
    }
  }
  if (files.size !== seen.size) throw new Error('Unmapped local migrations; refresh evidence');
  const latestRemoteVersion = [...versions].sort((a, b) => a.localeCompare(b)).at(-1);
  pending.sort((a, b) => a.localeCompare(b));
  if (pending.some((name) => name.slice(0, 14) <= latestRemoteVersion)) throw new Error('Pending migration predates deployed history');
  return {
    evidenceDate: evidence.checkedAt,
    liveHistoryRechecked: false,
    releaseReady: false,
    deployed: deployed.sort((a, b) => a.remoteVersion.localeCompare(b.remoteVersion)),
    pending,
    sqlTests: [...pricingReleaseSqlTests],
    blockers: [
      'Refresh live migration history and compare content again before release.',
      'Run the deployed-order clean-install replay immediately before release.',
      'Complete staff-login acceptance against an isolated deployed candidate.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = resolve(root, 'supabase/migrations');
  try {
    const evidence = JSON.parse(readFileSync(resolve(root, 'supabase/migration-history-map.json'), 'utf8'));
    const files = new Map(readdirSync(directory).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(resolve(directory, name), 'utf8')]));
    console.log(JSON.stringify(pricingReleasePreflight(evidence, files), null, 2));
  } catch (error) {
    console.error(`Preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
