#!/bin/bash
set -euo pipefail

wait_for_mysql() {
  if [ -z "${DATABASE_URL:-}" ] && [ -z "${MYSQL_HOST:-}" ]; then
    return 0
  fi
  echo "Waiting for MySQL..."
  for i in $(seq 1 60); do
    if node - <<'NODE'
const mysql = require('mysql2/promise');
const url = process.env.DATABASE_URL;
const cfg = url
  ? (() => { const u = new URL(url); return { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') }; })()
  : { host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE || 'znzy_homework' };
mysql.createConnection(cfg).then((c) => c.query('SELECT 1').then(() => c.end())).then(() => process.exit(0)).catch(() => process.exit(1));
NODE
    then
      echo "MySQL is ready"
      return 0
    fi
    sleep 2
  done
  echo "MySQL not ready in time" >&2
  exit 1
}

wait_for_redis() {
  if [ -z "${REDIS_URL:-}" ]; then
    return 0
  fi
  echo "Waiting for Redis..."
  for i in $(seq 1 30); do
    if node - <<'NODE'
const Redis = require('ioredis');
const url = process.env.REDIS_URL;
const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
client.connect().then(() => client.ping()).then(() => client.quit()).then(() => process.exit(0)).catch(() => process.exit(1));
NODE
    then
      echo "Redis is ready"
      return 0
    fi
    sleep 2
  done
  echo "Redis not ready in time" >&2
  exit 1
}

wait_for_mysql
wait_for_redis

if [ -n "${DATABASE_URL:-}" ] || [ -n "${MYSQL_HOST:-}" ]; then
  npm run db:seed || true
fi

exec node server/index.cjs
