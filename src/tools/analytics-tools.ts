import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerAnalyticsTools(server: McpServer): void {
  server.tool('get_tvl', 'Get protocol TVL history', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/v3/analytics/tvl');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching TVL: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool('get_apr_rewards', 'Get all APR reward records', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/v3/apr');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching APR rewards: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool(
    'get_apr_by_key',
    'Get APR for a specific key',
    { key: z.string().describe('APR key, e.g. sp_iUSD_indy, sp_iUSD_ada, stake_ada') },
    async ({ key }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/v3/apr', { key });
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
      const response = await client.get('/v3/dex/yields');
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
      const [assetsRes, pricesRes, adaRes, stakingRes] = await Promise.all([
        client.get('/assets'),
        client.get('/asset-prices'),
        client.get('/v3/analytics/ada'),
        client.get('/v3/staking'),
      ]);

      const assets = assetsRes.data as Array<{ asset: string }>;
      const prices = pricesRes.data as Array<{
        asset: string;
        collateral_asset: string;
        price: string;
      }>;
      const ada = adaRes.data as { price: number };
      const staking = stakingRes.data as { totalStake?: number; snapshotAda?: number };

      const stats = {
        assetCount: assets.length,
        assets: assets.map((a) => a.asset),
        prices: prices.map((p) => ({
          asset: p.asset,
          collateralAsset: p.collateral_asset === '' ? 'ADA' : p.collateral_asset,
          price: Number(p.price),
        })),
        adaPriceUsd: ada.price,
        totalStake: staking.totalStake ?? null,
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
