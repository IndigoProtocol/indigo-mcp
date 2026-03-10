/**
 * x402 Payment Configuration for Indigo MCP
 *
 * Defines pricing tiers and payment addresses for Indigo Protocol tools.
 * Following Coinbase x402 format for Base (EVM) and Solana payments.
 *
 * Pricing tiers:
 * - Read: $0.005 (basic data retrieval)
 * - Analysis: $0.02 (computed analytics, health checks)
 * - Write: $0.10 (transaction building, state changes)
 */

// Payment receiver addresses
export const PAYMENT_ADDRESSES = {
  evm: process.env.X402_EVM_ADDRESS || '',
  solana: process.env.X402_SOLANA_ADDRESS || '',
};

// USDC contract addresses
export const USDC_CONTRACTS = {
  // Base Mainnet
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Base Sepolia (testnet)
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // Solana Mainnet
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // Solana Devnet
  'solana:devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

// Tool pricing in USD
export type PricingTier = 'free' | 'read' | 'analysis' | 'write';

export interface ToolPricing {
  tier: PricingTier;
  price: number; // USD
}

export const PRICING_TIERS: Record<PricingTier, number> = {
  free: 0,
  read: 0.005, // $0.005 per call
  analysis: 0.02, // $0.02 per call
  write: 0.10, // $0.10 per call
};

// Tool-specific pricing for Indigo Protocol
export const TOOL_PRICING: Record<string, ToolPricing> = {
  // ============================================
  // READ TOOLS ($0.005) - Basic data retrieval
  // ============================================

  // Asset Tools
  get_assets: { tier: 'read', price: PRICING_TIERS.read },
  get_asset: { tier: 'read', price: PRICING_TIERS.read },
  get_asset_price: { tier: 'read', price: PRICING_TIERS.read },
  get_ada_price: { tier: 'read', price: PRICING_TIERS.read },
  get_indy_price: { tier: 'read', price: PRICING_TIERS.read },

  // CDP Tools - Read
  get_all_cdps: { tier: 'read', price: PRICING_TIERS.read },
  get_cdps_by_owner: { tier: 'read', price: PRICING_TIERS.read },
  get_cdps_by_address: { tier: 'read', price: PRICING_TIERS.read },

  // Staking Tools - Read
  get_staking_positions: { tier: 'read', price: PRICING_TIERS.read },
  get_staking_positions_by_owner: { tier: 'read', price: PRICING_TIERS.read },
  get_staking_position_by_address: { tier: 'read', price: PRICING_TIERS.read },
  get_staking_info: { tier: 'read', price: PRICING_TIERS.read },

  // Stability Pool Tools - Read
  get_stability_pools: { tier: 'read', price: PRICING_TIERS.read },
  get_stability_pool_accounts: { tier: 'read', price: PRICING_TIERS.read },
  get_sp_account_by_owner: { tier: 'read', price: PRICING_TIERS.read },

  // DEX Tools - Read
  get_steelswap_tokens: { tier: 'read', price: PRICING_TIERS.read },
  get_steelswap_estimate: { tier: 'read', price: PRICING_TIERS.read },
  get_iris_liquidity_pools: { tier: 'read', price: PRICING_TIERS.read },
  get_order_book: { tier: 'read', price: PRICING_TIERS.read },

  // Governance Tools - Read
  get_protocol_params: { tier: 'read', price: PRICING_TIERS.read },
  get_temperature_checks: { tier: 'read', price: PRICING_TIERS.read },
  get_polls: { tier: 'read', price: PRICING_TIERS.read },
  get_sync_status: { tier: 'read', price: PRICING_TIERS.read },

  // Collector/Redemption Tools - Read
  get_collector_utxos: { tier: 'read', price: PRICING_TIERS.read },
  get_redemption_orders: { tier: 'read', price: PRICING_TIERS.read },
  get_redemption_queue: { tier: 'read', price: PRICING_TIERS.read },

  // Utility Tools - Read
  get_blockfrost_balances: { tier: 'read', price: PRICING_TIERS.read },
  retrieve_from_ipfs: { tier: 'read', price: PRICING_TIERS.read },

  // ============================================
  // ANALYSIS TOOLS ($0.02) - Computed analytics
  // ============================================

  // Analytics Tools
  get_tvl: { tier: 'analysis', price: PRICING_TIERS.analysis },
  get_apr_rewards: { tier: 'analysis', price: PRICING_TIERS.analysis },
  get_apr_by_key: { tier: 'analysis', price: PRICING_TIERS.analysis },
  get_dex_yields: { tier: 'analysis', price: PRICING_TIERS.analysis },
  get_protocol_stats: { tier: 'analysis', price: PRICING_TIERS.analysis },

  // CDP Analysis
  analyze_cdp_health: { tier: 'analysis', price: PRICING_TIERS.analysis },

  // ============================================
  // WRITE TOOLS ($0.10) - Transaction building
  // ============================================

  // CDP Write Tools
  open_cdp: { tier: 'write', price: PRICING_TIERS.write },
  deposit_cdp: { tier: 'write', price: PRICING_TIERS.write },
  withdraw_cdp: { tier: 'write', price: PRICING_TIERS.write },
  close_cdp: { tier: 'write', price: PRICING_TIERS.write },
  mint_cdp: { tier: 'write', price: PRICING_TIERS.write },
  burn_cdp: { tier: 'write', price: PRICING_TIERS.write },
  merge_cdps: { tier: 'write', price: PRICING_TIERS.write },
  freeze_cdp: { tier: 'write', price: PRICING_TIERS.write },
  liquidate_cdp: { tier: 'write', price: PRICING_TIERS.write },
  redeem_cdp: { tier: 'write', price: PRICING_TIERS.write },

  // Leverage Tools
  leverage_cdp: { tier: 'write', price: PRICING_TIERS.write },

  // Staking Write Tools
  open_staking_position: { tier: 'write', price: PRICING_TIERS.write },
  adjust_staking_position: { tier: 'write', price: PRICING_TIERS.write },
  close_staking_position: { tier: 'write', price: PRICING_TIERS.write },
  distribute_staking_rewards: { tier: 'write', price: PRICING_TIERS.write },

  // Stability Pool Write Tools
  create_sp_account: { tier: 'write', price: PRICING_TIERS.write },
  adjust_sp_account: { tier: 'write', price: PRICING_TIERS.write },
  close_sp_account: { tier: 'write', price: PRICING_TIERS.write },
  process_sp_request: { tier: 'write', price: PRICING_TIERS.write },
  annul_sp_request: { tier: 'write', price: PRICING_TIERS.write },

  // LRP (Liquidity Redemption) Write Tools
  open_lrp: { tier: 'write', price: PRICING_TIERS.write },
  adjust_lrp: { tier: 'write', price: PRICING_TIERS.write },
  cancel_lrp: { tier: 'write', price: PRICING_TIERS.write },
  claim_lrp: { tier: 'write', price: PRICING_TIERS.write },
  redeem_lrp: { tier: 'write', price: PRICING_TIERS.write },

  // Oracle Write Tools
  feed_interest_oracle: { tier: 'write', price: PRICING_TIERS.write },
  start_interest_oracle: { tier: 'write', price: PRICING_TIERS.write },

  // IPFS Write Tools
  store_on_ipfs: { tier: 'write', price: PRICING_TIERS.write },
};

/**
 * Get pricing for a tool
 */
export function getToolPricing(toolName: string): ToolPricing {
  return TOOL_PRICING[toolName] || { tier: 'free', price: 0 };
}

/**
 * Check if x402 is enabled (payment addresses configured)
 */
export function isX402Enabled(): boolean {
  return !!(PAYMENT_ADDRESSES.evm || PAYMENT_ADDRESSES.solana);
}

/**
 * Get active networks based on configured addresses
 */
export function getActiveNetworks(): string[] {
  const networks: string[] = [];

  if (PAYMENT_ADDRESSES.evm) {
    const isTestnet = process.env.X402_TESTNET === 'true';
    networks.push(isTestnet ? 'eip155:84532' : 'eip155:8453');
  }

  if (PAYMENT_ADDRESSES.solana) {
    const isTestnet = process.env.X402_TESTNET === 'true';
    networks.push(isTestnet ? 'solana:devnet' : 'solana:mainnet');
  }

  return networks;
}

/**
 * Build payment requirements for 402 response
 */
export function buildPaymentRequirements(priceUsd: number): {
  accepts: Array<{
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
} {
  const accepts: Array<{
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }> = [];

  const networks = getActiveNetworks();
  const amountMicroUnits = Math.ceil(priceUsd * 1_000_000).toString();

  for (const network of networks) {
    const asset = USDC_CONTRACTS[network as keyof typeof USDC_CONTRACTS];
    const payTo = network.startsWith('eip155')
      ? PAYMENT_ADDRESSES.evm
      : PAYMENT_ADDRESSES.solana;

    if (asset && payTo) {
      accepts.push({
        network,
        asset,
        amount: amountMicroUnits,
        payTo,
      });
    }
  }

  return { accepts };
}
