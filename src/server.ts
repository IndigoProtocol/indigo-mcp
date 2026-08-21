import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

  applyPaymentGate(server);

  registerTools(server);
  registerResources(server);

  return server;
}

/** Read and parse a JSON request body. Returns `undefined` for an empty body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

async function startHttpServer(port: number, host: string): Promise<void> {
  process.stderr.write(`Indigo MCP starting HTTP server...\n`);

  /**
   * One transport (and one MCP server) per client session. A client that
   * reconnects — after a restart, say — simply sends a fresh `initialize` and
   * gets a new session, rather than being locked out until this process is
   * restarted.
   */
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req);
      } catch {
        sendJsonRpcError(res, 400, -32700, 'Parse error: request body is not valid JSON');
        return;
      }
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    if (existing) {
      await existing.handleRequest(req, res, body);
      return;
    }

    // No live session for this request. An `initialize` always starts a fresh
    // one — including when the client replayed a session id this process no
    // longer knows about, so a restarted client can always get back in.
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      if (typeof sessionId === 'string') {
        sendJsonRpcError(
          res,
          404,
          -32001,
          `Session not found: ${sessionId}. Send an initialize request to start a new session.`
        );
      } else {
        sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      }
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
      onsessionclosed: (id) => {
        transports.delete(id);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname === '/mcp') {
      handleMcpRequest(req, res).catch((error: unknown) => {
        process.stderr.write(`Indigo MCP request error: ${error}\n`);
        if (!res.headersSent) {
          sendJsonRpcError(res, 500, -32603, 'Internal server error');
        } else {
          res.end();
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(`Indigo MCP HTTP server listening on ${host}:${port}/mcp\n`);
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
    const port = parseInt(process.env.PORT ?? process.env.MCP_PORT ?? '3000', 10);
    const host = process.env.HOST ?? '0.0.0.0';
    await startHttpServer(port, host);
  } else {
    await startStdioServer();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Indigo MCP error: ${error}\n`);
  process.exit(1);
});
