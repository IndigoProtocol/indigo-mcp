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

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerRedemptionTools(testServer.server);
  });

  describe('get_order_book', () => {
    it('explains the order book is not indexed in v3', async () => {
      const result = await tools.get('get_order_book')!({});
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('not exposed by the v3 indexer');
    });
  });

  describe('get_redemption_orders', () => {
    it('reads /redemptions and filters by asset', async () => {
      const mockData = [
        { id: 1, asset: 'iUSD' },
        { id: 2, asset: 'iBTC' },
      ];
      mockGet.mockResolvedValue({ data: mockData });
      const result = await tools.get('get_redemption_orders')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(mockGet).toHaveBeenCalledWith('/redemptions');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].asset).toBe('iUSD');
    });

    it('applies a limit', async () => {
      mockGet.mockResolvedValue({
        data: [
          { id: 1, asset: 'iUSD' },
          { id: 2, asset: 'iUSD' },
        ],
      });
      const result = await tools.get('get_redemption_orders')!({ limit: 1 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_redemption_orders')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_redemption_queue', () => {
    it('explains the queue is not indexed in v3', async () => {
      const result = await tools.get('get_redemption_queue')!({ asset: 'iUSD' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('not exposed by the v3 indexer');
    });
  });
});
