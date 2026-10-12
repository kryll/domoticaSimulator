#!/usr/bin/env bash
# Para el laboratorio sin borrar nada (se vuelve a arrancar con setup.sh --no-build o
# «docker compose up -d» dentro de emulator/).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile zwave --profile matter stop
echo "Laboratorio parado. Los datos de Home Assistant y los snapshots se conservan."
