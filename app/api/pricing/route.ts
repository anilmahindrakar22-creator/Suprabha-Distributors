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
    const orderId = parameters.get('orderId');
    const pricingDate = parameters.get('pricingDate');
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
    const command = validatePricingCommand(await readBoundedJsonRequest(request));
    if (!command) return failure('Invalid pricing request', 400);
    return Response.json(await callOrderGateway<Record<string, unknown>>(email, command.action, command.payload), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return failure(error.message, error.status);
    if (error instanceof OrderGatewayError) return failure(error.message, error.status);
    return failure('Pricing service is temporarily unavailable', 502);
  }
}
