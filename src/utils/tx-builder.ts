import type { LucidEvolution, TxBuilder } from '@lucid-evolution/lucid';
import type { UnsignedTxResult, TxSummary } from '../types/tx-types.js';
import { getLucid } from './lucid-provider.js';

/**
 * CIP-20 metadata label for transaction messages.
 * See: https://cips.cardano.org/cip/CIP-20
 */
const CIP20_METADATA_LABEL = 674;

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
  buildFn: (lucid: LucidEvolution) => Promise<TxBuilder>,
  summary: TxSummary
): Promise<UnsignedTxResult> {
  const lucid = await getLucid();

  const utxos = await lucid.utxosAt(address);
  lucid.selectWallet.fromAddress(address, utxos);

  const txBuilder = await buildFn(lucid);

  txBuilder.attachMetadata(CIP20_METADATA_LABEL, {
    msg: buildCip20Message(summary),
  });

  const tx = await txBuilder.complete();

  return {
    unsignedTx: tx.toCBOR(),
    txHash: tx.toHash(),
    fee: tx.toTransaction().body().fee().toString(),
    summary,
  };
}
