import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerGovernanceTools(server: McpServer): void {
  // 1. get_protocol_params - No params → GET /protocol-params/
  server.tool('get_protocol_params', 'Get latest governance protocol parameters', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/protocol-params/');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching protocol params: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 2. get_temperature_checks - No params → GET /polls/temperature-checks
  server.tool('get_temperature_checks', 'Get temperature check polls', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/polls/temperature-checks');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching temperature checks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 3. get_sync_status - No params → GET /sync/
  server.tool('get_sync_status', 'Get indexer sync status', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/sync/');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching sync status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 4. get_polls - No params → GET /polls/
  server.tool('get_polls', 'Get all governance polls', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/polls/');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching polls: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
