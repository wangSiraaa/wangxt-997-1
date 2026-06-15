FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json* ./

RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "src/index.js"]
