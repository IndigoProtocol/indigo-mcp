export interface TxSummary {
  type: string;
  description: string;
  inputs: Record<string, string>;
}

export interface UnsignedTxResult {
  unsignedTx: string;
  txHash: string;
  fee: string;
  summary: TxSummary;
}
