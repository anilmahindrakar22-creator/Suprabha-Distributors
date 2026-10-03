import { StaffSignIn } from '@/components/staff-sign-in';
import { staffAuthEnabled } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';
export default function StaffSignInPage() {
  return staffAuthEnabled() ? <StaffSignIn /> : <main>Staff sign-in is not enabled on this site.</main>;
}
