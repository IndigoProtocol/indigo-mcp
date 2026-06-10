import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Rational } from '@indigo-labs/indigo-sdk';
import {
  parsePriceOracleDatum,
  parsePythStateDatum,
  getPythFeedConfig,
  feedPriceOracleTx,
  getInlineDatumOrThrow,
  fromSystemParamsAsset,
} from '@indigo-labs/indigo-sdk';
import { assetClassToUnit } from '@3rd-eye-labs/cardano-offchain-common';
import { fromText } from '@lucid-evolution/lucid';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import { ADA_COLLATERAL, findCollateralAsset, findPriceOracleOref } from '../utils/v3-finders.js';
import { getLucid } from '../utils/lucid-provider.js';

export function registerOracleTools(server: McpServer): void {
  server.tool(
    'get_oracle_price',
    'Get the on-chain price for an iAsset from its price oracle. ' +
      'Handles OracleNft (reads the oracle UTxO datum), Delisted (returns the delisted price), ' +
      'and Pyth/DeferredValidation (delegates to get_pyth_price).',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const lucid = await getLucid();
        const params = await getSystemParams();

        const collateralOut = await findCollateralAsset(lucid, params, asset);
        const priceInfo = collateralOut.datum.priceInfo;

        if ('Delisted' in priceInfo) {
          const { numerator, denominator } = priceInfo.Delisted.price;
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    asset,
                    source: 'Delisted',
                    price: { numerator: numerator.toString(), denominator: denominator.toString() },
                    priceFloat: Number(numerator) / Number(denominator),
                    note: 'Asset is delisted; price is fixed at the delisting value.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if ('OracleNft' in priceInfo) {
          const oracleUtxo = await lucid.utxoByUnit(assetClassToUnit(priceInfo.OracleNft));
          const datum = parsePriceOracleDatum(getInlineDatumOrThrow(oracleUtxo));
          const { numerator, denominator } = datum.price;
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    asset,
                    source: 'OracleNft',
                    price: { numerator: numerator.toString(), denominator: denominator.toString() },
                    priceFloat: Number(numerator) / Number(denominator),
                    expirationTime: datum.expirationTime.toString(),
                    oracleUtxo: { txHash: oracleUtxo.txHash, outputIndex: oracleUtxo.outputIndex },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // DeferredValidation → Pyth-priced asset.
        // Delegate to the get_pyth_price best-effort read.
        const pythResult = await getPythPriceForAsset(asset);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { asset, source: 'DeferredValidation (Pyth)', ...pythResult },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching oracle price for ${asset}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_pyth_price',
    'Best-effort read of the Pyth price feed config for an iAsset. ' +
      'Reads the on-chain Pyth state UTxO and returns feed configuration derived from system params. ' +
      'NOTE: Pyth price values are not readable from the on-chain Pyth state datum alone — ' +
      'the actual latest price must be fetched from the Pyth Lazer off-chain API and pushed ' +
      'on-chain via a signed PythMessage. This tool surfaces the feed config so callers can ' +
      'identify the correct Pyth feed ID to query externally.',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const result = await getPythPriceForAsset(asset);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ asset, ...result }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching Pyth price info for ${asset}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'feed_price_oracle',
    'Feed a new price to an OracleNft-backed price oracle — builds an unsigned transaction (CBOR hex) for admin signing. ' +
      'Only applicable to assets whose priceInfo is OracleNft; Pyth-priced assets are updated via signed Pyth messages, ' +
      'not this tool.',
    {
      address: z.string().describe('Admin Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      priceNumerator: z.string().describe('New price numerator (integer string)'),
      priceDenominator: z.string().describe('New price denominator (integer string)'),
    },
    async ({ address, asset, priceNumerator, priceDenominator }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const collateralOut = await findCollateralAsset(lucid, params, asset);

            // Only OracleNft-backed assets can be fed via this tool.
            if ('Delisted' in collateralOut.datum.priceInfo) {
              throw new Error(`${asset} is delisted; price cannot be updated.`);
            }
            if ('DeferredValidation' in collateralOut.datum.priceInfo) {
              throw new Error(
                `${asset} uses Pyth (DeferredValidation) for price; use a signed Pyth message instead.`
              );
            }

            const oracleOref = await findPriceOracleOref(lucid, collateralOut);
            if (oracleOref === undefined) {
              throw new Error(`Could not resolve price oracle UTxO for ${asset}.`);
            }

            // PriceOracleParams lives on the system params per-iAsset level.
            // In v3 the oracleParams are stored in CollateralAssetInfo (AssetInfo),
            // which is a derivation-time type not shipped on-chain.  The write-side
            // params (owner, biasTime, expirationPeriod) must be sourced from the
            // operator's configuration.  This tool accepts them via env vars:
            //   ORACLE_OWNER_PKH, ORACLE_BIAS_TIME_MS, ORACLE_EXPIRATION_PERIOD_MS
            const ownerPkh = process.env.ORACLE_OWNER_PKH;
            const biasTimeMs = process.env.ORACLE_BIAS_TIME_MS;
            const expirationPeriodMs = process.env.ORACLE_EXPIRATION_PERIOD_MS;

            if (!ownerPkh || !biasTimeMs || !expirationPeriodMs) {
              throw new Error(
                'Oracle admin params not configured. Set ORACLE_OWNER_PKH, ' +
                  'ORACLE_BIAS_TIME_MS, and ORACLE_EXPIRATION_PERIOD_MS environment variables.'
              );
            }

            const oracleParams = {
              owner: ownerPkh,
              biasTime: BigInt(biasTimeMs),
              expirationPeriod: BigInt(expirationPeriodMs),
            };

            const newPrice: Rational = {
              numerator: BigInt(priceNumerator),
              denominator: BigInt(priceDenominator),
            };

            return feedPriceOracleTx(lucid, oracleOref, newPrice, oracleParams, currentSlot);
          },
          {
            type: 'feed_price_oracle',
            description: `Feed price ${priceNumerator}/${priceDenominator} to ${asset} oracle`,
            inputs: { address, asset, priceNumerator, priceDenominator },
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
              text: `Error building feed_price_oracle transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Shared implementation for Pyth price info lookup. Reads the Pyth state UTxO
 * from the chain (via the pythStateAssetClass in system params) and returns
 * the feed config for the asset.
 *
 * Limitation: the on-chain Pyth state datum holds governance / trusted-signer
 * configuration, not the latest price values. The live price must be fetched
 * from the Pyth Lazer off-chain API (identified by the feedId returned here).
 */
async function getPythPriceForAsset(asset: string): Promise<Record<string, unknown>> {
  const lucid = await getLucid();
  const params = await getSystemParams();
  const pythConfig = params.pythConfig;

  // Resolve iasset bytes for getPythFeedConfig key lookup.
  const iassetBytes = fromText(asset);
  const iassetUint8 = Buffer.from(iassetBytes, 'hex');

  // ADA collateral is the default; getPythFeedConfig needs a collateral AssetClass.
  let feedConfig;
  try {
    feedConfig = getPythFeedConfig(pythConfig, iassetUint8, ADA_COLLATERAL);
  } catch {
    return {
      note: `No Pyth feed config found for ${asset}. The asset may not be priced via Pyth, or the key lookup failed.`,
      pythStateAssetClass: pythConfig.pythStateAssetClass,
    };
  }

  // Load the Pyth state UTxO to surface governance / signer config.
  const pythStateUnit = assetClassToUnit(fromSystemParamsAsset(pythConfig.pythStateAssetClass));
  let pythStateDatum: Record<string, unknown> | undefined;
  try {
    const pythStateUtxo = await lucid.utxoByUnit(pythStateUnit);
    const datum = parsePythStateDatum(getInlineDatumOrThrow(pythStateUtxo));
    pythStateDatum = {
      trustedSignersCount: datum.trustedSigners.size,
      withdrawScript: Buffer.from(datum.withdraw_script).toString('hex'),
    };
  } catch {
    // Non-fatal: if the Pyth state UTxO is not queryable, still return feed config.
    pythStateDatum = undefined;
  }

  return {
    feedConfig: {
      pythFeedValHash: feedConfig.pythFeedValHash,
      feedParams: feedConfig.params,
    },
    pythState: pythStateDatum,
    note:
      'Live Pyth price values are not stored in the on-chain state datum. ' +
      'To read the latest price, query the Pyth Lazer API using the feedId in feedParams.config ' +
      'and push the signed PythMessage on-chain via the Pyth feed validator.',
  };
}
