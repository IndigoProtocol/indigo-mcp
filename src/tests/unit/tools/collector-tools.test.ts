import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { registerCollectorTools } from '../../../tools/collector-tools.js';

function createTestServer() {
  const tools = new Map<string, Function>();
  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe('collector tools', () => {
  let tools: Map<string, Function>;
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getIndexerClient as any).mockReturnValue({ get: mockGet, post: mockPost });
    const testServer = createTestServer();
    tools = testServer.tools;
    registerCollectorTools(testServer.server);
  });

  describe('get_collector_utxos', () => {
    it('should GET when no length provided', async () => {
      const mockData = [{ txHash: 'abc123', index: 0 }];
      mockGet.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_collector_utxos')!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/collector/utxos');
    });

    it('should POST when length provided', async () => {
      const mockData = [{ txHash: 'abc123', index: 0 }];
      mockPost.mockResolvedValue({ data: mockData });

      const result = await tools.get('get_collector_utxos')!({ length: 10 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(mockData);
      expect(mockPost).toHaveBeenCalledWith('/collector/utxos', { length: 10 });
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await tools.get('get_collector_utxos')!({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('store_on_ipfs', () => {
    it('should store text on IPFS', async () => {
      mockPost.mockResolvedValue({ data: { cid: 'QmTest123' } });

      const result = await tools.get('store_on_ipfs')!({ text: 'Hello IPFS' });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockPost).toHaveBeenCalledWith('/web3/store', { text: 'Hello IPFS' });
      expect(parsed.cid).toBe('QmTest123');
    });

    it('should return error on failure', async () => {
      mockPost.mockRejectedValue(new Error('Storage error'));

      const result = await tools.get('store_on_ipfs')!({ text: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Storage error');
    });
  });

  describe('retrieve_from_ipfs', () => {
    it('should retrieve content by CID', async () => {
      mockGet.mockResolvedValue({ data: { content: 'Hello World' } });

      const result = await tools.get('retrieve_from_ipfs')!({ cid: 'QmTest123' });
      const parsed = JSON.parse(result.content[0].text);

      expect(mockGet).toHaveBeenCalledWith('/web3/retrieve/QmTest123');
      expect(parsed.content).toBe('Hello World');
    });

    it('should return error on failure', async () => {
      mockGet.mockRejectedValue(new Error('CID not found'));

      const result = await tools.get('retrieve_from_ipfs')!({ cid: 'QmInvalid' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('CID not found');
    });
  });
});
