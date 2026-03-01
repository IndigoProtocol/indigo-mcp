import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

export function registerAssetTools(server: McpServer): void {
  // 1. get_assets - No params → GET /assets/
  server.tool(
    'get_assets',
    'Get all Indigo iAssets with prices and interest data',
    {},
    async () => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/assets/');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
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
    }
  );

  // 2. get_asset - { asset: AssetParam } → GET /assets/ + filter by name
  server.tool(
    'get_asset',
    'Get details for a specific Indigo iAsset',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/assets/');
        const assets = response.data as Array<{ name: string }>;
        const found = assets.find((a) => a.name === asset);
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

  // 3. get_asset_price - { asset: AssetParam } → GET /assets/ + extract .price
  server.tool(
    'get_asset_price',
    'Get the current price for a specific Indigo iAsset',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/assets/');
        const assets = response.data as Array<{
          name: string;
          price: { price: number; expiration: number; slot: number };
        }>;
        const found = assets.find((a) => a.name === asset);
        if (!found) {
          return {
            content: [{ type: 'text' as const, text: `Asset ${asset} not found` }],
            isError: true,
          };
        }
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ asset, ...found.price }, null, 2) },
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

  // 4. get_ada_price - No params → GET /analytics/ada
  server.tool('get_ada_price', 'Get the current ADA price in USD', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/analytics/ada');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
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

  // 5. get_indy_price - No params → GET /analytics/indy → parse string values to numbers
  server.tool('get_indy_price', 'Get the current INDY token price in ADA and USD', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/analytics/indy');
      const raw = response.data as { ada: string; usd: string; timestamp: string };
      const data = {
        ada: Number(raw.ada),
        usd: Number(raw.usd),
        timestamp: Number(raw.timestamp),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
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
