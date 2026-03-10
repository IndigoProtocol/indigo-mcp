import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('x402 Middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear all x402 env vars before each test
    delete process.env.X402_EVM_ADDRESS;
    delete process.env.X402_SOLANA_ADDRESS;
    delete process.env.X402_TESTNET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const createMockHandler = () => {
    const calls: unknown[] = [];
    const handler = async (params: unknown) => {
      calls.push(params);
      return { content: [{ type: 'text', text: '{"result": "success"}' }] };
    };
    return { handler, calls };
  };

  describe('withX402', () => {
    it('passes through when x402 is disabled', async () => {
      const { withX402 } = await import('../middleware.js');
      const { handler, calls } = createMockHandler();
      const wrapped = withX402('get_assets', handler);
      const result = await wrapped({});

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('passes through for free tier tools', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const { handler, calls } = createMockHandler();
      const wrapped = withX402('unknown_free_tool', handler);
      const result = await wrapped({});

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('returns 402 when no payment provided for read tier tool (get_assets)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_assets', handler);
      const result = await wrapped({});

      const response = JSON.parse(result.content[0].text);
      expect(response.code).toBe(402);
      expect(response.error).toBe('Payment Required');
      expect(response.tool).toBe('get_assets');
      expect(response.price).toBe(0.005);
      expect(response.accepts).toBeDefined();
      expect(response.accepts.length).toBeGreaterThan(0);
    });

    it('returns 402 when no payment provided for CDP tool (get_cdps_by_owner)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_cdps_by_owner', handler);
      const result = await wrapped({ owner: 'addr1...' });

      const response = JSON.parse(result.content[0].text);
      expect(response.code).toBe(402);
      expect(response.tool).toBe('get_cdps_by_owner');
      expect(response.price).toBe(0.005);
    });

    it('returns 402 with analysis tier pricing for TVL tool', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_tvl', handler);
      const result = await wrapped({});

      const response = JSON.parse(result.content[0].text);
      expect(response.code).toBe(402);
      expect(response.tool).toBe('get_tvl');
      expect(response.price).toBe(0.02);
    });

    it('returns 402 with write tier pricing for open_cdp', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const { handler } = createMockHandler();
      const wrapped = withX402('open_cdp', handler);
      const result = await wrapped({});

      const response = JSON.parse(result.content[0].text);
      expect(response.code).toBe(402);
      expect(response.tool).toBe('open_cdp');
      expect(response.price).toBe(0.10);
    });

    it('includes correct payment requirements in 402 response', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_SOLANA_ADDRESS = 'SolanaAddress123';
      const { withX402 } = await import('../middleware.js');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_assets', handler);
      const result = await wrapped({});

      const response = JSON.parse(result.content[0].text);
      expect(response.accepts).toHaveLength(2);
      expect(response.accepts[0].network).toBe('eip155:8453');
      expect(response.accepts[1].network).toBe('solana:mainnet');
    });

    it('executes handler when valid payment provided', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const validPayment = {
        x402Version: 2,
        payload: {
          authorization: {
            from: '0xaaaa',
            to: '0x1234567890123456789012345678901234567890',
            value: '5000', // $0.005 for read tier
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
      };
      const paymentSignature = Buffer.from(JSON.stringify(validPayment)).toString('base64');

      const { handler, calls } = createMockHandler();
      const wrapped = withX402('get_assets', handler);
      const result = await wrapped({
        _meta: { paymentSignature },
      });

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('returns error for invalid payment', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { withX402 } = await import('../middleware.js');

      const invalidPayment = {
        x402Version: 2,
        payload: {
          authorization: {
            from: '0xaaaa',
            to: '0xwrongaddress', // Wrong recipient
            value: '5000',
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
      };
      const paymentSignature = Buffer.from(JSON.stringify(invalidPayment)).toString('base64');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_assets', handler);
      const result = await wrapped({
        _meta: { paymentSignature },
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('Payment Verification Failed');
      expect(response.reason).toContain('recipient');
    });
  });

  describe('getAllToolPricing', () => {
    it('returns pricing for Indigo tools', async () => {
      const { getAllToolPricing } = await import('../middleware.js');
      const pricing = getAllToolPricing();

      // Read tier tools
      expect(pricing.get_assets).toBeDefined();
      expect(pricing.get_assets.tier).toBe('read');
      expect(pricing.get_assets.priceFormatted).toBe('$0.0050');

      expect(pricing.get_cdps_by_owner).toBeDefined();
      expect(pricing.get_cdps_by_owner.tier).toBe('read');

      // Analysis tier tools
      expect(pricing.get_tvl).toBeDefined();
      expect(pricing.get_tvl.tier).toBe('analysis');
      expect(pricing.get_tvl.priceFormatted).toBe('$0.0200');

      // Write tier tools
      expect(pricing.open_cdp).toBeDefined();
      expect(pricing.open_cdp.tier).toBe('write');
      expect(pricing.open_cdp.priceFormatted).toBe('$0.1000');

      expect(pricing.open_staking_position).toBeDefined();
      expect(pricing.open_staking_position.tier).toBe('write');
    });
  });

  describe('getPricingSummary', () => {
    it('returns correct tier counts', async () => {
      const { getPricingSummary } = await import('../middleware.js');
      const summary = getPricingSummary();

      expect(summary.read.count).toBeGreaterThan(0);
      expect(summary.read.price).toBe('$0.0050');

      expect(summary.analysis.count).toBeGreaterThan(0);
      expect(summary.analysis.price).toBe('$0.0200');

      expect(summary.write.count).toBeGreaterThan(0);
      expect(summary.write.price).toBe('$0.1000');
    });
  });
});
