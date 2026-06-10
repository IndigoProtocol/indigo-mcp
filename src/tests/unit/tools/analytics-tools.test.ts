import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerAnalyticsTools } from '../../../tools/analytics-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('analytics tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerAnalyticsTools(testServer.server);
  });

  describe('get_tvl', () => {
    it('reads /v3/analytics/tvl', async () => {
      const mockData = { usd: [{ timestamp: 1, value: 100 }] };
      mockGet.mockResolvedValue({ data: mockData });
      const result = await tools.get('get_tvl')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/v3/analytics/tvl');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_tvl')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_apr_rewards', () => {
    it('reads all APR records from /v3/apr', async () => {
      mockGet.mockResolvedValue({ data: [{ key: 'sp_iUSD_indy', value: 9.27 }] });
      const result = await tools.get('get_apr_rewards')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].key).toBe('sp_iUSD_indy');
      expect(mockGet).toHaveBeenCalledWith('/v3/apr');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_apr_rewards')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_apr_by_key', () => {
    it('posts to /v3/apr with the key', async () => {
      mockPost.mockResolvedValue({ data: { key: 'sp_iUSD_indy', value: 9.27 } });
      const result = await tools.get('get_apr_by_key')!({ key: 'sp_iUSD_indy' });
      const parsed = JSON.parse(result.content[0].text);
      expect(mockPost).toHaveBeenCalledWith('/v3/apr', { key: 'sp_iUSD_indy' });
      expect(parsed.key).toBe('sp_iUSD_indy');
    });

    it('returns error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Not found'));
      const result = await tools.get('get_apr_by_key')!({ key: 'invalid' });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_dex_yields', () => {
    it('reads /v3/dex/yields', async () => {
      const mockData = [{ dex: 'MinswapV2', base_apr: 24.6 }];
      mockGet.mockResolvedValue({ data: mockData });
      const result = await tools.get('get_dex_yields')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/v3/dex/yields');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));
      const result = await tools.get('get_dex_yields')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_protocol_stats', () => {
    it('aggregates v3 endpoints', async () => {
      mockGet.mockImplementation((url: string) => {
        switch (url) {
          case '/assets':
            return Promise.resolve({ data: [{ asset: 'iUSD' }, { asset: 'iBTC' }] });
          case '/asset-prices':
            return Promise.resolve({
              data: [{ asset: 'iUSD', collateral_asset: '', price: '6.29' }],
            });
          case '/v3/analytics/ada':
            return Promise.resolve({ data: { price: 0.163 } });
          case '/v3/staking':
            return Promise.resolve({ data: { totalStake: 10000000 } });
          default:
            return Promise.reject(new Error('Unknown endpoint ' + url));
        }
      });

      const result = await tools.get('get_protocol_stats')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.assetCount).toBe(2);
      expect(parsed.adaPriceUsd).toBe(0.163);
      expect(parsed.totalStake).toBe(10000000);
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));
      const result = await tools.get('get_protocol_stats')!({});
      expect(result.isError).toBe(true);
    });
  });
});
