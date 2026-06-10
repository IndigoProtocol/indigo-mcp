import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';

const ACCOUNTS_UNAVAILABLE =
  'Individual stability pool accounts are not exposed by the v3 indexer. ' +
  'Use get_stability_pools for per-iAsset pool state, or read account UTxOs on-chain.';

export function registerStabilityPoolTools(server: McpServer): void {
  server.tool(
    'get_stability_pools',
    'Get the latest stability pool state for each iAsset (snapshots, epoch-to-scale-to-sum, asset states)',
    {},
    async () => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/stability-pools');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching stability pools: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Per-account stability pool data is not indexed in v3.
  server.tool(
    'get_stability_pool_accounts',
    'Get all open stability pool accounts, optionally filtered by iAsset',
    { asset: AssetParam.optional() },
    async () => {
      return { content: [{ type: 'text' as const, text: ACCOUNTS_UNAVAILABLE }] };
    }
  );

  server.tool(
    'get_sp_account_by_owner',
    'Get stability pool accounts for specific owners (accepts payment key hashes or bech32 addresses)',
    {
      owners: z.array(z.string()).describe('Array of payment key hashes or bech32 addresses'),
    },
    async () => {
      return { content: [{ type: 'text' as const, text: ACCOUNTS_UNAVAILABLE }] };
    }
  );
}
