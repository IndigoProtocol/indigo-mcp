import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAnalyticsTools } from './analytics-tools.js';
import { registerAssetTools } from './asset-tools.js';
import { registerCdpTools } from './cdp-tools.js';
import { registerCollectorTools } from './collector-tools.js';
import { registerDexTools } from './dex-tools.js';
import { registerGovernanceTools } from './governance-tools.js';
import { registerRedemptionTools } from './redemption-tools.js';
import { registerStabilityPoolTools } from './stability-pool-tools.js';
import { registerStakingTools } from './staking-tools.js';

export function registerTools(server: McpServer): void {
  registerAnalyticsTools(server);
  registerAssetTools(server);
  registerCdpTools(server);
  registerCollectorTools(server);
  registerDexTools(server);
  registerGovernanceTools(server);
  registerRedemptionTools(server);
  registerStabilityPoolTools(server);
  registerStakingTools(server);
}
