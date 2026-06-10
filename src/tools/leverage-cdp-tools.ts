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
  findPriceOracleOref,
  findTreasuryOref,
  findAllRobs,
  toOutRef,
} from '../utils/v3-finders.js';

const PYTH_UNSUPPORTED =
  'This iAsset is priced via Pyth, which requires a signed Pyth price message. ' +
  'Pyth-priced operations are not yet supported by this server.';

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
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [iassetOut, collateralOut, cdpCreatorOref, treasuryOref, allRobs] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findCdpCreatorOref(lucid, params),
                findTreasuryOref(lucid, params),
                findAllRobs(lucid, params, asset),
              ]);

            if (allRobs.length === 0) {
              throw new Error('No ROB positions found on-chain for this iAsset');
            }
            if (treasuryOref === undefined) {
              throw new Error('No ADA-only treasury UTxO available for leverage operation');
            }

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return leverageCdpWithRob(
              leverage,
              BigInt(baseCollateral),
              priceOracleOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              cdpCreatorOref,
              interestOracleOref,
              treasuryOref,
              params,
              lucid,
              allRobs,
              currentSlot
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
