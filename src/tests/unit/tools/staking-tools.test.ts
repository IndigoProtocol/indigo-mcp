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

describe('staking tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerStakingTools(testServer.server);
  });

  describe('get_staking_info', () => {
    it('should return staking info', async () => {
      const mockData = { totalStake: 1000000, slot: 12345 };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_staking_info')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/staking/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_staking_info')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_staking_positions', () => {
    it('should return all staking positions', async () => {
      const mockData = [{ owner: 'abc', stake: 500 }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_staking_positions')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/staking/positions');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_staking_positions')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_staking_positions_by_owner', () => {
    it('should post with converted owners', async () => {
      (extractPaymentCredential as any).mockImplementation((o: string) => `pkh_${o}`);
      mockPost.mockResolvedValue({ data: [{ owner: 'pkh_owner1', stake: 100 }] });

      const result = await tools.get('get_staking_positions_by_owner')!({ owners: ['owner1'] });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/staking/positions', { owners: ['pkh_owner1'] });
      expect(parsed).toHaveLength(1);
    });

    it('should return error on failure', async () => {
      (extractPaymentCredential as any).mockImplementation((o: string) => o);
      mockPost.mockRejectedValue(new Error('Server error'));

      const result = await tools.get('get_staking_positions_by_owner')!({ owners: ['o1'] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Server error');
    });
  });

  describe('get_staking_position_by_address', () => {
    it('should convert address and post', async () => {
      (extractPaymentCredential as any).mockReturnValue('pkh_abc');
      mockPost.mockResolvedValue({ data: [{ owner: 'pkh_abc', stake: 200 }] });

      const result = await tools.get('get_staking_position_by_address')!({ address: 'addr1test' });
      const parsed = JSON.parse(result.content[0].text);

      expect(extractPaymentCredential).toHaveBeenCalledWith('addr1test');
      expect(mockPost).toHaveBeenCalledWith('/staking/positions', { owners: ['pkh_abc'] });
      expect(parsed).toHaveLength(1);
    });

    it('should return error on failure', async () => {
      (extractPaymentCredential as any).mockReturnValue('pkh');
      mockPost.mockRejectedValue(new Error('Error'));

      const result = await tools.get('get_staking_position_by_address')!({ address: 'addr1x' });

      expect(result.isError).toBe(true);
    });
  });
});
