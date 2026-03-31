import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Load .env before tests run so X402_EVM_ADDRESS etc. are available
    // without needing to prefix every npm test invocation.
    setupFiles: ['dotenv/config'],
  },
});
