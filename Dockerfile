FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY rates ./rates
COPY openapi.yaml llms.txt tsconfig.json ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8788 PAYROLL_SQLITE=/data/payroll.db
EXPOSE 8788
CMD ["node_modules/.bin/tsx", "src/index.ts"]
