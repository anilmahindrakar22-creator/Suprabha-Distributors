import { StaffPasswordReset } from '@/components/staff-password-reset';
import { staffAuthEnabled } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';
export default function StaffPasswordResetPage() {
  return staffAuthEnabled() ? <StaffPasswordReset /> : <main>Staff recovery is not enabled on this site.</main>;
}
