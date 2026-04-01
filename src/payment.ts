/**
 * Payment module — x402 split execution payment gate
 *
 * Routes payment verification through the openmm.io proxy (or a custom
 * PAYMENT_SERVER) instead of directly to the x402.org facilitator.
 *
 * Split execution flow:
 *   1. Tool is called (no payment header required from the caller)
 *   2. Gate intercepts and POSTs to workerUrl/verify-payment
 *   3. Worker responds 402 with EIP-3009 requirements
 *   4. Gate signs locally with X402_PRIVATE_KEY — key never leaves this process
 *   5. Gate retries with X-PAYMENT header → worker verifies on-chain, issues JWT
 *   6. Gate verifies JWT locally, then executes the original tool handler
 *   7. Payment metadata (tx hash) is injected into the tool response
 *
 * Process isolation: the openmm.io worker handles all settlement logic.
 * indigo-mcp never holds the recipient wallet — only the payer key.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapWithSplitPayment } from '@qbtlabs/x402/split';

/** Default proxy / settlement worker. Override with PAYMENT_SERVER env var. */
export const DEFAULT_WORKER_URL = 'https://mcp.openmm.io';

/**
 * Tool names that bypass payment entirely.
 * Empty by default — all 40 Indigo tools require payment when enabled.
 * Add tool names here to make them always free.
 */
export const FREE_TOOLS: string[] = [];

/**
 * Apply the split payment gate to an MCP server.
 * Must be called BEFORE registerTools().
 *
 * Payment is enabled when X402_PRIVATE_KEY is set (the payer wallet).
 * When disabled this is a no-op — all tools execute without payment.
 *
 * @example
 * ```bash
 * X402_PRIVATE_KEY=0x...  # EVM payer wallet — auto-signs tool payments
 * PAYMENT_SERVER=https://mcp.openmm.io  # proxy (default)
 * X402_TESTNET=true  # Base Sepolia
 * ```
 */
export function applyPaymentGate(server: McpServer): void {
  const privateKey = process.env.X402_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) return;

  const workerUrl =
    process.env.PAYMENT_SERVER ?? process.env.X402_FACILITATOR_URL ?? DEFAULT_WORKER_URL;

  wrapWithSplitPayment(server as any, {
    privateKey,
    workerUrl,
    testnet: process.env.X402_TESTNET === 'true',
    freeTools: FREE_TOOLS,
  });
}
