/** Device protection only: unlocking never grants server authorization. */
export type OfflineVaultEnvelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};
const iterations = 600_000;
const context = new TextEncoder().encode('stockflow-offline-v1');
function encode(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
async function derive(pin: string, salt: Uint8Array) {
  if (!/^\d{6,64}$/.test(pin)) throw new Error('Use a PIN containing 6 to 64 digits.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
export async function sealOfflineVault(value: unknown, pin: string): Promise<OfflineVaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(pin, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: context }, key, new TextEncoder().encode(JSON.stringify(value)),
  );
  return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function openOfflineVault(envelope: OfflineVaultEnvelope, pin: string): Promise<unknown> {
  try {
    if (envelope.version !== 1) throw new Error('Unsupported vault');
    const salt = decode(envelope.salt);
    const iv = decode(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid vault');
    const key = await derive(pin, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: context }, key, decode(envelope.ciphertext) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    // Do not distinguish wrong PIN from damaged data or leak decrypted content.
    throw new Error('Unable to unlock saved offline data. Check your PIN.');
  }
}
