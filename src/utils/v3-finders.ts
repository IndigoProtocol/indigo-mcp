import type { LucidEvolution, Network, OutRef, UTxO } from '@lucid-evolution/lucid';
import { fromText, toHex } from '@lucid-evolution/lucid';
import type {
  SystemParams,
  IAssetOutput,
  CollateralAssetOutput,
  StabilityPoolContent,
  GovDatum,
  RobDatum,
} from '@indigo-labs/indigo-sdk';
import {
  fromSystemParamsAsset,
  createScriptAddress,
  getInlineDatumOrThrow,
  parseIAssetDatumOrThrow,
  parseCollateralAssetDatumOrThrow,
  parseStabilityPoolDatumOrThrow,
  parseGovDatumOrThrow,
  parseRobDatumOrThrow,
  parseSnapshotEpochToScaleToSumDatumOrThrow,
  mkStabilityPoolAddr,
} from '@indigo-labs/indigo-sdk';
import { getIndexerClient } from './indexer-client.js';
import type { AssetClass } from '@3rd-eye-labs/cardano-offchain-common';
import {
  adaAssetClass,
  assetClassToUnit,
  isSameAssetClass,
  assetClassValueOf,
} from '@3rd-eye-labs/cardano-offchain-common';

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
 * Resolve the iAsset state UTxO for a given asset name (e.g. "iUSD").
 * iAsset UTxOs sit at the iAsset validator address and hold the iAsset auth token.
 */
export async function findIAsset(
  lucid: LucidEvolution,
  params: SystemParams,
  assetName: string
): Promise<IAssetOutput> {
  const authAc = fromSystemParamsAsset(params.cdpParams.iAssetAuthToken);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.iassetHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(authAc));
  const wantHex = fromText(assetName);
  for (const utxo of utxos) {
    try {
      const datum = parseIAssetDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (toHex(datum.assetName) === wantHex) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs whose datum is not an iAsset datum.
    }
  }
  throw new Error(`iAsset UTxO for ${assetName} not found`);
}

/**
 * Resolve the collateral-asset state UTxO for an (iAsset, collateral) pair.
 * Carries the price oracle reference (priceInfo), the interest oracle NFT, and
 * the collateral's extra decimals.
 */
export async function findCollateralAsset(
  lucid: LucidEvolution,
  params: SystemParams,
  assetName: string,
  collateralAsset: AssetClass = ADA_COLLATERAL
): Promise<CollateralAssetOutput> {
  const authAc = fromSystemParamsAsset(params.cdpParams.collateralAssetAuthToken);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.iassetHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(authAc));
  const wantHex = fromText(assetName);
  for (const utxo of utxos) {
    try {
      const datum = parseCollateralAssetDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (
        isSameAssetClass(datum.collateralAsset, collateralAsset) &&
        toHex(datum.iasset) === wantHex
      ) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs whose datum is not a collateral-asset datum.
    }
  }
  throw new Error(`Collateral-asset UTxO for ${assetName} not found`);
}

/**
 * Resolve the interest oracle OutRef for a collateral asset. The interest oracle
 * NFT is referenced by the collateral-asset datum.
 */
