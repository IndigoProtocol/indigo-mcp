import type { SystemParams } from '@indigo-labs/indigo-sdk';
import { loadSystemParamsFromUrl } from '@indigo-labs/indigo-sdk';

const SYSTEM_PARAMS_URL =
  'https://config.indigoprotocol.io/mainnet/mainnet-system-params-v3.json';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedParams: SystemParams | null = null;
let cacheTimestamp = 0;

/**
 * Load the Indigo v3 system parameters from the mainnet v3 config endpoint.
 *
 * The v3 SystemParams shape adds Pyth price configuration, the interest
 * collection contract, the version registry, and multi-collateral support.
 */
export async function getSystemParams(): Promise<SystemParams> {
  const now = Date.now();
  if (cachedParams && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedParams;
  }

  cachedParams = await loadSystemParamsFromUrl(SYSTEM_PARAMS_URL);
  cacheTimestamp = now;
  return cachedParams;
}

export function resetSystemParamsCache(): void {
  cachedParams = null;
  cacheTimestamp = 0;
}
