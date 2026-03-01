import type { SystemParams } from '@indigo-labs/indigo-sdk';
import { loadSystemParamsFromUrl } from '@indigo-labs/indigo-sdk';

const SYSTEM_PARAMS_URL =
  'https://config.indigoprotocol.io/mainnet/mainnet-system-params-v21-lrp.json';

let cachedParams: SystemParams | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
