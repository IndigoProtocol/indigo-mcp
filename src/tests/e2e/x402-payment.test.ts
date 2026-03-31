/**
 * x402 Payment Middleware — End-to-End Tests
 *
 * Verifies the full payment-gating flow:
 *   1. Tool called without payment → 402 response with accepts[] array
 *   2. Tool called with malformed payment → 402 verification error
 *   3. Tool called when x402 is disabled (no address) → passes through
 *
 * To run:
 *   X402_EVM_ADDRESS=0x... X402_TESTNET=true npm test -- --reporter=verbose x402-payment
 *
 * Skip behaviour: tests that require an EVM address are skipped automatically
 * when X402_EVM_ADDRESS is not set in the environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configure,
  withX402,
  setToolPrices,
  resetConfig,
  isEnabled,
  buildPaymentRequirements,
} from '@qbtlabs/x402';

// ─── Helpers ────────────────────────────────────────────────────────────────

const DUMMY_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

/** Tool handler that always succeeds — stands in for the real implementation. */
const successHandler = vi.fn(async (_params: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: 'ok' }],
}));

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// ─── Suite: x402 disabled (no address configured) ───────────────────────────
// getConfig() falls back to process.env vars even after resetConfig(), so we
// must stub them out for tests that assert the "no chain configured" branch.

describe('withX402 — disabled (no chain address configured)', () => {
  beforeEach(() => {
    resetConfig();
    vi.stubEnv('X402_EVM_ADDRESS', '');
    vi.stubEnv('X402_SOLANA_ADDRESS', '');
    vi.stubEnv('X402_CARDANO_ADDRESS', '');
    successHandler.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes through to handler when x402 is not configured', async () => {
    expect(isEnabled()).toBe(false);

    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({});

    expect(successHandler).toHaveBeenCalledOnce();
    expect(result.content[0].text).toBe('ok');
  });

  it('passes through even when paymentSignature is absent', async () => {
    const wrapped = withX402('open_cdp', successHandler);
    const result = await wrapped({ collateral: '100' });

    expect(successHandler).toHaveBeenCalledOnce();
    expect(result.content[0].text).toBe('ok');
  });
});

// ─── Suite: x402 enabled — no payment provided ──────────────────────────────

describe('withX402 — 402 when payment missing', () => {
  const hasAddress = !!process.env.X402_EVM_ADDRESS;
  const address = process.env.X402_EVM_ADDRESS ?? DUMMY_EVM_ADDRESS;

  beforeEach(() => {
    configure({ evm: { address }, testnet: true });
    setToolPrices({ get_tvl: 'read', open_cdp: 'write' });
    successHandler.mockClear();
  });

  afterEach(() => {
    resetConfig();
  });

  it('returns 402 JSON when no paymentSignature in params', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({});

    expect(successHandler).not.toHaveBeenCalled();
    expect(result.content).toHaveLength(1);

    const body = JSON.parse(result.content[0].text);
    expect(body.code).toBe(402);
    expect(body.error).toBe('Payment Required');
    expect(body.tool).toBe('get_tvl');
  });

  it('includes price and priceFormatted in 402 response', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({});
    const body = JSON.parse(result.content[0].text);

    expect(typeof body.price).toBe('number');
    expect(body.price).toBeGreaterThan(0);
    expect(body.priceFormatted).toMatch(/^\$\d+\.\d+$/);
  });

  it('includes accepts[] array in 402 response', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({});
    const body = JSON.parse(result.content[0].text);

    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBeGreaterThan(0);

    const first = body.accepts[0];
    expect(first).toHaveProperty('network');
    expect(first).toHaveProperty('asset');
    expect(first).toHaveProperty('maxAmountRequired');
    expect(first).toHaveProperty('payTo', address);
  });

  it('uses testnet chain when X402_TESTNET=true', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({});
    const body = JSON.parse(result.content[0].text);

    // Base Sepolia chain ID is 84532
    const evmAccept = body.accepts.find((a: { network: string }) =>
      a.network.startsWith('eip155:')
    );
    expect(evmAccept).toBeDefined();
    expect(evmAccept.network).toBe('eip155:84532');
  });

  it('returns 402 for write tools (higher price tier)', async () => {
    const wrapped = withX402('open_cdp', successHandler);
    const result = await wrapped({});
    const body = JSON.parse(result.content[0].text);

    expect(body.code).toBe(402);
    expect(body.tool).toBe('open_cdp');
    // write tier ($0.01) > read tier ($0.001)
    expect(body.price).toBeGreaterThan(0.001);
  });

  it.skipIf(!hasAddress)(
    'real env: accepts[] payTo matches X402_EVM_ADDRESS',
    async () => {
      const wrapped = withX402('get_tvl', successHandler);
      const result = await wrapped({});
      const body = JSON.parse(result.content[0].text);

      const evmAccept = body.accepts.find((a: { network: string }) =>
        a.network.startsWith('eip155:')
      );
      expect(evmAccept.payTo).toBe(process.env.X402_EVM_ADDRESS);
    }
  );
});

