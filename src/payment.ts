/**
 * Payment module — x402 per-tool payment gating
 *
 * Configures chain addresses and maps every Indigo MCP tool to a pricing tier.
 * Import this module before registering tools so configure() and setToolPrices()
 * are in effect when withX402 wrappers evaluate their first call.
 */

import { configure, setToolPrices } from '@qbtlabs/x402';

configure({
  evm: { address: process.env.X402_EVM_ADDRESS! },
  cardano: process.env.X402_CARDANO_ADDRESS
    ? { address: process.env.X402_CARDANO_ADDRESS }
    : undefined,
  facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
  testnet: process.env.X402_TESTNET === 'true',
});

setToolPrices({
  // ── Read-only tools: protocol state, prices, positions ──────────────────
  // Analytics
  get_tvl: 'read',
  get_apr_rewards: 'read',
  get_apr_by_key: 'read',
  get_dex_yields: 'read',
  get_protocol_stats: 'read',

  // Asset / price feeds
  get_assets: 'read',
  get_asset: 'read',
  get_asset_price: 'read',
  get_ada_price: 'read',
  get_indy_price: 'read',

  // CDP read
  get_all_cdps: 'read',
  get_cdps_by_owner: 'read',
  get_cdps_by_address: 'read',
  analyze_cdp_health: 'analysis',

  // Collector / IPFS read
  get_collector_utxos: 'read',
  retrieve_from_ipfs: 'read',

  // DEX
  get_steelswap_tokens: 'read',
  get_steelswap_estimate: 'read',
  get_iris_liquidity_pools: 'read',
  get_blockfrost_balances: 'read',

  // Governance
  get_protocol_params: 'read',
  get_temperature_checks: 'read',
  get_polls: 'read',

  // Redemption
  get_order_book: 'read',
  get_redemption_orders: 'read',
  get_redemption_queue: 'read',

  // Stability pool read
  get_stability_pools: 'read',
  get_stability_pool_accounts: 'read',
  get_sp_account_by_owner: 'read',

  // Staking read
  get_staking_info: 'read',
  get_staking_positions: 'read',
  get_staking_positions_by_owner: 'read',
  get_staking_position_by_address: 'read',

  // ── Write tools: transaction builders / on-chain mutations ──────────────
  // CDP write
  open_cdp: 'write',
  deposit_cdp: 'write',
  withdraw_cdp: 'write',
  close_cdp: 'write',
  mint_cdp: 'write',
  burn_cdp: 'write',
  leverage_cdp: 'write',

  // CDP liquidation
  liquidate_cdp: 'write',
  redeem_cdp: 'write',
  freeze_cdp: 'write',
  merge_cdps: 'write',

  // ROB write
  open_rob: 'write',
  cancel_rob: 'write',
  adjust_rob: 'write',
  claim_rob: 'write',
  redeem_rob: 'write',

  // Stability pool write
  process_sp_request: 'write',
  annul_sp_request: 'write',
  create_sp_account: 'write',
  adjust_sp_account: 'write',
  close_sp_account: 'write',

  // Staking write
  open_staking_position: 'write',
  adjust_staking_position: 'write',
  close_staking_position: 'write',
  distribute_staking_rewards: 'write',

  // IPFS write
  store_on_ipfs: 'write',
});
