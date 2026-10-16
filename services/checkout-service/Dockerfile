FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/checkout-service/package.json services/checkout-service/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@sentinel/checkout-service --include-workspace-root --no-audit --no-fund
COPY services/checkout-service services/checkout-service
RUN npm run build --workspace=@sentinel/checkout-service && npm prune --workspace=@sentinel/checkout-service --include-workspace-root --omit=dev --no-audit --no-fund

FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
WORKDIR /app
ENV NODE_ENV=production CONTAINER_MODE=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/checkout-service/package.json ./services/checkout-service/package.json
COPY --from=build /app/services/checkout-service/dist ./services/checkout-service/dist
USER node
EXPOSE 3001
CMD ["node", "services/checkout-service/dist/src/server.js"]
