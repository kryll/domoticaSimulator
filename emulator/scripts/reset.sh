#!/usr/bin/env bash
# Borra el laboratorio para empezar de cero: contenedores, volúmenes, la configuración de HA
# creada al usarlo (salvo configuration.yaml), el token, los datos de Z-Wave JS UI y del mock
# (emulator/zwave/), los puertos y claves de los nodos ESPHome y el bridge Matter (emulator/matter/,
# .secrets/matter.json y el volumen de matterjs-server). Conserva .env y los snapshots
# salvo con --all.   emulator/scripts/reset.sh [--yes] [--all]
set -euo pipefail
cd "$(dirname "$0")/.."
YES=0
ALL=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --all) ALL=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done
if [ "$YES" != 1 ]; then
  read -r -p "Se borrará el Home Assistant del laboratorio (usuarios, dispositivos, historial). ¿Seguir? [s/N] " answer
  case "$answer" in s|S|si|sí|Sí) ;; *) echo "Cancelado"; exit 0 ;; esac
fi
docker compose --profile zwave --profile matter down -v --remove-orphans
# Los archivos de ha-config los crea HA como root: se borran desde un contenedor.
docker run --rm --entrypoint sh -v "$PWD/ha-config:/c" eclipse-mosquitto:2 -c \
  'cd /c && for f in .[!.]* *; do case "$f" in configuration.yaml|packages|"*"|".[!.]*") ;; *) rm -rf "$f" ;; esac; done; rm -rf packages/hasim'
# Z-Wave JS UI y el mock escriben como root: también se borra desde un contenedor.
if [ -d zwave ]; then
  docker run --rm --entrypoint sh -v "$PWD/zwave:/z" eclipse-mosquitto:2 -c 'rm -rf /z/ui /z/mock'
fi
# El bridge Matter (matter.js, escrito como root por el orquestador): fabrics y endpoints.
if [ -d matter ]; then
  docker run --rm --entrypoint sh -v "$PWD/matter:/m" eclipse-mosquitto:2 -c 'rm -rf /m/bridge'
fi
rm -f .secrets/ha-token .secrets/esphome-nodes.json .secrets/matter.json
if [ "$ALL" = 1 ]; then
  docker run --rm --entrypoint sh -v "$PWD:/lab" eclipse-mosquitto:2 -c 'rm -rf /lab/snapshots/* /lab/.secrets'
  rm -f .env
fi
echo "Laboratorio borrado. Vuelve a crearlo con emulator/scripts/setup.sh"
