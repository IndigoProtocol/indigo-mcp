import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { createSpAccount, adjustSpAccount, closeSpAccount } from '@indigo-labs/indigo-sdk';
import { AssetParam } from '../utils/validators.js';

export function registerStabilityPoolWriteTools(server: McpServer): void {
  server.tool(
    'create_sp_account',
    'Create a new stability pool account by depositing iAssets. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset to deposit (iUSD, iBTC, iETH, or iSOL)'),
      amount: z.string().describe('Amount of iAsset to deposit (in smallest unit)'),
    },
    async ({ address, asset, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const txBuilder = await createSpAccount(asset, BigInt(amount), params, lucid);
            return txBuilder.complete();
          },
          {
            type: 'create_sp_account',
            description: `Create stability pool account for ${asset}`,
            inputs: { address, asset, amount },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error creating SP account: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'adjust_sp_account',
    'Deposit to or withdraw from an existing stability pool account. Positive amount deposits, negative withdraws. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset of the stability pool (iUSD, iBTC, iETH, or iSOL)'),
      amount: z.string().describe('Amount to adjust (positive = deposit, negative = withdraw, in smallest unit)'),
      accountTxHash: z.string().describe('Transaction hash of the account UTxO'),
      accountOutputIndex: z.number().describe('Output index of the account UTxO'),
    },
    async ({ address, asset, amount, accountTxHash, accountOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const [accountUtxo] = await lucid.utxosByOutRef([
              { txHash: accountTxHash, outputIndex: accountOutputIndex },
            ]);
            if (!accountUtxo) throw new Error('Account UTxO not found on chain');

            const params = await getSystemParams();
            const txBuilder = await adjustSpAccount(
              asset,
              BigInt(amount),
              accountUtxo,
              params,
              lucid,
            );
            return txBuilder.complete();
          },
          {
            type: 'adjust_sp_account',
            description: `Adjust stability pool account for ${asset}`,
            inputs: { address, asset, amount, accountTxHash, accountOutputIndex: String(accountOutputIndex) },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adjusting SP account: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'close_sp_account',
    'Close a stability pool account and withdraw all deposited iAssets. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      accountTxHash: z.string().describe('Transaction hash of the account UTxO'),
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
            const txBuilder = await closeSpAccount(accountUtxo, params, lucid);
            return txBuilder.complete();
          },
          {
            type: 'close_sp_account',
            description: 'Close stability pool account and withdraw all funds',
            inputs: { address, accountTxHash, accountOutputIndex: String(accountOutputIndex) },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error closing SP account: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}