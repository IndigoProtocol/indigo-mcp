/**
 * x402 Payment Module for Indigo MCP
 *
 * Implements HTTP 402 payment protocol for pay-per-use API access.
 * Supports Base (EVM) and Solana networks with USDC payments.
 *
 * Pricing Tiers for Indigo Protocol:
 * - Read ($0.005): Basic data retrieval (assets, CDPs, staking positions)
 * - Analysis ($0.02): Computed analytics (TVL, APR, CDP health)
 * - Write ($0.10): Transaction building (open CDP, stake, leverage)
 *
 * Usage:
 * 1. Set environment variables:
 *    - X402_EVM_ADDRESS: Your EVM wallet address for receiving payments
 *    - X402_SOLANA_ADDRESS: Your Solana wallet address for receiving payments
 *    - X402_TESTNET: Set to 'true' for testnet mode
 *
 * 2. Wrap tool handlers with x402 middleware:
 *    import { withX402 } from './x402/index.js';
 *    const wrappedHandler = withX402('tool_name', originalHandler);
 *
 * 3. Or use the tool registrar:
 *    import { createX402ToolRegistrar } from './x402/index.js';
 *    const registerTool = createX402ToolRegistrar(server);
 *    registerTool('tool_name', 'description', schema, handler);
 */

// Configuration
export {
  PAYMENT_ADDRESSES,
  USDC_CONTRACTS,
  PRICING_TIERS,
  TOOL_PRICING,
  getToolPricing,
  isX402Enabled,
  getActiveNetworks,
  buildPaymentRequirements,
  type PricingTier,
  type ToolPricing,
} from './config.js';

// Verification
export {
  parsePaymentSignature,
  verifyEvmPayment,
  verifySolanaPayment,
  verifyPayment,
  type PaymentPayload,
} from './verify.js';

// Middleware
export {
  withX402,
  createX402ToolRegistrar,
  getAllToolPricing,
  getPricingSummary,
} from './middleware.js';
