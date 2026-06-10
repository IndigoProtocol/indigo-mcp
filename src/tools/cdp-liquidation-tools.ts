import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { liquidateCdp, redeemCdp, freezeCdp, mergeCdps } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import {
  findIAsset,
  findCollateralAsset,
  findInterestOracleOref,
  findPriceOracleOref,
  findInterestCollectorOref,
  findTreasuryOref,
  findStabilityPool,
  findGov,
  toOutRef,
} from '../utils/v3-finders.js';

const PYTH_UNSUPPORTED =
  'This iAsset is priced via Pyth, which requires a signed Pyth price message. ' +
  'Pyth-priced operations are not yet supported by this server.';

export function registerCdpLiquidationTools(server: McpServer): void {
  server.tool(
    'liquidate_cdp',
    'Liquidate an undercollateralized CDP through the stability pool — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [stabilityPool, interestCollectorOref, treasuryOref] = await Promise.all([
              findStabilityPool(lucid, params, asset),
              findInterestCollectorOref(lucid, params),
              findTreasuryOref(lucid, params),
            ]);

            return liquidateCdp(
              cdpOref,
              toOutRef(stabilityPool.utxo),
              interestCollectorOref,
              treasuryOref,
              params,
              lucid
            );
          },
          {
            type: 'liquidate_cdp',
            description: `Liquidate undercollateralized ${asset} CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex) },
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
              text: `Error building liquidate_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'redeem_cdp',
    'Redeem iAssets from a CDP — builds an unsigned transaction (CBOR hex) for client-side signing. To redeem the maximum possible, pass the total minted amount.',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z
        .string()
        .describe(
          'iAsset amount to redeem in smallest unit (pass total minted amount to redeem max)'
        ),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut, interestCollectorOref, treasuryOref, gov] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findInterestCollectorOref(lucid, params),
                findTreasuryOref(lucid, params),
                findGov(lucid, params),
              ]);

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return redeemCdp(
              BigInt(amount),
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              priceOracleOref,
              interestOracleOref,
              interestCollectorOref,
              treasuryOref,
              toOutRef(gov.utxo),
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'redeem_cdp',
            description: `Redeem ${amount} ${asset} from CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex), amount },
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
              text: `Error building redeem_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'freeze_cdp',
    'Freeze a CDP to prevent further operations until unfrozen — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut] = await Promise.all([
              findIAsset(lucid, params, asset),
              findCollateralAsset(lucid, params, asset),
            ]);

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return freezeCdp(
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              priceOracleOref,
              interestOracleOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'freeze_cdp',
            description: `Freeze ${asset} CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex) },
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
              text: `Error building freeze_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'merge_cdps',
    'Merge multiple CDPs into one — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      cdpOutRefs: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the CDP UTxO'),
            outputIndex: z.number().describe('Output index of the CDP UTxO'),
          })
        )
        .min(2)
        .describe('Array of CDP UTxO references to merge (minimum 2)'),
    },
    async ({ address, cdpOutRefs }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            return mergeCdps(cdpOutRefs, params, lucid);
          },
          {
            type: 'merge_cdps',
            description: `Merge ${cdpOutRefs.length} CDPs into one`,
            inputs: { address, cdpOutRefs: JSON.stringify(cdpOutRefs) },
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
              text: `Error building merge_cdps transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
