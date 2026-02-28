import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fromText } from '@lucid-evolution/lucid';
import {
  openLrp,
  cancelLrp,
  adjustLrp,
  claimLrp,
  redeemLrp,
} from '@indigo-labs/indigo-sdk';
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

export function registerLrpWriteTools(server: McpServer): void {
  server.tool(
    'open_lrp',
    'Open a new LRP (Limit Redemption Protocol) position with ADA and a max price limit. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      lovelacesAmount: z.string().describe('ADA amount in lovelace to deposit into the LRP'),
      maxPrice: z.string().describe('Max price as an on-chain integer string (the getOnChainInt value)'),
    },
    async ({ address, asset, lovelacesAmount, maxPrice }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const assetTokenName = fromText(asset);
            const maxPriceDecimal = parseMaxPrice(maxPrice);
            const txBuilder = await openLrp(
              assetTokenName,
              BigInt(lovelacesAmount),
              maxPriceDecimal,
              lucid,
              params,
            );
            return txBuilder.complete();
          },
          {
            type: 'open_lrp',
            description: `Open ${asset} LRP with ${lovelacesAmount} lovelace`,
            inputs: { address, asset, lovelacesAmount, maxPrice },
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
              text: `Error opening LRP position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'cancel_lrp',
    'Cancel an existing LRP position. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      lrpTxHash: z.string().describe('Transaction hash of the LRP UTxO'),
      lrpOutputIndex: z.number().describe('Output index of the LRP UTxO'),
    },
    async ({ address, lrpTxHash, lrpOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const lrpOutRef = { txHash: lrpTxHash, outputIndex: lrpOutputIndex };
            const txBuilder = await cancelLrp(lrpOutRef, params, lucid);
            return txBuilder.complete();
          },
          {
            type: 'cancel_lrp',
            description: 'Cancel an LRP position',
            inputs: { address, lrpTxHash, lrpOutputIndex: String(lrpOutputIndex) },
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
              text: `Error cancelling LRP position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'adjust_lrp',
    'Adjust ADA amount in an LRP position (positive to increase, negative to decrease). Optionally update the max price. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      lrpTxHash: z.string().describe('Transaction hash of the LRP UTxO'),
      lrpOutputIndex: z.number().describe('Output index of the LRP UTxO'),
      lovelacesAdjustAmount: z.string().describe('Lovelace adjustment amount (positive to add, negative to remove)'),
      newMaxPrice: z.string().optional().describe('Optional new max price as an on-chain integer string'),
    },
    async ({ address, lrpTxHash, lrpOutputIndex, lovelacesAdjustAmount, newMaxPrice }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const lrpOutRef = { txHash: lrpTxHash, outputIndex: lrpOutputIndex };
            const newMaxPriceDecimal = newMaxPrice !== undefined
              ? parseMaxPrice(newMaxPrice)
              : undefined;
            const txBuilder = await adjustLrp(
              lucid,
              lrpOutRef,
              BigInt(lovelacesAdjustAmount),
              newMaxPriceDecimal,
              params,
            );
            return txBuilder.complete();
          },
          {
            type: 'adjust_lrp',
            description: `Adjust LRP by ${lovelacesAdjustAmount} lovelace`,
            inputs: {
              address,
              lrpTxHash,
              lrpOutputIndex: String(lrpOutputIndex),
              lovelacesAdjustAmount,
              ...(newMaxPrice !== undefined ? { newMaxPrice } : {}),
            },
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
              text: `Error adjusting LRP position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'claim_lrp',
    'Claim received iAssets from an LRP position. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      lrpTxHash: z.string().describe('Transaction hash of the LRP UTxO'),
      lrpOutputIndex: z.number().describe('Output index of the LRP UTxO'),
    },
    async ({ address, lrpTxHash, lrpOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const lrpOutRef = { txHash: lrpTxHash, outputIndex: lrpOutputIndex };
            const txBuilder = await claimLrp(lucid, lrpOutRef, params);
            return txBuilder.complete();
          },
          {
            type: 'claim_lrp',
            description: 'Claim iAssets from an LRP position',
            inputs: { address, lrpTxHash, lrpOutputIndex: String(lrpOutputIndex) },
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
              text: `Error claiming LRP iAssets: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'redeem_lrp',
    'Redeem iAssets against one or more LRP positions. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      redemptionLrps: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the LRP UTxO'),
            outputIndex: z.number().describe('Output index of the LRP UTxO'),
            iAssetAmount: z.string().describe('Amount of iAssets to redeem against this LRP'),
          }),
        )
        .describe('Array of LRP positions and amounts to redeem against'),
      priceOracleTxHash: z.string().describe('Transaction hash of the price oracle UTxO'),
      priceOracleOutputIndex: z.number().describe('Output index of the price oracle UTxO'),
      iassetTxHash: z.string().describe('Transaction hash of the iAsset UTxO'),
      iassetOutputIndex: z.number().describe('Output index of the iAsset UTxO'),
    },
    async ({
      address,
      redemptionLrps,
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
            const redemptionLrpsData: [{ txHash: string; outputIndex: number }, bigint][] =
              redemptionLrps.map((lrp) => [
                { txHash: lrp.txHash, outputIndex: lrp.outputIndex },
                BigInt(lrp.iAssetAmount),
              ]);
            const priceOracleOutRef = {
              txHash: priceOracleTxHash,
              outputIndex: priceOracleOutputIndex,
            };
            const iassetOutRef = {
              txHash: iassetTxHash,
              outputIndex: iassetOutputIndex,
            };
            const txBuilder = await redeemLrp(
              redemptionLrpsData,
              priceOracleOutRef,
              iassetOutRef,
              lucid,
              params,
            );
            return txBuilder.complete();
          },
          {
            type: 'redeem_lrp',
            description: `Redeem iAssets against ${redemptionLrps.length} LRP position(s)`,
            inputs: {
              address,
              redemptionLrps: JSON.stringify(redemptionLrps),
              priceOracleTxHash,
              priceOracleOutputIndex: String(priceOracleOutputIndex),
              iassetTxHash,
              iassetOutputIndex: String(iassetOutputIndex),
            },
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
              text: `Error redeeming LRP: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
