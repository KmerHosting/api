FROM oven/bun:1.2.0-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
ENV NODE_ENV=production
EXPOSE 8787
USER bun
CMD ["bun", "run", "start"]
