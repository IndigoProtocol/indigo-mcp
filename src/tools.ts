import axios from 'axios';
import { formatCdp } from './utils';
import { paymentCredentialOf } from '@lucid-evolution/lucid';
import { z } from 'zod';
import express from 'express';

const INDIGO_API_HOST: string = 'https://analytics.indigoprotocol.io/api';

export default [
    {
        name: 'indigo_assets',
        description: 'Retrieve iAsset system parameters',
        inputSchema: {},
        handler: handleAssets,
    },
    {
        name: 'indigo_asset_prices',
        description: 'Retrieve iAsset prices',
        inputSchema: {},
        handler: handleAssetPrices,
    },
    {
        name: 'indigo_asset_analytics',
        description: 'Retrieve iAsset analytics like Market Cap, TVL, etc.',
        inputSchema: {},
        handler: handleAssetAnalytics,
    },
    {
        name: 'indigo_interest_rates',
        description: 'Retrieve iAsset interest rates',
        inputSchema: {},
        handler: handleAssetInterestRates,
    },
    {
        name: 'indigo_cdps',
        description: 'Retrieve open Collateralized Debt Positions (CDPs)',
        inputSchema: {},
        handler: handleCdps,
    },
    {
        name: 'indigo_cdps_at_address',
        description: 'Retrieve open Collateralized Debt Positions (CDPs) for a specific address',
        inputSchema: {
            address: z.string().describe('Address to get CDPs for'),
        },
        handler: handleCdpsAtAddress,
    },
];

export async function handleAssets(request: express.Request) {
    return axios.get(`${INDIGO_API_HOST}/assets`)
        .then((response) => {
            const data = response.data.map((assetInfo) => ({
                asset: assetInfo.asset,
                createdAt: assetInfo.created_at,
                liquidationRatio: `${assetInfo.liquidation_ratio_percentage / 10**6} %`,
                maintenanceRatio: `${assetInfo.maintenance_ratio_percentage / 10**6} %`,
                redemptionRatio: `${assetInfo.redemption_ratio_percentage / 10**6} %`,
                debtMintingFee: `${assetInfo.debt_minting_fee_percentage / 10**6} %`,
                redemptionProcessingFee: `${assetInfo.redemption_processing_fee_percentage / 10**6} %`,
            }));

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetPrices(request: express.Request) {
    return axios.get(`${INDIGO_API_HOST}/asset-prices`)
        .then((response) => {
            const data = response.data.map((assetInfo) => ({
                asset: assetInfo.asset,
                price: `${Number(assetInfo.price) / 10**6} ADA`,
            }));

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetAnalytics(request: express.Request) {
    return axios.get(`${INDIGO_API_HOST}/assets/analytics`)
        .then((response) => {
            const responseData = response.data;
            const assets = Object.keys(responseData);

            const data = assets.map((asset) => ({
                asset,
                marketCap: `${responseData[asset].marketCap} ADA`,
                totalCollateralRatio: `${responseData[asset].totalCollateralRatio} %`,
                outstandingInterest: `${responseData[asset].totalInterestInAsset} ${asset}`,
                totalSupply: `${responseData[asset].totalCollateralRatio} ${asset}`,
                totalValueLocked: `${responseData[asset].totalValueLocked} ADA`,
            }));

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleAssetInterestRates(request: express.Request) {
    return axios.get(`${INDIGO_API_HOST}/asset-interest-rates`)
        .then((response) => {
            const assets = [...new Set(response.data.map((info) => info.asset))];

            const data = assets.map((asset: string) => {
                const record = response.data
                    .filter((record) => record.asset === asset)
                    .sort((a, b) => b.slot - a.slot)[0];

                return {
                    asset,
                    interestRate: `${record.interest_rate / 10_000} %`,
                    lastUpdated: (new Date(record.last_interest_update)).toISOString(),
                };
            });

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleCdps(request: express.Request) {
    const assets = await axios.get(`${INDIGO_API_HOST}/asset-prices`)
        .then((response) => {
            return response.data.reduce((results, assetInfo) => {
                results[assetInfo.asset] = assetInfo;

                return results;
            }, {});
        });
    const interestRates: any[] = await axios.get(`${INDIGO_API_HOST}/asset-interest-rates`)
        .then((response) => response.data);

    return axios.get(`${INDIGO_API_HOST}/cdps`)
        .then((response) => {
            const data = response.data.map((cdp) => {
                const interestRecord = interestRates
                    .filter((record) => record.asset === cdp.asset)
                    .sort((a, b) => b.slot - a.slot)[0];

                return formatCdp(cdp, assets[cdp.asset], interestRecord);
            });

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}

export async function handleCdpsAtAddress(request: express.Request, address) {
    const paymentCredential: string = paymentCredentialOf(address).hash;
    const assets = await axios.get(`${INDIGO_API_HOST}/asset-prices`)
        .then((response) => {
            return response.data.reduce((results, assetInfo) => {
                results[assetInfo.asset] = assetInfo;

                return results;
            }, {});
        });
    const interestRates: any[] = await axios.get(`${INDIGO_API_HOST}/asset-interest-rates`)
        .then((response) => response.data);

    return axios.get(`${INDIGO_API_HOST}/cdps`)
        .then((response) => {
            const data = response.data
                .filter((cdp) => cdp.owner === paymentCredential)
                .map((cdp) => {
                    const interestRecord = interestRates
                        .filter((record) => record.asset === cdp.asset)
                        .sort((a, b) => b.slot - a.slot)[0];

                    return formatCdp(cdp, assets[cdp.asset], interestRecord);
                });

            return {
                contents: [{
                    type: 'text',
                    text: JSON.stringify(data),
                }]
            };
        });
}