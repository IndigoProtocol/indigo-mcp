import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fromText } from '@lucid-evolution/lucid';
import { openLrp, cancelLrp, adjustLrp, claimLrp, redeemLrp } from '@indigoprotocol/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

/**
 * Parse a maxPrice string into the OnChainDecimal format expected by the SDK.
 * The SDK's OnChainDecimal is { getOnChainInt: bigint }.
 */
function parseMaxPrice(maxPriceStr: string): { getOnChainInt: bigint } {
  return { getOnChainInt: BigInt(maxPriceStr) };
}

export function registerRobWriteTools(server: McpServer): void {
  server.tool(
    'open_rob',
    'Open a new ROB (Redemption Order Book) position with ADA and a max price limit. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      lovelacesAmount: z.string().describe('ADA amount in lovelace to deposit into the ROB'),
      maxPrice: z
        .string()
        .describe('Max price as an on-chain integer string (the getOnChainInt value)'),
    },
    async ({ address, asset, lovelacesAmount, maxPrice }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const assetTokenName = fromText(asset);
            const maxPriceDecimal = parseMaxPrice(maxPrice);
            return openLrp(assetTokenName, BigInt(lovelacesAmount), maxPriceDecimal, lucid, params);
          },
          {
            type: 'open_rob',
            description: `Open ${asset} ROB with ${lovelacesAmount} lovelace`,
            inputs: { address, asset, lovelacesAmount, maxPrice },
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
              text: `Error opening ROB position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'cancel_rob',
    'Cancel an existing ROB position. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      robTxHash: z.string().describe('Transaction hash of the ROB UTxO'),
      robOutputIndex: z.number().describe('Output index of the ROB UTxO'),
    },
    async ({ address, robTxHash, robOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const robOutRef = { txHash: robTxHash, outputIndex: robOutputIndex };
            return cancelLrp(robOutRef, params, lucid);
          },
          {
            type: 'cancel_rob',
            description: 'Cancel an ROB position',
            inputs: { address, robTxHash, robOutputIndex: String(robOutputIndex) },
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
              text: `Error cancelling ROB position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'adjust_rob',
    'Adjust ADA amount in an ROB position (positive to increase, negative to decrease). Optionally update the max price. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      robTxHash: z.string().describe('Transaction hash of the ROB UTxO'),
      robOutputIndex: z.number().describe('Output index of the ROB UTxO'),
      lovelacesAdjustAmount: z
        .string()
        .describe('Lovelace adjustment amount (positive to add, negative to remove)'),
      newMaxPrice: z
        .string()
        .optional()
        .describe('Optional new max price as an on-chain integer string'),
    },
    async ({ address, robTxHash, robOutputIndex, lovelacesAdjustAmount, newMaxPrice }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const robOutRef = { txHash: robTxHash, outputIndex: robOutputIndex };
            const newMaxPriceDecimal =
              newMaxPrice !== undefined ? parseMaxPrice(newMaxPrice) : undefined;
            return adjustLrp(
              lucid,
              robOutRef,
              BigInt(lovelacesAdjustAmount),
              newMaxPriceDecimal,
              params
            );
          },
          {
            type: 'adjust_rob',
            description: `Adjust ROB by ${lovelacesAdjustAmount} lovelace`,
            inputs: {
              address,
              robTxHash,
              robOutputIndex: String(robOutputIndex),
              lovelacesAdjustAmount,
              ...(newMaxPrice !== undefined ? { newMaxPrice } : {}),
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
              text: `Error adjusting ROB position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'claim_rob',
    'Claim received iAssets from an ROB position. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      robTxHash: z.string().describe('Transaction hash of the ROB UTxO'),
      robOutputIndex: z.number().describe('Output index of the ROB UTxO'),
    },
    async ({ address, robTxHash, robOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const robOutRef = { txHash: robTxHash, outputIndex: robOutputIndex };
            return claimLrp(lucid, robOutRef, params);
          },
          {
            type: 'claim_rob',
            description: 'Claim iAssets from an ROB position',
            inputs: { address, robTxHash, robOutputIndex: String(robOutputIndex) },
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
              text: `Error claiming ROB iAssets: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'redeem_rob',
    'Redeem iAssets against one or more ROB positions. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      redemptionRobs: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the ROB UTxO'),
            outputIndex: z.number().describe('Output index of the ROB UTxO'),
            iAssetAmount: z.string().describe('Amount of iAssets to redeem against this ROB'),
          })
        )
        .describe('Array of ROB positions and amounts to redeem against'),
      priceOracleTxHash: z.string().describe('Transaction hash of the price oracle UTxO'),
      priceOracleOutputIndex: z.number().describe('Output index of the price oracle UTxO'),
      iassetTxHash: z.string().describe('Transaction hash of the iAsset UTxO'),
      iassetOutputIndex: z.number().describe('Output index of the iAsset UTxO'),
    },
    async ({
      address,
      redemptionRobs,
      priceOracleTxHash,
      priceOracleOutputIndex,
      iassetTxHash,
      iassetOutputIndex,
    }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const redemptionRobsData: [{ txHash: string; outputIndex: number }, bigint][] =
              redemptionRobs.map((rob) => [
                { txHash: rob.txHash, outputIndex: rob.outputIndex },
                BigInt(rob.iAssetAmount),
              ]);
            const priceOracleOutRef = {
              txHash: priceOracleTxHash,
              outputIndex: priceOracleOutputIndex,
            };
            const iassetOutRef = {
              txHash: iassetTxHash,
              outputIndex: iassetOutputIndex,
            };
            return redeemLrp(redemptionRobsData, priceOracleOutRef, iassetOutRef, lucid, params);
          },
          {
            type: 'redeem_rob',
            description: `Redeem iAssets against ${redemptionRobs.length} ROB position(s)`,
            inputs: {
              address,
              redemptionRobs: JSON.stringify(redemptionRobs),
              priceOracleTxHash,
              priceOracleOutputIndex: String(priceOracleOutputIndex),
              iassetTxHash,
              iassetOutputIndex: String(iassetOutputIndex),
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
              text: `Error redeeming ROB: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
