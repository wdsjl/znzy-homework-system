FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build \
  && chmod +x docker/entrypoint.sh

ENV API_PORT=4000
ENV ASYNC_GRADING=1
ENV VITE_API_PROXY=http://127.0.0.1:4000

EXPOSE 4000 4173

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker/entrypoint.sh"]
