import { describe, it, expect, beforeEach } from 'vitest';

describe('indexer client', () => {
  beforeEach(async () => {
    // Reset the module to clear the singleton between tests
    const mod = await import('../../utils/indexer-client.js');
    // We need to re-import fresh each time, so we use dynamic imports
    // But vitest caches modules, so we use vi.resetModules in a different way
  });

  it('should return an axios instance', async () => {
    const { getIndexerClient } = await import('../../utils/indexer-client.js');
    const client = getIndexerClient();

    expect(client).toBeDefined();
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.delete).toBe('function');
  });

  it('should return the same instance on subsequent calls (singleton)', async () => {
    const { getIndexerClient } = await import('../../utils/indexer-client.js');
    const client1 = getIndexerClient();
    const client2 = getIndexerClient();

    expect(client1).toBe(client2);
  });

  it('should have correct default base URL', async () => {
    const { getIndexerClient } = await import('../../utils/indexer-client.js');
    const client = getIndexerClient();

    expect(client.defaults.baseURL).toBe(
      process.env.INDEXER_URL || 'https://analytics.indigoprotocol.io/api/v1',
    );
  });

  it('should have JSON content type headers', async () => {
    const { getIndexerClient } = await import('../../utils/indexer-client.js');
    const client = getIndexerClient();

    expect(client.defaults.headers['Content-Type']).toBe('application/json');
    expect(client.defaults.headers['Accept']).toBe('application/json');
  });

  it('should have a timeout configured', async () => {
    const { getIndexerClient } = await import('../../utils/indexer-client.js');
    const client = getIndexerClient();

    expect(client.defaults.timeout).toBe(15000);
  });

  it('getLiquidations should be a function', async () => {
    const { getLiquidations } = await import('../../utils/indexer-client.js');

    expect(typeof getLiquidations).toBe('function');
  });
});