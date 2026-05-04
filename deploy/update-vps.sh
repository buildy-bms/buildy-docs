#!/bin/bash
# Buildy Docs — Mise a jour code sur le VPS Jelastic.
# A executer depuis le VPS, en root, dans /opt/buildy-docs.
# (Anciennement /opt/buildy-af, renomme le 2026-05-01.)
set -e

INSTALL_DIR="${INSTALL_DIR:-/opt/buildy-docs}"
PM2_NAME="${PM2_NAME:-buildy-docs}"

cd "$INSTALL_DIR"

echo "[0/5] backup pre-deploy..."
bash "$INSTALL_DIR/deploy/backup-db.sh" predeploy

echo "[1/5] git pull..."
git pull --ff-only

echo "[2/5] backend deps..."
(cd backend-node && npm ci --omit=dev)

echo "[3/5] frontend build..."
(cd frontend && npm ci && npm run build)

echo "[4/5] pm2 restart $PM2_NAME..."
pm2 restart "$PM2_NAME" --update-env

echo "[5/5] OK"
echo ""
echo "Mise a jour OK. Logs : pm2 logs $PM2_NAME"
