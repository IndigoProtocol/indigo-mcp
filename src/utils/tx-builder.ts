import type { LucidEvolution, TxBuilder } from '@lucid-evolution/lucid';
import type { UnsignedTxResult, TxSummary, PythPricingSummary } from '../types/tx-types.js';
import { getLucid } from './lucid-provider.js';

/**
 * CIP-20 metadata label for transaction messages.
 * See: https://cips.cardano.org/cip/CIP-20
 */
const CIP20_METADATA_LABEL = 674;

/**
 * Scratch space handed to a build function so it can report pricing details
 * that are only known once the transaction has been assembled.
 */
export interface TxBuildContext {
  /** Set when the transaction is priced via a signed Pyth message. */
  pyth?: PythPricingSummary;
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

  const ctx: TxBuildContext = {};
  const txBuilder = await buildFn(lucid, ctx);

  txBuilder.attachMetadata(CIP20_METADATA_LABEL, {
    msg: buildCip20Message(summary),
  });

  const tx = await txBuilder.complete();

  return {
    unsignedTx: tx.toCBOR(),
    txHash: tx.toHash(),
    fee: tx.toTransaction().body().fee().toString(),
    summary: ctx.pyth ? { ...summary, pyth: ctx.pyth } : summary,
  };
}
