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
import { fetchPythPriceFeed, PYTH_MAX_DELAY_MS } from '../utils/pyth.js';
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
    'Get the current Pyth price for an iAsset, together with its on-chain feed configuration. ' +
      'The price is the latest signed Pyth update served by the Indigo analytics API — the same ' +
      'payload the CDP write tools embed on-chain — and is only valid on-chain until validUntil.',
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

            return feedPriceOracleTx(lucid, oracleOref, newPrice, oracleParams);
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
 * Shared implementation for Pyth price lookup.
 *
 * The live price is not readable from the on-chain Pyth state datum — that
 * holds governance / trusted-signer configuration only. The current signed
 * price update comes from the Indigo analytics API, which serves the same
 * payload the transaction builders embed on-chain; the feed config and Pyth
 * state datum are read from the chain alongside it for context.
 */
async function getPythPriceForAsset(asset: string): Promise<Record<string, unknown>> {
  const lucid = await getLucid();
  const params = await getSystemParams();
  const pythConfig = params.pythConfig;

  // Live price update, straight from the feed the tx builders use.
  let livePrice: Record<string, unknown> | undefined;
  try {
    const feed = await fetchPythPriceFeed(asset);
    livePrice = {
      price: feed.price,
      priceTimestamp: new Date(feed.timestampMs).toISOString(),
      validUntil: new Date(feed.validUntilMs).toISOString(),
      stale: Date.now() > feed.validUntilMs,
    };
  } catch (error) {
    // Non-fatal: still return the on-chain feed configuration below.
    livePrice = {
      error: `Could not fetch the live Pyth price: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Resolve iasset bytes for getPythFeedConfig key lookup.
  const iassetBytes = fromText(asset);
  const iassetUint8 = Buffer.from(iassetBytes, 'hex');

  // ADA collateral is the default; getPythFeedConfig needs a collateral AssetClass.
  let feedConfig;
  try {
    feedConfig = getPythFeedConfig(pythConfig, iassetUint8, ADA_COLLATERAL);
  } catch {
    return {
      ...livePrice,
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
    ...livePrice,
    feedConfig: {
      pythFeedValHash: feedConfig.pythFeedValHash,
      feedParams: feedConfig.params,
    },
    pythState: pythStateDatum,
    note:
      'The price is the latest signed Pyth update served by the Indigo analytics API — the same ' +
      'payload the write tools embed on-chain. It is only valid on-chain until validUntil ' +
      `(${PYTH_MAX_DELAY_MS / 1_000}s after priceTimestamp); the on-chain Pyth state datum itself ` +
      'carries governance and trusted-signer configuration, not price values.',
  };
}
