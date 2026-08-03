import { isValidIsraeliId } from './idChecksum';

describe('isValidIsraeliId', () => {
  it('accepts a known-valid Israeli ID number', () => {
    expect(isValidIsraeliId('123456782')).toBe(true);
  });

  it('rejects a same-length number that fails the check digit', () => {
    expect(isValidIsraeliId('123456789')).toBe(false);
  });

  it('pads shorter ids before checking, so a valid short id still passes', () => {
    expect(isValidIsraeliId('10009')).toBe(true);
  });

  it('rejects non-numeric or empty input', () => {
    expect(isValidIsraeliId('abcdefghi')).toBe(false);
    expect(isValidIsraeliId('')).toBe(false);
  });
});
