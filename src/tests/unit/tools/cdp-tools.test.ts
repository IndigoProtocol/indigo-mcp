import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

vi.mock('../../../utils/address.js', () => ({
  extractPaymentCredential: vi.fn((input: string) => input),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { extractPaymentCredential } from '../../../utils/address.js';
import { registerCdpTools } from '../../../tools/cdp-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

// v3 indexer CDP shape (GET /cdps): collateral_asset '' = ADA.
function rawCdp(over: Record<string, unknown> = {}) {
  return {
    output_hash: 'tx0',
    output_index: 0,
    owner: 'abc123',
    asset: 'iUSD',
    collateral_asset: '',
    collateralAmount: 300_000_000,
    mintedAmount: 100_000_000,
    interest_iasset_amount: null,
    interest_last_updated: null,
    active_interest_tracking_unitary_interest_snapshot: '1',
    active_interest_tracking_last_settled: 1_700_000_000_000,
    ...over,
  };
}

const mockCdps = [
  rawCdp({ output_hash: 'tx1', owner: 'abc123', asset: 'iUSD' }),
  rawCdp({ output_hash: 'tx2', owner: 'abc123', asset: 'iBTC', collateralAmount: 200_000_000 }),
  rawCdp({ output_hash: 'tx3', owner: 'def456', asset: 'iUSD', collateralAmount: 300_000_000 }),
];

// v3 asset state (GET /assets) — ratio fields are percentages, may be null.
const mockAssets = [
  { asset: 'iUSD', maintenance_ratio_percentage: 150, liquidation_ratio_percentage: 110 },
  { asset: 'iBTC', maintenance_ratio_percentage: 150, liquidation_ratio_percentage: 110 },
];

// v3 prices (GET /asset-prices) — iAsset price denominated in collateral.
const mockPrices = [
  { asset: 'iUSD', collateral_asset: '', price: '1.0' },
  { asset: 'iBTC', collateral_asset: '', price: '60000' },
];

function healthMock(
  cdps: unknown[],
  assets: unknown[] = mockAssets,
  prices: unknown[] = mockPrices
) {
  return (url: string) => {
    if (url === '/cdps') return Promise.resolve({ data: cdps });
    if (url === '/assets') return Promise.resolve({ data: assets });
    if (url === '/asset-prices') return Promise.resolve({ data: prices });
    return Promise.reject(new Error('Unknown endpoint ' + url));
  };
}

describe('cdp tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    (extractPaymentCredential as any).mockImplementation((s: string) => s);
    const testServer = createTestServer();
    tools = testServer.tools;
    registerCdpTools(testServer.server);
  });

  describe('get_all_cdps', () => {
    it('returns all CDPs normalised to the v3 shape', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });
      const result = await tools.get('get_all_cdps')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(3);
      expect(parsed.cdps[0].collateralAmount).toBe(300_000_000);
      expect(parsed.cdps[0].mintedAmount).toBe(100_000_000);
      expect(parsed.cdps[0].txHash).toBe('tx1');
    });

    it('filters by asset', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });
      const result = await tools.get('get_all_cdps')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(2);
      expect(parsed.cdps.every((c: any) => c.asset === 'iUSD')).toBe(true);
    });

    it('applies pagination', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });
      const result = await tools.get('get_all_cdps')!({ limit: 1, offset: 1 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps).toHaveLength(1);
      expect(parsed.limit).toBe(1);
      expect(parsed.offset).toBe(1);
      expect(parsed.total).toBe(3);
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_all_cdps')!({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_cdps_by_owner', () => {
    it('filters by owner', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });
      const result = await tools.get('get_cdps_by_owner')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.every((c: any) => c.owner === 'abc123')).toBe(true);
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_cdps_by_owner')!({ owner: 'abc123' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout');
    });
  });

  describe('get_cdps_by_address', () => {
    it('filters by address owner credential', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });
      const result = await tools.get('get_cdps_by_address')!({ address: 'def456' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('def456');
    });
  });

  describe('analyze_cdp_health', () => {
    it('reports safe status', async () => {
      mockGet.mockImplementation(
        healthMock([rawCdp({ collateralAmount: 300_000_000, mintedAmount: 100_000_000 })])
      );
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps[0].collateralRatio).toBe(300);
      expect(parsed.cdps[0].status).toBe('safe');
    });

    it('reports at-risk status', async () => {
      mockGet.mockImplementation(
        healthMock([rawCdp({ collateralAmount: 120_000_000, mintedAmount: 100_000_000 })])
      );
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps[0].collateralRatio).toBe(120);
      expect(parsed.cdps[0].status).toBe('at-risk');
    });

    it('reports liquidatable status', async () => {
      mockGet.mockImplementation(
        healthMock([rawCdp({ collateralAmount: 100_000_000, mintedAmount: 100_000_000 })])
      );
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps[0].status).toBe('liquidatable');
    });

    it('incorporates accrued interest from interest_iasset_amount', async () => {
      mockGet.mockImplementation(
        healthMock([
          rawCdp({
            collateralAmount: 300_000_000,
            mintedAmount: 100_000_000,
            interest_iasset_amount: 50_000_000,
          }),
        ])
      );
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps[0].accruedInterestTokens).toBe(50);
      expect(parsed.cdps[0].effectiveDebtTokens).toBe(150);
      // 300 collateral / (150 debt * 1.0 price) = 200 %
      expect(parsed.cdps[0].collateralRatio).toBe(200);
    });

    it('returns unknown status when no price exists for the asset/collateral pair', async () => {
      mockGet.mockImplementation(
        healthMock([rawCdp({ asset: 'iUSD', collateral_asset: '' })], mockAssets, [])
      );
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cdps[0].collateralRatio).toBeNull();
      expect(parsed.cdps[0].status).toBe('unknown');
    });

    it('handles no CDPs found', async () => {
      mockGet.mockImplementation(healthMock([]));
      const result = await tools.get('analyze_cdp_health')!({ owner: 'nobody' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('No CDPs found');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('API error'));
      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});
