#!/bin/bash
# Buildy AF — Mise a jour code sur le VPS Jelastic.
# A executer depuis le VPS, en root, dans /opt/buildy-af.
set -e

cd /opt/buildy-af

echo "[1/4] git pull..."
git pull --ff-only

echo "[2/4] backend deps..."
(cd backend-node && npm ci --omit=dev)

echo "[3/4] frontend build..."
(cd frontend && npm ci && npm run build)

echo "[4/4] pm2 restart buildy-af..."
pm2 restart buildy-af --update-env

echo ""
echo "Mise a jour OK. Logs : pm2 logs buildy-af"
