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
import { registerStabilityPoolTools } from '../../../tools/stability-pool-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('stability pool tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerStabilityPoolTools(testServer.server);
  });

  describe('get_stability_pools', () => {
    it('should return stability pools', async () => {
      const mockData = [{ asset: 'iUSD', snapshotP: '1.0' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_stability_pools')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/stability-pools/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_stability_pools')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_stability_pool_accounts', () => {
    it('should return all accounts', async () => {
      const mockAccounts = [
        { asset: 'iUSD', owner: 'abc' },
        { asset: 'iBTC', owner: 'def' },
      ];
      mockGet.mockResolvedValue({ data: mockAccounts });

      const result = await tools.get('get_stability_pool_accounts')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(2);
    });

    it('should filter by asset', async () => {
      const mockAccounts = [
        { asset: 'iUSD', owner: 'abc' },
        { asset: 'iBTC', owner: 'def' },
      ];
      mockGet.mockResolvedValue({ data: mockAccounts });

      const result = await tools.get('get_stability_pool_accounts')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].asset).toBe('iUSD');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_stability_pool_accounts')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout');
    });
  });

  describe('get_sp_account_by_owner', () => {
    it('should post with converted owners', async () => {
      (extractPaymentCredential as any).mockImplementation((o: string) => `pkh_${o}`);
      mockPost.mockResolvedValue({ data: [{ owner: 'pkh_owner1' }] });

      const result = await tools.get('get_sp_account_by_owner')!({ owners: ['owner1', 'owner2'] });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/stability-pools/accounts', {
        owners: ['pkh_owner1', 'pkh_owner2'],
      });
      expect(parsed).toHaveLength(1);
    });

    it('should return error on failure', async () => {
      (extractPaymentCredential as any).mockImplementation((o: string) => o);
      mockPost.mockRejectedValue(new Error('Server error'));

      const result = await tools.get('get_sp_account_by_owner')!({ owners: ['owner1'] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Server error');
    });
  });
});
