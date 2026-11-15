#!/usr/bin/env bash
set -euo pipefail
cd /workspace/chatPan
export npm_config_cache=/workspace/.npm
export XDG_CACHE_HOME=/workspace/.cache
mkdir -p "$npm_config_cache" "$XDG_CACHE_HOME"
npm ci
node scripts/local-env.mjs
if [ -z "${DATABASE_URL:-}" ]; then
  if docker container inspect chatpan-db >/dev/null 2>&1; then
    docker start chatpan-db >/dev/null
    for attempt in $(seq 1 20); do
      if docker exec chatpan-db pg_isready -U chatpan >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker exec chatpan-db pg_isready -U chatpan
  else
    docker compose up -d --wait db
  fi
fi
npm run db:generate
npm run db:migrate
npm run build
