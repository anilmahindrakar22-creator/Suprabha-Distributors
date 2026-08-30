import { headers } from 'next/headers';

export type ChatGPTUser = {
  userId: string;
  email: string;
  displayName: string;
};

const allowedEmails = new Set([
  'anil.mahindrakar22@gmail.com',
  'nikitesh.am@gmail.com',
]);

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = requestHeaders
    .get('oai-authenticated-user-email')
    ?.trim()
    .toLowerCase();

  if (!userId || !email) return null;

  return { userId, email, displayName: email.split('@')[0] };
}

export function hasStockFlowAccess(user: ChatGPTUser | null): boolean {
  return Boolean(user && allowedEmails.has(user.email));
}

export function chatGPTSignInPath(returnTo = '/'): string {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo)}`;
}
