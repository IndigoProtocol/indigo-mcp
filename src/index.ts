import { IndigoMcpServer } from './IndigoMcpServer';

const server: IndigoMcpServer = new IndigoMcpServer(8000);

await server.start();

