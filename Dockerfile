FROM node:18.19 AS build

WORKDIR /app

COPY package*.json tsconfig.json tsconfig.build.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:18.19-slim

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist

RUN npm install --omit=dev

CMD ["node", "dist/index.js"]
