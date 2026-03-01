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

const mockLoans = [
  { owner: 'abc123', asset: 'iUSD', collateral: 150_000_000, minted: 100_000_000, minRatio: 150 },
  { owner: 'abc123', asset: 'iBTC', collateral: 200_000_000, minted: 50_000_000, minRatio: 150 },
  { owner: 'def456', asset: 'iUSD', collateral: 300_000_000, minted: 200_000_000, minRatio: 150 },
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
      mockGet.mockResolvedValue({ data: mockLoans });

      const result = await tools.get('get_all_cdps')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      expect(parsed.cdps).toHaveLength(3);
      expect(result.isError).toBeUndefined();
    });

    it('should filter by asset', async () => {
      mockGet.mockResolvedValue({ data: mockLoans });

      const result = await tools.get('get_all_cdps')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(2);
      expect(parsed.cdps.every((c: any) => c.asset === 'iUSD')).toBe(true);
    });

    it('should apply pagination', async () => {
      mockGet.mockResolvedValue({ data: mockLoans });

      const result = await tools.get('get_all_cdps')!({ limit: 1, offset: 1 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.cdps).toHaveLength(1);
      expect(parsed.limit).toBe(1);
      expect(parsed.offset).toBe(1);
      expect(parsed.total).toBe(3);
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
      mockGet.mockResolvedValue({ data: mockLoans });

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
      mockGet.mockResolvedValue({ data: mockLoans });

      const result = await tools.get('get_cdps_by_address')!({ address: 'addr1someaddress' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('def456');
      expect(extractPaymentCredential).toHaveBeenCalledWith('addr1someaddress');
    });
  });

  describe('analyze_cdp_health', () => {
    const mockAssets = [
      {
        name: 'iUSD',
        price: { price: 1.0 },
        interest: { ratio: 1.0, minRatio: 150, liquidation: 110 },
      },
      {
        name: 'iBTC',
        price: { price: 60000 },
        interest: { ratio: 1.0, minRatio: 150, liquidation: 110 },
      },
    ];

    it('should analyze CDP health with safe status', async () => {
      (extractPaymentCredential as any).mockReturnValue('abc123');
      mockGet.mockImplementation((url: string) => {
        if (url === '/loans/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 300_000_000,
                minted: 100_000_000,
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
        if (url === '/loans/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 160_000_000,
                minted: 100_000_000,
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
        if (url === '/loans/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 120_000_000,
                minted: 100_000_000,
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
        if (url === '/loans/') {
          return Promise.resolve({
            data: [
              {
                owner: 'abc123',
                asset: 'iUSD',
                collateral: 100_000_000,
                minted: 100_000_000,
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

    it('should handle no CDPs found', async () => {
      (extractPaymentCredential as any).mockReturnValue('nobody');
      mockGet.mockImplementation((url: string) => {
        if (url === '/loans/') return Promise.resolve({ data: [] });
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
  });
});
