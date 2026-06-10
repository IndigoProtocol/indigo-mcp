import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerAnalyticsTools(server: McpServer): void {
  // The v3 indexer no longer exposes a historical TVL route. Surface this as a
  // clear, non-crashing message rather than a 404.
  server.tool('get_tvl', 'Get protocol TVL', {}, async () => {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'TVL is not available from the v3 indexer (the /analytics/tvl route was removed). Use a TVL aggregator such as DefiLlama, or compute it from get_protocol_stats.',
        },
      ],
    };
  });

  // The v3 indexer serves APR per key (POST /apr); there is no "all records"
  // collection route. Direct callers to get_apr_by_key.
  server.tool('get_apr_rewards', 'Get APR reward records', {}, async () => {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'The v3 indexer serves APR per key only. Use get_apr_by_key with a key such as sp_iUSD_indy, sp_iUSD_ada, or stake_ada.',
        },
      ],
    };
  });

  server.tool(
    'get_apr_by_key',
    'Get APR for a specific key',
    { key: z.string().describe('APR key, e.g. sp_iUSD_indy, sp_iUSD_ada, stake_ada') },
    async ({ key }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/apr', { key });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching APR by key: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool('get_dex_yields', 'Get DEX farm yields for iAsset pairs', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/yields');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching DEX yields: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool('get_protocol_stats', 'Get aggregated protocol statistics', {}, async () => {
    try {
      const client = getIndexerClient();
      const [assetsRes, pricesRes, indyRes, stakingRes] = await Promise.all([
        client.get('/assets'),
        client.get('/asset-prices'),
        client.get('/indy-price'),
        client.get('/staking-manager'),
      ]);

      const assets = assetsRes.data as Array<{ asset: string }>;
      const prices = pricesRes.data as Array<{
        asset: string;
        collateral_asset: string;
        price: string;
      }>;
      const indy = indyRes.data as { ada_price: string; usd_price: string };
      const staking = stakingRes.data as { total_stake?: number; snapshot_ada?: number };

      const indyAda = Number(indy.ada_price);
      const adaUsd = indyAda > 0 ? Number(indy.usd_price) / indyAda : 0;

      const stats = {
        assetCount: assets.length,
        assets: assets.map((a) => a.asset),
        prices: prices.map((p) => ({
          asset: p.asset,
          collateralAsset: p.collateral_asset === '' ? 'ADA' : p.collateral_asset,
          price: Number(p.price),
        })),
        adaPriceUsd: adaUsd,
        indyPriceUsd: Number(indy.usd_price),
        totalStake: staking.total_stake ?? null,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching protocol stats: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
