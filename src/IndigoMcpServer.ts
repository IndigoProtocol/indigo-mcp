import express, { Express } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from './logger';
import cors from 'cors';
import tools from './tools';
import { McpTool } from './types';

export class IndigoMcpServer {

    protected app: Express;

    constructor(
        protected port: number = 8000,
    ) {
        this.app = express()
    }

    async start() {
        this.app.use(express.json());
        this.app.use(
            cors({
                exposedHeaders: ['mcp-session-id'],
                allowedHeaders: ['Content-Type', 'mcp-session-id'],
            })
        );

        this.app.post('/mcp', this.handleRequest.bind(this));
        this.app.get('/mcp', this.rejectRequest.bind(this));
        this.app.delete('/mcp', this.rejectRequest.bind(this));

        this.app.listen(this.port, () => {
            logger.info(`Indigo MCP started on port ${this.port}`);
        });
    }

    async handleRequest(request: express.Request, response: express.Response) {
        try {
            const server: McpServer = new McpServer({
                name: 'indigo-mcp',
                version: '1.0.0',
            }, {
                capabilities: {
                    tools: {},
                },
            });

            tools.forEach((tool: McpTool) => {
                server.registerTool(
                    tool.name,
                    {
                        title: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                    },
                    async (params: any) => {
                        try {
                            return tool.handler(request, ...Object.values(params));
                        } catch (e) {
                            logger.error(e);

                            return {
                                content: [{
                                    type: 'text',
                                    text: e
                                }],
                                isError: true,
                            }
                        }
                    }
                )
            });

            const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });

            response.on('close', () => {
                transport.close();
                server.close();
            });

            await server.connect(transport);
            await transport.handleRequest(request, response, request.body);
        } catch (e) {
            logger.error(e);

            if (! response.headersSent) {
                response.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    }

    rejectRequest(request: express.Request, response: express.Response) {
        response.writeHead(405).end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed.'
            },
            id: null
        }));
    }

}