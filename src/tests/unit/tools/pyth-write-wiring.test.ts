import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Guards the wiring that unblocked Pyth-priced iAssets: every price-dependent
 * write tool must forward the signed Pyth message and the Pyth state OutRef to
 * the SDK builder, in the trailing argument positions the builders expect, and
 * must pass `undefined` for the price-oracle OutRef while doing so.
 */

vi.mock('@indigo-labs/indigo-sdk', () =>
  Object.fromEntries(
    [
      'openCdp',
      'depositCdp',
      'withdrawCdp',
      'closeCdp',
      'mintCdp',
      'burnCdp',
      'liquidateCdp',
      'redeemCdp',
      'freezeCdp',
      'mergeCdps',
      'leverageCdpWithRob',
      'openRob',
      'cancelRob',
      'adjustRob',
      'claimRob',
      'redeemRob',
    ].map((name) => [name, vi.fn(() => Promise.resolve('tx-builder'))])
  )
);

vi.mock('../../../utils/sdk-config.js', () => ({
  getSystemParams: vi.fn(() => Promise.resolve({ params: true })),
}));

const utxo = (txHash: string) => ({ txHash, outputIndex: 0 });
const oref = (txHash: string) => ({ txHash, outputIndex: 0 });

vi.mock('../../../utils/v3-finders.js', () => ({
  ADA_COLLATERAL: { currencySymbol: new Uint8Array(), tokenName: new Uint8Array() },
  toOutRef: (u: { txHash: string; outputIndex: number }) => ({
    txHash: u.txHash,
    outputIndex: u.outputIndex,
  }),
  findIAsset: vi.fn(() => Promise.resolve({ utxo: utxo('iasset'), datum: {} })),
  findCollateralAsset: vi.fn(() => Promise.resolve({ utxo: utxo('collateral'), datum: {} })),
  findCdpCreatorOref: vi.fn(() => Promise.resolve(oref('cdp-creator'))),
  findInterestOracleOref: vi.fn(() => Promise.resolve(oref('interest-oracle'))),
  findInterestCollectorOref: vi.fn(() => Promise.resolve(oref('interest-collector'))),
  findTreasuryOref: vi.fn(() => Promise.resolve(oref('treasury'))),
  findGov: vi.fn(() => Promise.resolve({ utxo: utxo('gov'), datum: {} })),
  findStabilityPool: vi.fn(() => Promise.resolve({ utxo: utxo('stability-pool'), datum: {} })),
  findAllRobs: vi.fn(() => Promise.resolve([[utxo('rob'), {}]])),
}));

const PYTH_MESSAGE = 'b9011a82deadbeef';
const PYTH_STATE_OREF = { txHash: 'pyth-state', outputIndex: 0 };
const PYTH_SUMMARY = {
  price: '4.739746222611',
  priceTimestamp: '2026-08-21T09:13:01.000Z',
  submitBefore: '2026-08-21T09:17:41.000Z',
};

vi.mock('../../../utils/pyth.js', () => ({
  resolvePriceSource: vi.fn(() =>
    Promise.resolve({
      priceOracleOref: undefined,
      pythMessage: PYTH_MESSAGE,
      pythStateOref: PYTH_STATE_OREF,
      pythFeed: { price: PYTH_SUMMARY.price },
    })
  ),
  pythSummary: vi.fn(() => PYTH_SUMMARY),
}));

// Run the tool's build closure the way the real buildUnsignedTx does, so the
// Pyth summary the closure writes into the context reaches the result.
vi.mock('../../../utils/tx-builder.js', () => ({
  buildUnsignedTx: vi.fn(
    async (
      _address: string,
      buildFn: (lucid: unknown, ctx: { pyth?: unknown }) => Promise<unknown>,
      summary: Record<string, unknown>
    ) => {
      const ctx: { pyth?: unknown } = {};
      await buildFn({ currentSlot: () => 123 }, ctx);
      return {
        unsignedTx: 'cbor',
        txHash: 'hash',
        fee: '0',
        summary: ctx.pyth ? { ...summary, pyth: ctx.pyth } : summary,
      };
    }
  ),
}));

import * as sdk from '@indigo-labs/indigo-sdk';
import { registerCdpWriteTools } from '../../../tools/cdp-write-tools.js';
import { registerCdpMintBurnTools } from '../../../tools/cdp-mint-burn-tools.js';
import { registerCdpLiquidationTools } from '../../../tools/cdp-liquidation-tools.js';
import { registerLeverageCdpTools } from '../../../tools/leverage-cdp-tools.js';
import { registerRobWriteTools } from '../../../tools/rob-write-tools.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function createTestServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

