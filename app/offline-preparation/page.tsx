import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { hasAnyStockFlowRole } from '@/lib/user-types';
import { OfflineOrderPreparation } from '@/components/offline-order-preparation';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default async function OfflinePreparationPage() {
  const user = await getChatGPTUser();
  if (!user) redirect('/');
  const session = await getStockFlowSession(user.email);
  if (!session || !hasAnyStockFlowRole(session.roles, ['administrator', 'management', 'sales', 'operations'])) redirect('/');
  return <OfflineOrderPreparation actorEmail={session.email} />;
}
