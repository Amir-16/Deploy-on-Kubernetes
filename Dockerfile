FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:5000/api || exit 1

CMD ["node", "src/server.js"]
