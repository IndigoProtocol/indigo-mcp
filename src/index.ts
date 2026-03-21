#!/usr/bin/env node

export { registerTools } from './tools/index.js';

// Only run server if this file is executed directly (not imported as library)
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('indigo-mcp/dist/index.js');

if (isMainModule) {
  // Handle setup command before importing heavy dependencies
  if (process.argv[2] === 'setup') {
    import('./cli/setup.js');
  } else {
    import('./server.js');
  }
}
