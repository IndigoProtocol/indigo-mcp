import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';
import { extractPaymentCredential } from '../utils/address.js';

// All iAssets and ADA use 6 decimals on-chain.
const DECIMALS = 1e6;

// Raw CDP record as returned by the v3 indexer (GET /cdps).
interface RawCdp {
  output_hash: string;
  output_index: number;
  owner: string;
  asset: string;
  // Hex `policy.tokenName` of the collateral asset; empty string = ADA.
  collateral_asset: string;
  collateralAmount: number;
  mintedAmount: number;
  // Accrued interest already expressed in iAsset smallest units (null when freshly settled).
  interest_iasset_amount: number | null;
  interest_last_updated: number | null;
  active_interest_tracking_unitary_interest_snapshot: string | null;
  active_interest_tracking_last_settled: number | null;
  [key: string]: unknown;
}

// Normalised CDP shape returned by the read tools.
interface Cdp {
  txHash: string;
  outputIndex: number;
  owner: string;
  asset: string;
  collateralAsset: string;
  collateralAmount: number;
  mintedAmount: number;
  accruedInterestIAsset: number;
  interestLastUpdated: number | null;
  frozen: boolean;
}

// Raw asset state from the v3 indexer (GET /assets). Ratio fields are
// percentages and may be null while the indexer backfills them post-v3.
interface RawAsset {
  asset: string;
  maintenance_ratio_percentage: number | null;
  liquidation_ratio_percentage: number | null;
  [key: string]: unknown;
}

// Price entry from the v3 indexer (GET /asset-prices): the iAsset price
// denominated in `collateral_asset` (empty string = ADA).
interface RawAssetPrice {
  asset: string;
  collateral_asset: string;
  price: string;
  [key: string]: unknown;
}

function normaliseCdp(r: RawCdp): Cdp {
  return {
    txHash: r.output_hash,
    outputIndex: r.output_index,
    owner: r.owner,
    asset: r.asset,
    collateralAsset: r.collateral_asset ?? '',
    collateralAmount: Number(r.collateralAmount ?? 0),
    mintedAmount: Number(r.mintedAmount ?? 0),
    accruedInterestIAsset: Number(r.interest_iasset_amount ?? 0),
    interestLastUpdated: r.interest_last_updated ?? null,
    frozen: r.active_interest_tracking_last_settled == null,
  };
}

async function fetchCdps(): Promise<Cdp[]> {
  const client = getIndexerClient();
  const res = await client.get('/cdps');
  return (res.data as RawCdp[]).map(normaliseCdp);
}

export function registerCdpTools(server: McpServer): void {
  server.tool(
    'get_all_cdps',
    'Get all CDPs, optionally filtered by iAsset',
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
    'Get all CDPs for a specific owner (accepts payment key hash or bech32 address)',
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
    'Get all CDPs for a specific Cardano address',
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
    'Analyze collateral ratios and liquidation risk of CDPs for an owner, accounting for accrued interest',
    { owner: z.string().describe('Owner payment key hash (56-char hex) or bech32 address') },
    async ({ owner }) => {
      try {
        const pkh = extractPaymentCredential(owner);
        const client = getIndexerClient();

        const [allCdps, assetsRes, pricesRes] = await Promise.all([
          fetchCdps(),
          client.get('/assets'),
          client.get('/asset-prices'),
        ]);

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

        const assetMap = new Map((assetsRes.data as RawAsset[]).map((a) => [a.asset, a]));
        // Price is keyed by `${asset}|${collateral_asset}` (collateral '' = ADA).
        const priceMap = new Map(
          (pricesRes.data as RawAssetPrice[]).map((p) => [`${p.asset}|${p.collateral_asset}`, p])
        );

        const analysis = cdps.map((cdp) => {
          const priceEntry = priceMap.get(`${cdp.asset}|${cdp.collateralAsset}`);
          const assetInfo = assetMap.get(cdp.asset);

          const collateral = cdp.collateralAmount / DECIMALS;
          const mintedTokens = cdp.mintedAmount / DECIMALS;
          // Effective debt includes accrued interest (already in iAsset units).
          const effectiveDebtTokens = (cdp.mintedAmount + cdp.accruedInterestIAsset) / DECIMALS;

          const base = {
            txHash: cdp.txHash,
            outputIndex: cdp.outputIndex,
            asset: cdp.asset,
            collateralAsset: cdp.collateralAsset === '' ? 'ADA' : cdp.collateralAsset,
            collateral,
            mintedTokens,
            accruedInterestTokens: cdp.accruedInterestIAsset / DECIMALS,
            effectiveDebtTokens,
            frozen: cdp.frozen,
          };

          if (!priceEntry) {
            return {
              ...base,
              collateralRatio: null,
              status: 'unknown',
              note: `No indexer price for ${cdp.asset} against collateral '${cdp.collateralAsset || 'ADA'}'`,
            };
          }

          // price = collateral units per 1 iAsset, so debt value (in collateral
          // units) = effectiveDebtTokens * price.
          const price = Number(priceEntry.price);
          const debtValue = effectiveDebtTokens * price;
          const collateralRatio = debtValue > 0 ? (collateral / debtValue) * 100 : null;

          const maintenanceRatio = assetInfo?.maintenance_ratio_percentage ?? null;
          const liquidationRatio = assetInfo?.liquidation_ratio_percentage ?? null;

          let status = 'unknown';
          if (collateralRatio != null && maintenanceRatio != null && liquidationRatio != null) {
            if (collateralRatio >= maintenanceRatio) status = 'safe';
            else if (collateralRatio >= liquidationRatio) status = 'at-risk';
            else status = 'liquidatable';
          }

          return {
            ...base,
            priceInCollateral: price,
            collateralRatio:
              collateralRatio == null ? null : Math.round(collateralRatio * 100) / 100,
            maintenanceRatio,
            liquidationRatio,
            status,
            ...(maintenanceRatio == null
              ? { note: 'Liquidation thresholds not yet published by the indexer for this asset' }
              : {}),
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
