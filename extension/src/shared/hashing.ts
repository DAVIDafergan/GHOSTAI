/**
 * MUST stay byte-for-byte identical to backend/src/common/crypto/hashing.util.ts
 * and connector/src/hashing.ts. Web Crypto (not Node's `crypto`) is used here
 * since content scripts run in the browser, not Node.
 */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeEntityHash(value: string, companySalt: string): Promise<string> {
  return hmacSha256Hex(companySalt, normalizeValue(value));
}
