import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { applyPaymentGate } from './payment.js';

const SERVER_NAME = 'indigo-mcp';
const SERVER_VERSION = '0.2.0';

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Apply split payment gate before registering tools.
  // wrapWithSplitPayment patches server.tool internally so every handler
  // goes through the mcp.openmm.io proxy for payment verification.
  // No-op when X402_PRIVATE_KEY is not set.
  applyPaymentGate(server);

  registerTools(server);
  registerResources(server);

  return server;
}

async function startHttpServer(port: number): Promise<void> {
  process.stderr.write(`Indigo MCP starting HTTP server...\n`);

  // Start HTTP server immediately so Fly.io sees the port open
  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname === '/mcp') {
      if (!transport) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server initializing' }));
        return;
      }
      transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  let transport: StreamableHTTPServerTransport | null = null;

  httpServer.listen(port, '0.0.0.0', async () => {
    process.stderr.write(`Indigo MCP HTTP server listening on 0.0.0.0:${port}\n`);

    // Initialize MCP server after port is open
    const server = createServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);
    process.stderr.write(`Indigo MCP server ready\n`);
  });
}

async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const mode = process.env.MCP_TRANSPORT ?? 'stdio';

  if (mode === 'http') {
    const port = parseInt(process.env.PORT ?? '3000', 10);
    await startHttpServer(port);
  } else {
    await startStdioServer();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Indigo MCP error: ${error}\n`);
  process.exit(1);
});
