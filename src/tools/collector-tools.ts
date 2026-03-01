import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerCollectorTools(server: McpServer): void {
  // 1. get_collector_utxos - GET or POST /collector/utxos
  server.tool(
    'get_collector_utxos',
    'Get collector UTXOs for fee distribution',
    { length: z.number().describe('Maximum number of UTXOs to return').optional() },
    async ({ length }) => {
      try {
        const client = getIndexerClient();
        const response = length
          ? await client.post('/collector/utxos', { length })
          : await client.get('/collector/utxos');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching collector UTXOs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. store_on_ipfs - POST /web3/store
  server.tool(
    'store_on_ipfs',
    'Store text content on IPFS',
    { text: z.string().describe('Text content to store on IPFS') },
    async ({ text }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/web3/store', { text });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error storing content on IPFS: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. retrieve_from_ipfs - GET /web3/retrieve/{cid}
  server.tool(
    'retrieve_from_ipfs',
    'Retrieve content from IPFS by CID',
    { cid: z.string().describe('IPFS content identifier (CID)') },
    async ({ cid }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get(`/web3/retrieve/${cid}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error retrieving content from IPFS: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
