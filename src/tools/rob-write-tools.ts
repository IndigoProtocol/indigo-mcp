import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { openRob, cancelRob, adjustRob, claimRob, redeemRob } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import {
  ADA_COLLATERAL,
  findIAsset,
  findCollateralAsset,
  findPriceOracleOref,
  toOutRef,
} from '../utils/v3-finders.js';

const PYTH_UNSUPPORTED =
  'This iAsset is priced via Pyth, which requires a signed Pyth price message. ' +
  'Pyth-priced operations are not yet supported by this server.';

export function registerRobWriteTools(server: McpServer): void {
  server.tool(
    'open_rob',
    'Open a new ROB (Redemption Order Book) buy order: deposit ADA to buy an iAsset up to a max price. The max price is a rational number (numerator/denominator). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      lovelacesAmount: z.string().describe('ADA amount in lovelace to deposit into the ROB'),
      maxPriceNumerator: z.string().describe('Max price numerator (integer string)'),
      maxPriceDenominator: z.string().describe('Max price denominator (integer string)'),
    },
    async ({ address, asset, lovelacesAmount, maxPriceNumerator, maxPriceDenominator }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const orderType = {
              BuyIAssetOrder: {
                collateralAsset: ADA_COLLATERAL,
                maxPrice: {
                  numerator: BigInt(maxPriceNumerator),
                  denominator: BigInt(maxPriceDenominator),
                },
              },
            };
            return openRob(asset, BigInt(lovelacesAmount), orderType, lucid, params);
          },
          {
            type: 'open_rob',
            description: `Open ${asset} ROB buy order with ${lovelacesAmount} lovelace`,
            inputs: { address, asset, lovelacesAmount, maxPriceNumerator, maxPriceDenominator },
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
            return cancelRob(robOutRef, params, lucid);
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
    'Adjust ADA amount in an ROB buy order (positive to increase, negative to decrease). Optionally update the max price (numerator/denominator). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      robTxHash: z.string().describe('Transaction hash of the ROB UTxO'),
      robOutputIndex: z.number().describe('Output index of the ROB UTxO'),
      lovelacesAdjustAmount: z
        .string()
        .describe('Lovelace adjustment amount (positive to add, negative to remove)'),
      newMaxPriceNumerator: z
        .string()
        .optional()
        .describe('Optional new max price numerator (integer string)'),
      newMaxPriceDenominator: z
        .string()
        .optional()
        .describe('Optional new max price denominator (integer string)'),
    },
    async ({
      address,
      robTxHash,
      robOutputIndex,
      lovelacesAdjustAmount,
      newMaxPriceNumerator,
      newMaxPriceDenominator,
    }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const robOutRef = { txHash: robTxHash, outputIndex: robOutputIndex };
            const newLimitPrice =
              newMaxPriceNumerator !== undefined && newMaxPriceDenominator !== undefined
                ? {
                    BuyOrder: {
                      numerator: BigInt(newMaxPriceNumerator),
                      denominator: BigInt(newMaxPriceDenominator),
                    },
                  }
                : undefined;
            return adjustRob(
              lucid,
              robOutRef,
              BigInt(lovelacesAdjustAmount),
              newLimitPrice,
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
              ...(newMaxPriceNumerator !== undefined ? { newMaxPriceNumerator } : {}),
              ...(newMaxPriceDenominator !== undefined ? { newMaxPriceDenominator } : {}),
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
            return claimRob(lucid, robOutRef, params);
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
    'Redeem iAssets against one or more ROB positions for a given iAsset. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset being redeemed against the ROB positions'),
      redemptionRobs: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the ROB UTxO'),
            outputIndex: z.number().describe('Output index of the ROB UTxO'),
            amount: z
              .string()
              .describe(
                'Payout amount for this redemption (iAssets for buy orders, collateral for sell orders)'
              ),
          })
        )
        .describe('Array of ROB positions and amounts to redeem against'),
    },
    async ({ address, asset, redemptionRobs }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [iassetOut, collateralOut] = await Promise.all([
              findIAsset(lucid, params, asset),
              findCollateralAsset(lucid, params, asset),
            ]);
            const priceOracleOref = await findPriceOracleOref(lucid, collateralOut);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            const redemptionRobsData: [{ txHash: string; outputIndex: number }, bigint][] =
              redemptionRobs.map((rob) => [
                { txHash: rob.txHash, outputIndex: rob.outputIndex },
                BigInt(rob.amount),
              ]);

            return redeemRob(
              redemptionRobsData,
              priceOracleOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              lucid,
              params,
              currentSlot
            );
          },
          {
            type: 'redeem_rob',
            description: `Redeem ${asset} against ${redemptionRobs.length} ROB position(s)`,
            inputs: { address, asset, redemptionRobs: JSON.stringify(redemptionRobs) },
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
