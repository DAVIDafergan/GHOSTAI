import { createHmac } from 'crypto';

/**
 * MUST stay byte-for-byte identical to backend/src/common/crypto/hashing.util.ts
 * (normalizeValue + computeEntityHash) and to the extension's copy of the same
 * logic - otherwise the same real-world value hashes differently across
 * components and lookups silently stop matching.
 */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeEntityHash(value: string, companySalt: string): string {
  return createHmac('sha256', companySalt).update(normalizeValue(value)).digest('hex');
}
