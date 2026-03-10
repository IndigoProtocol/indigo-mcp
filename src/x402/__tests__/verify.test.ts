import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PaymentPayload } from '../verify.js';

describe('x402 Verification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear and set env vars before importing
    delete process.env.X402_EVM_ADDRESS;
    delete process.env.X402_SOLANA_ADDRESS;
    delete process.env.X402_TESTNET;
    process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const createValidEvmPayload = (): PaymentPayload => ({
    x402Version: 2,
    payload: {
      authorization: {
        from: '0xaaaa',
        to: '0x1234567890123456789012345678901234567890',
        value: '5000', // $0.005 (read tier)
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: '0x' + '00'.repeat(32),
      },
      signature: '0x' + 'ab'.repeat(65),
    },
    accepted: {
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '5000',
    },
  });

  const createValidSolanaPayload = (): PaymentPayload => ({
    x402Version: 2,
    payload: {
      authorization: {
        from: 'SenderAddress',
        to: 'SoLAddressHere123456789012345678901234567890',
        value: '5000',
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: '0x' + '00'.repeat(32),
      },
      signature: 'base58signature',
    },
    accepted: {
      network: 'solana:mainnet',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '5000',
    },
  });

  describe('parsePaymentSignature', () => {
    it('parses valid base64-encoded payment', async () => {
      const { parsePaymentSignature } = await import('../verify.js');
      const validEvmPayload = createValidEvmPayload();
      const encoded = Buffer.from(JSON.stringify(validEvmPayload)).toString('base64');
      const parsed = parsePaymentSignature(encoded);
      expect(parsed).not.toBeNull();
      expect(parsed?.x402Version).toBe(2);
      expect(parsed?.accepted.network).toBe('eip155:8453');
    });

    it('returns null for invalid base64', async () => {
      const { parsePaymentSignature } = await import('../verify.js');
      const parsed = parsePaymentSignature('not-valid-base64!!!');
      expect(parsed).toBeNull();
    });

    it('returns null for non-JSON content', async () => {
      const { parsePaymentSignature } = await import('../verify.js');
      const encoded = Buffer.from('not json').toString('base64');
      const parsed = parsePaymentSignature(encoded);
      expect(parsed).toBeNull();
    });
  });

  describe('verifyEvmPayment', () => {
    it('accepts valid payment with sufficient amount for read tier', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const validEvmPayload = createValidEvmPayload();
      const result = await verifyEvmPayment(validEvmPayload, 0.005);
      expect(result.valid).toBe(true);
    });

    it('accepts valid payment with sufficient amount for write tier', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const writePayload = createValidEvmPayload();
      writePayload.payload.authorization.value = '100000';
      writePayload.accepted.amount = '100000';
      const result = await verifyEvmPayment(writePayload, 0.10);
      expect(result.valid).toBe(true);
    });

    it('rejects payment with insufficient amount', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const validEvmPayload = createValidEvmPayload();
      const result = await verifyEvmPayment(validEvmPayload, 0.01); // Expecting $0.01 but got $0.005
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('rejects payment to wrong recipient', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const wrongRecipient = createValidEvmPayload();
      wrongRecipient.payload.authorization.to = '0xwrongaddress';
      const result = await verifyEvmPayment(wrongRecipient, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('recipient');
    });

    it('rejects expired payment', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const expired = createValidEvmPayload();
      expired.payload.authorization.validBefore = String(Math.floor(Date.now() / 1000) - 3600);
      const result = await verifyEvmPayment(expired, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('rejects payment not yet valid', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const future = createValidEvmPayload();
      future.payload.authorization.validAfter = String(Math.floor(Date.now() / 1000) + 3600);
      const result = await verifyEvmPayment(future, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not yet valid');
    });

    it('rejects non-EVM network', async () => {
      const { verifyEvmPayment } = await import('../verify.js');
      const wrongNetwork = createValidEvmPayload();
      wrongNetwork.accepted.network = 'solana:mainnet';
      const result = await verifyEvmPayment(wrongNetwork, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('EVM');
    });
  });

  describe('verifySolanaPayment', () => {
    it('accepts valid Solana payment', async () => {
      const { verifySolanaPayment } = await import('../verify.js');
      const validSolanaPayload = createValidSolanaPayload();
      const result = await verifySolanaPayment(validSolanaPayload, 0.005);
      expect(result.valid).toBe(true);
    });

    it('rejects insufficient amount', async () => {
      const { verifySolanaPayment } = await import('../verify.js');
      const validSolanaPayload = createValidSolanaPayload();
      const result = await verifySolanaPayment(validSolanaPayload, 0.02);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('rejects non-Solana network', async () => {
      const { verifySolanaPayment } = await import('../verify.js');
      const wrongNetwork = createValidSolanaPayload();
      wrongNetwork.accepted.network = 'eip155:8453';
      const result = await verifySolanaPayment(wrongNetwork, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Solana');
    });
  });

  describe('verifyPayment', () => {
    it('routes EVM payments correctly', async () => {
      const { verifyPayment } = await import('../verify.js');
      const validEvmPayload = createValidEvmPayload();
      const encoded = Buffer.from(JSON.stringify(validEvmPayload)).toString('base64');
      const result = await verifyPayment(encoded, 0.005);
      expect(result.valid).toBe(true);
    });

    it('routes Solana payments correctly', async () => {
      const { verifyPayment } = await import('../verify.js');
      const validSolanaPayload = createValidSolanaPayload();
      const encoded = Buffer.from(JSON.stringify(validSolanaPayload)).toString('base64');
      const result = await verifyPayment(encoded, 0.005);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid signature format', async () => {
      const { verifyPayment } = await import('../verify.js');
      const result = await verifyPayment('invalid', 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });

    it('rejects unsupported networks', async () => {
      const { verifyPayment } = await import('../verify.js');
      const unsupported = createValidEvmPayload();
      unsupported.accepted.network = 'bitcoin:mainnet';
      const encoded = Buffer.from(JSON.stringify(unsupported)).toString('base64');
      const result = await verifyPayment(encoded, 0.005);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported');
    });
  });
});
