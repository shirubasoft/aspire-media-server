FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.control-plane.json ./
RUN npm ci
COPY control-plane ./control-plane
RUN npm run control-plane:build

FROM node:22-alpine
ENV NODE_ENV=production
RUN apk add --no-cache unzip
WORKDIR /app
COPY --from=build /app/dist/control-plane/src ./src
ENTRYPOINT ["node", "/app/src/cli.js"]
