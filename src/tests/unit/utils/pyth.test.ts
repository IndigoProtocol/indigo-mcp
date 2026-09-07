import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/indexer-client.js', () => ({
  getIndexerClient: vi.fn(),
}));

vi.mock('../../../utils/v3-finders.js', () => ({
  findPriceOracleOref: vi.fn(),
}));

vi.mock('../../../utils/sdk-config.js', () => ({
  getSystemParams: vi.fn(),
}));

// Keep the SDK (and its libsodium/WASM dependencies) out of a unit test; only
// the asset-class-to-unit conversion is used here.
vi.mock('@indigo-labs/indigo-sdk', () => ({
  fromSystemParamsAsset: (asset: { unCurrencySymbol: string; unTokenName: string }) => asset,
}));

vi.mock('@indigo-labs/cardano-offchain-common', () => ({
  assetClassToUnit: (asset: { unCurrencySymbol: string; unTokenName: string }) =>
    `${asset.unCurrencySymbol}${asset.unTokenName}`,
}));

import { getIndexerClient } from '../../../utils/indexer-client.js';
import { findPriceOracleOref } from '../../../utils/v3-finders.js';
import { getSystemParams } from '../../../utils/sdk-config.js';
import {
  fetchPythPriceFeed,
  fetchPythStateOref,
  resolvePythStateOref,
  assertPythFeedFresh,
  resolvePriceSource,
  pythSummary,
  PYTH_MAX_DELAY_MS,
} from '../../../utils/pyth.js';

// A real (truncated) Solana-format Pyth message: magic b9011a82 + signed payload.
const PYTH_PAYLOAD = 'b9011a82eb8fd5c098cdde39b3e03ba107081d59b5f7dbd3830f9194e5d7681a8d0dccd2';
const PRICE_TIMESTAMP_S = 1787303581;
const PRICE_TIMESTAMP_MS = PRICE_TIMESTAMP_S * 1_000;

const priceResponse = {
  data: {
    price: '4.739746222611',
    expiration: PRICE_TIMESTAMP_MS + 3_600_000,
    timestamp: PRICE_TIMESTAMP_S,
    pythPayload: PYTH_PAYLOAD,
  },
};

const stateResponse = {
  data: {
    outputHash: '20dedb9c6e51112ac3059366b65c31ee59fc136aa400a16f9d01554fe0da4c6f',
    outputIndex: 0,
  },
};

const mockGet = vi.fn();

/** Route the two analytics endpoints the Pyth helpers depend on. */
function routed(url: string) {
  if (url === '/v3/assets/iUSD/ada/price') return Promise.resolve(priceResponse);
  if (url === '/v3/pyth-state/utxo') return Promise.resolve(stateResponse);
  return Promise.reject(new Error('Unknown endpoint ' + url));
}

/** Freeze the clock just after the price update, well inside the delay window. */
function freezeClockAtPriceTime(offsetMs = 1_000): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(PRICE_TIMESTAMP_MS + offsetMs));
}

