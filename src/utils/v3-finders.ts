import type { LucidEvolution, Network, OutRef, UTxO } from '@lucid-evolution/lucid';
import { fromText, toHex } from '@lucid-evolution/lucid';
import type { SystemParams, CollateralAssetOutput, RobDatum } from '@indigo-labs/indigo-sdk';
import {
  createScriptAddress,
  getInlineDatumOrThrow,
  parseRobDatumOrThrow,
  findInterestOracle,
} from '@indigo-labs/indigo-sdk';
import type { AssetClass } from '@indigo-labs/cardano-offchain-common';
import { adaAssetClass, assetClassToUnit } from '@indigo-labs/cardano-offchain-common';

/**
 * v3 on-chain finder helpers.
 *
 * In Indigo v3 the price and interest oracle references no longer live on the
 * iAsset datum — they sit on the per-collateral-asset datum, and prices may be
 * served by Pyth (see `utils/pyth.ts`). The protocol's transaction builders also take {@link OutRef}s
 * rather than full UTxOs. These helpers mirror the canonical query patterns used
 * by the indigo-sdk-v3 acceptance tests.
 */

/** The ADA collateral asset class, the default collateral for legacy tools. */
export const ADA_COLLATERAL: AssetClass = adaAssetClass;

export function toOutRef(utxo: UTxO): OutRef {
  return { txHash: utxo.txHash, outputIndex: utxo.outputIndex };
}

function getNetwork(lucid: LucidEvolution): Network {
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');
  return network;
}

/**
 * Resolve the interest oracle OutRef for a collateral asset. The interest oracle
 * NFT is referenced by the collateral-asset datum.
 */
export async function findInterestOracleOref(
  lucid: LucidEvolution,
  collateralAsset: CollateralAssetOutput
): Promise<OutRef> {
  return findInterestOracle(lucid, collateralAsset.datum.interestOracleNft);
}

/**
 * Resolve the price oracle OutRef for a collateral asset.
 * - `OracleNft`: returns the oracle UTxO's OutRef.
 * - `Delisted`: throws — the asset cannot be used as collateral.
 * - Pyth (`DeferredValidation`): returns `undefined` — the price comes from a
 *   signed Pyth message instead. Use {@link resolvePriceSource} from
 *   `utils/pyth.ts`, which handles both cases.
 */
export async function findPriceOracleOref(
  lucid: LucidEvolution,
  collateralAsset: CollateralAssetOutput
): Promise<OutRef | undefined> {
  const priceInfo = collateralAsset.datum.priceInfo;
  if ('OracleNft' in priceInfo) {
    const utxo = await lucid.utxoByUnit(assetClassToUnit(priceInfo.OracleNft));
    return toOutRef(utxo);
  }
  if ('Delisted' in priceInfo) {
    throw new Error('Collateral asset is delisted; cannot perform this operation');
  }
  // DeferredValidation → Pyth-priced asset.
  return undefined;
}

/** Find all ROB position UTxOs for a given iAsset, paired with their parsed datums. */
export async function findAllRobs(
  lucid: LucidEvolution,
  params: SystemParams,
  assetName: string
): Promise<[UTxO, RobDatum][]> {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.robHash);
  const utxos = await lucid.utxosAt(address);
  const wantHex = fromText(assetName);
  const result: [UTxO, RobDatum][] = [];
  for (const utxo of utxos) {
    try {
      const datum = parseRobDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (toHex(datum.iasset) === wantHex) {
        result.push([utxo, datum]);
      }
    } catch {
      // Skip non-ROB datums.
    }
  }
  return result;
}
