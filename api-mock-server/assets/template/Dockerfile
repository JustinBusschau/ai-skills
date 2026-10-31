# Pin the base image by digest (node:22-alpine@sha256:...) if your organisation requires it.
FROM node:22-alpine
WORKDIR /app
# The lockfile is required, so the image installs exactly the versions npm run verify tested.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Binding to 0.0.0.0 makes this a shared instance: pass MOCK_ADMIN_TOKEN and
# MOCK_CONTROL_TOKEN at run time or the server refuses to start.
ENV HOST=0.0.0.0 PORT=4010 NODE_ENV=production
EXPOSE 4010
USER node
CMD ["node_modules/.bin/tsx", "src/server.ts"]
