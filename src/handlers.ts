import axios from 'axios';

const INDIGO_API_HOST: string = 'https://analytics.indigoprotocol.io/api';

export async function handleAssets(uri) {
    return axios.get(`${INDIGO_API_HOST}/assets`)
        .then((response) => {
            const data = response.data.map((assetInfo) => ({
                asset: assetInfo.asset,
                createdAt: assetInfo.created_at,
                liquidationRatio: `${assetInfo.liquidation_ratio_percentage / 10**6}%`,
                maintenanceRatio: `${assetInfo.maintenance_ratio_percentage / 10**6}%`,
                redemptionRatio: `${assetInfo.redemption_ratio_percentage / 10**6}%`,
                debtMintingFee: `${assetInfo.debt_minting_fee_percentage / 10**6}%`,
                redemptionProcessingFee: `${assetInfo.redemption_processing_fee_percentage / 10**6}%`,
            }));

            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetPrices(uri) {
    return axios.get(`${INDIGO_API_HOST}/asset-prices`)
        .then((response) => {
            const data = response.data.map((assetInfo) => ({
                asset: assetInfo.asset,
                price: `${Number(assetInfo.price) / 10**6} ADA`,
            }));

            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetAnalytics(uri) {
    return axios.get(`${INDIGO_API_HOST}/assets/analytics`)
        .then((response) => {
            const responseData = response.data;
            const assets = Object.keys(responseData);

            const data = assets.map((asset) => ({
                asset,
                marketCap: `${responseData[asset].marketCap} ADA`,
                totalCollateralRatio: `${responseData[asset].totalCollateralRatio}%`,
                outstandingInterest: `${responseData[asset].totalInterestInAsset} ${asset}`,
                totalSupply: `${responseData[asset].totalCollateralRatio} ${asset}`,
                totalValueLocked: `${responseData[asset].totalValueLocked} ADA`,
            }));

            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetInterestRates(uri) {
    return axios.get(`${INDIGO_API_HOST}/asset-interest-rates`)
        .then((response) => {
            const assets = [...new Set(response.data.map((info) => info.asset))];

            const data = assets.map((asset: string) => {
                const record = response.data
                    .filter((record) => record.asset === asset)
                    .sort((a, b) => b.slot - a.slot)[0];

                return {
                    asset,
                    interestRate: `${record.interest_rate / 10_000}%`,
                    lastUpdated: (new Date(record.last_interest_update)).toISOString(),
                };
            });

            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(data),
                }]
            };
        });
}