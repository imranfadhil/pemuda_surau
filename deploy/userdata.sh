#!/bin/bash
# DigitalOcean cloud-init - Pemuda Surau
# The "docker-20-04" marketplace image already has Docker + Compose installed,
# so we just prepare the app directory. Code is pushed via sync.bat over SSH.

set -e -x

mkdir -p /opt/pemuda_surau

# Ensure the compose plugin is available as `docker compose`.
if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

echo "Droplet ready for code sync."