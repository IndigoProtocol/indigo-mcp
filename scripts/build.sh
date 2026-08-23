#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="dist"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$OUT_DIR/cli"

BANNER='import { createRequire as __banner_createRequire } from "module"; import { fileURLToPath as __banner_fileURLToPath } from "url"; import { dirname as __banner_dirname } from "path"; import { Request as UndiciRequest, Response as UndiciResponse, Headers as UndiciHeaders, fetch as undiciFetch } from "undici"; const require = __banner_createRequire(import.meta.url); const __filename = __banner_fileURLToPath(import.meta.url); const __dirname = __banner_dirname(__filename); if (typeof globalThis.Request === "undefined") { globalThis.Request = UndiciRequest; globalThis.Response = UndiciResponse; globalThis.Headers = UndiciHeaders; globalThis.fetch = undiciFetch; }'

echo "Building main bundle..."
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile="$OUT_DIR/index.js" \
  --target=node18 \
  --main-fields=module,main \
  --external:undici \
  --external:libsodium-wrappers-sumo \
  --external:libsodium-sumo \
  --banner:js="$BANNER"

echo "Building CLI setup..."
npx esbuild src/cli/setup.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile="$OUT_DIR/cli/setup.js" \
  --target=node18 \
  --main-fields=module,main \
  --banner:js="$BANNER"

echo "Generating type declarations..."
npx tsc --project tsconfig.build.json --emitDeclarationOnly

echo "Copying WASM files..."
# Resolve each WASM through the same dependency chain the bundle imports.
# A wildcard scan of node_modules is not safe: pnpm keeps several versions of
# these packages side by side and the last `find` match wins non-deterministically.
# Shipping a uplc WASM that does not match the bundled JS glue silently changes
# local script-evaluation results.
node -e '
const path = require("path"), fs = require("fs");
const pkgRoot = (spec, paths) => {
  try { return path.dirname(require.resolve(spec + "/package.json", { paths })); } catch {}
  let dir = path.dirname(require.resolve(spec, { paths }));
  for (;;) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, "utf8")).name === spec) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error("package root not found for " + spec);
    dir = up;
  }
};
const out = process.argv[1];
const sdk = pkgRoot("@indigo-labs/indigo-sdk", [process.cwd()]);
const lucid = pkgRoot("@lucid-evolution/lucid", [sdk]);
const search = [lucid, sdk, process.cwd()];
for (const [spec, rel] of [
  ["@anastasia-labs/cardano-multiplatform-lib-nodejs", "cardano_multiplatform_lib_bg.wasm"],
  ["@lucid-evolution/uplc", "dist/node/uplc_tx_bg.wasm"],
  ["@emurgo/cardano-message-signing-nodejs", "cardano_message_signing_bg.wasm"],
]) {
  const src = path.join(pkgRoot(spec, search), rel);
  fs.copyFileSync(src, path.join(out, path.basename(rel)));
  console.log("  " + path.basename(rel) + " <- " + spec);
}
' "$OUT_DIR"

# List copied WASM files
ls -la "$OUT_DIR"/*.wasm 2>/dev/null || echo "No WASM files copied"

echo "Making binaries executable..."
chmod +x "$OUT_DIR/index.js" "$OUT_DIR/cli/setup.js"

echo "Build complete!"
