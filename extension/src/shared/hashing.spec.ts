import { computeEntityHash, normalizeValue } from './hashing';

describe('hashing', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeValue('  Avner   Cohen  ')).toBe('avner cohen');
  });

  it('produces the same hash for values that normalize the same way', async () => {
    const salt = 'shared-salt';
    expect(await computeEntityHash('Avner Cohen', salt)).toBe(await computeEntityHash('avner   cohen', salt));
  });

  it('produces different hashes for different salts', async () => {
    expect(await computeEntityHash('Avner Cohen', 'salt-a')).not.toBe(await computeEntityHash('Avner Cohen', 'salt-b'));
  });

  it('produces byte-for-byte identical output to the backend/connector copies of this algorithm', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHmac } = require('crypto');
    const salt = 'cross-impl-salt';
    const value = 'Some Customer';
    const nodeHash = createHmac('sha256', salt).update(normalizeValue(value)).digest('hex');
    expect(await computeEntityHash(value, salt)).toBe(nodeHash);
  });
});
