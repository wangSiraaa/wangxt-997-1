FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./server/
COPY server/package-lock.json* ./server/
RUN cd server && npm install --production

COPY web/package.json ./web/
COPY web/package-lock.json* ./web/
RUN cd web && npm install

COPY server/ ./server/
COPY web/ ./web/

RUN cd web && npm run build

RUN mkdir -p /app/server/data

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app/server

CMD ["node", "src/index.js"]
