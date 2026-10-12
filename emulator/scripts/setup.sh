#!/usr/bin/env bash
# Prepara y arranca el laboratorio de HA Simulator en un PC Linux con Docker (todo gratuito).
#   emulator/scripts/setup.sh [--no-build] [--zwave] [--matter] [--docker|--no-docker]
#   --no-build   no vuelve a compilar la app (usa dist/ tal cual)
#   --zwave      arranca también Z-Wave JS UI (se completa en E2)
#   --matter     arranca también matterjs-server (se completa en E2)
#   --docker     da al orquestador el socket de Docker (necesario para restaurar snapshots)
#   --no-docker  se lo quita (por defecto no lo tiene)
set -euo pipefail

LAB="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$LAB/.." && pwd)"
BUILD=1
PROFILES=()
DOCKER_CONTROL=""
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --zwave) PROFILES+=(--profile zwave) ;;
    --matter) PROFILES+=(--profile matter) ;;
    --docker) DOCKER_CONTROL=1 ;;
    --no-docker) DOCKER_CONTROL=0 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
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
rand() { head -c "${1:-18}" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if [ ! -f .env ]; then
  say "Creando emulator/.env con contraseñas aleatorias y el token del laboratorio"
  umask 077
  cat > .env <<ENV
MQTT_HASIM_PASSWORD=$(rand)
MQTT_HA_PASSWORD=$(rand)
HA_USERNAME=hasim
HA_PASSWORD=$(rand)
# Token que la app pide en Ajustes → Laboratorio (y que exige el orquestador).
LAB_TOKEN=$(rand 32)
# Interfaz de Caddy (8080): 127.0.0.1 = solo este PC; 0.0.0.0 = también la LAN.
LAB_BIND=127.0.0.1
TZ=${TZ:-Europe/Madrid}
ENV
  umask 022
fi
# .env de una versión anterior sin token: se añade.
if ! grep -q '^LAB_TOKEN=' .env; then
  say "Añadiendo el token del laboratorio (LAB_TOKEN) a emulator/.env"
  printf '# Token que la app pide en Ajustes → Laboratorio (y que exige el orquestador).\nLAB_TOKEN=%s\n' "$(rand 32)" >> .env
fi
grep -q '^LAB_BIND=' .env || printf '# Interfaz de Caddy (8080): 127.0.0.1 = solo este PC; 0.0.0.0 = también la LAN.\nLAB_BIND=127.0.0.1\n' >> .env
chmod 600 .env
# Perfil opcional con el socket de Docker (restaurar snapshots): se recuerda en .env.
if [ "$DOCKER_CONTROL" = 1 ]; then
  grep -q '^COMPOSE_FILE=' .env || echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.docker.yml' >> .env
elif [ "$DOCKER_CONTROL" = 0 ]; then
  sed -i '/^COMPOSE_FILE=/d' .env
fi
mkdir -p .secrets snapshots ha-config/packages/hasim
chmod 700 .secrets snapshots

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
# Si el orquestador ya existía con otro juego de volúmenes (--docker/--no-docker), se recrea.
docker compose "${PROFILES[@]}" up -d --build --remove-orphans

say "Esperando a Home Assistant (la primera vez tarda unos minutos)"
for _ in $(seq 1 180); do
  if curl -fsS -o /dev/null http://127.0.0.1:8123/api/onboarding 2>/dev/null; then break; fi
  sleep 2
done
curl -fsS -o /dev/null http://127.0.0.1:8123/api/onboarding || fail "Home Assistant no responde en http://localhost:8123 (mira: docker compose logs homeassistant)"

# 4. Onboarding automático (usuario, token de larga duración y entrada MQTT).
say "Configurando Home Assistant"
# El onboarding corre como root dentro del contenedor: los secretos (ha-token) se dejan a nombre
# del usuario del PC (HOST_UID/HOST_GID) con modo 0600, para que los lean los scripts del host.
docker compose exec -T -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" orchestrator node scripts/onboard-ha.mjs

# shellcheck disable=SC1091
. ./.env
say "Laboratorio listo"
cat <<MSG
  App (cliente del lab):  http://localhost:8080   → Ajustes → Laboratorio → «Conectar con el laboratorio»
  Token del laboratorio:  ${LAB_TOKEN}
                          (pégalo una vez en Ajustes → Laboratorio; está en emulator/.env)
  Home Assistant:         http://localhost:8123   usuario: ${HA_USERNAME}   contraseña: ${HA_PASSWORD}
                          (están en emulator/.env; cámbialas en HA si quieres)
  Snapshots:              restaurar necesita setup.sh --docker (control de Docker para parar HA)
  Parar:                  emulator/scripts/stop.sh
  Borrar y empezar:       emulator/scripts/reset.sh
MSG
