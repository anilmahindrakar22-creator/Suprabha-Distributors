import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const actions = ["session", "bootstrap", "create_order", "transition_order", "save_fulfilment", "edit_order", "list_users", "upsert_user"];

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const gatewayKey = request.headers.get("x-order-gateway-key");
  if (!gatewayKey || gatewayKey.length < 32) return reply({ message: "Unauthorized gateway", code: "42501" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 65_536) return reply({ error: "Request is too large" }, 413);

  let body: { actorEmail?: string; action?: string; payload?: Record<string, unknown> };
  try { body = await request.json(); } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (typeof body.actorEmail !== "string" || typeof body.action !== "string" || !actions.includes(body.action)) return reply({ error: "Invalid request" }, 400);

  const database = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  const gateway = ["session", "list_users", "upsert_user"].includes(body.action) ? "stockflow_user_gateway" : body.action === "save_fulfilment" ? "stockflow_fulfilment_gateway" : body.action === "edit_order" ? "stockflow_edit_gateway" : "stockflow_order_gateway";
  const { data, error } = await database.rpc(gateway, {
    p_gateway_key: gatewayKey, p_actor_email: body.actorEmail, p_action: body.action, p_payload: body.payload ?? {},
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "54000" ? 429 : 400;
    return reply({ message: error.message, code: error.code }, status);
  }
  return reply(data);
});
