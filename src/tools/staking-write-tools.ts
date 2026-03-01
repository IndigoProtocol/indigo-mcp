import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  openStakingPosition,
  adjustStakingPosition,
  closeStakingPosition,
  findStakingManager,
} from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';

export function registerStakingWriteTools(server: McpServer): void {
  server.tool(
    'open_staking_position',
    'Stake INDY tokens by creating a new staking position. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      amount: z.string().describe('INDY amount to stake (in smallest unit)'),
    },
    async ({ address, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const stakingManagerOutput = await findStakingManager(params, lucid);
            const txBuilder = await openStakingPosition(
              BigInt(amount),
              params,
              lucid,
              stakingManagerOutput.utxo
            );
            return txBuilder.complete();
          },
          {
            type: 'open_staking_position',
            description: 'Create a new INDY staking position',
            inputs: { address, amount },
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
              text: `Error opening staking position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'adjust_staking_position',
    'Adjust an existing INDY staking position (add or remove INDY). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      amount: z
        .string()
        .describe('INDY amount to adjust (positive = stake more, negative = unstake)'),
      positionTxHash: z.string().describe('Transaction hash of the staking position UTxO'),
      positionOutputIndex: z.number().describe('Output index of the staking position UTxO'),
    },
    async ({ address, amount, positionTxHash, positionOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const stakingManagerOutput = await findStakingManager(params, lucid);
            const positionOutRef = {
              txHash: positionTxHash,
              outputIndex: positionOutputIndex,
            };
            const currentSlot = lucid.currentSlot();
            const txBuilder = await adjustStakingPosition(
              positionOutRef,
              BigInt(amount),
              params,
              lucid,
              currentSlot,
              stakingManagerOutput.utxo
            );
            return txBuilder.complete();
          },
          {
            type: 'adjust_staking_position',
            description: 'Adjust an existing INDY staking position',
            inputs: {
              address,
              amount,
              positionTxHash,
              positionOutputIndex: String(positionOutputIndex),
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
              text: `Error adjusting staking position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'close_staking_position',
    'Close an INDY staking position and unstake all INDY. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      positionTxHash: z.string().describe('Transaction hash of the staking position UTxO'),
      positionOutputIndex: z.number().describe('Output index of the staking position UTxO'),
    },
    async ({ address, positionTxHash, positionOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const stakingManagerOutput = await findStakingManager(params, lucid);
            const positionOutRef = {
              txHash: positionTxHash,
              outputIndex: positionOutputIndex,
            };
            const currentSlot = lucid.currentSlot();
            const txBuilder = await closeStakingPosition(
              positionOutRef,
              params,
              lucid,
              currentSlot,
              stakingManagerOutput.utxo
            );
            return txBuilder.complete();
          },
          {
            type: 'close_staking_position',
            description: 'Close an INDY staking position and unstake all INDY',
            inputs: { address, positionTxHash, positionOutputIndex: String(positionOutputIndex) },
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
              text: `Error closing staking position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
