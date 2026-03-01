import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution, Network } from '@lucid-evolution/lucid';
import type { SystemParams, IAssetContent } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import {
  liquidateCdp,
  redeemCdp,
  freezeCdp,
  mergeCdps,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  parseIAssetDatumOrThrow,
  getInlineDatumOrThrow,
} from '@indigo-labs/indigo-sdk';
import { fromText } from '@lucid-evolution/lucid';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

function getNetwork(lucid: LucidEvolution): Network {
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');
  return network;
}

async function findIAssetUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution
): Promise<{ utxo: Awaited<ReturnType<typeof lucid.utxoByUnit>>; datum: IAssetContent }> {
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

async function findInterestOracleUtxo(iAssetDatum: IAssetContent, lucid: LucidEvolution) {
  const nft = iAssetDatum.interestOracleNft;
  const oracleUnit = nft.currencySymbol + nft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

async function findCollectorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.collectorHash);
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No collector UTxOs found');
  }
  return utxos[0];
}

async function findTreasuryUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.treasuryHash);
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No treasury UTxOs found');
  }
  return utxos[0];
}

async function findStabilityPoolUtxo(params: SystemParams, lucid: LucidEvolution) {
  const spTokenAc = fromSystemParamsAsset(params.stabilityPoolParams.stabilityPoolToken);
  const spAddress = createScriptAddress(
    getNetwork(lucid),
    params.validatorHashes.stabilityPoolHash
  );
  const utxos = await lucid.utxosAtWithUnit(spAddress, assetClassToUnit(spTokenAc));
  if (utxos.length === 0) {
    throw new Error('No stability pool UTxOs found');
  }
  return utxos[0];
}

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
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [stabilityPoolUtxo, collectorUtxo, treasuryUtxo] = await Promise.all([
              findStabilityPoolUtxo(params, lucid),
              findCollectorUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const txBuilder = await liquidateCdp(
              cdpOutRef,
              stabilityPoolUtxo,
              collectorUtxo,
              treasuryUtxo,
              params,
              lucid
            );
            return txBuilder.complete();
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
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iAssetResult, collectorUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await redeemCdp(
              BigInt(amount),
              cdpOutRef,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
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
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const iAssetResult = await findIAssetUtxo(asset, params, lucid);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await freezeCdp(
              cdpOutRef,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              params,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
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

            const txBuilder = await mergeCdps(cdpOutRefs, params, lucid);
            return txBuilder.complete();
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