export async function findInterestOracleOref(
  lucid: LucidEvolution,
  collateralAsset: CollateralAssetOutput
): Promise<OutRef> {
  const utxo = await lucid.utxoByUnit(assetClassToUnit(collateralAsset.datum.interestOracleNft));
  return toOutRef(utxo);
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

/** Find a CDP creator OutRef (factory UTxO used when opening a CDP). */
export async function findCdpCreatorOref(
  lucid: LucidEvolution,
  params: SystemParams
): Promise<OutRef> {
  const nftAc = fromSystemParamsAsset(params.cdpCreatorParams.cdpCreatorNft);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.cdpCreatorHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  if (utxos.length === 0) throw new Error('No CDP creator UTxO found');
  return toOutRef(utxos[0]);
}

/**
 * Find a non-admin interest collector OutRef. Admin collectors (holding the
 * multisig UTxO NFT) are excluded.
 */
export async function findInterestCollectorOref(
  lucid: LucidEvolution,
  params: SystemParams
): Promise<OutRef> {
  const multisigNft = fromSystemParamsAsset(params.interestCollectionParams.multisigUtxoNft);
  const address = createScriptAddress(
    getNetwork(lucid),
    params.validatorHashes.interestCollectionHash
  );
  const utxos = await lucid.utxosAt(address);
  const nonAdmin = utxos.filter((utxo) => assetClassValueOf(utxo.assets, multisigNft) === 0n);
  if (nonAdmin.length === 0) throw new Error('No non-admin interest collector UTxO found');
  return toOutRef(nonAdmin[0]);
}

/**
 * Find a treasury OutRef holding only ADA, suitable as a fee-collecting input.
 * Returns `undefined` when no ADA-only treasury UTxO is available.
 *
 * In practice this returns `undefined` on mainnet: treasury UTxOs carry the
 * collected iAssets, and they live at the treasury address *with* its staking
 * credential rather than the enterprise address built here. That is deliberate
 * for the CDP tools — `undefined` selects the SDK's direct-payment branch, which
 * pays the fee into a fresh treasury output and is verified working for every
 * iAsset. Do not "fix" this into returning an oref without re-testing every CDP
 * write tool: spending the treasury is a different code path, and the treasury
 * validator rejects an input that would gain a new asset class.
 *
 * {@link findTreasuryOrefForAsset} is the resolver for the paths that genuinely
 * need to spend the treasury.
 */
export async function findTreasuryOref(
  lucid: LucidEvolution,
  params: SystemParams
): Promise<OutRef | undefined> {
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.treasuryHash);
  const utxos = await lucid.utxosAt(address);
  const adaOnly = utxos.find(
    (utxo) => Object.keys(utxo.assets).length === 1 && utxo.assets.lovelace !== undefined
  );
  return adaOnly ? toOutRef(adaOnly) : undefined;
}

/**
 * Find a treasury OutRef able to receive a fee in `iassetUnit`.
 *
 * Resolved through the indexer for the same reason as {@link findAllRobs}: the
 * live treasury UTxOs sit at the treasury address with its staking credential,
 * not the enterprise address.
 *
 * The treasury validator caps the continuing output at two asset classes
 * ("Too many asset classes"), so a candidate only works if it already holds the
 * iAsset alongside lovelace, or holds lovelace alone. That is what the ADA-only
 * filter in {@link findTreasuryOref} was reaching for — the rule is right, it
 * was just looking at the wrong address.
 *
 * Returns `undefined` when nothing qualifies, letting the caller decide whether
 * that is fatal.
 */
export async function findTreasuryOrefForAsset(
  lucid: LucidEvolution,
  iassetUnit: string
): Promise<OutRef | undefined> {
  // Ask the indexer for a single treasury UTxO purely to learn the address it
  // sits at — the staking credential is not derivable from system params — then
  // read the whole set from the chain. Resolving all ~350 orefs individually
  // would be far more provider traffic for the same answer.
  const client = getIndexerClient();
  const response = await client.post('/v3/treasury/utxos', { length: 1 });
  const entries = response.data as Array<{ outputHash: string; outputIndex: number }>;
  if (entries.length === 0) return undefined;

  const seed = await lucid.utxosByOutRef([
    { txHash: entries[0].outputHash, outputIndex: entries[0].outputIndex },
  ]);
  if (seed.length === 0) return undefined;

  const utxos = await lucid.utxosAt(seed[0].address);
  const candidates = utxos.filter((utxo) => {
    const units = new Set(Object.keys(utxo.assets));
    units.add(iassetUnit);
    return units.size <= 2;
  });
  // Prefer one that already holds the iAsset: it is the shape every treasury
  // spend on-chain uses, and it leaves the output's min-ADA untouched.
  candidates.sort((a, b) => Number((b.assets[iassetUnit] ?? 0n) - (a.assets[iassetUnit] ?? 0n)));

  return candidates.length > 0 ? toOutRef(candidates[0]) : undefined;
}

