#!/bin/bash
# Buildy Docs — Mise a jour code sur le VPS Jelastic.
# A executer depuis le VPS, en root, dans /opt/buildy-docs.
# (Anciennement /opt/buildy-af, renomme le 2026-05-01.)
set -e

INSTALL_DIR="${INSTALL_DIR:-/opt/buildy-docs}"
PM2_NAME="${PM2_NAME:-buildy-docs}"

cd "$INSTALL_DIR"

echo "[0/6] backup pre-deploy..."
bash "$INSTALL_DIR/deploy/backup-db.sh" predeploy

echo "[1/6] git pull..."
git pull --ff-only

echo "[2/6] backend deps..."
(cd backend-node && npm ci --omit=dev)

# Le TEXTE du decret (R175, dates d'echeance 2025/2030, seuils, FAQ, guides)
# vit dans la table `bacs_knowledge` de la DB, PAS dans le code : `git pull` ne
# la met donc jamais a jour. On relance l'ingestion a chaque deploy pour que la
# base reflete `scripts/bacs-knowledge/decree-articles.json` (+ gov-faq.json +
# guides PDF). Ingestion IDEMPOTENTE (DELETE + INSERT par source) : rejouable
# sans risque. NON BLOQUANTE : un echec (ex. PDF guide absent sur le VPS) ne
# doit pas casser le deploiement — la partie decret (chargee du JSON en premier)
# est de toute facon appliquee avant les PDF.
echo "[3/6] ingestion base de connaissance BACS (decret + dates 2030 + FAQ + guides)..."
(cd backend-node && node scripts/bacs-knowledge/ingest.mjs) \
  || echo "AVERTISSEMENT: ingestion bacs_knowledge en echec — relancer a la main : cd $INSTALL_DIR/backend-node && node scripts/bacs-knowledge/ingest.mjs"

echo "[4/6] frontend build..."
(cd frontend && npm ci && npm run build)

echo "[5/6] pm2 restart $PM2_NAME..."
pm2 restart "$PM2_NAME" --update-env

echo "[6/6] OK"
echo ""
echo "Mise a jour OK. Logs : pm2 logs $PM2_NAME"
