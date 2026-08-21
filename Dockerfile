# Builds the server from source, so the image depends on nothing but this repo.
#
# Note for anyone tracing artifacts: this is one of three build outputs and they
# are not interchangeable.
#   scripts/build.sh          -> dist/            (npm package, this image, Fly)
#   scripts/smithery-build.sh -> .smithery/stdio/ (MCPB bundle for `smithery mcp publish`)
#   `npx smithery build`      -> .smithery/hosted/ (Smithery's own hosted runtime)
# This Dockerfile previously copied from .smithery/hosted/, which nothing in the
# repo produces, so every container build failed on a missing file.

FROM node:22-slim AS build

WORKDIR /app
RUN npm install -g pnpm@10

# Dependencies first, so a source-only change reuses this layer.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

# esbuild bundles src, marks libsodium/undici external, and copies the WASM
# files the Cardano libraries load at runtime into dist/.
RUN pnpm build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@10

# Only the runtime dependencies — the three packages left external to the
# bundle. Everything else is already inside dist/index.js.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune

COPY --from=build /app/dist ./dist

ENV MCP_TRANSPORT=http
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
