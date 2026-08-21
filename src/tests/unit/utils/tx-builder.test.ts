import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/lucid-provider.js', () => ({
  getLucid: vi.fn(),
}));

import { getLucid } from '../../../utils/lucid-provider.js';
import { buildUnsignedTx } from '../../../utils/tx-builder.js';

/** Minimal stand-in for a completed Lucid transaction. */
function completedTx(fee: string) {
  return {
    toCBOR: () => 'cbor-hex',
    toHash: () => 'tx-hash',
    toTransaction: () => ({ body: () => ({ fee: () => fee }) }),
  };
}

/**
 * Stand-in for a Lucid TxBuilder. `failWith` is thrown by the first
 * `complete()` of each builder instance unless a minimum fee has been set.
 */
function makeTxBuilder(failWith?: unknown) {
  const state = { minFee: undefined as bigint | undefined, metadata: [] as unknown[] };
  const builder = {
    state,
    attachMetadata: vi.fn((label: number, msg: unknown) => {
      state.metadata.push([label, msg]);
      return builder;
    }),
    setMinFee: vi.fn((fee: bigint) => {
      state.minFee = fee;
      return builder;
    }),
    complete: vi.fn(() => {
      if (failWith !== undefined && state.minFee === undefined) return Promise.reject(failWith);
      return Promise.resolve(completedTx(state.minFee ? state.minFee.toString() : '170000'));
    }),
  };
  return builder;
}

const SUMMARY = { type: 'open_cdp', description: 'Open iUSD CDP', inputs: { asset: 'iUSD' } };

describe('buildUnsignedTx', () => {
  const lucid = {
    utxosAt: vi.fn(() => Promise.resolve([])),
    selectWallet: { fromAddress: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLucid).mockResolvedValue(lucid as never);
  });

  it('returns the completed transaction with its summary', async () => {
    const builder = makeTxBuilder();
    const result = await buildUnsignedTx('addr1', () => Promise.resolve(builder as never), {
      ...SUMMARY,
    });

    expect(result).toMatchObject({ unsignedTx: 'cbor-hex', txHash: 'tx-hash', fee: '170000' });
    expect(builder.attachMetadata).toHaveBeenCalledTimes(1);
    expect(builder.setMinFee).not.toHaveBeenCalled();
  });

  it('carries the Pyth pricing the build function reports into the summary', async () => {
    const pyth = {
      price: '4.61',
      priceTimestamp: '2026-08-21T09:52:41.000Z',
      submitBefore: '2026-08-21T09:57:21.000Z',
    };

    const result = await buildUnsignedTx(
      'addr1',
      (_lucid, ctx) => {
        ctx.pyth = pyth;
        return Promise.resolve(makeTxBuilder() as never);
      },
      { ...SUMMARY }
    );

    expect(result.summary.pyth).toEqual(pyth);
  });

  it('rebuilds at the suggested minimum fee when coin selection shifts', async () => {
    // Lucid throws a plain object here, not an Error.
    const lucidError = {
      Complete:
        'RedeemerBuilder: Coin selection had to be updated after building redeemers, ' +
        'possibly leading to incorrect indices. Try setting a minimum fee of 1115401 lovelaces.',
    };

    const builders: ReturnType<typeof makeTxBuilder>[] = [];
    const result = await buildUnsignedTx(
      'addr1',
      () => {
        const builder = makeTxBuilder(lucidError);
        builders.push(builder);
        return Promise.resolve(builder as never);
      },
      { ...SUMMARY }
    );

    // A failed builder still holds its mints and redeemers, so the retry must
    // assemble a fresh one rather than completing the same builder twice.
    expect(builders).toHaveLength(2);
    expect(builders[0].setMinFee).not.toHaveBeenCalled();
    expect(builders[1].setMinFee).toHaveBeenCalledWith(1115401n);
    expect(builders[1].complete).toHaveBeenCalledTimes(1);
    expect(result.fee).toBe('1115401');
  });

  it('propagates errors that are not a minimum-fee hint', async () => {
    const builder = makeTxBuilder(new Error('Insufficient input in transaction'));

    await expect(
      buildUnsignedTx('addr1', () => Promise.resolve(builder as never), { ...SUMMARY })
    ).rejects.toThrow(/Insufficient input/);
  });
});
