# indigo-mcp

MCP server for [Indigo Protocol](https://indigoprotocol.io/) — exposes Indigo data and actions to LLM agents via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Quick Start

```bash
npm install
npm run build
npm start
```

### Development

```bash
npm run dev      # run with tsx (hot reload)
npm run lint     # eslint
npm run format   # prettier
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
        "INDEXER_URL": "https://analytics.indigoprotocol.io/api"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXER_URL` | `https://analytics.indigoprotocol.io/api` | Indigo indexer API base URL |

## Available Tools

_Tools will be added in follow-up issues._

## Project Structure

```
src/
├── index.ts              # Server entry point (stdio transport)
├── tools/                # MCP tool definitions
│   └── index.ts
├── resources/            # MCP resource definitions
│   └── index.ts
└── utils/
    ├── index.ts
    └── indexer-client.ts # Indexer API client
```

## License

ISC
