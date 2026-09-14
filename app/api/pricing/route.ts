import { getChatGPTUser } from '@/app/chatgpt-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import type { OrderPricingWorkspace } from '@/lib/pricing-types';
import { validPriceContractLookup, validPricingLookup, validatePricingCommand } from '@/lib/pricing-types';

const privateHeaders = { 'cache-control': 'private, no-store' };

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: privateHeaders });
}

async function actorEmail() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user.email;
}

export async function GET(request: Request) {
  try {
    const email = await actorEmail();
    const parameters = new URL(request.url).searchParams;
    if (parameters.has('recoveryKey')) {
      const idempotencyKey = parameters.get('recoveryKey') || '';
      const pricingAction = parameters.get('pricingAction') || '';
      if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey) || !['apply_price_book', 'apply_product_price_impact', 'set_standard_item_price', 'create_price_contract', 'approve_price_contract', 'reject_price_contract', 'create_pricing_policy'].includes(pricingAction)) return failure('Invalid recovery reference', 400);
      return Response.json(await callOrderGateway(email, 'recover_order_submission', { idempotencyKey, pricingAction }), { headers: privateHeaders });
    }
    if (parameters.get('book') === '1' || parameters.get('impact') === '1') {
      const customerId = parameters.get('customerId');
      const tallyKey = parameters.get('tallyKey');
      const offset = Number(parameters.get('offset') || 0);
      const tab = parameters.get('tab') || 'purchased';
      if (!validPriceContractLookup(customerId, tallyKey) || !Number.isInteger(offset) || offset < 0 || offset > 100000 || !['purchased','exceptions','all'].includes(tab) || (parameters.get('book') === '1' ? !customerId : !tallyKey)) return failure('Invalid pricing filters', 400);
      return Response.json(await callOrderGateway(email, parameters.get('book') === '1' ? 'get_customer_price_book' : 'get_product_price_impact', { customerId, tallyKey, offset, tab, search: (parameters.get('search') || '').slice(0, 200) }), { headers: privateHeaders });
    }
    if (parameters.get('base') === '1') return Response.json(await callOrderGateway(email, 'list_standard_item_prices', {}), { headers: privateHeaders });
    const orderId = parameters.get('orderId');
    const pricingDate = parameters.get('pricingDate');
    if (parameters.get('policies') === '1') {
      return Response.json(await callOrderGateway(email, 'list_pricing_policies', {}), { headers: privateHeaders });
    }
    if (parameters.get('contracts') === '1') {
      const customerId = parameters.get('customerId');
      const tallyKey = parameters.get('tallyKey');
      if (!validPriceContractLookup(customerId, tallyKey)) return failure('Invalid customer price filters', 400);
      return Response.json(await callOrderGateway(email, 'list_price_contracts', { ...(customerId ? { customerId } : {}), ...(tallyKey ? { tallyKey } : {}) }), { headers: privateHeaders });
    }
    if (!validPricingLookup(orderId, pricingDate)) return failure('Valid pricing lookup is required', 400);
    return Response.json(await callOrderGateway<OrderPricingWorkspace>(email, 'get_order_pricing', {
      orderId,
      ...(pricingDate ? { pricingDate } : {}),
    }), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Pricing service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  try {
    const email = await actorEmail();
    const body = await readBoundedJsonRequest(request);
    if (body && typeof body === 'object' && 'action' in body && body.action === 'close_unresolved_pricing') {
      const payload = 'payload' in body ? body.payload : null;
      if (!payload || typeof payload !== 'object' || !('idempotencyKey' in payload) || typeof payload.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.idempotencyKey) || !('pricingAction' in payload) || typeof payload.pricingAction !== 'string' || !['apply_price_book','apply_product_price_impact','set_standard_item_price','create_price_contract','approve_price_contract','reject_price_contract','create_pricing_policy'].includes(payload.pricingAction)) return failure('Invalid recovery reference', 400);
      return Response.json(await callOrderGateway(email, 'recover_order_submission', { idempotencyKey: payload.idempotencyKey, pricingAction: payload.pricingAction, closeUnresolved: true }), { headers: privateHeaders });
    }
    const command = validatePricingCommand(body);
    if (!command) return failure('Invalid pricing request', 400);
    return Response.json(await callOrderGateway<Record<string, unknown>>(email, command.action, command.payload), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return failure(error.message, error.status);
    if (error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Pricing service is temporarily unavailable', 502);
  }
}
