import { getChatGPTUser } from '@/app/chatgpt-auth';
import { createStockHandler } from '@/lib/stock-handler';
import { getStockFlowSession } from '@/lib/stockflow-session';

const stockEndpoint =
  'https://aormuidjbdqruglmyseh.supabase.co/functions/v1/stockflow-sync';

export const GET = createStockHandler({
  endpoint: stockEndpoint,
  fetchFn: fetch,
  getUser: getChatGPTUser,
  hasAccess: async (user) => Boolean(await getStockFlowSession(user.email)),
  readKey: () => process.env.STOCKFLOW_READ_KEY,
});
