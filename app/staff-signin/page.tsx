import { StaffSignIn, StaffSessionUnavailable } from '@/components/staff-sign-in';
import { publicChatGPTSignInUrl, staffAuthEnabled, StaffSessionUnavailableError } from '@/lib/staff-auth';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function StaffSignInPage() {
  if (!staffAuthEnabled()) return <main>Staff sign-in is not enabled on this site.</main>;
  let user;
  try { user = await getChatGPTUser(); }
  catch (error) {
    if (error instanceof StaffSessionUnavailableError) return <StaffSessionUnavailable />;
    throw error;
  }
  if (user) redirect('/');
  return <StaffSignIn resume chatGPTSignInUrl={publicChatGPTSignInUrl()} />;
}
