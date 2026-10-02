import { getChatGPTUser } from '@/app/chatgpt-auth';
import { createStockHandler } from '@/lib/stock-handler';
import { getStockFlowSession } from '@/lib/stockflow-session';

export const GET = createStockHandler({
  endpoint: () => process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL}/functions/v1/stockflow-sync`
    : undefined,
  fetchFn: fetch,
  getUser: getChatGPTUser,
  hasAccess: async (user) => Boolean(await getStockFlowSession(user.email)),
  readKey: () => process.env.STOCKFLOW_READ_KEY,
});
