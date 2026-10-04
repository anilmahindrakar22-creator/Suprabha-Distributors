import { StaffSignIn } from '@/components/staff-sign-in';
import { publicChatGPTSignInUrl, staffAuthEnabled } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';
export default function StaffSignInPage() {
  return staffAuthEnabled() ? <StaffSignIn chatGPTSignInUrl={publicChatGPTSignInUrl()} /> : <main>Staff sign-in is not enabled on this site.</main>;
}
