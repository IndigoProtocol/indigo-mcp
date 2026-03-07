#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';

const SERVER_NAME = 'indigo-mcp';
const SERVER_VERSION = '0.2.0';

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server);
  registerResources(server);

  return server;
}

async function startHttpServer(port: number): Promise<void> {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname === '/mcp') {
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.listen(port, () => {
    process.stderr.write(`Indigo MCP HTTP server listening on port ${port}\n`);
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
