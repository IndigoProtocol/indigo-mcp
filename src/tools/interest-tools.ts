import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution, OutRef } from '@lucid-evolution/lucid';
import { z } from 'zod';
import {
  batchCollectInterest,
  distributeInterest,
  feedInterestOracle,
  parseInterestOracleDatum,
  getInlineDatumOrThrow,
  fromSystemParamsAsset,
  createScriptAddress,
} from '@indigo-labs/indigo-sdk';
import type { SystemParams } from '@indigo-labs/indigo-sdk';
import { assetClassValueOf, assetClassToUnit } from '@3rd-eye-labs/cardano-offchain-common';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';
import {
  findCollateralAsset,
  findInterestOracleOref,
  findInterestCollectorOref,
  toOutRef,
} from '../utils/v3-finders.js';

/**
 * Resolve the admin interest collector OutRef — the UTxO at the interest
 * collection validator address that holds the multisig UTxO NFT.
 */
async function findInterestAdminOref(lucid: LucidEvolution, params: SystemParams): Promise<OutRef> {
  const multisigNft = fromSystemParamsAsset(params.interestCollectionParams.multisigUtxoNft);
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');
  const address = createScriptAddress(network, params.validatorHashes.interestCollectionHash);
  const utxos = await lucid.utxosAt(address);
  const adminUtxo = utxos.find((utxo) => assetClassValueOf(utxo.assets, multisigNft) > 0n);
  if (!adminUtxo) throw new Error('No admin interest collector UTxO found');
  return toOutRef(adminUtxo);
}

export function registerInterestTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // collect_interest
  // ---------------------------------------------------------------------------
  server.tool(
    'collect_interest',
    'Batch-collect accrued interest from one or more CDP positions into the interest collector — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('Caller Cardano bech32 address (addr1... or addr_test1...)'),
      asset: AssetParam,
      cdps: z
        .array(
          z.object({
            txHash: z.string().describe('Transaction hash of the CDP UTxO'),
            outputIndex: z.number().describe('Output index of the CDP UTxO'),
          })
        )
        .min(1)
        .describe('CDP UTxO references to collect interest from'),
    },
    async ({ address, asset, cdps }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const collateralOut = await findCollateralAsset(lucid, params, asset);
            const [collateralAssetOref, interestOracleOref, interestCollectorOref] =
              await Promise.all([
                Promise.resolve(toOutRef(collateralOut.utxo)),
                findInterestOracleOref(lucid, collateralOut),
                findInterestCollectorOref(lucid, params),
              ]);

            const cdpOutRefs = cdps.map(({ txHash, outputIndex }) => ({
              txHash,
              outputIndex,
            }));

            return batchCollectInterest(
              collateralAssetOref,
              interestCollectorOref,
              interestOracleOref,
              cdpOutRefs,
              params,
              lucid,
              currentSlot
            );
          },
          {
            type: 'collect_interest',
            description: `Collect interest for ${cdps.length} ${asset} CDP(s)`,
            inputs: { address, asset, cdpCount: String(cdps.length) },
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
              text: `Error building collect_interest transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // distribute_interest
  // ---------------------------------------------------------------------------
  server.tool(
    'distribute_interest',
    'Distribute accumulated interest from collector UTxOs to the admin interest collector — builds an unsigned transaction (CBOR hex) for client-side signing',
    {
      address: z.string().describe('Caller Cardano bech32 address'),
      collectorTxHashes: z
        .array(z.string())
        .min(1)
        .describe('Transaction hashes of the non-admin interest collector UTxOs to distribute'),
      collectorOutputIndices: z
        .array(z.number())
        .min(1)
        .describe('Output indices corresponding to each collectorTxHashes entry (same order)'),
    },
    async ({ address, collectorTxHashes, collectorOutputIndices }) => {
      try {
        if (collectorTxHashes.length !== collectorOutputIndices.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'collectorTxHashes and collectorOutputIndices must have the same length',
              },
            ],
            isError: true,
          };
        }

        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();

            const interestCollectorOutRefs = collectorTxHashes.map((txHash, i) => ({
              txHash,
              outputIndex: collectorOutputIndices[i],
            }));

            const interestAdminOutRef = await findInterestAdminOref(lucid, params);

            return distributeInterest(interestCollectorOutRefs, interestAdminOutRef, params, lucid);
          },
          {
            type: 'distribute_interest',
            description: `Distribute interest from ${collectorTxHashes.length} collector UTxO(s)`,
            inputs: { address, collectorCount: String(collectorTxHashes.length) },
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
              text: `Error building distribute_interest transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // feed_interest_oracle  (admin / maintenance)
  // ---------------------------------------------------------------------------
  server.tool(
    'feed_interest_oracle',
    [
      'ADMIN/MAINTENANCE: Update the interest rate stored in an interest oracle UTxO.',
      'Builds an unsigned transaction (CBOR hex) that must be signed by the oracle owner key.',
      'Requires the oracle contract parameters (biasTime in milliseconds, owner pubkey hash hex)',
      'which are fixed at contract deployment and must be supplied by the protocol admin.',
    ].join(' '),
    {
      address: z.string().describe('Oracle owner Cardano bech32 address'),
      asset: AssetParam,
      newInterestRate: z
        .string()
        .describe(
          'New interest rate as an on-chain integer (scaled; e.g. 5_000_000 = 5 % p.a. in the protocol encoding)'
        ),
      oracleBiasTime: z
        .string()
        .describe(
          'Oracle contract biasTime parameter in milliseconds (bigint string; fixed at deployment)'
        ),
      oracleOwner: z
        .string()
        .describe(
          'Oracle contract owner parameter as a hex-encoded public key hash (fixed at deployment)'
        ),
    },
    async ({ address, asset, newInterestRate, oracleBiasTime, oracleOwner }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const currentSlot = lucid.currentSlot();

            const collateralOut = await findCollateralAsset(lucid, params, asset);
            const interestOracleNft = collateralOut.datum.interestOracleNft;

            const oracleParams = {
              biasTime: BigInt(oracleBiasTime),
              owner: oracleOwner,
            };

            return feedInterestOracle(
              oracleParams,
              BigInt(newInterestRate),
              lucid,
              currentSlot,
              interestOracleNft
            );
          },
          {
            type: 'feed_interest_oracle',
            description: `Update interest oracle for ${asset} to rate ${newInterestRate}`,
            inputs: { address, asset, newInterestRate },
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
              text: `Error building feed_interest_oracle transaction: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_interest_oracle  (read)
  // ---------------------------------------------------------------------------
  server.tool(
    'get_interest_oracle',
    'Read the current interest oracle state for an asset — returns the on-chain interest rate, unitary interest accumulator, and last-updated timestamp',
    {
      asset: AssetParam,
    },
    async ({ asset }) => {
      try {
        const { getLucid } = await import('../utils/lucid-provider.js');
        const lucid = await getLucid();
        const params = await getSystemParams();

        const collateralOut = await findCollateralAsset(lucid, params, asset);
        const oracleUtxo = await lucid.utxoByUnit(
          assetClassToUnit(collateralOut.datum.interestOracleNft)
        );

        const datum = parseInterestOracleDatum(getInlineDatumOrThrow(oracleUtxo));

        const result = {
          asset,
          oracleRef: { txHash: oracleUtxo.txHash, outputIndex: oracleUtxo.outputIndex },
          interestRate: datum.interestRate.getOnChainInt.toString(),
          unitaryInterest: datum.unitaryInterest.toString(),
          lastUpdated: datum.lastUpdated.toString(),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading interest oracle: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
