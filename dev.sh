#!/bin/bash
# Buildy AF — Dev mode (backend via PM2 + frontend Vite)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

cleanup() {
    echo ""
    echo "Arret du frontend..."
    kill $PID_FRONT 2>/dev/null
    wait $PID_FRONT 2>/dev/null
    echo "Frontend arrete. Backend PM2 reste en place (pm2 stop buildy-af / pm2 logs buildy-af)."
}
trap cleanup EXIT

# Copier .env si absent
if [ ! -f .env ]; then
    echo "Copie de .env.example vers .env"
    cp .env.example .env
fi

# Installer les deps si absentes
if [ ! -d backend-node/node_modules ]; then
    echo "[deps] backend-node : npm install..."
    (cd backend-node && npm install)
fi
if [ ! -d frontend/node_modules ]; then
    echo "[deps] frontend : npm install..."
    (cd frontend && npm install)
fi

# 1. Backend via PM2 (port 3100, watch actif)
echo "[1/2] Backend Fastify via PM2 sur :3100"
if pm2 describe buildy-af > /dev/null 2>&1; then
    pm2 restart buildy-af --update-env
else
    pm2 start ecosystem.config.cjs
fi
sleep 1

# 2. Frontend Vite (port 5173, proxy vers 3100)
echo "[2/2] Frontend Vue.js sur :5173"
(cd frontend && npm run dev) &
PID_FRONT=$!

echo ""
echo "============================================"
echo "  Buildy AF — Dev Mode"
echo "============================================"
echo "  UI:        http://localhost:5173"
echo "  API:       http://localhost:3100/api"
echo "  Mode:      DEV_BYPASS_AUTH=1 (user fictif)"
echo "  Logs:      pm2 logs buildy-af"
echo "  Stop:      pm2 stop buildy-af  (puis Ctrl+C ici)"
echo "============================================"
echo ""

wait
