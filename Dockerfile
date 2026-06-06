FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && chmod +x docker/entrypoint.sh

ENV API_PORT=4000
ENV ASYNC_GRADING=1

EXPOSE 4000 4173

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker/entrypoint.sh"]
