import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { openCdp, depositCdp, withdrawCdp, closeCdp } from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import {
  findIAsset,
  findCollateralAsset,
  findCdpCreatorOref,
  findInterestOracleOref,
  findPriceOracleOref,
  findInterestCollectorOref,
  findTreasuryOref,
  toOutRef,
} from '../utils/v3-finders.js';

const PYTH_UNSUPPORTED =
  'This iAsset is priced via Pyth, which requires a signed Pyth price message. ' +
  'Pyth-priced operations are not yet supported by this server.';

export function registerCdpWriteTools(server: McpServer): void {
  server.tool(
    'open_cdp',
    'Open a new CDP position with ADA collateral — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      collateralAmount: z.string().describe('ADA collateral amount in lovelace'),
      mintAmount: z.string().describe('iAsset amount to mint in smallest unit'),
    },
    async ({ address, asset, collateralAmount, mintAmount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const [iassetOut, collateralOut, cdpCreatorOref, treasuryOref] = await Promise.all([
              findIAsset(lucid, params, asset),
              findCollateralAsset(lucid, params, asset),
              findCdpCreatorOref(lucid, params),
              findTreasuryOref(lucid, params),
            ]);

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return openCdp(
              BigInt(collateralAmount),
              BigInt(mintAmount),
              params,
              cdpCreatorOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              priceOracleOref,
              interestOracleOref,
              treasuryOref,
              lucid,
              currentSlot
            );
          },
          {
            type: 'open_cdp',
            description: `Open ${asset} CDP with ${collateralAmount} lovelace collateral, minting ${mintAmount}`,
            inputs: { address, asset, collateralAmount, mintAmount },
          }
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error building open_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'deposit_cdp',
    'Deposit additional ADA collateral into a CDP — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('Lovelace amount to deposit'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut, interestCollectorOref, treasuryOref] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findInterestCollectorOref(lucid, params),
                findTreasuryOref(lucid, params),
              ]);

            const interestOracleOref = await findInterestOracleOref(lucid, collateralOut);

            return depositCdp(
              BigInt(amount),
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              interestOracleOref,
              treasuryOref,
              interestCollectorOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'deposit_cdp',
            description: `Deposit ${amount} lovelace into ${asset} CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex), amount },
          }
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error building deposit_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'withdraw_cdp',
    'Withdraw ADA collateral from a CDP — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
      amount: z.string().describe('Lovelace amount to withdraw'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex, amount }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [iassetOut, collateralOut, interestCollectorOref, treasuryOref] =
              await Promise.all([
                findIAsset(lucid, params, asset),
                findCollateralAsset(lucid, params, asset),
                findInterestCollectorOref(lucid, params),
                findTreasuryOref(lucid, params),
              ]);

            const [priceOracleOref, interestOracleOref] = await Promise.all([
              findPriceOracleOref(lucid, collateralOut),
              findInterestOracleOref(lucid, collateralOut),
            ]);
            if (priceOracleOref === undefined) throw new Error(PYTH_UNSUPPORTED);

            return withdrawCdp(
              BigInt(amount),
              cdpOref,
              toOutRef(iassetOut.utxo),
              toOutRef(collateralOut.utxo),
              priceOracleOref,
              interestOracleOref,
              treasuryOref,
              interestCollectorOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'withdraw_cdp',
            description: `Withdraw ${amount} lovelace from ${asset} CDP`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex), amount },
          }
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error building withdraw_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'close_cdp',
    'Close a CDP and reclaim collateral — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam,
      cdpTxHash: z.string().describe('Transaction hash of the CDP UTxO'),
      cdpOutputIndex: z.number().describe('Output index of the CDP UTxO'),
    },
    async ({ address, asset, cdpTxHash, cdpOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();
            const cdpOref = { txHash: cdpTxHash, outputIndex: cdpOutputIndex };

            const [collateralOut, interestCollectorOref] = await Promise.all([
              findCollateralAsset(lucid, params, asset),
              findInterestCollectorOref(lucid, params),
            ]);

            const interestOracleOref = await findInterestOracleOref(lucid, collateralOut);

            return closeCdp(
              cdpOref,
              toOutRef(collateralOut.utxo),
              interestOracleOref,
              interestCollectorOref,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'close_cdp',
            description: `Close ${asset} CDP and reclaim collateral`,
            inputs: { address, asset, cdpTxHash, cdpOutputIndex: String(cdpOutputIndex) },
          }
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error building close_cdp transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
