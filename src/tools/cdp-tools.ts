import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { calculateAccruedInterest } from '@indigo-labs/indigo-sdk';
import type { InterestOracleDatum } from '@indigo-labs/indigo-sdk';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';
import { extractPaymentCredential } from '../utils/address.js';

// v3 CDP as returned by the indexer.
//
// The indexer exposes CDPs via GET /cdps/ (the legacy /loans/ path is gone in
// v3). The v3 shape replaces the old `minted` field with `mintedAmt` and adds
// the per-CDP interest-tracking snapshot used by calculateAccruedInterest.
interface CdpRecord {
  owner: string;
  asset: string;
  // ADA collateral in lovelace (value held by the UTxO).
  collateral: number;
  // Amount of iAsset minted, in the asset's smallest unit.
  mintedAmt: number;
  // Minimum collateral ratio required (percentage, e.g. 150 = 150 %).
  minRatio: number;
  // v3 interest-tracking snapshot — present on active (non-frozen) CDPs.
  interestTracking?: {
    // POSIX ms at which the CDP's interest was last settled on-chain.
    lastSettled: string | number;
    // Accumulated unitary interest captured when the CDP was last touched.
    unitaryInterestSnapshot: string | number;
  };
  [key: string]: unknown;
}

// Asset state as returned by the indexer GET /assets/.
interface AssetRecord {
  name: string;
  price: {
    // Current ADA price per 1 iAsset (human-readable float).
    price: number;
    [key: string]: unknown;
  };
  // v3 shape exposes these at the top level (not nested under `interest`).
  maintenanceRatio?: number;
  liquidationRatio?: number;
  // Legacy v2 shape — kept for robustness during the indexer migration.
  interest?: {
    ratio: number;
    minRatio: number;
    liquidation: number;
    [key: string]: unknown;
  };
  // v3 interest oracle datum cached by the indexer — used by analyze_cdp_health.
  interestOracle?: {
    unitaryInterest: string | number;
    interestRate: string | number;
    lastUpdated: string | number;
  };
  [key: string]: unknown;
}

// Resolve the maintenance and liquidation ratios from whichever shape the
// indexer returns.  v3 puts them at the top level; v2 nested them under
// `interest`.
function resolveRatios(asset: AssetRecord): {
  maintenanceRatio: number;
  liquidationRatio: number;
} {
  const maintenanceRatio = asset.maintenanceRatio ?? asset.interest?.minRatio ?? 150;
  const liquidationRatio = asset.liquidationRatio ?? asset.interest?.liquidation ?? 110;
  return { maintenanceRatio, liquidationRatio };
}

// Fetch CDPs from the indexer.  Tries the v3 /cdps/ endpoint first and falls
// back to the legacy /loans/ endpoint so the tools degrade gracefully if the
// indexer has not yet migrated to v3.
async function fetchCdps(): Promise<CdpRecord[]> {
  const client = getIndexerClient();
  try {
    const res = await client.get('/cdps/');
    return res.data as CdpRecord[];
  } catch {
    const res = await client.get('/loans/');
    // Normalise legacy shape: rename `minted` → `mintedAmt` so the rest of
    // the code only has to deal with one field name.
    const raw = res.data as Array<Record<string, unknown>>;
    return raw.map((r) => ({
      ...r,
      mintedAmt: (r.mintedAmt ?? r.minted ?? 0) as number,
    })) as CdpRecord[];
  }
}

