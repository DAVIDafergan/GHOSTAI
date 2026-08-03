const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Table/column names come from the connector's own config file (trusted,
 * operator-provided), not from any HTTP request - but we still validate them
 * before interpolating into SQL as defense in depth against a malformed or
 * tampered config file.
 */
export function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe identifier in source config: "${name}"`);
  }
}
