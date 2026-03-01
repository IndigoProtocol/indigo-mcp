import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LucidEvolution, Network, UTxO } from '@lucid-evolution/lucid';
import { fromText } from '@lucid-evolution/lucid';
import type { SystemParams, IAssetContent, AssetClass } from '@indigo-labs/indigo-sdk';
import { z } from 'zod';
import {
  feedInterestOracle,
  startInterestOracle,
  fromSystemParamsAsset,
  assetClassToUnit,
  createScriptAddress,
  parseIAssetDatumOrThrow,
  getInlineDatumOrThrow,
} from '@indigo-labs/indigo-sdk';
import { buildUnsignedTx } from '../utils/tx-builder.js';
import { getSystemParams } from '../utils/sdk-config.js';
import { AssetParam } from '../utils/validators.js';

function getNetwork(lucid: LucidEvolution): Network {
  const network = lucid.config().network;
  if (!network) throw new Error('Lucid network not configured');
  return network;
}

/**
 * Resolve the iAsset state UTxO for a given asset name (e.g. "iUSD").
 */
async function findIAssetUtxo(
  asset: string,
  params: SystemParams,
  lucid: LucidEvolution
): Promise<{ utxo: UTxO; datum: IAssetContent }> {
  const iAssetAuthAc = fromSystemParamsAsset(params.cdpParams.iAssetAuthToken);
  const cdpAddress = createScriptAddress(getNetwork(lucid), params.validatorHashes.cdpHash);
  const utxos = await lucid.utxosAtWithUnit(cdpAddress, assetClassToUnit(iAssetAuthAc));
  const assetHex = fromText(asset);
  for (const utxo of utxos) {
    try {
      const datum = parseIAssetDatumOrThrow(getInlineDatumOrThrow(utxo));
      if (datum.assetName === assetHex) {
        return { utxo, datum };
      }
    } catch {
      // Skip UTxOs with unparseable datums
    }
  }
  throw new Error(`iAsset UTxO for ${asset} not found`);
}

export function registerOracleWriteTools(server: McpServer): void {
  server.tool(
    'feed_interest_oracle',
    'Feed a new interest rate to the interest oracle for a given iAsset. Returns an unsigned transaction (CBOR hex) for client-side signing. Only callable by the oracle operator.',
    {
      address: z.string().describe('Oracle operator Cardano bech32 address'),
      asset: AssetParam,
      newInterestRate: z.string().describe('New interest rate as bigint string'),
      biasTime: z.string().describe('Oracle bias time in milliseconds as bigint string'),
      owner: z.string().describe('Oracle operator pub key hash (hex)'),
    },
    async ({ address, asset, newInterestRate, biasTime, owner }) => {
      try {
        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const params = await getSystemParams();
            const iAssetResult = await findIAssetUtxo(asset, params, lucid);
            const interestOracleNft: AssetClass = {
              currencySymbol: iAssetResult.datum.interestOracleNft.currencySymbol,
              tokenName: iAssetResult.datum.interestOracleNft.tokenName,
            };
            const oracleParams = {
              biasTime: BigInt(biasTime),
              owner,
            };
            const txBuilder = await feedInterestOracle(
              oracleParams,
              BigInt(newInterestRate),
              lucid,
              interestOracleNft
            );
            return txBuilder.complete();
          },
          {
            type: 'feed_interest_oracle',
            description: `Feed interest rate ${newInterestRate} for ${asset} oracle`,
            inputs: { address, asset, newInterestRate, biasTime, owner },
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
              text: `Error feeding interest oracle: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'start_interest_oracle',
    'Initialize a new interest oracle (one-time admin setup). Returns an unsigned transaction (CBOR hex) and the minted oracle asset class. Only callable by protocol administrators.',
    {
      address: z.string().describe('Admin Cardano bech32 address'),
      initialUnitaryInterest: z.string().describe('Initial unitary interest as bigint string'),
      initialInterestRate: z.string().describe('Initial interest rate as bigint string'),
      initialLastInterestUpdate: z
        .string()
        .describe('Initial last interest update timestamp (milliseconds) as bigint string'),
      biasTime: z.string().describe('Oracle bias time in milliseconds as bigint string'),
      owner: z.string().describe('Oracle operator pub key hash (hex)'),
    },
    async ({
      address,
      initialUnitaryInterest,
      initialInterestRate,
      initialLastInterestUpdate,
      biasTime,
      owner,
    }) => {
      try {
        let mintedAssetClass: AssetClass | undefined;

        const result = await buildUnsignedTx(
          address,
          async (lucid) => {
            const oracleParams = {
              biasTime: BigInt(biasTime),
              owner,
            };
            const [txBuilder, assetClass] = await startInterestOracle(
              BigInt(initialUnitaryInterest),
              BigInt(initialInterestRate),
              BigInt(initialLastInterestUpdate),
              oracleParams,
              lucid
            );
            mintedAssetClass = assetClass;
            return txBuilder.complete();
          },
          {
            type: 'start_interest_oracle',
            description: 'Initialize a new interest oracle',
            inputs: {
              address,
              initialUnitaryInterest,
              initialInterestRate,
              initialLastInterestUpdate,
              biasTime,
              owner,
            },
          }
        );

        const response = {
          ...result,
          oracleAssetClass: mintedAssetClass
            ? {
                currencySymbol: mintedAssetClass.currencySymbol,
                tokenName: mintedAssetClass.tokenName,
              }
            : undefined,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error starting interest oracle: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
