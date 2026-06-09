import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { processSpRequest, annulRequest } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import { findStabilityPool, findIAsset, findE2s2sSnapshotOrefs } from '../utils/v3-finders.js';

export function registerSpRequestTools(server: McpServer): void {
  server.tool(
    'process_sp_request',
    'Process a pending stability pool request (protocol maintenance operation). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset of the stability pool (iUSD, iBTC, iETH, or iSOL)'),
      accountTxHash: z
        .string()
        .describe('Transaction hash of the account UTxO with the pending request'),
      accountOutputIndex: z.number().describe('Output index of the account UTxO'),
    },
    async ({ address, asset, accountTxHash, accountOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [accountUtxo] = await lucid.utxosByOutRef([
              { txHash: accountTxHash, outputIndex: accountOutputIndex },
            ]);
            if (!accountUtxo) throw new Error('Account UTxO not found on chain');

            const [stabilityPool, iassetOut, e2s2sSnapshotOrefs] = await Promise.all([
              findStabilityPool(lucid, params, asset),
              findIAsset(lucid, params, asset),
              findE2s2sSnapshotOrefs(lucid, params, asset),
            ]);

            return processSpRequest(
              stabilityPool.utxo,
              accountUtxo,
              iassetOut.utxo,
              e2s2sSnapshotOrefs,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'process_sp_request',
            description: `Process stability pool request for ${asset}`,
            inputs: {
              address,
              asset,
              accountTxHash,
              accountOutputIndex: String(accountOutputIndex),
            },
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
              text: `Error processing SP request: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'annul_sp_request',
    'Cancel a pending stability pool request. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      accountTxHash: z
        .string()
        .describe('Transaction hash of the account UTxO with the pending request'),
      accountOutputIndex: z.number().describe('Output index of the account UTxO'),
    },
    async ({ address, accountTxHash, accountOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const [accountUtxo] = await lucid.utxosByOutRef([
              { txHash: accountTxHash, outputIndex: accountOutputIndex },
            ]);
            if (!accountUtxo) throw new Error('Account UTxO not found on chain');

            const params = await getSystemParams();
            return annulRequest(accountUtxo, params, lucid);
          },
          {
            type: 'annul_sp_request',
            description: 'Cancel pending stability pool request',
            inputs: {
              address,
              accountTxHash,
              accountOutputIndex: String(accountOutputIndex),
            },
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
              text: `Error annulling SP request: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
