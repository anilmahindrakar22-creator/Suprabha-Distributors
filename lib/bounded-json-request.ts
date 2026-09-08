export class BoundedJsonRequestError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message);
  }
}

export async function readBoundedJsonRequest(request: Request, maximumBytes = 65_536): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new BoundedJsonRequestError('Requests must use JSON', 415);

  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new BoundedJsonRequestError('Invalid request length', 400);
    if (bytes > maximumBytes) throw new BoundedJsonRequestError('Request is too large', 413);
  }

  if (!request.body) throw new BoundedJsonRequestError('Invalid JSON', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new BoundedJsonRequestError('Request is too large', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new BoundedJsonRequestError('Invalid JSON', 400);
  }
}
