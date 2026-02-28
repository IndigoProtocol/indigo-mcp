import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution } from '@lucid-evolution/lucid';
import type { SystemParams } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import {
  mintCdp,
  burnCdp,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  matchSingle,
  parseIAssetDatumOrThrow,
  getInlineDatumOrThrow,
} from '@indigo-labs/indigo-sdk';
import { fromText } from '@lucid-evolution/lucid';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

/**
 * Resolve the iAsset state UTxO for a given asset name (e.g. "iUSD").
 */
async function findIAssetUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution,
) {
  const iAssetAuthAc = fromSystemParamsAsset(params.cdpParams.iAssetAuthToken);
  const cdpAddress = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.cdpHash,
  );
  const utxos = await lucid.utxosAtWithUnit(
    cdpAddress,
    assetClassToUnit(iAssetAuthAc),
  );
  const assetHex = fromText(asset);
  const iAssetUnit = iAssetAuthAc.currencySymbol + assetHex;
  const matched = utxos.filter((u) => u.assets[iAssetUnit] !== undefined);
  return matchSingle(
    matched,
    (xs) => new Error(`Expected exactly one iAsset UTxO for ${asset}, found ${xs.length}`),
  );
}

/**
 * Find the price oracle UTxO for a given iAsset.
 */
async function findPriceOracleUtxo(
  iAssetUtxo: Awaited<ReturnType<typeof findIAssetUtxo>>,
  lucid: LucidEvolution,
) {
  const datum = parseIAssetDatumOrThrow(getInlineDatumOrThrow(iAssetUtxo));
  const priceInfo = datum.price as { Oracle?: { content: { oracleNft: { currencySymbol: string; tokenName: string } } } };
  if (!priceInfo.Oracle) {
    throw new Error('iAsset is delisted, cannot perform CDP operations');
  }
  const oracleNft = priceInfo.Oracle.content.oracleNft;
  const oracleUnit = oracleNft.currencySymbol + oracleNft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

/**
 * Find the interest oracle UTxO for a given iAsset.
 */
async function findInterestOracleUtxo(
  iAssetUtxo: Awaited<ReturnType<typeof findIAssetUtxo>>,
  lucid: LucidEvolution,
) {
  const datum = parseIAssetDatumOrThrow(getInlineDatumOrThrow(iAssetUtxo));
  const oracleNft = datum.interestOracleNft;
  const oracleUnit = oracleNft.currencySymbol + oracleNft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

/**
 * Find the governance UTxO (holds govNFT at the gov validator address).
 */
async function findGovUtxo(params: SystemParams, lucid: LucidEvolution) {
  const nftAc = fromSystemParamsAsset(params.govParams.govNFT);
  const address = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.govHash,
  );
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  return matchSingle(utxos, (_) => new Error('Expected a single governance UTxO'));
}

/**
 * Find the treasury UTxO at the treasury validator address.
 */
async function findTreasuryUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.treasuryHash,
  );
  const utxos = await lucid.utxosAt(address);
  return matchSingle(utxos, (_) => new Error('Expected a single treasury UTxO'));
}

/**
 * Find a collector UTxO at the collector validator address.
 */
async function findCollectorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.collectorHash,
  );
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No collector UTxOs found');
  }
  return utxos[0];
}

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
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iAssetUtxo, collectorUtxo, govUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findGovUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetUtxo, lucid),
              findInterestOracleUtxo(iAssetUtxo, lucid),
            ]);

            const txBuilder = await mintCdp(
              BigInt(amount),
              cdpOutRef,
              iAssetUtxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              govUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot,
            );
            return txBuilder.complete();
          },
          {
            type: 'mint_cdp',
            description: `Mint ${amount} ${asset} from CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex), amount },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error building mint_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
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
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iAssetUtxo, collectorUtxo, govUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findGovUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetUtxo, lucid),
              findInterestOracleUtxo(iAssetUtxo, lucid),
            ]);

            const txBuilder = await burnCdp(
              BigInt(amount),
              cdpOutRef,
              iAssetUtxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              govUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot,
            );
            return txBuilder.complete();
          },
          {
            type: 'burn_cdp',
            description: `Burn ${amount} ${asset} to reduce CDP debt`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex), amount },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error building burn_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}