import type { LucidEvolution, TxBuilder } from '@lucid-evolution/lucid';
import type { UnsignedTxResult, TxSummary, PythPricingSummary } from '../types/tx-types.js';
import { getLucid } from './lucid-provider.js';

/**
 * CIP-20 metadata label for transaction messages.
 * See: https://cips.cardano.org/cip/CIP-20
 */
const CIP20_METADATA_LABEL = 674;

/**
 * Lucid reports the fee that makes coin selection stable when selection had to
 * change after the redeemers were built — which invalidates redeemer indices.
 * Script-heavy transactions, which every Pyth-priced CDP operation is, hit this
 * regularly.
 */
const MIN_FEE_HINT = /minimum fee of (\d+) lovelace/i;

/**
 * Scratch space handed to a build function so it can report pricing details
 * that are only known once the transaction has been assembled.
 */
export interface TxBuildContext {
  /** Set when the transaction is priced via a signed Pyth message. */
  pyth?: PythPricingSummary;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error);
  return text === '[object Object]' ? JSON.stringify(error) : text;
}

/**
 * Build CIP-20 metadata message lines from a TxSummary.
 * Each line is capped at 64 bytes (CIP-20 requirement).
 */
function buildCip20Message(summary: TxSummary): string[] {
  const lines: string[] = [`Indigo Protocol: ${summary.type}`, summary.description];
  return lines.map((line) => (line.length > 64 ? line.slice(0, 64) : line));
}

export async function buildUnsignedTx(
  address: string,
  buildFn: (lucid: LucidEvolution, ctx: TxBuildContext) => Promise<TxBuilder>,
  summary: TxSummary
): Promise<UnsignedTxResult> {
  const lucid = await getLucid();

  const utxos = await lucid.utxosAt(address);
  lucid.selectWallet.fromAddress(address, utxos);

  // Assemble from scratch each time: a TxBuilder that failed to complete still
  // holds its mints and redeemers, so completing it twice duplicates them.
  const assemble = async (minFee?: bigint) => {
    const ctx: TxBuildContext = {};
    const txBuilder = await buildFn(lucid, ctx);

    txBuilder.attachMetadata(CIP20_METADATA_LABEL, {
      msg: buildCip20Message(summary),
    });
    if (minFee !== undefined) txBuilder.setMinFee(minFee);

    return { tx: await txBuilder.complete(), ctx };
  };

  let built: Awaited<ReturnType<typeof assemble>>;
  try {
    built = await assemble();
  } catch (error) {
    const hint = MIN_FEE_HINT.exec(describeError(error));
    if (!hint) throw error;
    built = await assemble(BigInt(hint[1]));
  }

  const { tx, ctx } = built;

  return {
    unsignedTx: tx.toCBOR(),
    txHash: tx.toHash(),
    fee: tx.toTransaction().body().fee().toString(),
    summary: ctx.pyth ? { ...summary, pyth: ctx.pyth } : summary,
  };
}
