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

const mockAssets = [{ asset: 'iUSD' }, { asset: 'iBTC' }];
const mockPrices = [
  { asset: 'iUSD', collateral_asset: '', price: '1.0', expiration: 100 },
  { asset: 'iBTC', collateral_asset: '', price: '60000', expiration: 100 },
];
const mockIndy = { ada_price: '0.64', usd_price: '0.1024', timestamp: 1700000000 };

function routed(url: string) {
  if (url === '/assets') return Promise.resolve({ data: mockAssets });
  if (url === '/asset-prices') return Promise.resolve({ data: mockPrices });
  if (url === '/indy-price') return Promise.resolve({ data: mockIndy });
  return Promise.reject(new Error('Unknown endpoint ' + url));
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
    it('returns assets enriched with prices', async () => {
      mockGet.mockImplementation(routed);
      const result = await tools.get('get_assets')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].asset).toBe('iUSD');
      expect(parsed[0].prices[0]).toMatchObject({ collateralAsset: 'ADA', price: 1 });
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_assets')!({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_asset', () => {
    it('returns a specific asset by v3 `asset` field', async () => {
      mockGet.mockImplementation(routed);
      const result = await tools.get('get_asset')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.asset).toBe('iUSD');
    });

    it('errors when asset not found', async () => {
      mockGet.mockResolvedValue({ data: [{ asset: 'iUSD' }] });
      const result = await tools.get('get_asset')!({ asset: 'iBTC' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('iBTC not found');
    });
  });

  describe('get_asset_price', () => {
    it('returns prices per collateral from /asset-prices', async () => {
      mockGet.mockImplementation(routed);
      const result = await tools.get('get_asset_price')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.asset).toBe('iUSD');
      expect(parsed.prices[0]).toMatchObject({ collateralAsset: 'ADA', price: 1 });
    });

    it('errors when no price found', async () => {
      mockGet.mockResolvedValue({ data: [] });
      const result = await tools.get('get_asset_price')!({ asset: 'iSOL' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No price found');
    });
  });

  describe('get_ada_price', () => {
    it('derives ADA/USD from the INDY feed', async () => {
      mockGet.mockImplementation(routed);
      const result = await tools.get('get_ada_price')!({});
      const parsed = JSON.parse(result.content[0].text);
      // 0.1024 / 0.64 = 0.16
      expect(parsed.usd).toBeCloseTo(0.16, 5);
      expect(mockGet).toHaveBeenCalledWith('/indy-price');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Service unavailable'));
      const result = await tools.get('get_ada_price')!({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Service unavailable');
    });
  });

  describe('get_indy_price', () => {
    it('maps the v3 indy-price shape to numbers', async () => {
      mockGet.mockImplementation(routed);
      const result = await tools.get('get_indy_price')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ada).toBe(0.64);
      expect(parsed.usd).toBe(0.1024);
      expect(parsed.timestamp).toBe(1700000000);
      expect(mockGet).toHaveBeenCalledWith('/indy-price');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));
      const result = await tools.get('get_indy_price')!({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});
