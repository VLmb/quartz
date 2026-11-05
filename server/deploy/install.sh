#!/usr/bin/env bash
# Установка или обновление kb-api на сервере (Ubuntu/Debian). Запуск: sudo bash install.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/VLmb/quartz.git}"
BRANCH="${BRANCH:-v5}"
DIR=/opt/kb

need_node() {
  command -v node >/dev/null || return 0
  [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]
}
if need_node; then
  echo "→ Ставлю Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id kb-api >/dev/null 2>&1 || useradd --system --home /var/lib/kb-api --shell /usr/sbin/nologin kb-api

if [ -d "$DIR/.git" ]; then
  echo "→ Обновляю код в $DIR"
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  echo "→ Клонирую $REPO_URL в $DIR"
  git clone --depth 1 --branch "$BRANCH" --filter=blob:none --sparse "$REPO_URL" "$DIR"
  git -C "$DIR" sparse-checkout set server
fi

if [ ! -f /etc/kb-api.env ]; then
  install -m 600 -o root -g root "$DIR/server/deploy/kb-api.env.example" /etc/kb-api.env
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" /etc/kb-api.env
  echo "!! Заполните /etc/kb-api.env (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SITE_ORIGIN) и запустите скрипт ещё раз."
  exit 1
fi

install -m 644 "$DIR/server/deploy/kb-api.service" /etc/systemd/system/kb-api.service
systemctl daemon-reload
systemctl enable --now kb-api
systemctl restart kb-api
sleep 1
if curl -fsS http://127.0.0.1:8787/api/health >/dev/null; then
  echo "✓ kb-api работает: http://127.0.0.1:8787/api/health"
else
  echo "✗ kb-api не отвечает — смотрите: journalctl -u kb-api -n 50"
  exit 1
fi
