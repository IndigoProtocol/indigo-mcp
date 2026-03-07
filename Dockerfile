FROM node:22-slim

WORKDIR /app

COPY .smithery/hosted/server.mjs ./server.mjs
COPY .smithery/hosted/*.wasm ./

ENV MCP_TRANSPORT=http
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.mjs"]
