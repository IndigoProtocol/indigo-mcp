import type { LucidEvolution, OutRef } from '@lucid-evolution/lucid';
import type { CollateralAssetOutput } from '@indigo-labs/indigo-sdk';
import type { PythPricingSummary } from '../types/tx-types.js';
import { getIndexerClient } from './indexer-client.js';
import { findPriceOracleOref } from './v3-finders.js';

/**
 * Pyth pricing support.
 *
 * In Indigo v3 most iAssets are priced via Pyth (`DeferredValidation` on the
 * collateral-asset datum) rather than by an on-chain oracle NFT. Those
 * transactions carry a signed Pyth price message plus a reference to the Pyth
 * state UTxO; the SDK builders accept both as trailing arguments.
 *
 * Neither value can be derived from the chain alone — the signed message comes
 * from Pyth Lazer and is served, already signed and in the Solana wire format
 * the on-chain feed validator expects, by the Indigo analytics API.
 */

/** Default collateral used in the analytics price path. */
export const DEFAULT_COLLATERAL = 'ada';

/**
 * Window the on-chain Pyth feed validator allows between the price timestamp
 * and the transaction validity upper bound. Mirrors `pythMaxDelay` in the SDK's
 * `attachOracle`: a transaction built from an older payload cannot be submitted.
 */
export const PYTH_MAX_DELAY_MS = 280 * 1_000;

/** Raw shape returned by `GET /v3/assets/{iasset}/{collateral}/price`. */
interface PythPriceResponse {
  price: string;
  /** Milliseconds since epoch. */
  expiration: number;
  /** Seconds since epoch. */
  timestamp: number;
  /** Hex-encoded, signed Solana-format Pyth message. */
  pythPayload: string;
}

/** Raw shape returned by `GET /v3/pyth-state/utxo`. */
interface PythStateUtxoResponse {
  outputHash: string;
  outputIndex: number;
}

export interface PythPriceFeed {
  /** Decimal price of the iAsset in the collateral asset. */
  price: string;
  /** Signed Pyth message (hex) to pass to the SDK builders as `pythMessage`. */
  pythMessage: string;
  /** Price timestamp in milliseconds since epoch. */
  timestampMs: number;
  /** Latest time the resulting transaction may be submitted, ms since epoch. */
  validUntilMs: number;
}

/**
 * A resolved price source for a transaction. Exactly one of `priceOracleOref`
 * (oracle-NFT assets) and `pythMessage`/`pythStateOref` (Pyth assets) is set —
 * the SDK builders reject being handed both.
 */
export interface PriceSource {
  priceOracleOref: OutRef | undefined;
  pythMessage: string | undefined;
  pythStateOref: OutRef | undefined;
  /** Present for Pyth-priced assets: the price the transaction was built at. */
  pythFeed: PythPriceFeed | undefined;
}

/**
 * Fetch the current signed Pyth message and price for an (iAsset, collateral)
 * pair from the analytics API.
 */
export async function fetchPythPriceFeed(
  asset: string,
  collateral: string = DEFAULT_COLLATERAL
): Promise<PythPriceFeed> {
  const client = getIndexerClient();
  const path = `/v3/assets/${encodeURIComponent(asset)}/${encodeURIComponent(collateral)}/price`;

  const response = await client.get<PythPriceResponse>(path);
  const { price, timestamp, pythPayload } = response.data ?? {};

  if (!pythPayload) {
    throw new Error(
      `No Pyth payload returned for ${asset}/${collateral} by the Indigo analytics API. ` +
        'The asset may not be priced via Pyth, or the feed is temporarily unavailable.'
    );
  }

  const timestampMs = timestamp * 1_000;

  return {
    price,
    pythMessage: pythPayload,
    timestampMs,
    validUntilMs: timestampMs + PYTH_MAX_DELAY_MS,
  };
}

/**
 * Reject a price update that is already outside the on-chain validity window —
 * a transaction built from it could never be submitted, so failing here gives a
 * far clearer error than a rejected submission would.
 */
export function assertPythFeedFresh(
  feed: PythPriceFeed,
  asset: string,
  collateral: string = DEFAULT_COLLATERAL
): void {
  const ageMs = Date.now() - feed.timestampMs;
  if (ageMs <= PYTH_MAX_DELAY_MS) return;

  throw new Error(
    `The Pyth price message for ${asset}/${collateral} is ${Math.round(ageMs / 1_000)}s old, ` +
      `beyond the ${PYTH_MAX_DELAY_MS / 1_000}s on-chain validity window. ` +
      'Retry to pick up a fresher price update.'
  );
}

/**
 * Fetch the OutRef of the current Pyth state UTxO, referenced by every
 * Pyth-priced transaction.
 */
export async function fetchPythStateOref(): Promise<OutRef> {
  const client = getIndexerClient();
  const response = await client.get<PythStateUtxoResponse>('/v3/pyth-state/utxo');
  const { outputHash, outputIndex } = response.data ?? {};

  if (!outputHash || outputIndex === undefined || outputIndex === null) {
    throw new Error('The Indigo analytics API did not return a Pyth state UTxO');
  }

  return { txHash: outputHash, outputIndex };
}

/**
 * Resolve everything a transaction builder needs to price an (iAsset,
 * collateral) pair, whichever oracle the asset uses.
 *
 * - `OracleNft` → the oracle UTxO's OutRef.
 * - Pyth (`DeferredValidation`) → a freshly fetched signed message plus the
 *   Pyth state OutRef.
 * - `Delisted` → throws (via {@link findPriceOracleOref}).
 */
export async function resolvePriceSource(
  lucid: LucidEvolution,
  collateralAsset: CollateralAssetOutput,
  asset: string,
  collateral: string = DEFAULT_COLLATERAL
): Promise<PriceSource> {
  const priceOracleOref = await findPriceOracleOref(lucid, collateralAsset);

  if (priceOracleOref !== undefined) {
    return {
      priceOracleOref,
      pythMessage: undefined,
      pythStateOref: undefined,
      pythFeed: undefined,
    };
  }

  const [pythFeed, pythStateOref] = await Promise.all([
    fetchPythPriceFeed(asset, collateral),
    fetchPythStateOref(),
  ]);
  assertPythFeedFresh(pythFeed, asset, collateral);

  return {
    priceOracleOref: undefined,
    pythMessage: pythFeed.pythMessage,
    pythStateOref,
    pythFeed,
  };
}

/**
 * Summarise the Pyth price a transaction was built at, so a caller signing on a
 * hardware wallet knows how long it has to submit. `undefined` for oracle-NFT
 * priced assets.
 */
export function pythSummary(source: PriceSource): PythPricingSummary | undefined {
  if (!source.pythFeed) return undefined;
  return {
    price: source.pythFeed.price,
    priceTimestamp: new Date(source.pythFeed.timestampMs).toISOString(),
    submitBefore: new Date(source.pythFeed.validUntilMs).toISOString(),
  };
}
