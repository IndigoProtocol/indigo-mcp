import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

interface OrderBookEntry {
  owner: string;
  asset: string;
  lovelaceAmount: number;
  maxPrice: number;
  claimableAmount: number;
  [key: string]: unknown;
}

export function registerRedemptionTools(server: McpServer): void {
  server.tool(
    'get_order_book',
    'Get open limited redemption positions from the order book, optionally filtered by asset or owners',
    {
      asset: AssetParam.optional(),
      owners: z.array(z.string()).optional(),
    },
    async ({ asset, owners }) => {
      try {
        const client = getIndexerClient();
        const hasFilters = asset !== undefined || owners !== undefined;
        const response = hasFilters
          ? await client.post('/order-book/', { asset, owners })
          : await client.get('/order-book/');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching order book: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_redemption_orders',
    'Get redemption orders, optionally filtered by timestamp or price range',
    {
      timestamp: z.number().optional().describe('Unix timestamp in milliseconds'),
      in_range: z.boolean().optional().describe('Filter by price range'),
    },
    async ({ timestamp, in_range }) => {
      try {
        const client = getIndexerClient();
        const hasFilters = timestamp !== undefined || in_range !== undefined;
        const response = hasFilters
          ? await client.post('/rewards/redemption-orders', { timestamp, in_range })
          : await client.get('/rewards/redemption-orders');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching redemption orders: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_redemption_queue',
    'Get aggregated redemption queue for a specific iAsset, sorted by max price ascending',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/order-book/', { asset });
        const entries = response.data as OrderBookEntry[];
        const sorted = [...entries].sort((a, b) => a.maxPrice - b.maxPrice);
        const totalLovelace = sorted.reduce((sum, e) => sum + e.lovelaceAmount, 0);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  asset,
                  totalPositions: sorted.length,
                  totalLovelace,
                  entries: sorted,
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
              text: `Error fetching redemption queue: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
