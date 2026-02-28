import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerAnalyticsTools(server: McpServer): void {
  // 1. get_tvl - No params → GET /analytics/tvl
  server.tool('get_tvl', 'Get historical TVL data from DefiLlama', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/analytics/tvl');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching TVL: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // 2. get_apr_rewards - No params → GET /apr/
  server.tool('get_apr_rewards', 'Get all APR reward records', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/apr/');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching APR rewards: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // 3. get_apr_by_key - POST /apr/ with { key }
  server.tool(
    'get_apr_by_key',
    'Get APR for a specific key',
    { key: z.string().describe('APR key, e.g. sp_iUSD_indy, sp_iUSD_ada, stake_ada') },
    async ({ key }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/apr/', { key });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error fetching APR by key: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // 4. get_dex_yields - No params → GET /dex/yields
  server.tool('get_dex_yields', 'Get DEX farm yields for iAsset pairs', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/dex/yields');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching DEX yields: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // 5. get_protocol_stats - Aggregated stats from multiple endpoints
  server.tool('get_protocol_stats', 'Get aggregated protocol statistics', {}, async () => {
    try {
      const client = getIndexerClient();
      const [assetsRes, adaRes, tvlRes, stakingRes] = await Promise.all([
        client.get('/assets/'),
        client.get('/analytics/ada'),
        client.get('/analytics/tvl'),
        client.get('/staking/'),
      ]);

      const assets = assetsRes.data as Array<{ name: string; price: { price: number } }>;
      const adaPrice = adaRes.data as number;
      const tvlData = tvlRes.data as Array<{ tvl: number }>;
      const stakingData = stakingRes.data as { totalStake: number };

      const latestTvl = tvlData.length > 0 ? tvlData[tvlData.length - 1].tvl : null;

      const stats = {
        assetCount: assets.length,
        assets: assets.map((a) => ({ name: a.name, price: a.price.price })),
        adaPrice,
        tvl: latestTvl,
        totalStake: stakingData.totalStake,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error fetching protocol stats: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });
}