import { StaffSignIn } from '@/components/staff-sign-in';
import { publicChatGPTSignInUrl, staffAuthEnabled } from '@/lib/staff-auth';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function StaffSignInPage() {
  if (!staffAuthEnabled()) return <main>Staff sign-in is not enabled on this site.</main>;
  if (await getChatGPTUser()) redirect('/');
  return <StaffSignIn chatGPTSignInUrl={publicChatGPTSignInUrl()} />;
}
