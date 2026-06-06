/**
 * Short-code generation utility.
 *
 * Generates fixed-length numeric codes (supplier/compliance portal access codes, RFQ suffixes)
 * using a cryptographically strong RNG when available, falling back to Math.random() only in
 * environments without the Web Crypto API.
 */

/**
 * Generate a zero-padded numeric code of the given length (e.g. `generateNumericCode(6)` → "048213").
 */
export const generateNumericCode = (digits: number): string => {
  const max = 10 ** digits;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return (array[0] % max).toString().padStart(digits, '0');
  }
  return Math.floor(Math.random() * max).toString().padStart(digits, '0');
};
