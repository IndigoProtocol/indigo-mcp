import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { extractPaymentCredential } from '../utils/address.js';

export function registerStakingTools(server: McpServer): void {
  server.tool(
    'get_staking_info',
    'Get the current INDY staking manager state (slot, outputHash, totalStake, snapshotAda)',
    {},
    async () => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/staking/');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching staking info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_staking_positions',
    'Get all open INDY staking positions',
    {},
    async () => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/staking/positions');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching staking positions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_staking_positions_by_owner',
    'Get INDY staking positions for specific owners (accepts payment key hashes or bech32 addresses)',
    {
      owners: z.array(z.string()).describe('Array of payment key hashes or bech32 addresses'),
    },
    async ({ owners }) => {
      try {
        const convertedOwners = owners.map((o) => extractPaymentCredential(o));
        const client = getIndexerClient();
        const response = await client.post('/staking/positions', { owners: convertedOwners });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching staking positions by owner: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_staking_position_by_address',
    'Get INDY staking positions for a single Cardano address',
    {
      address: z.string().describe('Cardano bech32 address'),
    },
    async ({ address }) => {
      try {
        const pkh = extractPaymentCredential(address);
        const client = getIndexerClient();
        const response = await client.post('/staking/positions', { owners: [pkh] });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching staking position by address: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}