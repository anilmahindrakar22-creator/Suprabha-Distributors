import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isApprovedGatewayKey, readBoundedJson, RequestGate } from "./request-gate.ts";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
const reply = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extraHeaders } });
const actions = ["session", "bootstrap", "get_catalog", "get_customers", "get_order_summary", "list_orders", "get_order_events", "get_order_details", "get_order_pricing", "submit_order_pricing", "apply_governed_order_pricing", "approve_price_exception", "reject_price_exception", "list_price_contracts", "create_price_contract", "approve_price_contract", "reject_price_contract", "list_pricing_policies", "create_pricing_policy", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "apply_price_book", "approve_customer_price_book", "approve_customer_group_margin", "apply_product_price_impact", "list_standard_item_prices", "set_standard_item_price", "recover_order_submission", "create_order", "transition_order", "save_fulfilment", "save_dispatch", "confirm_delivery", "edit_order", "create_exception", "resolve_exception", "schedule_installation", "complete_installation", "record_billing_review", "add_order_note", "set_order_priority", "set_order_assignee", "set_order_follow_up", "complete_order_follow_up", "get_service_workspace", "create_service_ticket", "resolve_service_ticket", "list_users", "list_assignable_users", "upsert_user"];
const readActions = new Set(["session", "bootstrap", "get_catalog", "get_customers", "get_order_summary", "list_orders", "get_order_events", "get_order_details", "get_order_pricing", "list_price_contracts", "list_pricing_policies", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "list_standard_item_prices", "recover_order_submission", "get_service_workspace", "list_users", "list_assignable_users"]);
const requestGate = new RequestGate();
const productRequestActions = ['list_product_requests', 'create_product_request', 'review_product_request'];
actions.push(...productRequestActions);
readActions.add('list_product_requests');
actions.push('get_requirements');
readActions.add('get_requirements');

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
    const gateway = ["session", "list_users", "list_assignable_users", "upsert_user"].includes(body.action) ? "stockflow_user_gateway" : body.action === "get_catalog" ? "stockflow_catalog_gateway" : body.action === "get_customers" ? "stockflow_customer_gateway" : body.action === "get_order_summary" ? "stockflow_order_summary_gateway" : body.action === "list_orders" ? "stockflow_order_list_gateway" : body.action === "get_order_events" ? "stockflow_order_activity_gateway" : body.action === "get_order_details" ? "stockflow_order_detail_gateway" : ["get_order_pricing", "submit_order_pricing", "apply_governed_order_pricing", "approve_price_exception", "reject_price_exception", "list_price_contracts", "create_price_contract", "approve_price_contract", "reject_price_contract", "list_pricing_policies", "create_pricing_policy", "get_customer_price_book", "preview_customer_prices", "preview_customer_group_margin", "get_product_price_impact", "apply_price_book", "approve_customer_price_book", "approve_customer_group_margin", "apply_product_price_impact", "list_standard_item_prices", "set_standard_item_price"].includes(body.action) ? "stockflow_pricing_gateway" : body.action === "recover_order_submission" ? "stockflow_submission_recovery_gateway" : ["get_service_workspace", "create_service_ticket", "resolve_service_ticket"].includes(body.action) ? "stockflow_service_gateway" : body.action === "record_billing_review" ? "stockflow_billing_review_gateway" : body.action === "add_order_note" ? "stockflow_order_note_gateway" : body.action === "set_order_priority" ? "stockflow_priority_gateway" : body.action === "set_order_assignee" ? "stockflow_assignment_gateway" : ["set_order_follow_up", "complete_order_follow_up"].includes(body.action) ? "stockflow_follow_up_gateway" : ["save_dispatch", "confirm_delivery"].includes(body.action) ? "stockflow_delivery_gateway" : body.action === "save_fulfilment" ? "stockflow_fulfilment_gateway" : body.action === "edit_order" ? "stockflow_edit_gateway" : ["create_exception", "resolve_exception"].includes(body.action) ? "stockflow_exception_gateway" : ["schedule_installation", "complete_installation"].includes(body.action) ? "stockflow_installation_gateway" : "stockflow_order_gateway";
    // Modern Supabase secret keys belong only in `apikey`. The supabase-js
    // default Authorization header treats them as JWTs and rejects the call.
    const rpcGateway = body.action === 'get_requirements' ? 'stockflow_requirements_gateway' : productRequestActions.includes(body.action) ? 'stockflow_product_request_gateway' : gateway;
    const response = await fetch(`${url}/rest/v1/rpc/${rpcGateway}`, {
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
