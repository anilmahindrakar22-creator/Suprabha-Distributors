import { headers } from 'next/headers';
import { chatGPTSignInPath, normalizeEmail } from '@/lib/access-control.mjs';

export { chatGPTSignInPath };

export type ChatGPTUser = {
  userId: string;
  email: string;
  displayName: string;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = normalizeEmail(
    requestHeaders.get('oai-authenticated-user-email'),
  );

  if (!userId || !email) return null;

  return { userId, email, displayName: email.split('@')[0] };
}

