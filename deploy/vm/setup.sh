#!/usr/bin/env bash
# One Ubuntu 22.04/24.04 VM for Let's Collab. Run as root, from anywhere:
#
#   MODE=turn bash setup.sh   TURN relay only (the backend stays on Render and uses this relay)
#   MODE=full bash setup.sh   backend + exam media server (mediasoup SFU) + TURN, behind HTTPS (Caddy)
#
# Optional: DOMAIN=api.example.com (DNS A record -> this VM). Without it, <public-ip>.sslip.io is used,
# which resolves to this VM and gets a real HTTPS certificate. REPO_URL / BRANCH pick the code (full mode).
# Safe to run again: existing secrets and /etc/letscollab/server.env are kept.
set -euo pipefail

MODE="${MODE:-full}"
REPO_URL="${REPO_URL:-https://github.com/Kish-04/Lets-Collab-App.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/letscollab
CONF_DIR=/etc/letscollab
MEDIASOUP_VERSION=3.28.0
SFU_MIN_PORT=40000
SFU_MAX_PORT=40999
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
case "$MODE" in turn|full) ;; *) echo "MODE must be turn or full"; exit 1;; esac

PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me)"
DOMAIN="${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}"
echo "==> Public IP ${PUBLIC_IP}, host name ${DOMAIN}, mode ${MODE}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ufw coturn openssl ca-certificates gnupg

install -d -m 700 "$CONF_DIR"

# ── TURN (coturn) ────────────────────────────────────────────────────────────────────────────────
# Same secret as the backend's TURN_SECRET: the backend hands out short-lived HMAC credentials
if [ ! -s "$CONF_DIR/turn.secret" ]; then
  openssl rand -hex 32 > "$CONF_DIR/turn.secret"
  chmod 600 "$CONF_DIR/turn.secret"
fi
TURN_SECRET="$(cat "$CONF_DIR/turn.secret")"

cat > /etc/turnserver.conf <<EOF
# Written by deploy/vm/setup.sh; see deploy/turn/turnserver.conf for the meaning of each setting
listening-port=3478
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
external-ip=${PUBLIC_IP}
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=letscollab
fingerprint
stale-nonce=600
no-cli
no-tls
no-dtls
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
user-quota=12
total-quota=1200
EOF
chmod 640 /etc/turnserver.conf
chgrp turnserver /etc/turnserver.conf 2>/dev/null || true
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
systemctl enable coturn
systemctl restart coturn

TURN_URLS="turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp"

# ── Firewall ─────────────────────────────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"

if [ "$MODE" = "full" ]; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow "${SFU_MIN_PORT}:${SFU_MAX_PORT}/udp"
  ufw allow "${SFU_MIN_PORT}:${SFU_MAX_PORT}/tcp"

  # ── Node.js 22 ───────────────────────────────────────────────────────────────────────────────
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  # ── Caddy (HTTPS in front of the backend) ────────────────────────────────────────────────────
  if ! command -v caddy >/dev/null; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  reverse_proxy 127.0.0.1:3001
}
EOF
  systemctl enable caddy
  systemctl restart caddy

  # ── Backend code ─────────────────────────────────────────────────────────────────────────────
  id letscollab >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin letscollab
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$APP_DIR" reset --hard FETCH_HEAD
  else
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
  chown -R letscollab:letscollab "$APP_DIR"
  sudo -u letscollab -H bash -c "cd '$APP_DIR/server' && npm ci --omit=dev && npm install --no-save --omit=dev mediasoup@${MEDIASOUP_VERSION}"

  # ── Backend settings: created once, then yours to edit ──────────────────────────────────────
  if [ ! -f "$CONF_DIR/server.env" ]; then
    cat > "$CONF_DIR/server.env" <<EOF
# Let's Collab backend on this VM. Copy every other variable from Render (Environment tab) below,
# e.g. MONGO_URI, JWT_SECRET, AUDIT_*, UPLOAD_URL_SECRET, ADMIN_*, CORS_ORIGINS, FRONTEND_URL, chain keys.
NODE_ENV=production
PORT=3001
SFU_ENABLED=true
SFU_LISTEN_IP=0.0.0.0
SFU_ANNOUNCED_IP=${PUBLIC_IP}
SFU_RTC_MIN_PORT=${SFU_MIN_PORT}
SFU_RTC_MAX_PORT=${SFU_MAX_PORT}
TURN_URLS=${TURN_URLS}
TURN_SECRET=${TURN_SECRET}
LTI_TOOL_URL=https://${DOMAIN}
EOF
    chmod 600 "$CONF_DIR/server.env"
    chown letscollab:letscollab "$CONF_DIR/server.env"
  fi

  cat > /etc/systemd/system/letscollab.service <<EOF
[Unit]
Description=Let's Collab backend
After=network-online.target
Wants=network-online.target

[Service]
User=letscollab
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${CONF_DIR}/server.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable letscollab
  systemctl restart letscollab
fi

ufw --force enable

echo
echo "==> Done (${MODE} mode)."
echo "TURN relay: ${TURN_URLS}"
echo "TURN secret: in ${CONF_DIR}/turn.secret (sudo cat it; never paste it in chat or screenshots)."
if [ "$MODE" = "turn" ]; then
  echo "On Render, add TURN_URLS (above) and TURN_SECRET (from the file), then redeploy."
else
  echo "Backend: https://${DOMAIN}  (health: https://${DOMAIN}/health)"
  echo "Next: put the Render variables into ${CONF_DIR}/server.env, then: systemctl restart letscollab"
  echo "Then on Vercel set NEXT_PUBLIC_BACKEND_URL=https://${DOMAIN} and redeploy the web app."
fi
echo "Also open the same ports in your cloud provider's firewall / security group (see deploy/vm/README.md)."