describe('pyth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(routed);
    vi.mocked(getIndexerClient).mockReturnValue({ get: mockGet } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchPythPriceFeed', () => {
    it('returns the signed message and its validity window', async () => {
      const feed = await fetchPythPriceFeed('iUSD');

      expect(mockGet).toHaveBeenCalledWith('/v3/assets/iUSD/ada/price');
      expect(feed.pythMessage).toBe(PYTH_PAYLOAD);
      expect(feed.price).toBe('4.739746222611');
      expect(feed.timestampMs).toBe(PRICE_TIMESTAMP_MS);
      expect(feed.validUntilMs).toBe(PRICE_TIMESTAMP_MS + PYTH_MAX_DELAY_MS);
    });

    it('uses the requested collateral in the path', async () => {
      mockGet.mockResolvedValueOnce(priceResponse);
      await fetchPythPriceFeed('iBTC', 'ada');
      expect(mockGet).toHaveBeenCalledWith('/v3/assets/iBTC/ada/price');
    });

    it('throws when the API returns no payload', async () => {
      mockGet.mockResolvedValueOnce({ data: { price: '1.0', timestamp: PRICE_TIMESTAMP_S } });
      await expect(fetchPythPriceFeed('iUSD')).rejects.toThrow(/No Pyth payload/);
    });
  });

  describe('fetchPythStateOref', () => {
    it('maps the analytics response onto an OutRef', async () => {
      await expect(fetchPythStateOref()).resolves.toEqual({
        txHash: stateResponse.data.outputHash,
        outputIndex: 0,
      });
    });

    it('throws when the API returns no state UTxO', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      await expect(fetchPythStateOref()).rejects.toThrow(/did not return a Pyth state UTxO/);
    });
  });

  describe('resolvePythStateOref', () => {
    // The state UTxO is whichever UTxO holds the pythStateAssetClass NFT, so
    // the chain can answer when the analytics API cannot.
    const pythStateAssetClass = {
      unCurrencySymbol: 'c935c937d0deda8975142c7b77aeef8f8cd48791e89a8ca7a0edc154',
      unTokenName: 'Pyth State',
    };
    const lucid = { utxoByUnit: vi.fn() };

    beforeEach(() => {
      lucid.utxoByUnit.mockReset();
      vi.mocked(getSystemParams).mockResolvedValue({
        pythConfig: { pythStateAssetClass },
      } as never);
    });

    it('prefers the analytics API and does not touch the chain', async () => {
      await expect(resolvePythStateOref(lucid as never)).resolves.toEqual({
        txHash: stateResponse.data.outputHash,
        outputIndex: 0,
      });
      expect(lucid.utxoByUnit).not.toHaveBeenCalled();
    });

    it('falls back to the on-chain Pyth state NFT when the API fails', async () => {
      mockGet.mockRejectedValueOnce(new Error('503 Service Unavailable'));
      lucid.utxoByUnit.mockResolvedValue({ txHash: 'on-chain-hash', outputIndex: 2 });

      await expect(resolvePythStateOref(lucid as never)).resolves.toEqual({
        txHash: 'on-chain-hash',
        outputIndex: 2,
      });
      expect(lucid.utxoByUnit).toHaveBeenCalledTimes(1);
    });

    it('reports both failures when neither source can answer', async () => {
      mockGet.mockRejectedValueOnce(new Error('503 Service Unavailable'));
      lucid.utxoByUnit.mockRejectedValue(new Error('no utxo found'));

      await expect(resolvePythStateOref(lucid as never)).rejects.toThrow(
        /503 Service Unavailable.*no utxo found/s
      );
    });
  });

  describe('assertPythFeedFresh', () => {
    const feed = {
      price: '1.0',
      pythMessage: PYTH_PAYLOAD,
      timestampMs: PRICE_TIMESTAMP_MS,
      validUntilMs: PRICE_TIMESTAMP_MS + PYTH_MAX_DELAY_MS,
    };

    it('accepts an update inside the on-chain delay window', () => {
      freezeClockAtPriceTime(PYTH_MAX_DELAY_MS - 1_000);
      expect(() => assertPythFeedFresh(feed, 'iUSD')).not.toThrow();
    });

    it('rejects an update past the on-chain delay window', () => {
      freezeClockAtPriceTime(PYTH_MAX_DELAY_MS + 60_000);
      expect(() => assertPythFeedFresh(feed, 'iUSD')).toThrow(/beyond the 280s/);
    });
  });

  describe('resolvePriceSource', () => {
    const collateralOut = { utxo: {}, datum: {} } as never;

    it('returns the oracle OutRef for OracleNft-priced assets and skips Pyth', async () => {
      const oracleOref = { txHash: 'abc', outputIndex: 1 };
      vi.mocked(findPriceOracleOref).mockResolvedValue(oracleOref);

      const source = await resolvePriceSource({} as never, collateralOut, 'iUSD');

      expect(source.priceOracleOref).toEqual(oracleOref);
      expect(source.pythMessage).toBeUndefined();
      expect(source.pythStateOref).toBeUndefined();
      expect(source.pythFeed).toBeUndefined();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('fetches the message and state UTxO for Pyth-priced assets', async () => {
      freezeClockAtPriceTime();
      vi.mocked(findPriceOracleOref).mockResolvedValue(undefined);

      const source = await resolvePriceSource({} as never, collateralOut, 'iUSD');

      expect(source.priceOracleOref).toBeUndefined();
      expect(source.pythMessage).toBe(PYTH_PAYLOAD);
      expect(source.pythStateOref).toEqual({
        txHash: stateResponse.data.outputHash,
        outputIndex: 0,
      });
      expect(source.pythFeed?.price).toBe('4.739746222611');
    });

    it('fails loudly when the available Pyth update is already too old', async () => {
      freezeClockAtPriceTime(PYTH_MAX_DELAY_MS + 60_000);
      vi.mocked(findPriceOracleOref).mockResolvedValue(undefined);

      await expect(resolvePriceSource({} as never, collateralOut, 'iUSD')).rejects.toThrow(
        /beyond the 280s on-chain validity window/
      );
    });
  });

  describe('pythSummary', () => {
    it('is undefined for oracle-priced transactions', () => {
      expect(
        pythSummary({
          priceOracleOref: { txHash: 'abc', outputIndex: 0 },
          pythMessage: undefined,
          pythStateOref: undefined,
          pythFeed: undefined,
        })
      ).toBeUndefined();
    });

    it('reports the price and the submission deadline', () => {
      const summary = pythSummary({
        priceOracleOref: undefined,
        pythMessage: PYTH_PAYLOAD,
        pythStateOref: { txHash: 'abc', outputIndex: 0 },
        pythFeed: {
          price: '4.739746222611',
          pythMessage: PYTH_PAYLOAD,
          timestampMs: PRICE_TIMESTAMP_MS,
          validUntilMs: PRICE_TIMESTAMP_MS + PYTH_MAX_DELAY_MS,
        },
      });

      expect(summary).toEqual({
        price: '4.739746222611',
        priceTimestamp: new Date(PRICE_TIMESTAMP_MS).toISOString(),
        submitBefore: new Date(PRICE_TIMESTAMP_MS + PYTH_MAX_DELAY_MS).toISOString(),
      });
    });
  });
});
