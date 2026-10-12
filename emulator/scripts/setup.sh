#!/usr/bin/env bash
# Prepara y arranca el laboratorio de HA Simulator en un PC Linux con Docker (todo gratuito).
#   emulator/scripts/setup.sh [--no-build] [--zwave] [--matter]
#   --no-build  no vuelve a compilar la app (usa dist/ tal cual)
#   --zwave     arranca también Z-Wave JS UI (se completa en E2)
#   --matter    arranca también matterjs-server (se completa en E2)
set -euo pipefail

LAB="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$LAB/.." && pwd)"
BUILD=1
PROFILES=()
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --zwave) PROFILES+=(--profile zwave) ;;
    --matter) PROFILES+=(--profile matter) ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "No encuentro Docker. Instala Docker Engine (gratuito): https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Falta el plugin «docker compose» (paquete docker-compose-plugin)."
command -v curl >/dev/null || fail "Falta curl (sudo apt install curl)."

cd "$LAB"

# 1. Secretos locales (nunca van al proyecto ni al repositorio).
if [ ! -f .env ]; then
  say "Creando emulator/.env con contraseñas aleatorias"
  rand() { head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  umask 077
  cat > .env <<ENV
MQTT_HASIM_PASSWORD=$(rand)
MQTT_HA_PASSWORD=$(rand)
HA_USERNAME=hasim
HA_PASSWORD=$(rand)
TZ=${TZ:-Europe/Madrid}
ENV
  umask 022
fi
mkdir -p .secrets snapshots ha-config/packages/hasim
chmod 700 .secrets

# 2. App compilada con base «/» (Caddy la sirve en http://localhost:8080).
if [ "$BUILD" = 1 ]; then
  say "Compilando la app"
  if command -v npm >/dev/null; then
    (cd "$ROOT" && npm ci --no-audit --no-fund && npx vite build --base=/)
  else
    echo "No hay Node.js en el PC: se compila dentro de un contenedor node:22-alpine."
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT":/app -w /app node:22-alpine \
      sh -c "npm ci --no-audit --no-fund && npx vite build --base=/"
  fi
fi
[ -f "$ROOT/dist/index.html" ] || fail "No existe dist/index.html: compila la app (quita --no-build)."

# 3. Contenedores (la primera vez se descargan las imágenes; después funciona sin Internet).
say "Arrancando Home Assistant, Mosquitto, Caddy y el orquestador"
docker compose "${PROFILES[@]}" up -d --build

say "Esperando a Home Assistant (la primera vez tarda unos minutos)"
for _ in $(seq 1 180); do
  if curl -fsS -o /dev/null http://127.0.0.1:8123/api/onboarding 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS -o /dev/null http://127.0.0.1:8123/api/onboarding || fail "Home Assistant no responde en http://localhost:8123 (mira: docker compose logs homeassistant)"

# 4. Onboarding automático (usuario, token de larga duración y entrada MQTT).
say "Configurando Home Assistant"
docker compose exec -T orchestrator node scripts/onboard-ha.mjs

# shellcheck disable=SC1091
. ./.env
say "Laboratorio listo"
cat <<MSG
  App (cliente del lab):  http://localhost:8080   → Ajustes → Laboratorio → «Conectar con el laboratorio»
  Home Assistant:         http://localhost:8123   usuario: ${HA_USERNAME}   contraseña: ${HA_PASSWORD}
                          (están en emulator/.env; cámbialas en HA si quieres)
  Parar:                  emulator/scripts/stop.sh
  Borrar y empezar:       emulator/scripts/reset.sh
MSG
