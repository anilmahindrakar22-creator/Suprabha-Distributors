import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isApprovedGatewayKey, readBoundedJson, RequestGate } from "./request-gate.ts";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
const reply = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extraHeaders } });
const actions = ["session", "bootstrap", "get_catalog", "get_customers", "get_tally_recent_products", "get_order_summary", "list_orders", "get_order_events", "get_order_details", "get_order_pricing", "submit_order_pricing", "apply_governed_order_pricing", "approve_price_exception", "reject_price_exception", "list_price_contracts", "create_price_contract", "approve_price_contract", "reject_price_contract", "list_pricing_policies", "create_pricing_policy", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "apply_price_book", "approve_customer_price_book", "approve_customer_group_margin", "apply_product_price_impact", "list_standard_item_prices", "set_standard_item_price", "recover_order_submission", "create_order", "transition_order", "save_fulfilment", "save_dispatch", "confirm_delivery", "edit_order", "create_exception", "resolve_exception", "schedule_installation", "complete_installation", "record_billing_review", "add_order_note", "set_order_priority", "set_order_assignee", "set_order_follow_up", "complete_order_follow_up", "get_service_workspace", "create_service_ticket", "resolve_service_ticket", "list_users", "list_assignable_users", "upsert_user"];
const readActions = new Set(["session", "bootstrap", "get_catalog", "get_customers", "get_tally_recent_products", "get_order_summary", "list_orders", "get_order_events", "get_order_details", "get_order_pricing", "list_price_contracts", "list_pricing_policies", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "list_standard_item_prices", "recover_order_submission", "get_service_workspace", "list_users", "list_assignable_users"]);
const requestGate = new RequestGate();
const accountActions = ['create_customer', 'get_accounts', 'create_territory', 'assign_account', 'set_location', 'log_visit', 'set_class_policy', 'add_contact', 'update_contact', 'remove_contact', 'set_assessment', 'erase_contact', 'record_style_observation', 'set_style_override'];
actions.push(...accountActions);
readActions.add('get_accounts');
const productRequestActions = ['list_product_requests', 'create_product_request', 'review_product_request'];
actions.push(...productRequestActions);
readActions.add('list_product_requests');
const pushActions = ['push_config', 'push_subscribe', 'push_unsubscribe'];
const purchaseActions = ['supplier_options','create_purchase_orders','list_purchase_orders','mark_purchase_order_shared','receive_purchase_order','cancel_purchase_order'];
actions.push(...purchaseActions);
const purchaseReceiptActions = ['get_tally_receipts', 'get_tally_receipt_counts', 'receive_from_tally'];
actions.push(...purchaseReceiptActions);
readActions.add('get_tally_receipts');
readActions.add('get_tally_receipt_counts');
readActions.add('list_purchase_orders');
readActions.add('supplier_options');
actions.push('send_on_challan','bill_challan');
actions.push(...pushActions);
readActions.add('push_config');
actions.push('get_requirements');
readActions.add('get_requirements');
actions.push('get_requirement_orders');
readActions.add('get_requirement_orders');
actions.push('get_stock_alerts');
readActions.add('get_stock_alerts');
const economicActions = ['get_link_suggestions','confirm_customer_links','get_instrument_economics','recover_economic_command','register_historical_instrument','create_target','set_mapping','set_item_group_mapping','set_expectation','record_observation','approve_target','link_instrument_billing','review_acquisition','record_capital','set_group_members','close_group_membership','set_allocation','close_allocation','close_target','set_policy','rebuild','create_case','update_case','claim_recovery','verify_cost','resolve_line'];
actions.push(...economicActions);
actions.push('get_wallet_workspace', 'get_wallet_account', 'record_wallet_snapshot', 'set_wallet_policy');
actions.push('get_wallet_diagnoses', 'get_account_opportunities', 'get_account_signals', 'get_opportunity_outcomes', 'open_opportunity', 'record_constraint', 'close_opportunity');
actions.push('get_actions_due', 'get_opportunity_actions', 'get_action_owners', 'create_action', 'close_action');
actions.push('get_my_actions', 'close_my_action');
actions.push('get_contract_windows', 'get_today');
const powerMapActions = ['get_power_map', 'set_influence', 'end_influence'];
actions.push(...powerMapActions);
readActions.add('get_power_map');
readActions.add('get_my_actions');
readActions.add('get_contract_windows');
readActions.add('get_today');
readActions.add('get_actions_due');
readActions.add('get_opportunity_actions');
readActions.add('get_action_owners');
readActions.add('get_instrument_economics');
readActions.add('get_wallet_workspace');
readActions.add('get_wallet_account');
readActions.add('get_wallet_diagnoses');
readActions.add('get_account_opportunities');
readActions.add('get_account_signals');
readActions.add('get_opportunity_outcomes');
economicActions.push('get_sales_coverage');
readActions.add('get_sales_coverage');
readActions.add('get_link_suggestions');

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const gatewayKey = request.headers.get("x-order-gateway-key");
  if (!gatewayKey || gatewayKey.length < 32) return reply({ message: "Unauthorized gateway", code: "42501" }, 403);
  if (!await isApprovedGatewayKey(gatewayKey, Deno.env.get("STOCKFLOW_ORDER_GATEWAY_SHA256"))) return reply({ message: "Unauthorized gateway", code: "42501" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 65_536) return reply({ error: "Request is too large" }, 413);

  let body: { actorEmail?: string; action?: string; payload?: Record<string, unknown> };
  try { body = await readBoundedJson(request) as typeof body; } catch (error) {
    return error instanceof RangeError ? reply({ error: "Request is too large" }, 413) : reply({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || typeof body.actorEmail !== "string" || !body.actorEmail.trim() || body.actorEmail.length > 254 || typeof body.action !== "string" || !actions.includes(body.action)
    || (body.payload != null && (typeof body.payload !== "object" || Array.isArray(body.payload)))) return reply({ error: "Invalid request" }, 400);

  const admission = readActions.has(body.action) ? null : await requestGate.begin(gatewayKey, body.actorEmail, body.action, body.payload ?? {});
  if (admission && !admission.allowed) return reply({ message: "Wait before retrying this command", code: "54000" }, 429, { "retry-after": String(admission.retryAfterSeconds) });

  let conflict = false;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    const secretKey = secretKeys ? (JSON.parse(secretKeys) as Record<string, string>)["stockflowedge"] : undefined;
    if (!url || !secretKey) return reply({ message: "Order service is not configured" }, 503);
    const gateway = ["session", "list_users", "list_assignable_users", "upsert_user"].includes(body.action) ? "stockflow_user_gateway" : body.action === "get_catalog" ? "stockflow_catalog_gateway" : body.action === "get_tally_recent_products" ? "stockflow_recent_products_gateway" : body.action === "get_customers" ? "stockflow_customer_gateway" : body.action === "get_order_summary" ? "stockflow_order_summary_gateway" : body.action === "list_orders" ? "stockflow_order_list_gateway" : body.action === "get_order_events" ? "stockflow_order_activity_gateway" : body.action === "get_order_details" ? "stockflow_order_detail_gateway" : ["get_order_pricing", "submit_order_pricing", "apply_governed_order_pricing", "approve_price_exception", "reject_price_exception", "list_price_contracts", "create_price_contract", "approve_price_contract", "reject_price_contract", "list_pricing_policies", "create_pricing_policy", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "apply_price_book", "approve_customer_price_book", "approve_customer_group_margin", "apply_product_price_impact", "list_standard_item_prices", "set_standard_item_price"].includes(body.action) ? "stockflow_pricing_gateway" : body.action === "recover_order_submission" ? "stockflow_submission_recovery_gateway" : ["get_service_workspace", "create_service_ticket", "resolve_service_ticket"].includes(body.action) ? "stockflow_service_gateway" : body.action === "record_billing_review" ? "stockflow_billing_review_gateway" : body.action === "add_order_note" ? "stockflow_order_note_gateway" : body.action === "set_order_priority" ? "stockflow_priority_gateway" : body.action === "set_order_assignee" ? "stockflow_assignment_gateway" : ["set_order_follow_up", "complete_order_follow_up"].includes(body.action) ? "stockflow_follow_up_gateway" : ["save_dispatch", "confirm_delivery"].includes(body.action) ? "stockflow_delivery_gateway" : body.action === "save_fulfilment" ? "stockflow_fulfilment_gateway" : body.action === "edit_order" ? "stockflow_edit_gateway" : ["create_exception", "resolve_exception"].includes(body.action) ? "stockflow_exception_gateway" : ["schedule_installation", "complete_installation"].includes(body.action) ? "stockflow_installation_gateway" : "stockflow_order_gateway";
    // Modern Supabase secret keys belong only in `apikey`. The supabase-js
    // default Authorization header treats them as JWTs and rejects the call.
    const rpcGateway = body.action === 'get_contract_windows' ? 'stockflow_contract_window_gateway' : body.action === 'get_today' ? 'stockflow_today_gateway' : ['get_my_actions', 'close_my_action'].includes(body.action) ? 'stockflow_my_actions_gateway' : ['get_actions_due', 'get_opportunity_actions', 'get_action_owners', 'create_action', 'close_action'].includes(body.action) ? 'stockflow_action_gateway' : purchaseReceiptActions.includes(body.action) ? 'stockflow_po_receipt_gateway' : purchaseActions.includes(body.action) ? 'stockflow_purchase_gateway' : pushActions.includes(body.action) ? 'stockflow_push_gateway' : accountActions.includes(body.action) ? 'stockflow_accounts_gateway' : ['get_wallet_workspace', 'get_wallet_account', 'record_wallet_snapshot', 'set_wallet_policy'].includes(body.action) ? 'stockflow_wallet_gateway' : ['get_wallet_diagnoses', 'get_account_opportunities', 'get_account_signals', 'get_opportunity_outcomes', 'open_opportunity', 'record_constraint', 'close_opportunity'].includes(body.action) ? 'stockflow_opportunity_gateway' : economicActions.includes(body.action) ? 'stockflow_economics_gateway' : body.action === 'get_stock_alerts' ? 'stockflow_stock_alert_gateway' : body.action === 'get_requirement_orders' ? 'stockflow_requirement_orders_gateway' : body.action === 'get_requirements' ? 'stockflow_requirements_gateway' : productRequestActions.includes(body.action) ? 'stockflow_product_request_gateway' : gateway;
    const routedGateway = powerMapActions.includes(body.action) ? 'stockflow_power_map_gateway' : rpcGateway;
    const response = await fetch(`${url}/rest/v1/rpc/${routedGateway}`, {
      method: "POST",
      headers: { apikey: secretKey, "content-type": "application/json" },
      body: JSON.stringify({
        p_gateway_key: gatewayKey, p_actor_email: body.actorEmail, p_action: body.action, p_payload: body.payload ?? {},
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = data as { code?: string; message?: string };
      conflict = error.code === "40001" || error.code === "PT409";
      const status = error.code === "42501" ? 403 : conflict ? 409 : error.code === "54000" ? 429 : 400;
      return reply({ message: error.message, code: error.code }, status);
    }
    return reply(data);
  } finally {
    if (admission?.allowed) requestGate.finish(admission, conflict);
  }
});