/** Find the stability pool state UTxO for a given iAsset. */
export async function findStabilityPool(
  lucid: LucidEvolution,
  params: SystemParams,
  assetName: string
): Promise<{ utxo: UTxO; datum: StabilityPoolContent }> {
  const spToken = fromSystemParamsAsset(params.stabilityPoolParams.stabilityPoolToken);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.stabilityPoolHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(spToken));
  const wantHex = fromText(assetName);
  for (const utxo of utxos) {
    try {
      const datum = parseStabilityPoolDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (toHex(datum.iasset) === wantHex) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs that are not stability pool state datums.
    }
  }
  throw new Error(`Stability pool UTxO for ${assetName} not found`);
}

/** Find the governance state UTxO (holds the gov NFT). */
export async function findGov(
  lucid: LucidEvolution,
  params: SystemParams
): Promise<{ utxo: UTxO; datum: GovDatum }> {
  const govNft = fromSystemParamsAsset(params.govParams.govNFT);
  const address = createScriptAddress(getNetwork(lucid), params.validatorHashes.govHash);
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(govNft));
  for (const utxo of utxos) {
    try {
      const datum = parseGovDatumOrThrow(getInlineDatumOrThrow(utxo));
      return { utxo, datum };
    } catch {
      // Skip non-gov datums.
    }
  }
  throw new Error('Governance UTxO not found');
}

/**
 * Find all ROB position UTxOs for a given iAsset, paired with their parsed datums.
 *
 * Resolved through the indexer rather than by scanning a script address. ROB
 * positions carry the owner's staking credential, so they are spread across as
 * many addresses as there are owners, and they hold no auth token to look them
 * up by — an address scan finds nothing.
 */
export async function findAllRobs(
  lucid: LucidEvolution,
  _params: SystemParams,
  assetName: string
): Promise<[UTxO, RobDatum][]> {
  const client = getIndexerClient();
  const response = await client.get('/v3/order-book');
  const entries = response.data as Array<{
    iasset: string;
    outputHash: string;
    outputIndex: number;
  }>;

  const orefs = entries
    .filter((entry) => entry.iasset === assetName)
    .map((entry) => ({ txHash: entry.outputHash, outputIndex: entry.outputIndex }));
  if (orefs.length === 0) return [];

  const utxos = await lucid.utxosByOutRef(orefs);
  const result: [UTxO, RobDatum][] = [];
  for (const utxo of utxos) {
    try {
      result.push([utxo, parseRobDatumOrThrow(getInlineDatumOrThrow(utxo))]);
    } catch {
      // Skip anything the indexer listed that no longer parses as a ROB datum.
    }
  }
  return result;
}

/** Find the epoch-to-scale-to-sum snapshot OutRefs for a given iAsset's stability pool. */
export async function findE2s2sSnapshotOrefs(
  lucid: LucidEvolution,
  params: SystemParams,
  assetName: string
): Promise<OutRef[]> {
  const snapshotToken = fromSystemParamsAsset(
    params.stabilityPoolParams.snapshotEpochToScaleToSumToken
  );
  const utxos = await lucid.utxosAtWithUnit(
    mkStabilityPoolAddr(lucid, params),
    assetClassToUnit(snapshotToken)
  );
  const wantHex = fromText(assetName);
  const orefs: OutRef[] = [];
  for (const utxo of utxos) {
    try {
      const datum = parseSnapshotEpochToScaleToSumDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (toHex(datum.iasset) === wantHex) {
        orefs.push(toOutRef(utxo));
      }
    } catch {
      // Skip non-snapshot datums.
    }
  }
  return orefs;
}
