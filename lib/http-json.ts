// Shared reader for StockFlow JSON APIs. Staff never see parser errors such as
// "Unexpected token '<' ... is not valid JSON" when a sign-in page, proxy page or server error arrives instead of data.

export const unexpectedPageMessage = 'StockFlow returned an unexpected page. Check your connection, sign in again if asked, then retry.';

export function unreadableResponseMessage(status: number, ok: boolean) {
  return ok ? unexpectedPageMessage : `StockFlow could not complete the request (error ${status}). Please retry.`;
}

/** Parse a JSON body; throws a plain-language Error when the body is not JSON. Does not judge `response.ok`. */
export async function readJsonBody<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(unreadableResponseMessage(response.status, response.ok));
  }
}

/** Parse JSON and throw the server's `error` text (or the fallback) when the request failed. */
export async function readJsonResponse<T>(response: Response, fallback = 'Unable to complete the request'): Promise<T> {
  const body = await readJsonBody<T & { error?: string }>(response);
  if (!response.ok) throw new Error(typeof body?.error === 'string' && body.error ? body.error : fallback);
  return body;
}
