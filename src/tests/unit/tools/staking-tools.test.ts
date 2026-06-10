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
import { registerStakingTools } from '../../../tools/staking-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

const mockPositions = [
  { owner: 'pkh_a', staked_indy: 100 },
  { owner: 'pkh_b', staked_indy: 200 },
];

describe('staking tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    (extractPaymentCredential as any).mockImplementation((s: string) => s);
    const testServer = createTestServer();
    tools = testServer.tools;
    registerStakingTools(testServer.server);
  });

  describe('get_staking_info', () => {
    it('reads the v3 staking manager', async () => {
      const mockData = { total_stake: 1000000, snapshot_ada: 5 };
      mockGet.mockResolvedValue({ data: mockData });
      const result = await tools.get('get_staking_info')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/staking-manager');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await tools.get('get_staking_info')!({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_staking_positions', () => {
    it('reads the v3 staking positions', async () => {
      mockGet.mockResolvedValue({ data: mockPositions });
      const result = await tools.get('get_staking_positions')!({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockPositions);
      expect(mockGet).toHaveBeenCalledWith('/staking-positions');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));
      const result = await tools.get('get_staking_positions')!({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_staking_positions_by_owner', () => {
    it('filters positions client-side by owner', async () => {
      mockGet.mockResolvedValue({ data: mockPositions });
      const result = await tools.get('get_staking_positions_by_owner')!({ owners: ['pkh_a'] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('pkh_a');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));
      const result = await tools.get('get_staking_positions_by_owner')!({ owners: ['pkh_a'] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Server error');
    });
  });

  describe('get_staking_position_by_address', () => {
    it('filters positions by the address credential', async () => {
      mockGet.mockResolvedValue({ data: mockPositions });
      const result = await tools.get('get_staking_position_by_address')!({ address: 'pkh_b' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('pkh_b');
      expect(extractPaymentCredential).toHaveBeenCalledWith('pkh_b');
    });

    it('returns error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Error'));
      const result = await tools.get('get_staking_position_by_address')!({ address: 'pkh_b' });
      expect(result.isError).toBe(true);
    });
  });
});
