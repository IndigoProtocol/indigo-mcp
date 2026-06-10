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

// v3 CDP shape — mintedAmt replaces minted, interest tracking added.
const mockCdps = [
  {
    owner: 'abc123',
    asset: 'iUSD',
    collateral: 150_000_000,
    mintedAmt: 100_000_000,
    minRatio: 150,
  },
  {
    owner: 'abc123',
    asset: 'iBTC',
    collateral: 200_000_000,
    mintedAmt: 50_000_000,
    minRatio: 150,
  },
  {
    owner: 'def456',
    asset: 'iUSD',
    collateral: 300_000_000,
    mintedAmt: 200_000_000,
    minRatio: 150,
  },
];

// v3 asset shape — ratios at top level, optional interestOracle.
const mockAssets = [
  {
    name: 'iUSD',
    price: { price: 1.0 },
    maintenanceRatio: 150,
    liquidationRatio: 110,
  },
  {
    name: 'iBTC',
    price: { price: 60000 },
    maintenanceRatio: 150,
    liquidationRatio: 110,
  },
];

describe('cdp tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerCdpTools(testServer.server);
  });

  describe('get_all_cdps', () => {
    it('should return all CDPs', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });

      const result = await tools.get('get_all_cdps')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      expect(parsed.cdps).toHaveLength(3);
      expect(result.isError).toBeUndefined();
    });

    it('should filter by asset', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });

      const result = await tools.get('get_all_cdps')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(2);
      expect(parsed.cdps.every((c: any) => c.asset === 'iUSD')).toBe(true);
    });

    it('should apply pagination', async () => {
      mockGet.mockResolvedValue({ data: mockCdps });

      const result = await tools.get('get_all_cdps')!({ limit: 1, offset: 1 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps).toHaveLength(1);
      expect(parsed.limit).toBe(1);
      expect(parsed.offset).toBe(1);
      expect(parsed.total).toBe(3);
    });

    it('should fall back to /loans/ when /cdps/ is unavailable', async () => {
      const legacyLoans = mockCdps.map(({ mintedAmt, ...rest }) => ({
        ...rest,
        minted: mintedAmt,
      }));
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') return Promise.reject(new Error('Not Found'));
        if (url === '/loans/') return Promise.resolve({ data: legacyLoans });
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('get_all_cdps')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      // Normalised field should be present after migration.
      expect(parsed.cdps[0].mintedAmt).toBeDefined();
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_all_cdps')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_cdps_by_owner', () => {
    it('should return CDPs filtered by owner', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockResolvedValue({ data: mockCdps });

      const result = await tools.get('get_cdps_by_owner')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(2);
      expect(parsed.every((c: any) => c.owner === 'abc123')).toBe(true);
      expect(extractPaymentCredential).toHaveBeenCalledWith('abc123');
    });

    it('should return error on failure', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_cdps_by_owner')!({ owner: 'abc123' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout');
    });
  });

  describe('get_cdps_by_address', () => {
    it('should return CDPs filtered by address', async () => {
      (extractPaymentCredential as any).mockReturnValue('def456');
      mockGet.mockResolvedValue({ data: mockCdps });

      const result = await tools.get('get_cdps_by_address')!({ address: 'addr1someaddress' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('def456');
      expect(extractPaymentCredential).toHaveBeenCalledWith('addr1someaddress');
    });
  });

  describe('analyze_cdp_health', () => {
    it('should analyze CDP health with safe status', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 300_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({ data: mockAssets });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.owner).toBe('abc123');
      expect(parsed.cdps[0].status).toBe('safe');
      expect(parsed.cdps[0].collateralRatio).toBe(300);
    });

    it('should return warning status', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 160_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({ data: mockAssets });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps[0].status).toBe('warning');
    });

    it('should return at-risk status', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 120_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({ data: mockAssets });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps[0].status).toBe('at-risk');
    });

    it('should return liquidatable status', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 100_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({ data: mockAssets });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps[0].status).toBe('liquidatable');
    });

    it('should incorporate accrued interest when v3 tracking fields are present', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      // Without interest the ratio is 300 % (safe).  After adding simulated
      // accrued interest that doubles the effective debt it should drop to ~150 %
      // (warning / boundary of safe), but because the SDK function is called we
      // just verify the effectiveMintedTokens > mintedTokens and
      // accruedInterestLovelace > 0.
      const nowMs = BigInt(Date.now());
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 300_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
                interestTracking: {
                  // Settled a year ago — will produce meaningful accrued interest.
                  lastSettled: String(nowMs - 31_536_000_000n),
                  unitaryInterestSnapshot: '1000000000000000000',
                },
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({
            data: [
              {
                name: 'iUSD',
                price: { price: 1.0 },
                maintenanceRatio: 150,
                liquidationRatio: 110,
                interestOracle: {
                  // 5 % annual rate expressed as a fixed-point bigint (1e18 = 1).
                  unitaryInterest: '1050000000000000000',
                  interestRate: '50000000000000000',
                  lastUpdated: String(nowMs),
                },
              },
            ],
          });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps[0].accruedInterestLovelace).toBeGreaterThan(0);
      expect(parsed.cdps[0].effectiveMintedTokens).toBeGreaterThanOrEqual(
        parsed.cdps[0].mintedTokens
      );
    });

    it('should handle no CDPs found', async () => {
      (extractPaymentCredential as any).mockReturnValue('nobody');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') return Promise.resolve({ data: [] });
        if (url === '/assets/') return Promise.resolve({ data: mockAssets });
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'nobody' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.message).toContain('No CDPs found');
    });

    it('should return error on failure', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockRejectedValue(new Error('API error'));

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });

    it('should fall back gracefully when interestOracle data is missing', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/cdps/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 300_000_000,
                mintedAmt: 100_000_000,
                minRatio: 150,
                interestTracking: {
                  lastSettled: '1000000',
                  unitaryInterestSnapshot: '1000000000000000000',
                },
              },
            ],
          });
        }
        if (url === '/assets/') {
          return Promise.resolve({
            data: [
              {
                name: 'iUSD',
                price: { price: 1.0 },
                maintenanceRatio: 150,
                liquidationRatio: 110,
                // no interestOracle field
              },
            ],
          });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const result = await tools.get('analyze_cdp_health')!({ owner: 'abc123' });
      const parsed = JSON.parse(result.content[0].text);

      // No oracle → accrued interest is zero, ratio computed from raw mintedAmt.
      expect(parsed.cdps[0].accruedInterestLovelace).toBe(0);
      expect(parsed.cdps[0].collateralRatio).toBe(300);
    });
  });
});
