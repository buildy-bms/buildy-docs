#!/bin/bash
# Buildy AF — Installation initiale sur le VPS Jelastic.
# A executer UNE FOIS depuis le VPS, en root.
# Pour les mises a jour, utiliser deploy/update-vps.sh.
set -e

REPO_URL="https://github.com/buildy-bms/buildy-af.git"
INSTALL_DIR="/opt/buildy-af"
PORT="${BUILDY_AF_PORT:-3443}"

echo "=========================================="
echo "  Buildy AF — Installation VPS"
echo "=========================================="

# 1. Clone
if [ -d "$INSTALL_DIR" ]; then
    echo "[1/6] $INSTALL_DIR existe deja, skip clone."
else
    echo "[1/6] Clone $REPO_URL dans $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# 2a. Dependencies systeme pour Puppeteer (Chromium headless)
echo "[2/6] Install dependances systeme Chromium..."
apt-get update -qq
# Ubuntu 24.04 utilise libasound2t64 (au lieu de libasound2)
LIBASOUND="libasound2t64"
apt-cache show $LIBASOUND >/dev/null 2>&1 || LIBASOUND="libasound2"
apt-get install -y -qq \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libgbm1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpango-1.0-0 libpangocairo-1.0-0 libxkbcommon0 libxshmfence1 \
    $LIBASOUND fonts-liberation 2>&1 | tail -2

# 2b. Dependencies backend (Puppeteer telecharge Chromium ~170MB au postinstall)
echo "[2b/6] Install dependances backend (long : telecharge Chromium)..."
(cd backend-node && npm ci --omit=dev)

# 3. Dependencies frontend + build
echo "[3/6] Install dependances frontend + build..."
(cd frontend && npm ci && npm run build)

# 4. Generation certs HTTPS auto-signes
echo "[4/6] Generation certs HTTPS auto-signes..."
bash deploy/generate-certs.sh buildy-af.buildy.wan

# 5. Setup .env si absent
if [ ! -f .env ]; then
    echo "[5/6] Creation .env (a editer manuellement avant pm2 start) :"
    cat > .env <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=$PORT
LOG_LEVEL=info
PUBLIC_URL=https://buildy-af.buildy.wan:$PORT

# JWT (genere ci-dessous)
JWT_SECRET=$(openssl rand -hex 32)

# PocketID OIDC — REQUIS, recuperer depuis PocketID admin (client buildy-af)
OIDC_ENABLED=true
OIDC_ISSUER=https://fleet-manager.buildy.wan:3056
OIDC_CLIENT_ID=__A_REMPLIR__
OIDC_CLIENT_SECRET=__A_REMPLIR__
OIDC_REDIRECT_URI=https://buildy-af.buildy.wan:$PORT/api/auth/oidc/callback

# CORS
CORS_ORIGINS=https://buildy-af.buildy.wan:$PORT

# HTTPS
HTTPS_ENABLED=true
HTTPS_CERT_PATH=$INSTALL_DIR/certs/server.crt
HTTPS_KEY_PATH=$INSTALL_DIR/certs/server.key

# Storage
DATABASE_PATH=$INSTALL_DIR/data/buildy_af.db
ATTACHMENTS_DIR=$INSTALL_DIR/data/attachments
EXPORTS_DIR=$INSTALL_DIR/data/exports

# Pas de DEV_BYPASS en prod
DEV_BYPASS_AUTH=0
EOF
    echo "  → .env cree. Editer OIDC_CLIENT_ID + OIDC_CLIENT_SECRET avec les valeurs PocketID."
else
    echo "[5/6] .env existe deja, skip."
fi

# 6. Firewall (ouvre PORT pour NetBird subnet 100.64.0.0/16)
echo "[6/6] Ouverture iptables port $PORT pour le subnet NetBird..."
if iptables -L INPUT -n | grep -q "tcp dpt:$PORT"; then
    echo "  → regle iptables deja presente."
else
    iptables -I INPUT -s 100.64.0.0/16 -p tcp --dport $PORT -j ACCEPT
    if [ -f /etc/iptables/rules.v4 ]; then
        iptables-save > /etc/iptables/rules.v4
        echo "  → regle ajoutee + persistee."
    else
        echo "  → regle ajoutee (non persistee — pas de /etc/iptables/rules.v4)."
    fi
fi

echo ""
echo "=========================================="
echo "  Installation terminee."
echo "=========================================="
echo "  1. Editer $INSTALL_DIR/.env avec les valeurs PocketID OIDC"
echo "  2. cd $INSTALL_DIR && pm2 start ecosystem.config.cjs --env production"
echo "  3. pm2 save"
echo "  4. Tester : https://buildy-af.buildy.wan:$PORT/api/health"
echo "=========================================="
