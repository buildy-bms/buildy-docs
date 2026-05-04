#!/bin/bash
# Buildy Docs — Restauration de la base de prod buildy_af.db depuis un snapshot.
# Usage : restore-db.sh                    (mode interactif, choix du snapshot)
#         restore-db.sh <chemin-snapshot>  (mode direct)
#
# - Stoppe pm2 buildy-docs
# - Sauvegarde l'existant sous data/backups/pre-restore/<ts>.db.gz
# - Decompresse le snapshot choisi vers data/buildy_af.db
# - Supprime les fichiers WAL/SHM (force fresh state)
# - Redemarre pm2
set -e

INSTALL_DIR="${INSTALL_DIR:-/opt/buildy-docs}"
DB="$INSTALL_DIR/data/buildy_af.db"
PM2_NAME="${PM2_NAME:-buildy-docs}"

if [ -n "$1" ]; then
  SNAPSHOT="$1"
else
  echo "Snapshots disponibles (du plus recent au plus ancien) :"
  echo
  i=1
  declare -a SNAPSHOTS=()
  for kind in predeploy daily manual-legacy; do
    if [ -d "$INSTALL_DIR/data/backups/$kind" ]; then
      for f in $(ls -1t "$INSTALL_DIR/data/backups/$kind"/*.db.gz 2>/dev/null | head -20); do
        SIZE=$(du -h "$f" | cut -f1)
        DATE=$(stat -c %y "$f" | cut -d. -f1)
        printf "  [%2d] %-10s  %s  %5s  %s\n" "$i" "$kind" "$DATE" "$SIZE" "$(basename $f)"
        SNAPSHOTS[$i]="$f"
        i=$((i+1))
      done
    fi
  done
  if [ ${#SNAPSHOTS[@]} -eq 0 ]; then
    echo "Aucun snapshot disponible." >&2
    exit 1
  fi
  echo
  read -p "Numero du snapshot a restaurer (ou Ctrl-C pour annuler) : " CHOICE
  SNAPSHOT="${SNAPSHOTS[$CHOICE]}"
  if [ -z "$SNAPSHOT" ] || [ ! -f "$SNAPSHOT" ]; then
    echo "Choix invalide." >&2
    exit 1
  fi
fi

echo
echo "Snapshot a restaurer : $SNAPSHOT"
echo "Cible               : $DB"
read -p "Confirmer (yes/NO) ? " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Annule."
  exit 0
fi

# Sauvegarde de securite de l'etat actuel avant overwrite
SAFETY_DIR="$INSTALL_DIR/data/backups/pre-restore"
mkdir -p "$SAFETY_DIR"
SAFETY_TS=$(date +%Y-%m-%d-%H%M%S)
SAFETY="$SAFETY_DIR/pre-restore-$SAFETY_TS.db.gz"
echo "[1/4] Sauvegarde de l'etat actuel : $SAFETY"
gzip -c "$DB" > "$SAFETY"

echo "[2/4] Stop pm2 $PM2_NAME..."
pm2 stop "$PM2_NAME"

echo "[3/4] Restauration..."
gunzip -c "$SNAPSHOT" > "$DB"
# WAL/SHM peuvent contenir des transactions de l'ancienne DB — les supprimer
# pour eviter une corruption (better-sqlite3 les recreera au demarrage).
rm -f "$DB-wal" "$DB-shm"

echo "[4/4] Restart pm2 $PM2_NAME..."
pm2 restart "$PM2_NAME"

echo
echo "Restauration OK. En cas de probleme, l'etat precedent est dans :"
echo "  $SAFETY"
echo "Pour annuler : gunzip -c $SAFETY > $DB && pm2 restart $PM2_NAME"
