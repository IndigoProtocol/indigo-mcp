import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mintCdp, burnCdp } from '@indigo-labs/indigo-sdk';
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
  toOutRef,
} from '../utils/v3-finders.js';

const PYTH_UNSUPPORTED =
  'This iAsset is priced via Pyth, which requires a signed Pyth price message. ' +
  'Pyth-priced operations are not yet supported by this server.';

export function registerCdpMintBurnTools(server: McpServer): void {
  server.tool(
    'mint_cdp',
    'Mint additional iAssets from an existing CDP (increases debt) — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('iAsset amount to mint in smallest unit'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut, interestCollectorOref, treasuryOref] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findInterestCollectorOref(lucid, params),
                findTreasuryOref(lucid, params),
              ]);

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return mintCdp(
              BigInt(amount),
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              priceOracleOref,
              interestOracleOref,
              treasuryOref,
              interestCollectorOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'mint_cdp',
            description: `Mint ${amount} ${asset} from CDP`,
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
              text: `Error building mint_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'burn_cdp',
    'Burn iAssets to reduce CDP debt — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('iAsset amount to burn in smallest unit'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut, interestCollectorOref, treasuryOref] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findInterestCollectorOref(lucid, params),
                findTreasuryOref(lucid, params),
              ]);

            const interestOracleOref = await findInterestOracleOref(lucid, collateralOut);

            return burnCdp(
              BigInt(amount),
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              interestOracleOref,
              treasuryOref,
              interestCollectorOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'burn_cdp',
            description: `Burn ${amount} ${asset} to reduce CDP debt`,
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
              text: `Error building burn_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
