import { describe, it, expect } from 'vitest';
import { extractPaymentCredential } from '../../../utils/address.js';

describe('extractPaymentCredential', () => {
  it('should pass through a 56-char hex string', () => {
    const hex = 'a'.repeat(56);
    expect(extractPaymentCredential(hex)).toBe(hex);
  });

  it('should pass through mixed-case 56-char hex', () => {
    const hex = 'aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF001122334455';
    expect(extractPaymentCredential(hex)).toBe(hex);
  });

  it('should throw on invalid input (not hex, not bech32)', () => {
    expect(() => extractPaymentCredential('not-valid')).toThrow(
      'Invalid address or payment key hash'
    );
  });

  it('should throw on empty string', () => {
    expect(() => extractPaymentCredential('')).toThrow('Invalid address or payment key hash');
  });

  it('should throw on hex string that is too short', () => {
    expect(() => extractPaymentCredential('abcdef')).toThrow('Invalid address or payment key hash');
  });

  it('should throw on hex string that is too long', () => {
    const hex = 'a'.repeat(58);
    expect(() => extractPaymentCredential(hex)).toThrow('Invalid address or payment key hash');
  });
});
