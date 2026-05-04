#!/bin/bash
# Buildy Docs — Sauvegarde de la base de prod buildy_af.db
# Usage : backup-db.sh [daily|predeploy]  (defaut: daily)
#
# - daily     : retention 30 derniers snapshots
# - predeploy : retention 20 derniers snapshots
#
# Methode : node + better-sqlite3 .backup() — copie consistante d'une DB
# SQLite en mode WAL sans arreter pm2 (eprouve le 2026-05-04 pour la
# duplication prod -> dev).
#
# Stockage : /opt/buildy-docs/data/backups/<kind>/<kind>-<ts>[-<sha>].db.gz
set -e

KIND="${1:-daily}"
case "$KIND" in
  daily)     RETENTION=30 ;;
  predeploy) RETENTION=20 ;;
  *) echo "[backup-db] Kind invalide: $KIND (daily|predeploy)" >&2; exit 1 ;;
esac

INSTALL_DIR="${INSTALL_DIR:-/opt/buildy-docs}"
DB="$INSTALL_DIR/data/buildy_af.db"
DEST_DIR="$INSTALL_DIR/data/backups/$KIND"
mkdir -p "$DEST_DIR"

if [ ! -f "$DB" ]; then
  echo "[backup-db] DB introuvable : $DB" >&2
  exit 1
fi

TS=$(date +%Y-%m-%d-%H%M%S)
SUFFIX=""
if [ "$KIND" = "predeploy" ]; then
  SHA=$(cd "$INSTALL_DIR" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
  SUFFIX="-$SHA"
fi
TMP="$DEST_DIR/$KIND-$TS$SUFFIX.db"

# Backup live via better-sqlite3 (WAL-safe, n'arrete pas pm2)
(cd "$INSTALL_DIR/backend-node" && node -e "
const Database = require('better-sqlite3');
const db = new Database('$DB', { readonly: true });
db.backup('$TMP').then(() => { db.close(); }).catch(err => {
  console.error('Backup error:', err.message);
  process.exit(1);
});
")

gzip -9 "$TMP"
SIZE=$(du -h "$TMP.gz" | cut -f1)
echo "[backup-db] $KIND OK : $TMP.gz ($SIZE)"

# Rotation : supprimer les plus vieux au-dela de RETENTION (tri par mtime desc)
TO_DELETE=$(ls -1t "$DEST_DIR"/*.db.gz 2>/dev/null | tail -n +$((RETENTION+1)))
if [ -n "$TO_DELETE" ]; then
  echo "$TO_DELETE" | xargs rm --
  COUNT=$(echo "$TO_DELETE" | wc -l)
  echo "[backup-db] retention $KIND : $COUNT ancien(s) snapshot(s) supprime(s) (conservation $RETENTION)"
fi
