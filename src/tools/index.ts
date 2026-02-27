import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAssetTools } from './asset-tools.js';
import { registerCdpTools } from './cdp-tools.js';

export function registerTools(server: McpServer): void {
  registerAssetTools(server);
  registerCdpTools(server);
}
