import { CDPFees, InterestOracleContract, InterestOracleDatum } from '@indigo-labs/indigo-sdk';

export const formatDigits = (value: any, digits: number = 6): number => Number(Number(value).toFixed(digits));

export function formatCdp(cdp, priceRecord, interestRecord) {
    const assetPrice: number = priceRecord.price / 10**6;
    const outstandingInterestAsset: bigint = cdpAccruedAssetInterest(
        BigInt(cdp.active_interest_tracking_unitary_interest_snapshot),
        BigInt(cdp.mintedAmount),
        BigInt(cdp.active_interest_tracking_last_settled),
        {
            unitaryInterest: BigInt(interestRecord.unitary_interest),
            interestRate: BigInt(interestRecord.interest_rate),
            lastUpdated: BigInt(interestRecord.last_interest_update),
        },
    );
    const outstandingInterestAda: number = (Number(outstandingInterestAsset) / 10**6) * assetPrice;
    const collateralRatio: number = cdpCollateralRatio(
        BigInt(cdp.collateralAmount),
        BigInt(cdp.mintedAmount),
        assetPrice,
        {
            type: 'ActiveCDPInterestTracking',
            last_settled: BigInt(cdp.active_interest_tracking_last_settled),
            unitary_interest_snapshot: BigInt(cdp.active_interest_tracking_unitary_interest_snapshot),
        },
        {
            unitaryInterest: BigInt(interestRecord.unitary_interest),
            interestRate: BigInt(interestRecord.interest_rate),
            lastUpdated: BigInt(interestRecord.last_interest_update),
        }
    );

    return {
        asset: cdp.asset,
        collateralRatio: `${formatDigits(collateralRatio, 2)} %`,
        collateralAmount: `${formatDigits(cdp.collateralAmount / 10**6)} ADA`,
        mintedAmount: `${formatDigits(cdp.mintedAmount / 10**6)} ${cdp.asset}`,
        outstandingInterest: `${formatDigits(outstandingInterestAda)} ADA`,
        ownerPubKeyHash: cdp.owner,
    };
}

export function cdpCollateralRatio(collateral: bigint, mintedAmount: bigint, assetPrice: number, cdpFees: CDPFees, interestRate: InterestOracleDatum | undefined): number {
    if (assetPrice === 0 || mintedAmount === 0n) return 0;
    if (cdpFees.type !== 'ActiveCDPInterestTracking') return 0;

    const totalInterestAsset: bigint = cdpAccruedAssetInterest(
        cdpFees.unitary_interest_snapshot,
        mintedAmount,
        cdpFees.last_settled,
        interestRate,
    );
    const totalInterestLovelace: number = Number(totalInterestAsset) * assetPrice;

    return ((Number(collateral) - totalInterestLovelace) / (assetPrice * Number(mintedAmount))) * 100;
}

export function cdpAccruedAssetInterest(unitaryInterestSnapshot: bigint, mintedAmount: bigint, lastSettled: bigint, interestRate: InterestOracleDatum | undefined): bigint {
    if (! interestRate) return 0n;

    return InterestOracleContract.calculateAccruedInterest(
        BigInt(Date.now()),
        unitaryInterestSnapshot,
        mintedAmount,
        lastSettled,
        interestRate,
    );
}