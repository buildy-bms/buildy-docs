#!/bin/bash
# Genere des certificats HTTPS auto-signes pour buildy-af.
# Idempotent : ne regenere pas si les fichiers existent deja.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$DIR/certs"
CN="${1:-buildy-af.buildy.wan}"

mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
    echo "Certs deja presents dans $CERT_DIR (suppression manuelle pour regenerer)."
    exit 0
fi

echo "Generation cert auto-signe pour CN=$CN (validite 10 ans)..."
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=$CN" \
    -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1" \
    > /dev/null 2>&1

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

echo "Certs generes :"
echo "  $CERT_DIR/server.crt"
echo "  $CERT_DIR/server.key"
