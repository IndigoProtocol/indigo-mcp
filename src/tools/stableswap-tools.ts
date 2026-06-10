import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fromText, toHex } from '@lucid-evolution/lucid';
import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid';
import type { StableswapPoolContent } from '@indigo-labs/indigo-sdk';
import {
  createStableswapOrder,
  cancelStableswapOrder,
  parseStableswapPoolDatumOrThrow,
  getInlineDatumOrThrow,
  createScriptAddress,
  fromSystemParamsAsset,
} from '@indigo-labs/indigo-sdk';
import { assetClassToUnit, isSameAssetClass } from '@3rd-eye-labs/cardano-offchain-common';
import type { AssetClass } from '@3rd-eye-labs/cardano-offchain-common';
import { getLucid } from '../utils/lucid-provider.js';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { ADA_COLLATERAL } from '../utils/v3-finders.js';
import { AssetParam } from '../utils/validators.js';

/**
 * Find the stableswap pool UTxO for a given (iAsset, collateral) pair.
 *
 * In Indigo v3, stableswap pool UTxOs sit at the stableswap validator address
 * and are identified by the CDP token. We parse each datum and match on iasset
 * name and collateralAsset.
 */
async function findStableswapPool(
  lucid: LucidEvolution,
  iasset: string,
  collateralAsset: AssetClass
): Promise<{ utxo: UTxO; datum: StableswapPoolContent }> {
  const params = await getSystemParams();
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');

  const cdpTokenAc = fromSystemParamsAsset(params.stableswapParams.cdpToken);
  const address = createScriptAddress(network, params.validatorHashes.stableswapHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(cdpTokenAc));
  const wantHex = fromText(iasset);

  for (const utxo of utxos) {
    try {
      const datum = parseStableswapPoolDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (
        toHex(datum.iasset) === wantHex &&
        isSameAssetClass(datum.collateralAsset, collateralAsset)
      ) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs whose datum is not a stableswap pool datum.
    }
  }

  throw new Error(
    `Stableswap pool UTxO for ${iasset} / ${assetClassToUnit(collateralAsset) || 'ADA'} not found`
  );
}

export function registerStableswapTools(server: McpServer): void {
  server.tool(
    'get_stableswap_pool',
    'Find the stableswap pool UTxO for an (iAsset, ADA collateral) pair and return its parsed datum',
    {
      asset: AssetParam.describe('iAsset name (iUSD, iBTC, iETH, or iSOL)'),
    },
    async ({ asset }) => {
      try {
        const lucid = await getLucid();
        const pool = await findStableswapPool(lucid, asset, ADA_COLLATERAL);

        const result = {
          txHash: pool.utxo.txHash,
          outputIndex: pool.utxo.outputIndex,
          datum: pool.datum,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching stableswap pool: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'create_stableswap_order',
    'Submit a stableswap order: swap collateral for iAsset (minting=true) or iAsset for collateral (minting=false). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset name (iUSD, iBTC, iETH, or iSOL)'),
      amount: z.string().describe('Amount in smallest unit to swap'),
      minting: z
        .boolean()
        .describe(
          'true = collateral → iAsset (mint direction); false = iAsset → collateral (redeem direction)'
        ),
    },
    async ({ address, asset, amount, minting }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const pool = await findStableswapPool(lucid, asset, ADA_COLLATERAL);

            return createStableswapOrder(
              asset,
              ADA_COLLATERAL,
              BigInt(amount),
              minting,
              pool.datum,
              params,
              lucid
            );
          },
          {
            type: 'create_stableswap_order',
            description: `${minting ? 'Mint' : 'Redeem'} ${asset} stableswap order for ${amount} units`,
            inputs: { address, asset, amount, minting: String(minting) },
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
              text: `Error building create_stableswap_order transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'cancel_stableswap_order',
    'Cancel an outstanding stableswap order and reclaim funds. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      orderTxHash: z.string().describe('Transaction hash of the stableswap order UTxO'),
      orderOutputIndex: z.number().describe('Output index of the stableswap order UTxO'),
    },
    async ({ address, orderTxHash, orderOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const stableswapOrderOref = { txHash: orderTxHash, outputIndex: orderOutputIndex };
            return cancelStableswapOrder(stableswapOrderOref, params, lucid);
          },
          {
            type: 'cancel_stableswap_order',
            description: `Cancel stableswap order ${orderTxHash}#${orderOutputIndex}`,
            inputs: {
              address,
              orderTxHash,
              orderOutputIndex: String(orderOutputIndex),
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
              text: `Error building cancel_stableswap_order transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
