import {
  readOfflineOrderDraft,
  removeOfflineOrderDraft,
  updateOfflineDraftState,
} from './offline-order-drafts';
import { confirmedOrderNumber, OrderSubmissionError, orderSubmissionError, orderSubmissionTimeoutMs, recoverAcceptedOrder, retryableOrderSubmissionFailure } from './order-submission';

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
      signal: AbortSignal.timeout(orderSubmissionTimeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      orderNumber?: string;
    };
    if (!response.ok) throw orderSubmissionError(response.status, body?.error);
    const orderNumber = confirmedOrderNumber(body);
    if (!orderNumber) throw new OrderSubmissionError('Order acknowledgement is incomplete. Retry the saved submission.', 'retryable');
    removeOfflineOrderDraft(storage, actorEmail);
    return { status: 'sent', orderNumber };
  } catch (cause) {
    if (cause instanceof OrderSubmissionError && cause.kind === 'conflict') {
      const accepted = await recoverAcceptedOrder(draft.command.payload.idempotencyKey, fetchFn);
      if (accepted) {
        removeOfflineOrderDraft(storage, actorEmail);
        return { status: 'sent', orderNumber: accepted };
      }
    }
    if (retryableOrderSubmissionFailure(cause)) return { status: 'retry_later' };

    const message =
      cause instanceof Error ? cause.message : 'Check the order details and retry.';
    updateOfflineDraftState(storage, actorEmail, 'error', message);
    return { status: 'needs_attention', message };
  }
}
