import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

const ORDER_BOOK_UNAVAILABLE =
  'The open redemption order book (LRP/ROB positions) is not exposed by the v3 indexer. ' +
  'Use get_redemption_orders for executed redemptions, or read open ROB positions on-chain.';

export function registerRedemptionTools(server: McpServer): void {
  // The open order book of LRP/ROB positions is not indexed in v3.
  server.tool(
    'get_order_book',
    'Get open limited redemption positions from the order book, optionally filtered by asset or owners',
    {
      asset: AssetParam.optional(),
      owners: z.array(z.string()).optional(),
    },
    async () => {
      return { content: [{ type: 'text' as const, text: ORDER_BOOK_UNAVAILABLE }] };
    }
  );

  server.tool(
    'get_redemption_orders',
    'Get executed redemption orders, optionally filtered by iAsset',
    {
      asset: AssetParam.optional(),
      limit: z.number().min(1).max(500).optional().describe('Max number of records (default 100)'),
    },
    async ({ asset, limit }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/redemptions');
        let orders = response.data as Array<{ asset: string; [k: string]: unknown }>;
        if (asset) orders = orders.filter((o) => o.asset === asset);
        orders = orders.slice(0, limit ?? 100);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(orders, null, 2) }],
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

  // The aggregated open-order queue depended on the order-book route, which is
  // not available in v3.
  server.tool(
    'get_redemption_queue',
    'Get aggregated redemption queue for a specific iAsset',
    { asset: AssetParam },
    async () => {
      return { content: [{ type: 'text' as const, text: ORDER_BOOK_UNAVAILABLE }] };
    }
  );
}
