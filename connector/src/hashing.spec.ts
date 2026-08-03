import { computeEntityHash, normalizeValue } from './hashing';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const backendHashing = require('../../backend/src/common/crypto/hashing.util');

describe('hashing', () => {
  it('normalizes case and whitespace the same way as the backend', () => {
    expect(normalizeValue('  Avner   Cohen  ')).toBe('avner cohen');
  });

  it('produces the same hash for values that normalize the same way', () => {
    const salt = 'shared-salt';
    expect(computeEntityHash('Avner Cohen', salt)).toBe(computeEntityHash('avner   cohen', salt));
  });

  it('produces byte-for-byte identical hashes to the backend copy of this logic', () => {
    const salt = 'cross-package-salt';
    expect(computeEntityHash('Some Customer Name', salt)).toBe(
      backendHashing.computeEntityHash('Some Customer Name', salt),
    );
    expect(normalizeValue('  Mixed   CASE value ')).toBe(backendHashing.normalizeValue('  Mixed   CASE value '));
  });
});
