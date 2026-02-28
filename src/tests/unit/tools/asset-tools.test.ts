import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerAssetTools } from '../../../tools/asset-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('asset tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerAssetTools(testServer.server);
  });

  describe('get_assets', () => {
    it('should return all assets', async () => {
      const mockAssets = [{ name: 'iUSD', price: { price: 1.0 } }, { name: 'iBTC', price: { price: 60000 } }];
      mockGet.mockResolvedValue({ data: mockAssets });

      const result = await tools.get('get_assets')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockAssets);
      expect(result.isError).toBeUndefined();
      expect(mockGet).toHaveBeenCalledWith('/assets/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_assets')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_asset', () => {
    it('should return a specific asset', async () => {
      const mockAssets = [{ name: 'iUSD', price: { price: 1.0 } }, { name: 'iBTC', price: { price: 60000 } }];
      mockGet.mockResolvedValue({ data: mockAssets });

      const result = await tools.get('get_asset')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.name).toBe('iUSD');
      expect(result.isError).toBeUndefined();
    });

    it('should return error when asset not found', async () => {
      mockGet.mockResolvedValue({ data: [{ name: 'iUSD' }] });

      const result = await tools.get('get_asset')!({ asset: 'iBTC' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('iBTC not found');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_asset')!({ asset: 'iUSD' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout');
    });
  });

  describe('get_asset_price', () => {
    it('should return asset price data', async () => {
      const mockAssets = [{ name: 'iUSD', price: { price: 1.0, expiration: 100, slot: 50 } }];
      mockGet.mockResolvedValue({ data: mockAssets });

      const result = await tools.get('get_asset_price')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.asset).toBe('iUSD');
      expect(parsed.price).toBe(1.0);
      expect(result.isError).toBeUndefined();
    });

    it('should return error when asset not found', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const result = await tools.get('get_asset_price')!({ asset: 'iSOL' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('iSOL not found');
    });
  });

  describe('get_ada_price', () => {
    it('should return ADA price', async () => {
      mockGet.mockResolvedValue({ data: 0.45 });

      const result = await tools.get('get_ada_price')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBe(0.45);
      expect(mockGet).toHaveBeenCalledWith('/analytics/ada');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Service unavailable'));

      const result = await tools.get('get_ada_price')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Service unavailable');
    });
  });

  describe('get_indy_price', () => {
    it('should parse string values to numbers', async () => {
      mockGet.mockResolvedValue({ data: { ada: '2.5', usd: '1.12', timestamp: '1700000000' } });

      const result = await tools.get('get_indy_price')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.ada).toBe(2.5);
      expect(parsed.usd).toBe(1.12);
      expect(parsed.timestamp).toBe(1700000000);
      expect(mockGet).toHaveBeenCalledWith('/analytics/indy');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));

      const result = await tools.get('get_indy_price')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});
