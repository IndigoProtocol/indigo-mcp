import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapWithSplitPayment } from '@qbtlabs/x402/split';

export const DEFAULT_WORKER_URL = 'https://mcp.openmm.io';

export const FREE_TOOLS: string[] = [];

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
