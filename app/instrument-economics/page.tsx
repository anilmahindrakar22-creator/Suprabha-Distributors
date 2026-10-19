import { redirect } from 'next/navigation';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { InstrumentEconomicsWorkspace } from '@/components/instrument-economics-workspace';
export const dynamic = 'force-dynamic';
export default async function InstrumentEconomicsPage() {
  const user = await getChatGPTUser(); if (!user) redirect('/');
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'accounts'])) redirect('/');
  return <InstrumentEconomicsWorkspace />;
}
