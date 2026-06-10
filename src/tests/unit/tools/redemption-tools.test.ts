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

const mockOrderBook = [
  { owner: 'a', iasset: 'iUSD', orderType: {}, assetAmounts: {}, outputHash: 'h1', outputIndex: 0 },
  { owner: 'b', iasset: 'iBTC', orderType: {}, assetAmounts: {}, outputHash: 'h2', outputIndex: 0 },
];

describe('redemption tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerRedemptionTools(testServer.server);
  });

  describe('get_order_book', () => {
    it('reads /v3/order-book and filters by asset', async () => {
      mockGet.mockResolvedValue({ data: mockOrderBook });
      const result = await tools.get('get_order_book')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(mockGet).toHaveBeenCalledWith('/v3/order-book');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].iasset).toBe('iUSD');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_order_book')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_redemption_orders', () => {
    it('reads /redemptions and filters by asset', async () => {
      mockGet.mockResolvedValue({
        data: [
          { id: 1, asset: 'iUSD' },
          { id: 2, asset: 'iBTC' },
        ],
      });
      const result = await tools.get('get_redemption_orders')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(mockGet).toHaveBeenCalledWith('/redemptions');
      expect(parsed).toHaveLength(1);
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_redemption_orders')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_redemption_queue', () => {
    it('returns open order-book entries for an asset', async () => {
      mockGet.mockResolvedValue({ data: mockOrderBook });
      const result = await tools.get('get_redemption_queue')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.asset).toBe('iUSD');
      expect(parsed.totalPositions).toBe(1);
      expect(mockGet).toHaveBeenCalledWith('/v3/order-book');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));
      const result = await tools.get('get_redemption_queue')!({ asset: 'iUSD' });
      expect(result.isError).toBe(true);
    });
  });
});
