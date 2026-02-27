import { bech32 } from 'bech32';

export function extractPaymentCredential(input: string): string {
  // If 56-char hex, return as-is (payment key hash)
  if (/^[0-9a-fA-F]{56}$/.test(input)) {
    return input;
  }
  // If bech32 address, decode and extract payment credential hash (bytes 1-29)
  if (input.startsWith('addr1') || input.startsWith('addr_test1')) {
    const { words } = bech32.decode(input, 200);
    const bytes = bech32.fromWords(words);
    const pkhBytes = bytes.slice(1, 29);
    return Buffer.from(pkhBytes).toString('hex');
  }
  throw new Error(`Invalid address or payment key hash: ${input}`);
}
