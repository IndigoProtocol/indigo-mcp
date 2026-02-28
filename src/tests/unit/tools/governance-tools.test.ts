import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerGovernanceTools } from '../../../tools/governance-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('governance tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerGovernanceTools(testServer.server);
  });

  describe('get_protocol_params', () => {
    it('should return protocol params', async () => {
      const mockData = { minCollateral: 150, liquidationFee: 10 };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_protocol_params')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/protocol-params/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_protocol_params')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_temperature_checks', () => {
    it('should return temperature checks', async () => {
      const mockData = [{ id: 1, title: 'Proposal A' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_temperature_checks')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/polls/temperature-checks');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const result = await tools.get('get_temperature_checks')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_sync_status', () => {
    it('should return sync status', async () => {
      const mockData = { slot: 12345, synced: true };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_sync_status')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/sync/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Error'));

      const result = await tools.get('get_sync_status')!({});

      expect(result.isError).toBe(true);
    });
  });

  describe('get_polls', () => {
    it('should return all polls', async () => {
      const mockData = [{ id: 1, title: 'Poll 1' }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_polls')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/polls/');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      const result = await tools.get('get_polls')!({});

      expect(result.isError).toBe(true);
    });
  });
});
