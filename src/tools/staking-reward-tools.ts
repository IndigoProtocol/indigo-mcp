import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { distributeAda, findStakingManager } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';

export function registerStakingRewardTools(server: McpServer): void {
  server.tool(
    'distribute_staking_rewards',
    'Distribute collected ADA rewards from collector UTxOs to staking positions. This is a protocol maintenance operation that anyone can call. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      collectorTxHashes: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the collector UTxO'),
            outputIndex: z.number().describe('Output index of the collector UTxO'),
          })
        )
        .describe('Array of collector UTxO references to distribute rewards from'),
    },
    async ({ address, collectorTxHashes }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const stakingManagerOutput = await findStakingManager(params, lucid);
            const txBuilder = await distributeAda(
              stakingManagerOutput.utxo,
              collectorTxHashes,
              params,
              lucid
            );
            return txBuilder.complete();
          },
          {
            type: 'distribute_staking_rewards',
            description: 'Distribute ADA rewards from collector UTxOs to staking positions',
            inputs: { address, collectorTxHashes: JSON.stringify(collectorTxHashes) },
          }
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error distributing staking rewards: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
