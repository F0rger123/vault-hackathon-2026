FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_VAULT_API=http://127.0.0.1:8000
ENV NEXT_PUBLIC_VAULT_API=$NEXT_PUBLIC_VAULT_API
RUN npm run build

FROM node:24-trixie-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# The app does not need npm at run time. Removing it drops npm's bundled packages, which image scans flag
# (docs/SECURITY.md).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
