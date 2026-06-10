import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

// v3 price entry from GET /asset-prices: iAsset price denominated in
// `collateral_asset` ('' = ADA).
interface AssetPrice {
  asset: string;
  collateral_asset: string;
  price: string;
  expiration?: number;
  [key: string]: unknown;
}

// Group price entries by iAsset name.
function pricesByAsset(prices: AssetPrice[]): Map<string, AssetPrice[]> {
  const map = new Map<string, AssetPrice[]>();
  for (const p of prices) {
    const list = map.get(p.asset) ?? [];
    list.push(p);
    map.set(p.asset, list);
  }
  return map;
}

export function registerAssetTools(server: McpServer): void {
  server.tool('get_assets', 'Get all Indigo iAssets with their prices', {}, async () => {
    try {
      const client = getIndexerClient();
      const [assetsRes, pricesRes] = await Promise.all([
        client.get('/assets'),
        client.get('/asset-prices'),
      ]);
      const assets = assetsRes.data as Array<{ asset: string; [k: string]: unknown }>;
      const priceMap = pricesByAsset(pricesRes.data as AssetPrice[]);
      const enriched = assets.map((a) => ({
        ...a,
        prices: (priceMap.get(a.asset) ?? []).map((p) => ({
          collateralAsset: p.collateral_asset === '' ? 'ADA' : p.collateral_asset,
          price: Number(p.price),
          expiration: p.expiration,
        })),
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching assets: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool(
    'get_asset',
    'Get details for a specific Indigo iAsset',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/assets');
        const assets = response.data as Array<{ asset: string }>;
        const found = assets.find((a) => a.asset === asset);
        if (!found) {
          return {
            content: [{ type: 'text' as const, text: `Asset ${asset} not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(found, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching asset: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_asset_price',
    'Get the current price(s) for a specific Indigo iAsset, per collateral asset (ADA and others)',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/asset-prices');
        const prices = (response.data as AssetPrice[]).filter((p) => p.asset === asset);
        if (prices.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No price found for ${asset}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  asset,
                  prices: prices.map((p) => ({
                    collateralAsset: p.collateral_asset === '' ? 'ADA' : p.collateral_asset,
                    price: Number(p.price),
                    expiration: p.expiration,
                  })),
                },
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
              text: `Error fetching asset price: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool('get_ada_price', 'Get the current ADA price in USD', {}, async () => {
    try {
      const client = getIndexerClient();
      // The indexer has no dedicated ADA price route; derive ADA/USD from the
      // INDY price feed, which reports INDY denominated in both ADA and USD.
      const response = await client.get('/indy-price');
      const raw = response.data as { ada_price: string; usd_price: string; timestamp: number };
      const indyAda = Number(raw.ada_price);
      const indyUsd = Number(raw.usd_price);
      const adaUsd = indyAda > 0 ? indyUsd / indyAda : 0;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { usd: adaUsd, source: 'derived from INDY ada/usd feed', timestamp: raw.timestamp },
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
            text: `Error fetching ADA price: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool('get_indy_price', 'Get the current INDY token price in ADA and USD', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/indy-price');
      const raw = response.data as { ada_price: string; usd_price: string; timestamp: number };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ada: Number(raw.ada_price), usd: Number(raw.usd_price), timestamp: raw.timestamp },
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
            text: `Error fetching INDY price: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
