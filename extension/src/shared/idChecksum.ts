/**
 * Israeli teudat zehut (ID number) check-digit validation (standard mod-10
 * weighted algorithm: alternating weights 1/2, digits of the doubled value
 * summed, total must be divisible by 10).
 */
export function isValidIsraeliId(raw: string): boolean {
  const digits = raw.trim();
  if (!/^\d{5,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, '0');

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const weight = (i % 2) + 1;
    const product = Number(padded[i]) * weight;
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}
