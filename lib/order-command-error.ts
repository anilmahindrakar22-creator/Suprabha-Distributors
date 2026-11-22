export function orderCommandErrorMessage(status: number, serverMessage: string | undefined, fallback = 'Unable to complete the request'): string {
  if (status === 429) return 'Wait a moment and try again.';
  if (status === 409) return 'Someone else changed this order. Refresh and try again.';
  return serverMessage?.trim() || fallback;
}
