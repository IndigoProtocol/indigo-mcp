import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerDexTools } from '../../../tools/dex-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('dex tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerDexTools(testServer.server);
  });

  describe('get_steelswap_tokens', () => {
    it('should return tokens', async () => {
      const mockData = [{ name: 'ADA', symbol: 'ADA' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_steelswap_tokens')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/steelswap/tokens');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_steelswap_tokens')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_steelswap_estimate', () => {
    it('should post swap estimate', async () => {
      mockPost.mockResolvedValue({ data: { amountOut: 500, priceImpact: 0.01 } });

      const result = await tools.get('get_steelswap_estimate')!({
        tokenIn: 'ADA',
        tokenOut: 'iUSD',
        amountIn: 1000,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/steelswap/estimate', {
        tokenIn: 'ADA',
        tokenOut: 'iUSD',
        amountIn: 1000,
      });
      expect(parsed.amountOut).toBe(500);
    });

    it('should return error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Bad request'));

      const result = await tools.get('get_steelswap_estimate')!({
        tokenIn: 'ADA',
        tokenOut: 'iUSD',
        amountIn: 1000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Bad request');
    });
  });

  describe('get_iris_liquidity_pools', () => {
    it('should post with filter params', async () => {
      const mockData = [{ tokenA: 'ADA', tokenB: 'iUSD', tvl: 1000000 }];
      mockPost.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_iris_liquidity_pools')!({
        tokenA: 'ADA',
        tokenB: 'iUSD',
        dex: 'minswap',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/iris/liquidity-pools', {
        tokenA: 'ADA',
        tokenB: 'iUSD',
        dex: 'minswap',
      });
      expect(parsed).toEqual(mockData);
    });

    it('should return error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Server error'));

      const result = await tools.get('get_iris_liquidity_pools')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_blockfrost_balances', () => {
    it('should pass address as query param', async () => {
      const mockData = [{ unit: 'lovelace', quantity: '5000000' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_blockfrost_balances')!({ address: 'addr1test' });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockGet).toHaveBeenCalledWith('/blockfrost/balances', { params: { address: 'addr1test' } });
      expect(parsed).toEqual(mockData);
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));

      const result = await tools.get('get_blockfrost_balances')!({ address: 'addr1invalid' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not found');
    });
  });
});
