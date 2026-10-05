import { cookies, headers } from 'next/headers';
import { sameStaffOrigin, STAFF_COOKIE, staffAuthEnabled, verifiedStaff } from '@/lib/staff-auth';
import { chatGPTSignInPath, normalizeEmail } from '@/lib/access-control.mjs';

export { chatGPTSignInPath };

export type ChatGPTUser = {
  userId: string;
  email: string;
  displayName: string;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  if (staffAuthEnabled()) {
    // Direct Workers must never trust client-supplied Sites identity headers.
    const origin = requestHeaders.get('origin');
    if (origin && !sameStaffOrigin(origin)) return null;
    return verifiedStaff((await cookies()).get(STAFF_COOKIE)?.value);
  }
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = normalizeEmail(
    requestHeaders.get('oai-authenticated-user-email'),
  );

  if (!userId || !email) return null;

  return { userId, email, displayName: email.split('@')[0] };
}
