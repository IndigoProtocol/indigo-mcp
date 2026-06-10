import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';
import { extractPaymentCredential } from '../utils/address.js';

interface StabilityPoolAccount {
  owner: string;
  asset: string;
  [key: string]: unknown;
}

async function fetchAccounts(): Promise<StabilityPoolAccount[]> {
  const client = getIndexerClient();
  const res = await client.get('/v3/stability-pools/accounts');
  return res.data as StabilityPoolAccount[];
}

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

  server.tool(
    'get_stability_pool_accounts',
    'Get all open stability pool accounts, optionally filtered by iAsset',
    { asset: AssetParam.optional() },
    async ({ asset }) => {
      try {
        let accounts = await fetchAccounts();
        if (asset) accounts = accounts.filter((a) => a.asset === asset);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(accounts, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching stability pool accounts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_sp_account_by_owner',
    'Get stability pool accounts for specific owners (accepts payment key hashes or bech32 addresses)',
    {
      owners: z.array(z.string()).describe('Array of payment key hashes or bech32 addresses'),
    },
    async ({ owners }) => {
      try {
        const wanted = new Set(owners.map((o) => extractPaymentCredential(o)));
        const accounts = (await fetchAccounts()).filter((a) => wanted.has(a.owner));
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(accounts, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching SP accounts by owner: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
