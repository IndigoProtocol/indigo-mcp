import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { leverageCdpWithRob } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import {
  findIAsset,
  findCollateralAsset,
  findCdpCreatorOref,
  findInterestOracleOref,
  findTreasuryOrefForAsset,
  findAllRobs,
  toOutRef,
} from '../utils/v3-finders.js';
import { resolvePriceSource, pythSummary } from '../utils/pyth.js';

export function registerLeverageCdpTools(server: McpServer): void {
  server.tool(
    'leverage_cdp',
    'Open a leveraged CDP by redeeming against ROB positions — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      leverage: z.number().describe('Leverage multiplier (e.g. 2.0 for 2x leverage)'),
      baseCollateral: z.string().describe('Base ADA collateral amount in lovelace'),
    },
    async ({ address, asset, leverage, baseCollateral }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid, ctx) => {
            const params = await getSystemParams();

            const [iassetOut, collateralOut, cdpCreatorOref, allRobs] = await Promise.all([
              findIAsset(lucid, params, asset),
              findCollateralAsset(lucid, params, asset),
              findCdpCreatorOref(lucid, params),
              findAllRobs(lucid, params, asset),
            ]);

            if (allRobs.length === 0) {
              throw new Error(
                `No open ROB positions for ${asset}. A leveraged CDP mints ${asset} and ` +
                  'immediately redeems it against existing order-book positions, so at least ' +
                  'one has to be live.'
              );
            }

            // The fee is paid in the minted iAsset, so the treasury input has to
            // be one that already holds it.
            const iassetUnit =
              params.cdpParams.cdpAssetSymbol.unCurrencySymbol +
              Buffer.from(iassetOut.datum.assetName).toString('hex');
            const treasuryOref = await findTreasuryOrefForAsset(lucid, iassetUnit);
            if (treasuryOref === undefined) {
              throw new Error(`No treasury UTxO currently holds ${asset} to receive the fee`);
            }

            const [priceSource, interestOracleOref] = await Promise.all([
              resolvePriceSource(lucid, collateralOut, asset),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            ctx.pyth = pythSummary(priceSource);

            return leverageCdpWithRob(
              leverage,
              BigInt(baseCollateral),
              priceSource.priceOracleOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              cdpCreatorOref,
              interestOracleOref,
              treasuryOref,
              params,
              lucid,
              allRobs,
              priceSource.pythMessage,
              priceSource.pythStateOref
            );
          },
          {
            type: 'leverage_cdp',
            description: `Open ${leverage}x leveraged ${asset} CDP with ${baseCollateral} lovelace base collateral`,
            inputs: { address, asset, leverage: String(leverage), baseCollateral },
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
              text: `Error building leverage_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
