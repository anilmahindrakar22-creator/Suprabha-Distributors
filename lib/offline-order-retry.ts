import {
  readOfflineOrderDraft,
  removeOfflineOrderDraft,
  updateOfflineDraftState,
} from './offline-order-drafts';
import { OrderSubmissionError, orderSubmissionError } from './order-submission';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type OfflineOrderRetryResult =
  | { status: 'none' }
  | { status: 'sent'; orderNumber: string }
  | { status: 'retry_later' }
  | { status: 'needs_attention'; message: string };

export async function retryPendingOfflineOrder(
  storage: DraftStorage,
  actorEmail: string,
  fetchFn: typeof fetch = fetch,
): Promise<OfflineOrderRetryResult> {
  const draft = readOfflineOrderDraft(storage, actorEmail);
  if (!draft || draft.state !== 'pending') return { status: 'none' };

  try {
    const response = await fetchFn('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft.command),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      orderNumber?: string;
    };
    if (!response.ok) throw orderSubmissionError(response.status, body.error);
    removeOfflineOrderDraft(storage, actorEmail);
    return { status: 'sent', orderNumber: body.orderNumber || 'Order' };
  } catch (cause) {
    const retryable =
      cause instanceof TypeError ||
      (cause instanceof OrderSubmissionError && cause.retryable);
    if (retryable) return { status: 'retry_later' };

    const message =
      cause instanceof Error ? cause.message : 'Check the order details and retry.';
    updateOfflineDraftState(storage, actorEmail, 'error', message);
    return { status: 'needs_attention', message };
  }
}