export function registerCdpTools(server: McpServer): void {
  server.tool(
    'get_all_cdps',
    'Get all CDPs/loans, optionally filtered by iAsset',
    {
      asset: AssetParam.optional(),
      limit: z.number().min(1).max(500).default(50).optional(),
      offset: z.number().min(0).default(0).optional(),
    },
    async ({ asset, limit, offset }) => {
      try {
        let cdps = await fetchCdps();
        if (asset) {
          cdps = cdps.filter((c) => c.asset === asset);
        }
        const total = cdps.length;
        const effectiveLimit = limit ?? 50;
        const effectiveOffset = offset ?? 0;
        const paginated = cdps.slice(effectiveOffset, effectiveOffset + effectiveLimit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { cdps: paginated, total, limit: effectiveLimit, offset: effectiveOffset },
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
              text: `Error fetching CDPs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_cdps_by_owner',
    'Get all CDPs/loans for a specific owner (accepts payment key hash or bech32 address)',
    { owner: z.string().describe('Owner payment key hash (56-char hex) or bech32 address') },
    async ({ owner }) => {
      try {
        const pkh = extractPaymentCredential(owner);
        const cdps = (await fetchCdps()).filter((c) => c.owner === pkh);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(cdps, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching CDPs by owner: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_cdps_by_address',
    'Get all CDPs/loans for a specific Cardano address',
    {
      address: z.string().describe('Cardano bech32 address (addr1... or addr_test1...)'),
    },
    async ({ address }) => {
      try {
        const pkh = extractPaymentCredential(address);
        const cdps = (await fetchCdps()).filter((c) => c.owner === pkh);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(cdps, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching CDPs by address: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'analyze_cdp_health',
    'Analyze health and collateral ratios of CDPs for an owner, accounting for accrued interest',
    { owner: z.string().describe('Owner payment key hash (56-char hex) or bech32 address') },
    async ({ owner }) => {
      try {
        const pkh = extractPaymentCredential(owner);
        const client = getIndexerClient();

        const [allCdps, assetsRes] = await Promise.all([fetchCdps(), client.get('/assets/')]);

        const assets = assetsRes.data as AssetRecord[];
        const cdps = allCdps.filter((c) => c.owner === pkh);

        if (cdps.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { message: 'No CDPs found for this owner', owner: pkh },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const assetMap = new Map(assets.map((a) => [a.name, a]));
        const nowMs = BigInt(Date.now());

        const analysis = cdps.map((cdp) => {
          const assetInfo = assetMap.get(cdp.asset);
          if (!assetInfo) {
            return { ...cdp, error: `Asset ${cdp.asset} not found` };
          }

          const collateralLovelace = BigInt(Math.round(cdp.collateral));
          const mintedUnits = BigInt(Math.round(cdp.mintedAmt));
          const priceAda = assetInfo.price.price;
          const { maintenanceRatio, liquidationRatio } = resolveRatios(assetInfo);

          // Compute accrued interest when the indexer provides the v3 interest
          // oracle snapshot alongside the CDP's interest-tracking fields.
          let accruedInterestLovelace = 0n;
          let effectiveMintedUnits = mintedUnits;

          const tracking = cdp.interestTracking;
          const oracle = assetInfo.interestOracle;

          if (tracking && oracle) {
            try {
              const interestOracleDatum: InterestOracleDatum = {
                unitaryInterest: BigInt(oracle.unitaryInterest),
                interestRate: { getOnChainInt: BigInt(oracle.interestRate) },
                lastUpdated: BigInt(oracle.lastUpdated),
              };
              accruedInterestLovelace = calculateAccruedInterest(
                nowMs,
                BigInt(tracking.unitaryInterestSnapshot),
                mintedUnits,
                BigInt(tracking.lastSettled),
                interestOracleDatum
              );
              // Effective debt = minted amount + accrued interest expressed as
              // iAsset units (accrued interest is returned in lovelace so we
              // convert back using the price: interest_iasset = interest_ada / price_ada).
              if (priceAda > 0) {
                const accruedUnits = BigInt(
                  Math.round((Number(accruedInterestLovelace) / 1e6 / priceAda) * 1e6)
                );
                effectiveMintedUnits = mintedUnits + accruedUnits;
              }
            } catch {
              // If the oracle data is malformed, fall back to the raw minted amount.
            }
          }

          const collateralAda = Number(collateralLovelace) / 1e6;
          const effectiveMintedTokens = Number(effectiveMintedUnits) / 1e6;
          const collateralRatio =
            effectiveMintedTokens > 0 && priceAda > 0
              ? (collateralAda / (effectiveMintedTokens * priceAda)) * 100
              : 0;

          let status: string;
          if (collateralRatio >= maintenanceRatio * 1.5) {
            status = 'safe';
          } else if (collateralRatio >= maintenanceRatio) {
            status = 'warning';
          } else if (collateralRatio >= liquidationRatio) {
            status = 'at-risk';
          } else {
            status = 'liquidatable';
          }

          return {
            asset: cdp.asset,
            collateralAda,
            mintedTokens: Number(mintedUnits) / 1e6,
            effectiveMintedTokens,
            accruedInterestLovelace: Number(accruedInterestLovelace),
            priceAda,
            collateralRatio: Math.round(collateralRatio * 100) / 100,
            maintenanceRatio,
            liquidationRatio,
            status,
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ owner: pkh, cdps: analysis }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error analyzing CDP health: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
