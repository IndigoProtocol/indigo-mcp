import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIndexerClient } from '../utils/indexer-client.js';
import { AssetParam } from '../utils/validators.js';
import { extractPaymentCredential } from '../utils/address.js';

interface Loan {
  owner: string;
  asset: string;
  collateral: number;
  minted: number;
  minRatio: number;
  [key: string]: unknown;
}

interface Asset {
  name: string;
  price: {
    price: number;
    [key: string]: unknown;
  };
  interest: {
    ratio: number;
    minRatio: number;
    liquidation: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function registerCdpTools(server: McpServer): void {
  server.tool(
    'get_all_cdps',
    'Get all CDPs/loans, optionally filtered by iAsset',
    {
      asset: AssetParam.optional(),
      limit: z.number().min(1).max(500).default(50).optional(),
      offset: z.number().min(0).default(0).optional(),
    },
    async ({ asset, limit, offset }) => {
      try {
        const client = getIndexerClient();
        const response = await client.get('/loans/');
        let loans = response.data as Loan[];
        if (asset) {
          loans = loans.filter((l) => l.asset === asset);
        }
        const total = loans.length;
        const effectiveLimit = limit ?? 50;
        const effectiveOffset = offset ?? 0;
        const paginated = loans.slice(effectiveOffset, effectiveOffset + effectiveLimit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { cdps: paginated, total, limit: effectiveLimit, offset: effectiveOffset },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching CDPs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_cdps_by_owner',
    'Get all CDPs/loans for a specific owner (accepts payment key hash or bech32 address)',
    { owner: z.string().describe('Owner payment key hash (56-char hex) or bech32 address') },
    async ({ owner }) => {
      try {
        const pkh = extractPaymentCredential(owner);
        const client = getIndexerClient();
        const response = await client.get('/loans/');
        const loans = (response.data as Loan[]).filter((l) => l.owner === pkh);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(loans, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching CDPs by owner: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_cdps_by_address',
    'Get all CDPs/loans for a specific Cardano address',
    {
      address: z
        .string()
        .describe('Cardano bech32 address (addr1... or addr_test1...)'),
    },
    async ({ address }) => {
      try {
        const pkh = extractPaymentCredential(address);
        const client = getIndexerClient();
        const response = await client.get('/loans/');
        const loans = (response.data as Loan[]).filter((l) => l.owner === pkh);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(loans, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching CDPs by address: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'analyze_cdp_health',
    'Analyze health and collateral ratios of CDPs for an owner',
    { owner: z.string().describe('Owner payment key hash (56-char hex) or bech32 address') },
    async ({ owner }) => {
      try {
        const pkh = extractPaymentCredential(owner);
        const client = getIndexerClient();

        const [loansRes, assetsRes] = await Promise.all([
          client.get('/loans/'),
          client.get('/assets/'),
        ]);

        const allLoans = loansRes.data as Loan[];
        const assets = assetsRes.data as Asset[];
        const loans = allLoans.filter((l) => l.owner === pkh);

        if (loans.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { message: 'No CDPs found for this owner', owner: pkh },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const assetMap = new Map(assets.map((a) => [a.name, a]));

        const analysis = loans.map((loan) => {
          const assetInfo = assetMap.get(loan.asset);
          if (!assetInfo) {
            return { ...loan, error: `Asset ${loan.asset} not found` };
          }

          const collateralAda = loan.collateral / 1e6;
          const mintedTokens = loan.minted / 1e6;
          const priceAda = assetInfo.price.price;
          const collateralRatio =
            mintedTokens > 0 && priceAda > 0
              ? (collateralAda / (mintedTokens * priceAda)) * 100
              : 0;

          const maintenanceRatio = assetInfo.interest.minRatio;
          const liquidationRatio = assetInfo.interest.liquidation;

          let status: string;
          if (collateralRatio >= maintenanceRatio * 1.5) {
            status = 'safe';
          } else if (collateralRatio >= maintenanceRatio) {
            status = 'warning';
          } else if (collateralRatio >= liquidationRatio) {
            status = 'at-risk';
          } else {
            status = 'liquidatable';
          }

          return {
            asset: loan.asset,
            collateralAda,
            mintedTokens,
            priceAda,
            collateralRatio: Math.round(collateralRatio * 100) / 100,
            maintenanceRatio,
            liquidationRatio,
            status,
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  owner: pkh,
                  cdps: analysis,
                  note: 'Collateral ratios are approximate and do not account for accrued interest',
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error analyzing CDP health: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
