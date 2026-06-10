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

const mockAccounts = [
  { owner: 'pkh_a', asset: 'iUSD' },
  { owner: 'pkh_b', asset: 'iBTC' },
];

describe('stability pool tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    (extractPaymentCredential as any).mockImplementation((s: string) => s);
    const testServer = createTestServer();
    tools = testServer.tools;
    registerStabilityPoolTools(testServer.server);
  });

  describe('get_stability_pools', () => {
    it('reads /stability-pools', async () => {
      const mockData = [{ asset: 'iUSD', snapshotP: '1.0' }];
      mockGet.mockResolvedValue({ data: mockData });
      const result = await tools.get('get_stability_pools')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/stability-pools');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_stability_pools')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_stability_pool_accounts', () => {
    it('reads /v3/stability-pools/accounts and filters by asset', async () => {
      mockGet.mockResolvedValue({ data: mockAccounts });
      const result = await tools.get('get_stability_pool_accounts')!({ asset: 'iUSD' });
      const parsed = JSON.parse(result.content[0].text);
      expect(mockGet).toHaveBeenCalledWith('/v3/stability-pools/accounts');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].asset).toBe('iUSD');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_stability_pool_accounts')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_sp_account_by_owner', () => {
    it('filters accounts client-side by owner', async () => {
      mockGet.mockResolvedValue({ data: mockAccounts });
      const result = await tools.get('get_sp_account_by_owner')!({ owners: ['pkh_b'] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('pkh_b');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));
      const result = await tools.get('get_sp_account_by_owner')!({ owners: ['pkh_b'] });
      expect(result.isError).toBe(true);
    });
  });
});
