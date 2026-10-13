#!/usr/bin/env bash
# Para el laboratorio sin borrar nada (se vuelve a arrancar con setup.sh --no-build o
# «docker compose up -d» dentro de emulator/).
set -euo pipefail
cd "$(dirname "$0")/.."
# Todos los perfiles (también los que no estén activos ahora): no queda ningún contenedor del lab.
docker compose --profile zwave --profile matter stop
echo "Laboratorio parado. Se conservan los datos de Home Assistant, Z-Wave JS UI (emulator/zwave/), las claves de ESPHome, el bridge Matter (emulator/matter/) y los snapshots."
