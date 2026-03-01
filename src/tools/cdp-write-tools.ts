import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution, Network, UTxO } from '@lucid-evolution/lucid';
import { fromText } from '@lucid-evolution/lucid';
import type { SystemParams, IAssetContent } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import {
  openCdp,
  depositCdp,
  withdrawCdp,
  closeCdp,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  parseIAssetDatumOrThrow,
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
 * iAsset UTxOs sit at the CDP validator address, hold the iAsset auth token,
 * and have an IAsset datum containing the hex-encoded asset name.
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
      // Skip UTxOs with unparseable datums (e.g. CDP datums at same address)
    }
  }
  throw new Error(`iAsset UTxO for ${asset} not found`);
}

/**
 * Find a CDP creator UTxO (holds the cdpCreatorNft at the cdpCreator validator address).
 * Multiple CDP creator UTxOs exist on-chain; any one can be used as a factory for opening CDPs.
 */
async function findCdpCreatorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const nftAc = fromSystemParamsAsset(params.cdpCreatorParams.cdpCreatorNft);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.cdpCreatorHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  if (utxos.length === 0) {
    throw new Error('No CDP creator UTxO found');
  }
  return utxos[0];
}

/**
 * Find the governance UTxO (holds govNFT at the gov validator address).
 */
async function findGovUtxo(params: SystemParams, lucid: LucidEvolution) {
  const nftAc = fromSystemParamsAsset(params.govParams.govNFT);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.govHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  if (utxos.length !== 1) {
    throw new Error(`Expected a single governance UTxO, found ${utxos.length}`);
  }
  return utxos[0];
}

/**
 * Find the treasury UTxO at the treasury validator address.
 */
async function findTreasuryUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.treasuryHash);
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No treasury UTxOs found');
  }
  // Return the first treasury UTxO
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
 * The oracle NFT is referenced in the iAsset datum's price field.
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
 * The interest oracle NFT is referenced in the iAsset datum's interestOracleNft field.
 */
async function findInterestOracleUtxo(iAssetDatum: IAssetContent, lucid: LucidEvolution) {
  const nft = iAssetDatum.interestOracleNft;
  const oracleUnit = nft.currencySymbol + nft.tokenName;
  return lucid.utxoByUnit(oracleUnit);
}

export function registerCdpWriteTools(server: McpServer): void {
  server.tool(
    'open_cdp',
    'Open a new CDP position — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      collateralAmount: z.string().describe('Collateral amount in lovelace'),
      mintAmount: z.string().describe('iAsset amount to mint in smallest unit'),
    },
    async ({ address, asset, collateralAmount, mintAmount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [iAssetResult, cdpCreatorUtxo, collectorUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCdpCreatorUtxo(params, lucid),
              findCollectorUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await openCdp(
              BigInt(collateralAmount),
              BigInt(mintAmount),
              params,
              cdpCreatorUtxo,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
          },
          {
            type: 'open_cdp',
            description: `Open ${asset} CDP with ${collateralAmount} lovelace collateral, minting ${mintAmount}`,
            inputs: { address, asset, collateralAmount, mintAmount },
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
              text: `Error building open_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'deposit_cdp',
    'Deposit additional collateral into a CDP — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('Lovelace amount to deposit'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iAssetResult, collectorUtxo, govUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findGovUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await depositCdp(
              BigInt(amount),
              cdpOutRef,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              govUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
          },
          {
            type: 'deposit_cdp',
            description: `Deposit ${amount} lovelace into ${asset} CDP`,
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
              text: `Error building deposit_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'withdraw_cdp',
    'Withdraw collateral from a CDP — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('Lovelace amount to withdraw'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOutRef = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iAssetResult, collectorUtxo, govUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findGovUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await withdrawCdp(
              BigInt(amount),
              cdpOutRef,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              govUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
          },
          {
            type: 'withdraw_cdp',
            description: `Withdraw ${amount} lovelace from ${asset} CDP`,
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
              text: `Error building withdraw_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'close_cdp',
    'Close a CDP and reclaim collateral — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
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

            const [iAssetResult, collectorUtxo, govUtxo, treasuryUtxo] = await Promise.all([
              findIAssetUtxo(asset, params, lucid),
              findCollectorUtxo(params, lucid),
              findGovUtxo(params, lucid),
              findTreasuryUtxo(params, lucid),
            ]);

            const [priceOracleUtxo, interestOracleUtxo] = await Promise.all([
              findPriceOracleUtxo(iAssetResult.datum, lucid),
              findInterestOracleUtxo(iAssetResult.datum, lucid),
            ]);

            const txBuilder = await closeCdp(
              cdpOutRef,
              iAssetResult.utxo,
              priceOracleUtxo,
              interestOracleUtxo,
              collectorUtxo,
              govUtxo,
              treasuryUtxo,
              params,
              lucid,
              currentSlot
            );
            return txBuilder.complete();
          },
          {
            type: 'close_cdp',
            description: `Close ${asset} CDP and reclaim collateral`,
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
              text: `Error building close_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
