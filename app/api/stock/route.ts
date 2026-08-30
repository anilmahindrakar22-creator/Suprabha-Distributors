import { getChatGPTUser, hasStockFlowAccess } from '@/app/chatgpt-auth';
import { createStockHandler } from '@/lib/stock-handler';

const stockEndpoint =
  'https://aormuidjbdqruglmyseh.supabase.co/functions/v1/stockflow-sync';

export const GET = createStockHandler({
  endpoint: stockEndpoint,
  fetchFn: fetch,
  getUser: getChatGPTUser,
  hasAccess: hasStockFlowAccess,
  readKey: () => process.env.STOCKFLOW_READ_KEY,
});
