# Indigo MCP

MCP server for [Indigo Protocol](https://indigoprotocol.io/) — exposes Indigo iAsset data, prices, and CDP/loan analytics to LLM agents via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Features

- Real-time iAsset prices (iUSD, iBTC, iETH, iSOL)
- ADA and INDY token price feeds
- CDP/loan browsing with pagination and filtering
- Owner lookup by payment key hash or bech32 address
- CDP health analysis with collateral ratio and liquidation risk status
- Stability pool state and account queries
- INDY staking positions and manager state
- Protocol analytics: TVL, APR rewards, DEX yields, aggregated stats
- Governance: protocol parameters, polls, temperature checks
- Redemption order book and queue aggregation
- DEX proxy: Steelswap swaps, Iris liquidity pools, Blockfrost balances
- Collector UTXOs, IPFS storage and retrieval

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

### Stability Pool Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_stability_pools` | Get the latest stability pool state for each iAsset | None |
| `get_stability_pool_accounts` | Get all open stability pool accounts, optionally filtered by iAsset | `asset?`: iUSD, iBTC, iETH, or iSOL |
| `get_sp_account_by_owner` | Get stability pool accounts for specific owners | `owners`: array of payment key hashes or bech32 addresses |

### Stability Pool Write Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_sp_account` | Create a new stability pool account by depositing iAssets | `address`: bech32 address; `asset`: iUSD, iBTC, iETH, or iSOL; `amount`: iAsset amount in smallest unit |
| `adjust_sp_account` | Deposit to or withdraw from a stability pool account | `address`: bech32 address; `asset`: iUSD, iBTC, iETH, or iSOL; `amount`: positive=deposit, negative=withdraw; `accountTxHash`: UTxO tx hash; `accountOutputIndex`: UTxO output index |
| `close_sp_account` | Close a stability pool account and withdraw everything | `address`: bech32 address; `accountTxHash`: UTxO tx hash; `accountOutputIndex`: UTxO output index |
### Staking Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_staking_info` | Get the current INDY staking manager state | None |
| `get_staking_positions` | Get all open INDY staking positions | None |
| `get_staking_positions_by_owner` | Get INDY staking positions for specific owners | `owners`: array of payment key hashes or bech32 addresses |
| `get_staking_position_by_address` | Get INDY staking positions for a single address | `address`: Cardano bech32 address |

### Staking Write Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `open_staking_position` | Stake INDY tokens by creating a new staking position | `address`: bech32 address; `amount`: INDY amount in smallest unit |
| `adjust_staking_position` | Adjust an existing staking position (add or remove INDY) | `address`: bech32 address; `amount`: positive=stake more, negative=unstake; `positionTxHash`: UTxO tx hash; `positionOutputIndex`: UTxO output index |
| `close_staking_position` | Close a staking position and unstake all INDY | `address`: bech32 address; `positionTxHash`: UTxO tx hash; `positionOutputIndex`: UTxO output index |

### Analytics & APR Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_tvl` | Get historical TVL data from DefiLlama | None |
| `get_apr_rewards` | Get all APR reward records | None |
| `get_apr_by_key` | Get APR for a specific key | `key`: APR key (e.g. sp_iUSD_indy, stake_ada) |
| `get_dex_yields` | Get DEX farm yields for iAsset pairs | None |
| `get_protocol_stats` | Get aggregated protocol statistics | None |

### Governance Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_protocol_params` | Get latest governance protocol parameters | None |
| `get_temperature_checks` | Get temperature check polls | None |
| `get_sync_status` | Get indexer sync status | None |
| `get_polls` | Get all governance polls | None |

### Redemption & Order Book Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_order_book` | Get open limited redemption positions | `asset?`: iAsset filter; `owners?`: array of payment key hashes |
| `get_redemption_orders` | Get redemption orders with optional filters | `timestamp?`: Unix ms; `in_range?`: filter by price range |
| `get_redemption_queue` | Get aggregated redemption queue for an iAsset | `asset`: iUSD, iBTC, iETH, or iSOL |

### DEX Proxy Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_steelswap_tokens` | Get all tokens available on Steelswap DEX | None |
| `get_steelswap_estimate` | Get a swap estimate from Steelswap | `tokenIn`: input token; `tokenOut`: output token; `amountIn`: amount |
| `get_iris_liquidity_pools` | Get liquidity pools from Iris | `tokenA?`: first token; `tokenB?`: second token; `dex?`: DEX filter |
| `get_blockfrost_balances` | Get token balances for a Cardano address | `address`: Cardano bech32 address |

### Collector & IPFS Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_collector_utxos` | Get collector UTXOs for fee distribution | `length?`: max UTXOs to return |
| `store_on_ipfs` | Store text content on IPFS | `text`: content to store |
| `retrieve_from_ipfs` | Retrieve content from IPFS by CID | `cid`: IPFS content identifier |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEXER_URL` | No | `https://analytics.indigoprotocol.io/api/v1` | Indigo analytics API base URL |
| `BLOCKFROST_API_KEY` | For write ops | — | Blockfrost project ID for transaction building |
| `CARDANO_NETWORK` | No | `mainnet` | Cardano network: `mainnet`, `preprod`, or `preview` |

## Example Queries

When connected to an LLM agent, you can ask natural language questions like:

- "What are the current prices of all Indigo iAssets?"
- "What is the price of iUSD right now?"
- "How much is ADA worth in USD?"
- "Show me all iETH CDPs"
- "What CDPs does this address own?" (paste a Cardano address)
- "Analyze the health of my CDPs" (with your address or payment key hash)
- "Are any of my positions at risk of liquidation?"
- "Show me the current stability pool state"
- "What are my stability pool deposits?" (with your address)
- "How much INDY am I staking?" (with your address)
- "What's the current TVL of Indigo?"
- "What APR can I earn on iUSD stability pool?"
- "What are the current governance protocol parameters?"
- "Show me the iUSD redemption queue"
- "Get a Steelswap estimate for swapping 100 ADA to iUSD"
- "What are the current DEX yields for iAsset pairs?"

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
npm run test           # run tests
npm run test:watch     # run tests in watch mode
```

### Project Structure

```
src/
├── index.ts                       # Server entry point (stdio transport)
├── types/
│   └── tx-types.ts                # UnsignedTxResult, TxSummary types
├── tools/
│   ├── index.ts                   # Tool registration hub
│   ├── asset-tools.ts             # 5 asset/price tools
│   ├── cdp-tools.ts               # 4 CDP/loan tools
│   ├── stability-pool-tools.ts    # 3 stability pool tools\
│   ├── stability-pool-write-tools.ts # 3 stability pool write tools
│   ├── staking-tools.ts           # 4 INDY staking tools
│   ├── staking-write-tools.ts     # 3 INDY staking write tools
│   ├── analytics-tools.ts         # 5 analytics/APR tools
│   ├── governance-tools.ts        # 4 governance tools
│   ├── redemption-tools.ts        # 3 redemption/order book tools
│   ├── dex-tools.ts               # 4 DEX proxy tools
│   └── collector-tools.ts         # 3 collector/IPFS tools
├── resources/
│   └── index.ts                   # MCP resource definitions
├── tests/
│   ├── unit/
│   │   ├── tools/                 # Unit tests for each tool module
│   │   └── utils/                 # Unit tests for validators, address
│   └── integration/
│       └── indexer-client.test.ts # Integration test for HTTP client
└── utils/
    ├── index.ts                   # Re-exports
    ├── indexer-client.ts          # Axios client for Indigo analytics API
    ├── validators.ts              # Zod validators (AssetParam enum)
    ├── address.ts                 # Bech32 address → payment credential
    ├── lucid-provider.ts          # Lucid + Blockfrost singleton provider
    ├── sdk-config.ts              # SystemParams loader with cache
    └── tx-builder.ts              # Transaction builder → unsigned CBOR
```

### Testing via stdin

The server communicates over stdio using JSON-RPC. You can test tools directly:

```bash
npm run build
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js
```

## License

ISC
