import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution, Network, UTxO } from '@lucid-evolution/lucid';
import { fromText } from '@lucid-evolution/lucid';
import type { SystemParams, IAssetContent, LRPDatum } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import {
  leverageCdpWithLrp,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  parseIAssetDatumOrThrow,
  parseLrpDatumOrThrow,
  getInlineDatumOrThrow,
} from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

function getNetwork(lucid: LucidEvolution): Network {
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');
  return network;
}

/**
 * Resolve the iAsset state UTxO for a given asset name (e.g. "iUSD").
 */
async function findIAssetUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution
): Promise<{ utxo: UTxO; datum: IAssetContent }> {
  const iAssetAuthAc = fromSystemParamsAsset(params.cdpParams.iAssetAuthToken);
  const cdpAddress = createScriptAddress(getNetwork(lucid), params.validatorHashes.cdpHash);
  const utxos = await lucid.utxosAtWithUnit(cdpAddress, assetClassToUnit(iAssetAuthAc));
  const assetHex = fromText(asset);
  for (const utxo of utxos) {
    try {
      const datum = parseIAssetDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (datum.assetName === assetHex) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs with unparseable datums
    }
  }
  throw new Error(`iAsset UTxO for ${asset} not found`);
}

/**
 * Find the CDP creator UTxO (holds the cdpCreatorNft at the cdpCreator validator address).
 */
async function findCdpCreatorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const nftAc = fromSystemParamsAsset(params.cdpCreatorParams.cdpCreatorNft);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.cdpCreatorHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  if (utxos.length !== 1) {
    throw new Error(`Expected a single CDP creator UTxO, found ${utxos.length}`);
  }
  return utxos[0];
}

/**
 * Find a collector UTxO at the collector validator address.
 */
async function findCollectorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.collectorHash);
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No collector UTxOs found');
  }
  return utxos[0];
}

/**
 * Find the price oracle UTxO for a given iAsset.
 */
async function findPriceOracleUtxo(iAssetDatum: IAssetContent, lucid: LucidEvolution) {
  const priceInfo = iAssetDatum.price as
    | { Delisted: unknown }
    | { Oracle: { content: { oracleNft: { currencySymbol: string; tokenName: string } } } };
  if ('Delisted' in priceInfo) {
    throw new Error('iAsset is delisted, cannot perform CDP operations');
  }
  const oracleNft = priceInfo.Oracle.content.oracleNft;
  const oracleUnit = oracleNft.currencySymbol + oracleNft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

/**
 * Find the interest oracle UTxO for a given iAsset.
 */
async function findInterestOracleUtxo(iAssetDatum: IAssetContent, lucid: LucidEvolution) {
  const nft = iAssetDatum.interestOracleNft;
  const oracleUnit = nft.currencySymbol + nft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

/**
 * Fetch all LRP UTxOs at the LRP validator address and parse their datums.
 */
async function findAllLrpUtxos(
  params: SystemParams,
  lucid: LucidEvolution
): Promise<[UTxO, LRPDatum][]> {
  const lrpAddress = createScriptAddress(getNetwork(lucid), params.validatorHashes.lrpHash);
  const utxos = await lucid.utxosAt(lrpAddress);
  const result: [UTxO, LRPDatum][] = [];
  for (const utxo of utxos) {
    try {
      const datum = parseLrpDatumOrThrow(getInlineDatumOrThrow(utxo));
      result.push([utxo, datum]);
    } catch {
      // Skip UTxOs with unparseable datums
    }
  }
  return result;
}

export function registerLeverageCdpTools(server: McpServer): void {
  server.tool(
    'leverage_cdp',
    'Open a leveraged CDP by redeeming against LRP positions — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      leverage: z.number().describe('Leverage multiplier (e.g. 2.0 for 2x leverage)'),
      baseCollateral: z.string().describe('Base collateral amount in lovelace'),
    },
    async ({ address, asset, leverage, baseCollateral }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [iAssetResult, cdpCreatorUtxo, collectorUtxo, allLrps] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCdpCreatorUtxo(params, lucid),
              findCollectorUtxo(params, lucid),
              findAllLrpUtxos(params, lucid),
            ]);

            if (allLrps.length === 0) {
              throw new Error('No LRP positions found on-chain');
            }

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await leverageCdpWithLrp(
              leverage,
              BigInt(baseCollateral),
              priceOracleUtxo,
              iAssetResult.utxo,
              cdpCreatorUtxo,
              interestOracleUtxo,
              collectorUtxo,
              params,
              lucid,
              allLrps,
              currentSlot
            );
            return txBuilder.complete();
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
