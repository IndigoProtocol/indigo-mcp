import type { LucidEvolution, TxSignBuilder } from '@lucid-evolution/lucid';
import type { UnsignedTxResult, TxSummary } from '../types/tx-types.js';
import { getLucid } from './lucid-provider.js';

export async function buildUnsignedTx(
  address: string,
  buildFn: (lucid: LucidEvolution) => Promise<TxSignBuilder>,
  summary: TxSummary
): Promise<UnsignedTxResult> {
  const lucid = await getLucid();

  const utxos = await lucid.utxosAt(address);
  lucid.selectWallet.fromAddress(address, utxos);

  const tx = await buildFn(lucid);

  return {
    unsignedTx: tx.toCBOR(),
    txHash: tx.toHash(),
    fee: tx.toTransaction().body().fee().toString(),
    summary,
  };
}
