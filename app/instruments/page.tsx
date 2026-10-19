import { redirect } from 'next/navigation';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';

export const dynamic = 'force-dynamic';
export default async function InstrumentsPage() {
  const user = await getChatGPTUser();
  if (!user) redirect('/');
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'operations', 'sales'])) redirect('/');
  // Merged into Service (12 Oct 2026); the old link opens the workspace.
  redirect('/');
}