// ─── Suite: x402 enabled — malformed payment ────────────────────────────────

describe('withX402 — payment verification errors', () => {
  const address = process.env.X402_EVM_ADDRESS ?? DUMMY_EVM_ADDRESS;

  beforeEach(() => {
    configure({ evm: { address }, testnet: true });
    setToolPrices({ get_tvl: 'read' });
    successHandler.mockClear();
  });

  afterEach(() => {
    resetConfig();
  });

  it('returns payment error for non-base64 signature', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({ paymentSignature: '!!!not-base64!!!' });

    const body = JSON.parse(result.content[0].text);
    expect(body.code).toBe(402);
    expect(body.error).toBe('Payment Verification Failed');
    expect(body.reason).toBe('Invalid payment signature format');
  });

  it('returns payment error for valid base64 but invalid JSON payload', async () => {
    const wrapped = withX402('get_tvl', successHandler);
    const badB64 = Buffer.from('not json at all').toString('base64');
    const result = await wrapped({ paymentSignature: badB64 });

    const body = JSON.parse(result.content[0].text);
    expect(body.code).toBe(402);
    expect(body.error).toBe('Payment Verification Failed');
  });

  it('returns payment error for structurally valid but unverifiable payment', async () => {
    // Build a well-structured payload that will fail chain verification
    const fakePayload = b64({
      accepted: {
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        maxAmountRequired: '1000',
        payTo: address,
      },
      payload: {
        signature: '0xdeadbeef',
        amount: '1000',
        nonce: '0x01',
      },
    });

    const wrapped = withX402('get_tvl', successHandler);
    const result = await wrapped({ paymentSignature: fakePayload });

    const body = JSON.parse(result.content[0].text);
    // Should fail verification (invalid signature), not return 200
    expect(body.code).toBe(402);
    expect(successHandler).not.toHaveBeenCalled();
  });
});

// ─── Suite: buildPaymentRequirements output shape ────────────────────────────

describe('buildPaymentRequirements — output shape', () => {
  afterEach(() => {
    resetConfig();
  });

  it('returns empty accepts[] when no chain configured', () => {
    resetConfig();
    vi.stubEnv('X402_EVM_ADDRESS', '');
    vi.stubEnv('X402_SOLANA_ADDRESS', '');
    vi.stubEnv('X402_CARDANO_ADDRESS', '');
    const reqs = buildPaymentRequirements(0.001);
    vi.unstubAllEnvs();
    expect(reqs.accepts).toEqual([]);
  });

  it('returns EVM accept entry with correct USDC contract (Base Sepolia)', () => {
    configure({ evm: { address: DUMMY_EVM_ADDRESS }, testnet: true });
    const reqs = buildPaymentRequirements(0.001);

    expect(reqs.accepts).toHaveLength(1);
    expect(reqs.accepts[0].network).toBe('eip155:84532');
    expect(reqs.accepts[0].asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(reqs.accepts[0].payTo).toBe(DUMMY_EVM_ADDRESS);
    // $0.001 = 1000 micro-USDC
    expect(reqs.accepts[0].maxAmountRequired).toBe('1000');
  });

  it('returns EVM accept entry with correct USDC contract (Base mainnet)', () => {
    configure({ evm: { address: DUMMY_EVM_ADDRESS }, testnet: false });
    const reqs = buildPaymentRequirements(0.001);

    expect(reqs.accepts[0].network).toBe('eip155:8453');
    expect(reqs.accepts[0].asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });
});
