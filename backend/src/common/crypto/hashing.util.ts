import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Normalization must match exactly between backend, connector, and extension
 * so the same real-world value always hashes to the same entityHash.
 */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeEntityHash(value: string, companySalt: string): string {
  return createHmac('sha256', companySalt).update(normalizeValue(value)).digest('hex');
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

// apiKey/extensionKey are high-entropy random secrets, not low-entropy passwords,
// so a fast deterministic hash (rather than bcrypt) is safe here and allows
// indexed lookup by hash.
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
