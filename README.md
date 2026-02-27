# Indigo MCP

MCP server for [Indigo Protocol](https://indigoprotocol.io/) — exposes Indigo iAsset data, prices, and CDP/loan analytics to LLM agents via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Features

- Real-time iAsset prices (iUSD, iBTC, iETH, iSOL)
- ADA and INDY token price feeds
- CDP/loan browsing with pagination and filtering
- Owner lookup by payment key hash or bech32 address
- CDP health analysis with collateral ratio and liquidation risk status

## Quick Start

```bash
npm install
npm run build
npm start
```

### Docker

```bash
docker build -t indigo-mcp .
docker run -i indigo-mcp
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "indigo": {
      "command": "node",
      "args": ["/path/to/indigo-mcp/dist/index.js"],
      "env": {
        "INDEXER_URL": "https://analytics.indigoprotocol.io/api/v1"
      }
    }
  }
}
```

## Available Tools

### Asset Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_assets` | Get all Indigo iAssets with prices and interest data | None |
| `get_asset` | Get details for a specific iAsset | `asset`: iUSD, iBTC, iETH, or iSOL |
| `get_asset_price` | Get the current price for a specific iAsset | `asset`: iUSD, iBTC, iETH, or iSOL |
| `get_ada_price` | Get the current ADA price in USD | None |
| `get_indy_price` | Get the current INDY token price in ADA and USD | None |

### CDP / Loan Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_all_cdps` | Get all CDPs/loans, optionally filtered by iAsset | `asset?`: iAsset filter; `limit?`: 1-500 (default 50); `offset?`: pagination offset |
| `get_cdps_by_owner` | Get CDPs for a specific owner | `owner`: payment key hash (56-char hex) or bech32 address |
| `get_cdps_by_address` | Get CDPs for a specific Cardano address | `address`: bech32 address (addr1... or addr_test1...) |
| `analyze_cdp_health` | Analyze collateral ratios and liquidation risk | `owner`: payment key hash or bech32 address |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXER_URL` | `https://analytics.indigoprotocol.io/api/v1` | Indigo analytics API base URL |

## Example Queries

When connected to an LLM agent, you can ask natural language questions like:

- "What are the current prices of all Indigo iAssets?"
- "What is the price of iUSD right now?"
- "How much is ADA worth in USD?"
- "Show me all iETH CDPs"
- "What CDPs does this address own?" (paste a Cardano address)
- "Analyze the health of my CDPs" (with your address or payment key hash)
- "Are any of my positions at risk of liquidation?"

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
git clone https://github.com/IndigoProtocol/indigo-mcp.git
cd indigo-mcp
npm install
npm run dev      # run with tsx (hot reload)
```

### Scripts

```bash
npm run build          # compile TypeScript
npm run start          # run compiled server
npm run dev            # run with tsx (hot reload)
npm run typecheck      # type-check without emitting
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier
npm run format:check   # prettier --check
```

### Project Structure

```
src/
├── index.ts                  # Server entry point (stdio transport)
├── tools/
│   ├── index.ts              # Tool registration (asset + CDP)
│   ├── asset-tools.ts        # 5 asset/price tools
│   └── cdp-tools.ts          # 4 CDP/loan tools
├── resources/
│   └── index.ts              # MCP resource definitions
└── utils/
    ├── index.ts              # Re-exports
    ├── indexer-client.ts     # Axios client for Indigo analytics API
    ├── validators.ts         # Zod validators (AssetParam enum)
    └── address.ts            # Bech32 address → payment credential
```

### Testing via stdin

The server communicates over stdio using JSON-RPC. You can test tools directly:

```bash
npm run build
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js
```

## License

ISC
