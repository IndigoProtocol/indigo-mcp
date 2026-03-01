import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';

export function registerDexTools(server: McpServer): void {
  server.tool('get_steelswap_tokens', 'Get all tokens available on Steelswap DEX', {}, async () => {
    try {
      const client = getIndexerClient();
      const response = await client.get('/steelswap/tokens');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching Steelswap tokens: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool(
    'get_steelswap_estimate',
    'Get a swap estimate from Steelswap DEX',
    {
      tokenIn: z.string().describe('Input token identifier'),
      tokenOut: z.string().describe('Output token identifier'),
      amountIn: z.number().describe('Amount of input token'),
    },
    async ({ tokenIn, tokenOut, amountIn }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/steelswap/estimate', { tokenIn, tokenOut, amountIn });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching Steelswap estimate: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_iris_liquidity_pools',
    'Get liquidity pools from Iris, optionally filtered by tokens or DEX',
    {
      tokenA: z.string().optional().describe('First token identifier'),
      tokenB: z.string().optional().describe('Second token identifier'),
      dex: z.string().optional().describe('DEX name filter'),
    },
    async ({ tokenA, tokenB, dex }) => {
      try {
        const client = getIndexerClient();
        const response = await client.post('/iris/liquidity-pools', { tokenA, tokenB, dex });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching Iris liquidity pools: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_blockfrost_balances',
    'Get token balances for a Cardano address via Blockfrost',
    {
      address: z.string().describe('Cardano bech32 address'),
    },
    async ({ address }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/blockfrost/balances', { params: { address } });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching Blockfrost balances: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
