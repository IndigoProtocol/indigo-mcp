import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerRedemptionTools } from '../../../tools/redemption-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('redemption tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerRedemptionTools(testServer.server);
  });

  describe('get_order_book', () => {
    it('should GET when no filters', async () => {
      const mockData = [{ owner: 'abc', asset: 'iUSD' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_order_book')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/order-book/');
    });

    it('should POST when asset filter provided', async () => {
      const mockData = [{ owner: 'abc', asset: 'iUSD' }];
      mockPost.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_order_book')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockPost).toHaveBeenCalledWith('/order-book/', { asset: 'iUSD', owners: undefined });
    });

    it('should POST when owners filter provided', async () => {
      mockPost.mockResolvedValue({ data: [] });

      await tools.get('get_order_book')!({ owners: ['owner1'] });

      expect(mockPost).toHaveBeenCalledWith('/order-book/', { asset: undefined, owners: ['owner1'] });
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_order_book')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_redemption_orders', () => {
    it('should GET when no filters', async () => {
      const mockData = [{ id: 1 }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_redemption_orders')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/rewards/redemption-orders');
    });

    it('should POST when timestamp filter provided', async () => {
      mockPost.mockResolvedValue({ data: [{ id: 2 }] });

      await tools.get('get_redemption_orders')!({ timestamp: 1700000000 });

      expect(mockPost).toHaveBeenCalledWith('/rewards/redemption-orders', {
        timestamp: 1700000000,
        in_range: undefined,
      });
    });

    it('should POST when in_range filter provided', async () => {
      mockPost.mockResolvedValue({ data: [] });

      await tools.get('get_redemption_orders')!({ in_range: true });

      expect(mockPost).toHaveBeenCalledWith('/rewards/redemption-orders', {
        timestamp: undefined,
        in_range: true,
      });
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_redemption_orders')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_redemption_queue', () => {
    it('should sort entries by maxPrice and aggregate', async () => {
      const mockEntries = [
        { owner: 'a', asset: 'iUSD', lovelaceAmount: 200, maxPrice: 1.1, claimableAmount: 0 },
        { owner: 'b', asset: 'iUSD', lovelaceAmount: 100, maxPrice: 0.9, claimableAmount: 0 },
        { owner: 'c', asset: 'iUSD', lovelaceAmount: 150, maxPrice: 1.0, claimableAmount: 0 },
      ];
      mockPost.mockResolvedValue({ data: mockEntries });

      const result = await tools.get('get_redemption_queue')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.asset).toBe('iUSD');
      expect(parsed.totalPositions).toBe(3);
      expect(parsed.totalLovelace).toBe(450);
      expect(parsed.entries[0].maxPrice).toBe(0.9);
      expect(parsed.entries[1].maxPrice).toBe(1.0);
      expect(parsed.entries[2].maxPrice).toBe(1.1);
      expect(mockPost).toHaveBeenCalledWith('/order-book/', { asset: 'iUSD' });
    });

    it('should return error on failure', async () => {
      mockPost.mockRejectedValue(new Error('API error'));

      const result = await tools.get('get_redemption_queue')!({ asset: 'iUSD' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});
