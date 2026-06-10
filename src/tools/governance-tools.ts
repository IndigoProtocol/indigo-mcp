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

  // get_temperature_checks - the dedicated /polls/temperature-checks route was
  // removed in v3; temperature checks now come through the polls feed.
  server.tool('get_temperature_checks', 'Get temperature check polls', {}, async () => {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'The v3 indexer no longer exposes a dedicated temperature-checks route. Use get_polls and filter by poll type.',
        },
      ],
    };
  });

  // 3. get_polls - No params → GET /polls/
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
