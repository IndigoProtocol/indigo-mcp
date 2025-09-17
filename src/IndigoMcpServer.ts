import express, { Express } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from './logger';
import {
    handleAssetAnalytics,
    handleAssetInterestRates,
    handleAssetPrices,
    handleAssets,
    handleCdps, handleCdpsAtAddress
} from './handlers';
import cors from 'cors';

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

            this.registerResources(server);

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

    registerResources(server: McpServer) {
        server.registerResource('assets', 'asset://parameters', { title: 'Asset System Parameters', description: 'Retrieve iAsset system parameters', mimeType: 'application/json' }, handleAssets);
        server.registerResource('asset-prices', 'asset://prices', { title: 'Asset Prices', description: 'Retrieve iAsset prices', mimeType: 'application/json' }, handleAssetPrices);
        server.registerResource('asset-analytics', 'asset://analytics', { title: 'Asset Analytics', description: 'Retrieve iAsset analytics like Market Cap, TVL, etc.', mimeType: 'application/json' }, handleAssetAnalytics);
        server.registerResource('asset-interest-rates', 'asset://interest-rates', { title: 'Asset Interest Rates', description: 'Retrieve iAsset interest rates', mimeType: 'application/json' }, handleAssetInterestRates);
        server.registerResource('cdps', 'cdp://all', { title: 'All open CDP positions', description: 'Retrieve open Collateralized Debt Positions (CDPs)', mimeType: 'application/json' }, handleCdps);
        server.registerResource('cdps-at-address', new ResourceTemplate('cdp://{address}', { list: undefined }), { title: 'Address CDP positions', description: 'Retrieve open Collateralized Debt Positions (CDPs) for a specific address', mimeType: 'application/json' }, (uri, { address }) => handleCdpsAtAddress(uri, address));
    }

}