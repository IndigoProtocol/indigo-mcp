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
    it('should return TVL data', async () => {
      const mockData = [{ tvl: 1000000, date: '2024-01-01' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_tvl')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/analytics/tvl');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_tvl')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_apr_rewards', () => {
    it('should return APR rewards', async () => {
      const mockData = [{ key: 'sp_iUSD_indy', value: 5.2 }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_apr_rewards')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/apr/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_apr_rewards')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_apr_by_key', () => {
    it('should post with key', async () => {
      mockPost.mockResolvedValue({ data: { key: 'sp_iUSD_indy', apr: 5.2 } });

      const result = await tools.get('get_apr_by_key')!({ key: 'sp_iUSD_indy' });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/apr/', { key: 'sp_iUSD_indy' });
      expect(parsed.key).toBe('sp_iUSD_indy');
    });

    it('should return error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Not found'));

      const result = await tools.get('get_apr_by_key')!({ key: 'invalid' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not found');
    });
  });

  describe('get_dex_yields', () => {
    it('should return DEX yields', async () => {
      const mockData = [{ pair: 'iUSD/ADA', yield: 10 }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_dex_yields')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/dex/yields');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await tools.get('get_dex_yields')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_protocol_stats', () => {
    it('should aggregate data from multiple endpoints', async () => {
      mockGet.mockImplementation((url: string) => {
        switch (url) {
          case '/assets/':
            return Promise.resolve({
              data: [{ name: 'iUSD', price: { price: 1.0 } }, { name: 'iBTC', price: { price: 60000 } }],
            });
          case '/analytics/ada':
            return Promise.resolve({ data: 0.45 });
          case '/analytics/tvl':
            return Promise.resolve({ data: [{ tvl: 5000000 }, { tvl: 6000000 }] });
          case '/staking/':
            return Promise.resolve({ data: { totalStake: 10000000 } });
          default:
            return Promise.reject(new Error('Unknown endpoint'));
        }
      });

      const result = await tools.get('get_protocol_stats')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.assetCount).toBe(2);
      expect(parsed.assets).toHaveLength(2);
      expect(parsed.adaPrice).toBe(0.45);
      expect(parsed.tvl).toBe(6000000);
      expect(parsed.totalStake).toBe(10000000);
    });

    it('should handle empty TVL data', async () => {
      mockGet.mockImplementation((url: string) => {
        switch (url) {
          case '/assets/':
            return Promise.resolve({ data: [] });
          case '/analytics/ada':
            return Promise.resolve({ data: 0 });
          case '/analytics/tvl':
            return Promise.resolve({ data: [] });
          case '/staking/':
            return Promise.resolve({ data: { totalStake: 0 } });
          default:
            return Promise.reject(new Error('Unknown'));
        }
      });

      const result = await tools.get('get_protocol_stats')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.tvl).toBeNull();
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));

      const result = await tools.get('get_protocol_stats')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});