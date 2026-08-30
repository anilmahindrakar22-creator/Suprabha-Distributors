import { getChatGPTUser, hasStockFlowAccess } from '@/app/chatgpt-auth';

const stockEndpoint =
  'https://aormuidjbdqruglmyseh.supabase.co/functions/v1/stockflow-sync';

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
  if (!hasStockFlowAccess(user)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  const readKey = process.env.STOCKFLOW_READ_KEY;
  if (!readKey) {
    return Response.json(
      { error: 'Stock service is not configured' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(stockEndpoint, {
      cache: 'no-store',
      headers: { 'x-dashboard-key': readKey },
    });
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return Response.json(
      { error: 'Stock service is temporarily unavailable' },
      { status: 502 },
    );
  }
}
