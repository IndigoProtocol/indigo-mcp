import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
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

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
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
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_stability_pool_accounts', () => {
    it('explains per-account data is not indexed in v3', async () => {
      const result = await tools.get('get_stability_pool_accounts')!({});
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('not exposed by the v3 indexer');
    });
  });

  describe('get_sp_account_by_owner', () => {
    it('explains per-account data is not indexed in v3', async () => {
      const result = await tools.get('get_sp_account_by_owner')!({ owners: ['owner1'] });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('not exposed by the v3 indexer');
    });
  });
});
