export interface PythPricingSummary {
  /** Price the transaction was built at, in the collateral asset. */
  price: string;
  /** ISO timestamp of the Pyth price update embedded in the transaction. */
  priceTimestamp: string;
  /**
   * ISO deadline for submitting the signed transaction. The on-chain Pyth feed
   * validator caps a transaction's validity window at the price timestamp plus
   * 280 seconds; after this the transaction must be rebuilt.
   */
  submitBefore: string;
}

export interface TxSummary {
  type: string;
  description: string;
  inputs: Record<string, string>;
  /** Present only for Pyth-priced iAssets. */
  pyth?: PythPricingSummary;
}

export interface UnsignedTxResult {
  unsignedTx: string;
  txHash: string;
  fee: string;
  summary: TxSummary;
}
