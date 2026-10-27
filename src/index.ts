#!/usr/bin/env node

// Refuse to start on a Node.js runtime older than 22.23.4. Earlier releases
// ship a Brotli decoder with an out-of-bounds write (CVE-2026-111497) that an
// untrusted upstream can trigger through a `Content-Encoding: br` response.
// `engines` in package.json only warns under npm and pnpm, so npx/stdio users
// would otherwise run on a vulnerable runtime without noticing.
const MIN_NODE = [22, 23, 4];
const current = process.versions.node.split('.').map(Number);
const isTooOld = (() => {
  for (let i = 0; i < MIN_NODE.length; i++) {
    const have = current[i] ?? 0;
    if (have !== MIN_NODE[i]) return have < MIN_NODE[i];
  }
  return false;
})();
if (isTooOld) {
  process.stderr.write(
    `indigo-mcp requires Node.js >= ${MIN_NODE.join('.')} (CVE-2026-111497 Brotli fix); ` +
      `found ${process.versions.node}. Upgrade Node.js and try again.\n`
  );
  process.exit(1);
}

// Handle setup command before importing heavy dependencies
if (process.argv[2] === 'setup') {
  import('./cli/setup.js');
} else {
  import('./server.js');
}
