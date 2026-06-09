import type { SystemParams } from '@indigoprotocol/indigo-sdk';
import { loadSystemParamsFromUrl } from '@indigoprotocol/indigo-sdk';
import type { SystemParams as SystemParamsV3 } from '@indigo-labs/indigo-sdk';
import { loadSystemParamsFromUrl as loadSystemParamsFromUrlV3 } from '@indigo-labs/indigo-sdk';

const SYSTEM_PARAMS_URL =
  'https://config.indigoprotocol.io/mainnet/mainnet-system-params-v21-lrp.json';

const SYSTEM_PARAMS_URL_V3 =
  'https://config.indigoprotocol.io/mainnet/mainnet-system-params-v3.json';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedParams: SystemParams | null = null;
let cacheTimestamp = 0;

let cachedParamsV3: SystemParamsV3 | null = null;
let cacheTimestampV3 = 0;

/**
 * Load the legacy (Indigo v1/v2) system parameters.
 *
 * @deprecated Retained only for tools that have not yet been migrated to the
 * Indigo v3 SDK. New code should use {@link getSystemParamsV3}. This loader and
 * the legacy `@indigoprotocol/indigo-sdk` dependency are removed once every
 * write tool is migrated (see Linear 3RD-421).
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

/**
 * Load the Indigo v3 system parameters from the mainnet v3 config endpoint.
 *
 * The v3 SystemParams shape differs substantially from v1 (it adds Pyth price
 * configuration, the interest collection contract, the version registry, and
 * multi-collateral support), so it is exposed under a distinct accessor while
 * tools are migrated incrementally.
 */
export async function getSystemParamsV3(): Promise<SystemParamsV3> {
  const now = Date.now();
  if (cachedParamsV3 && now - cacheTimestampV3 < CACHE_TTL_MS) {
    return cachedParamsV3;
  }

  cachedParamsV3 = await loadSystemParamsFromUrlV3(SYSTEM_PARAMS_URL_V3);
  cacheTimestampV3 = now;
  return cachedParamsV3;
}

export function resetSystemParamsCache(): void {
  cachedParams = null;
  cacheTimestamp = 0;
  cachedParamsV3 = null;
  cacheTimestampV3 = 0;
}
