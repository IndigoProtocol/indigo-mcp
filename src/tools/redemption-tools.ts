import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

interface OrderBookEntry {
  owner: string;
  iasset: string;
  orderType: unknown;
  assetAmounts: unknown;
  outputHash: string;
  outputIndex: number;
  [key: string]: unknown;
}

async function fetchOrderBook(): Promise<OrderBookEntry[]> {
  const client = getIndexerClient();
  const res = await client.get('/v3/order-book');
  return res.data as OrderBookEntry[];
}

export function registerRedemptionTools(server: McpServer): void {
  server.tool(
    'get_order_book',
    'Get open ROB (redemption order book) positions, optionally filtered by iAsset or owners',
    {
      asset: AssetParam.optional(),
      owners: z.array(z.string()).optional(),
    },
    async ({ asset, owners }) => {
      try {
        let entries = await fetchOrderBook();
        if (asset) entries = entries.filter((e) => e.iasset === asset);
        if (owners && owners.length > 0) {
          const set = new Set(owners);
          entries = entries.filter((e) => set.has(e.owner));
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }],
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

  server.tool(
    'get_redemption_queue',
    'Get the open ROB order-book entries for a specific iAsset',
    { asset: AssetParam },
    async ({ asset }) => {
      try {
        const entries = (await fetchOrderBook()).filter((e) => e.iasset === asset);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ asset, totalPositions: entries.length, entries }, null, 2),
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
