import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution } from '@lucid-evolution/lucid';
import type { SystemParams } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import { fromText } from '@lucid-evolution/lucid';
import {
  processSpRequest,
  annulRequest,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  matchSingle,
} from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

/**
 * Find the stability pool UTxO for a given asset.
 */
async function findStabilityPoolUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution,
) {
  const spTokenAc = fromSystemParamsAsset(params.stabilityPoolParams.stabilityPoolToken);
  const spAddress = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.stabilityPoolHash,
  );
  const utxos = await lucid.utxosAtWithUnit(
    spAddress,
    assetClassToUnit(spTokenAc),
  );
  const assetHex = fromText(asset);
  const spUnit = spTokenAc.currencySymbol + assetHex;
  const matched = utxos.filter((u) => u.assets[spUnit] !== undefined);
  return matchSingle(
    matched,
    (xs) => new Error(`Expected exactly one stability pool UTxO for ${asset}, found ${xs.length}`),
  );
}

/**
 * Find the governance UTxO (holds govNFT at the gov validator address).
 */
async function findGovUtxo(params: SystemParams, lucid: LucidEvolution) {
  const nftAc = fromSystemParamsAsset(params.govParams.govNFT);
  const address = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.govHash,
  );
  const utxos = await lucid.utxosAtWithUnit(address, assetClassToUnit(nftAc));
  return matchSingle(utxos, (_) => new Error('Expected a single governance UTxO'));
}

/**
 * Resolve the iAsset state UTxO for a given asset name.
 */
async function findIAssetUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution,
) {
  const iAssetAuthAc = fromSystemParamsAsset(params.cdpParams.iAssetAuthToken);
  const cdpAddress = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.cdpHash,
  );
  const utxos = await lucid.utxosAtWithUnit(
    cdpAddress,
    assetClassToUnit(iAssetAuthAc),
  );
  const assetHex = fromText(asset);
  const iAssetUnit = iAssetAuthAc.currencySymbol + assetHex;
  const matched = utxos.filter((u) => u.assets[iAssetUnit] !== undefined);
  return matchSingle(
    matched,
    (xs) => new Error(`Expected exactly one iAsset UTxO for ${asset}, found ${xs.length}`),
  );
}

/**
 * Find a collector UTxO at the collector validator address.
 */
async function findCollectorUtxo(params: SystemParams, lucid: LucidEvolution) {
  const address = createScriptAddress(
    lucid.config().network!,
    params.validatorHashes.collectorHash,
  );
  const utxos = await lucid.utxosAt(address);
  if (utxos.length === 0) {
    throw new Error('No collector UTxOs found');
  }
  return utxos[0];
}

export function registerSpRequestTools(server: McpServer): void {
  server.tool(
    'process_sp_request',
    'Process a pending stability pool request (protocol maintenance operation). Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      asset: AssetParam.describe('iAsset of the stability pool (iUSD, iBTC, iETH, or iSOL)'),
      accountTxHash: z.string().describe('Transaction hash of the account UTxO with the pending request'),
      accountOutputIndex: z.number().describe('Output index of the account UTxO'),
    },
    async ({ address, asset, accountTxHash, accountOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();

            const [accountUtxo] = await lucid.utxosByOutRef([
              { txHash: accountTxHash, outputIndex: accountOutputIndex },
            ]);
            if (!accountUtxo) throw new Error('Account UTxO not found on chain');

            const [stabilityPoolUtxo, govUtxo, iAssetUtxo, collectorUtxo] =
              await Promise.all([
                findStabilityPoolUtxo(asset, params, lucid),
                findGovUtxo(params, lucid),
                findIAssetUtxo(asset, params, lucid),
                findCollectorUtxo(params, lucid),
              ]);

            const txBuilder = await processSpRequest(
              asset,
              stabilityPoolUtxo,
              accountUtxo,
              govUtxo,
              iAssetUtxo,
              undefined,
              params,
              lucid,
              collectorUtxo,
            );
            return txBuilder.complete();
          },
          {
            type: 'process_sp_request',
            description: `Process stability pool request for ${asset}`,
            inputs: {
              address,
              asset,
              accountTxHash,
              accountOutputIndex: String(accountOutputIndex),
            },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error processing SP request: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'annul_sp_request',
    'Cancel a pending stability pool request. Returns an unsigned transaction (CBOR hex) for client-side signing.',
    {
      address: z.string().describe('User Cardano bech32 address'),
      accountTxHash: z.string().describe('Transaction hash of the account UTxO with the pending request'),
      accountOutputIndex: z.number().describe('Output index of the account UTxO'),
    },
    async ({ address, accountTxHash, accountOutputIndex }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const [accountUtxo] = await lucid.utxosByOutRef([
              { txHash: accountTxHash, outputIndex: accountOutputIndex },
            ]);
            if (!accountUtxo) throw new Error('Account UTxO not found on chain');

            const params = await getSystemParams();
            const txBuilder = await annulRequest(accountUtxo, params, lucid);
            return txBuilder.complete();
          },
          {
            type: 'annul_sp_request',
            description: 'Cancel pending stability pool request',
            inputs: {
              address,
              accountTxHash,
              accountOutputIndex: String(accountOutputIndex),
            },
          },
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error annulling SP request: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
