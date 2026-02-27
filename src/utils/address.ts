import { paymentCredentialOf } from '@lucid-evolution/lucid';

export function extractPaymentCredential(input: string): string {
  // If 56-char hex, return as-is (payment key hash)
  if (/^[0-9a-fA-F]{56}$/.test(input)) {
    return input;
  }
  // If bech32 address, extract payment credential hash
  if (input.startsWith('addr1') || input.startsWith('addr_test1')) {
    return paymentCredentialOf(input).hash;
  }
  throw new Error(`Invalid address or payment key hash: ${input}`);
}