const ADDRESS = 'addr1qxy';
const CDP = { cdpTxHash: 'cdp', cdpOutputIndex: 0 };

/**
 * Each case: the tool, the arguments it takes, the SDK builder it delegates to,
 * and the argument index where `pythMessage` lands (the state OutRef follows).
 */
const CASES = [
  {
    tool: 'open_cdp',
    args: { address: ADDRESS, asset: 'iUSD', collateralAmount: '100000000', mintAmount: '1000000' },
    builder: 'openCdp',
    pythIndex: 10,
    priceOracleIndex: 6,
  },
  {
    tool: 'withdraw_cdp',
    args: { address: ADDRESS, asset: 'iUSD', ...CDP, amount: '5000000' },
    builder: 'withdrawCdp',
    pythIndex: 10,
    priceOracleIndex: 4,
  },
  {
    tool: 'mint_cdp',
    args: { address: ADDRESS, asset: 'iUSD', ...CDP, amount: '1000000' },
    builder: 'mintCdp',
    pythIndex: 10,
    priceOracleIndex: 4,
  },
  {
    tool: 'redeem_cdp',
    args: { address: ADDRESS, asset: 'iUSD', ...CDP, amount: '1000000' },
    builder: 'redeemCdp',
    pythIndex: 11,
    priceOracleIndex: 4,
  },
  {
    tool: 'freeze_cdp',
    args: { address: ADDRESS, asset: 'iUSD', ...CDP },
    builder: 'freezeCdp',
    pythIndex: 7,
    priceOracleIndex: 3,
  },
  {
    tool: 'leverage_cdp',
    args: { address: ADDRESS, asset: 'iUSD', leverage: 2, baseCollateral: '100000000' },
    builder: 'leverageCdpWithRob',
    pythIndex: 11,
    priceOracleIndex: 2,
  },
  {
    tool: 'redeem_rob',
    args: {
      address: ADDRESS,
      asset: 'iUSD',
      redemptionRobs: [{ txHash: 'rob', outputIndex: 0, amount: '1000000' }],
    },
    builder: 'redeemRob',
    pythIndex: 6,
    priceOracleIndex: 1,
  },
] as const;

describe('Pyth arguments reach the SDK transaction builders', () => {
  let tools: Map<string, ToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createTestServer();
    tools = created.tools;
    registerCdpWriteTools(created.server);
    registerCdpMintBurnTools(created.server);
    registerCdpLiquidationTools(created.server);
    registerLeverageCdpTools(created.server);
    registerRobWriteTools(created.server);
  });

  for (const testCase of CASES) {
    it(`${testCase.tool} forwards the Pyth message and state OutRef to ${testCase.builder}`, async () => {
      const handler = tools.get(testCase.tool);
      expect(handler, `${testCase.tool} is registered`).toBeDefined();

      const result = await handler!({ ...testCase.args });
      expect(result.isError, result.content[0]?.text).toBeFalsy();

      const builder = vi.mocked(sdk[testCase.builder] as (...args: unknown[]) => unknown);
      expect(builder).toHaveBeenCalledTimes(1);

      const args = builder.mock.calls[0];
      expect(args[testCase.pythIndex]).toBe(PYTH_MESSAGE);
      expect(args[testCase.pythIndex + 1]).toEqual(PYTH_STATE_OREF);
      // The builders reject a price-oracle OutRef alongside a Pyth message.
      expect(args[testCase.priceOracleIndex]).toBeUndefined();
    });
  }

  it('reports the Pyth price and submission deadline in the transaction summary', async () => {
    const handler = tools.get('open_cdp');
    const result = await handler!({
      address: ADDRESS,
      asset: 'iUSD',
      collateralAmount: '100000000',
      mintAmount: '1000000',
    });

    const payload = JSON.parse(result.content[0].text) as { summary: { pyth?: unknown } };
    expect(payload.summary.pyth).toEqual(PYTH_SUMMARY);
  });

  it('leaves Pyth-free tools untouched', async () => {
    const handler = tools.get('deposit_cdp');
    const result = await handler!({ address: ADDRESS, asset: 'iUSD', ...CDP, amount: '5000000' });

    expect(result.isError).toBeFalsy();
    const depositCdp = vi.mocked(sdk.depositCdp as (...args: unknown[]) => unknown);
    expect(depositCdp).toHaveBeenCalledTimes(1);
    // depositCdp has no price dependency: 9 args, no Pyth tail.
    expect(depositCdp.mock.calls[0]).toHaveLength(9);
  });
});
