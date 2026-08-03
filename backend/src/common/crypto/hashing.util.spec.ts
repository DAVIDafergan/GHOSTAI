import { computeEntityHash, hashSecret, normalizeValue } from './hashing.util';

describe('hashing.util', () => {
  it('normalizes case, surrounding whitespace, and internal whitespace runs', () => {
    expect(normalizeValue('  Avner   Cohen  ')).toBe('avner cohen');
  });

  it('produces the same entityHash for values that normalize the same way', () => {
    const salt = 'company-salt';
    expect(computeEntityHash('Avner Cohen', salt)).toBe(computeEntityHash('avner   cohen', salt));
  });

  it('produces different entityHash values for different company salts (no cross-tenant collision)', () => {
    expect(computeEntityHash('Avner Cohen', 'salt-a')).not.toBe(computeEntityHash('Avner Cohen', 'salt-b'));
  });

  it('hashSecret is deterministic so it can be used as a lookup key', () => {
    expect(hashSecret('some-secret')).toBe(hashSecret('some-secret'));
    expect(hashSecret('some-secret')).not.toBe(hashSecret('other-secret'));
  });
});
