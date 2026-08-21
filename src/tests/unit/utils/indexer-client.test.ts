import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeIndexerUrl } from '../../../utils/indexer-client.js';

describe('normalizeIndexerUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves a correct base URL alone', () => {
    expect(normalizeIndexerUrl('https://analytics.indigoprotocol.io/api')).toBe(
      'https://analytics.indigoprotocol.io/api'
    );
  });

  it('drops a trailing slash', () => {
    expect(normalizeIndexerUrl('https://analytics.indigoprotocol.io/api/')).toBe(
      'https://analytics.indigoprotocol.io/api'
    );
  });

  it('drops the retired v1 segment older setup wizards wrote', () => {
    expect(normalizeIndexerUrl('https://analytics.indigoprotocol.io/api/v1')).toBe(
      'https://analytics.indigoprotocol.io/api'
    );
  });

  it('drops a v3 segment, which would otherwise double the prefix', () => {
    expect(normalizeIndexerUrl('https://analytics.indigoprotocol.io/api/v3')).toBe(
      'https://analytics.indigoprotocol.io/api'
    );
  });

  it('warns on stderr when it rewrites the URL', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    normalizeIndexerUrl('https://analytics.indigoprotocol.io/api/v1');

    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0][0]).toMatch(/ends in an API version/);
  });

  it('stays silent for a base URL it does not touch', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    normalizeIndexerUrl('http://localhost:3001/api');

    expect(stderr).not.toHaveBeenCalled();
  });

  it('keeps a version that is part of the host path rather than the tail', () => {
    expect(normalizeIndexerUrl('https://example.test/v3/indexer/api')).toBe(
      'https://example.test/v3/indexer/api'
    );
  });
});
