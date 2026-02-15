#!/bin/sh
set -e

PUID=${PUID:-1001}
PGID=${PGID:-1001}

if [ "$PGID" != "1001" ]; then
  delgroup nodejs 2>/dev/null || true
  addgroup --system --gid "$PGID" nodejs
fi

if [ "$PUID" != "1001" ]; then
  deluser nextjs 2>/dev/null || true
  adduser --system --uid "$PUID" --ingroup nodejs nextjs
fi

chown nextjs:nodejs /app/data

exec su-exec nextjs:nodejs node server.js
