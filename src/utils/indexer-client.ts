import axios, { type AxiosInstance } from 'axios';

const DEFAULT_INDEXER_URL = 'https://analytics.indigoprotocol.io/api';

/**
 * Normalise a configured indexer base URL.
 *
 * Tool paths carry their own API version where the v3 indexer needs one
 * (`/v3/analytics/tvl`) while others are unversioned (`/assets`), so the base
 * must stop at `/api`. A base that ends in a version segment breaks roughly
 * half the read tools and leaves the rest working, which reads like a partial
 * outage rather than a misconfiguration:
 *
 * - `/api/v1` — written into MCP client configs by older setup wizards; v1 is
 *   retired, so every route 404s.
 * - `/api/v3` — the natural "fix" to try; doubles the prefix on versioned
 *   paths (`/api/v3/v3/analytics/tvl`).
 *
 * Rather than fail, drop the trailing version and say so once on stderr.
 */
export function normalizeIndexerUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const withoutVersion = trimmed.replace(/\/v\d+$/, '');

  if (withoutVersion !== trimmed) {
    process.stderr.write(
      `Indigo MCP: INDEXER_URL "${url}" ends in an API version; using "${withoutVersion}". ` +
        'Tool paths carry their own version — set the base URL without one.\n'
    );
  }

  return withoutVersion;
}

const INDEXER_URL = normalizeIndexerUrl(process.env.INDEXER_URL || DEFAULT_INDEXER_URL);

let instance: AxiosInstance | null = null;

export function getIndexerClient(): AxiosInstance {
  if (!instance) {
    instance = axios.create({
      baseURL: INDEXER_URL,
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
  return instance;
}

export async function getLiquidations(): Promise<unknown> {
  const client = getIndexerClient();
  const response = await client.get('/liquidations');
  return response.data;
}
