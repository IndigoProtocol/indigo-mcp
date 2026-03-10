import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('x402 Config', () => {
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

  describe('getToolPricing', () => {
    it('returns correct pricing for read tier tools', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('get_assets');
      expect(pricing.tier).toBe('read');
      expect(pricing.price).toBe(PRICING_TIERS.read);
    });

    it('returns correct pricing for CDP read tools', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('get_cdps_by_owner');
      expect(pricing.tier).toBe('read');
      expect(pricing.price).toBe(PRICING_TIERS.read);
    });

    it('returns correct pricing for staking read tools', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('get_staking_positions');
      expect(pricing.tier).toBe('read');
      expect(pricing.price).toBe(PRICING_TIERS.read);
    });

    it('returns correct pricing for analysis tier tools', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('get_tvl');
      expect(pricing.tier).toBe('analysis');
      expect(pricing.price).toBe(PRICING_TIERS.analysis);
    });

    it('returns correct pricing for CDP health analysis', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('analyze_cdp_health');
      expect(pricing.tier).toBe('analysis');
      expect(pricing.price).toBe(PRICING_TIERS.analysis);
    });

    it('returns correct pricing for write tier tools', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const pricing = getToolPricing('open_cdp');
      expect(pricing.tier).toBe('write');
      expect(pricing.price).toBe(PRICING_TIERS.write);
    });

    it('returns correct pricing for CDP write operations', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const cdpWriteTools = ['deposit_cdp', 'withdraw_cdp', 'close_cdp', 'mint_cdp', 'burn_cdp'];
      for (const tool of cdpWriteTools) {
        const pricing = getToolPricing(tool);
        expect(pricing.tier).toBe('write');
        expect(pricing.price).toBe(PRICING_TIERS.write);
      }
    });

    it('returns correct pricing for staking write operations', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const stakingWriteTools = ['open_staking_position', 'adjust_staking_position', 'close_staking_position'];
      for (const tool of stakingWriteTools) {
        const pricing = getToolPricing(tool);
        expect(pricing.tier).toBe('write');
        expect(pricing.price).toBe(PRICING_TIERS.write);
      }
    });

    it('returns correct pricing for stability pool operations', async () => {
      const { getToolPricing, PRICING_TIERS } = await import('../config.js');
      const spWriteTools = ['create_sp_account', 'adjust_sp_account', 'close_sp_account'];
      for (const tool of spWriteTools) {
        const pricing = getToolPricing(tool);
        expect(pricing.tier).toBe('write');
        expect(pricing.price).toBe(PRICING_TIERS.write);
      }
    });

    it('returns free tier for unknown tools', async () => {
      const { getToolPricing } = await import('../config.js');
      const pricing = getToolPricing('unknown_tool');
      expect(pricing.tier).toBe('free');
      expect(pricing.price).toBe(0);
    });
  });

  describe('isX402Enabled', () => {
    it('returns false when no addresses configured', async () => {
      const { isX402Enabled } = await import('../config.js');
      expect(isX402Enabled()).toBe(false);
    });

    it('returns true when EVM address configured', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { isX402Enabled } = await import('../config.js');
      expect(isX402Enabled()).toBe(true);
    });

    it('returns true when Solana address configured', async () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      const { isX402Enabled } = await import('../config.js');
      expect(isX402Enabled()).toBe(true);
    });
  });

  describe('getActiveNetworks', () => {
    it('returns Base mainnet when EVM address set', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { getActiveNetworks } = await import('../config.js');
      const networks = getActiveNetworks();
      expect(networks).toContain('eip155:8453');
    });

    it('returns Base Sepolia when testnet mode', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_TESTNET = 'true';
      const { getActiveNetworks } = await import('../config.js');
      const networks = getActiveNetworks();
      expect(networks).toContain('eip155:84532');
    });

    it('returns Solana mainnet when Solana address set', async () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      const { getActiveNetworks } = await import('../config.js');
      const networks = getActiveNetworks();
      expect(networks).toContain('solana:mainnet');
    });

    it('returns Solana devnet when testnet mode', async () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      process.env.X402_TESTNET = 'true';
      const { getActiveNetworks } = await import('../config.js');
      const networks = getActiveNetworks();
      expect(networks).toContain('solana:devnet');
    });
  });

  describe('buildPaymentRequirements', () => {
    it('builds correct payment requirements for $0.005 (read tier)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { buildPaymentRequirements, USDC_CONTRACTS } = await import('../config.js');
      const requirements = buildPaymentRequirements(0.005);
      expect(requirements.accepts).toHaveLength(1);
      expect(requirements.accepts[0].network).toBe('eip155:8453');
      expect(requirements.accepts[0].amount).toBe('5000'); // $0.005 * 1e6
      expect(requirements.accepts[0].asset).toBe(USDC_CONTRACTS['eip155:8453']);
    });

    it('builds correct payment requirements for $0.02 (analysis tier)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { buildPaymentRequirements } = await import('../config.js');
      const requirements = buildPaymentRequirements(0.02);
      expect(requirements.accepts[0].amount).toBe('20000'); // $0.02 * 1e6
    });

    it('builds correct payment requirements for $0.10 (write tier)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { buildPaymentRequirements } = await import('../config.js');
      const requirements = buildPaymentRequirements(0.10);
      expect(requirements.accepts[0].amount).toBe('100000'); // $0.10 * 1e6
    });

    it('includes both networks when both addresses set', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      const { buildPaymentRequirements } = await import('../config.js');
      const requirements = buildPaymentRequirements(0.005);
      expect(requirements.accepts).toHaveLength(2);
      expect(requirements.accepts.map(a => a.network)).toContain('eip155:8453');
      expect(requirements.accepts.map(a => a.network)).toContain('solana:mainnet');
    });

    it('correctly converts micro-units', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      const { buildPaymentRequirements } = await import('../config.js');
      const requirements = buildPaymentRequirements(0.005);
      expect(requirements.accepts[0].amount).toBe('5000');
    });
  });
});
