#!/usr/bin/env node

// Export registerTools for use as a library (e.g., in Cortex)
export { registerTools } from './tools/index.js';

// Handle setup command before importing heavy dependencies
if (process.argv[2] === 'setup') {
  import('./cli/setup.js');
} else {
  import('./server.js');
}
