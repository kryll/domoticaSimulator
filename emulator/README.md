# Laboratorio de HA Simulator

Entorno de pruebas tipo GNS3 en tu PC: un **Home Assistant real** (de pruebas, nunca el de tu casa) al que se conectan los dispositivos del proyecto a través de sus integraciones. La app hace de cliente gráfico y de «mundo físico»; el orquestador (`hasim-orchestrator`) hace de servidor del laboratorio.

- 100 % gratuito y libre: Docker Engine, Home Assistant, Mosquitto, Caddy, Node.js y paquetes npm libres. Sin cuentas, claves ni servicios de terceros.
- Sin Internet en funcionamiento: solo hace falta para descargar las imágenes la primera vez.
- Es un backend **opcional**: la app sigue funcionando sola en el navegador.

Diseño completo y límites: [docs/EMULACION.md](../docs/EMULACION.md).

## Requisitos

- Linux con Docker Engine y el plugin `docker compose` (red `host`; Docker Desktop de Mac/Windows no sirve para Matter).
- Unos **2 GB de RAM libres** y unos **5 GB de disco** (imágenes de HA, Mosquitto, Caddy y Node).
- Node.js 22 para compilar la app (opcional: si no está, `setup.sh` la compila en un contenedor `node:22-alpine`).
- `curl`.

## Instalación paso a paso

1. Instala Docker Engine (gratuito) siguiendo https://docs.docker.com/engine/install/ para tu distribución, y añade tu usuario al grupo `docker` (`sudo usermod -aG docker $USER`, cierra sesión y vuelve a entrar).
2. Clona el repositorio:
   ```bash
   git clone https://github.com/kryll/domoticaSimulator.git
   cd domoticaSimulator
   ```
3. Arranca el laboratorio:
   ```bash
   emulator/scripts/setup.sh            # opciones: --no-build, --zwave, --matter, --docker
   ```
   El script:
   - crea `emulator/.env` (modo 0600) con contraseñas aleatorias (MQTT y usuario de HA) y el **token del laboratorio** (`LAB_TOKEN`) si no existe; a un `.env` antiguo le añade el token;
   - compila la app con base `/` en `dist/`;
   - levanta Home Assistant, Mosquitto, Caddy y el orquestador (`docker compose up -d --build`);
   - hace el onboarding de HA por su API (`scripts/onboard-ha.mjs`): crea el usuario, guarda un token de larga duración en `emulator/.secrets/ha-token` (a nombre de tu usuario, modo 0600) y añade la integración MQTT;
   - muestra el token del laboratorio.
4. Abre **la app en http://localhost:8080** → *Ajustes → Laboratorio*: marca «Conectar con el laboratorio» y pega el token (`LAB_TOKEN` de `emulator/.env`). Se guarda solo en ese navegador (localStorage), nunca en el proyecto.
5. Abre **Home Assistant en http://localhost:8123**. Usuario y contraseña: los de `emulator/.env` (`HA_USERNAME` / `HA_PASSWORD`; por defecto, en `.env.example`, `hasim` / `hasim-cambiame`). Cámbialos si quieres.

Parar: `emulator/scripts/stop.sh` (conserva todo). Volver a arrancar: `emulator/scripts/setup.sh --no-build`. Borrar y empezar de cero: `emulator/scripts/reset.sh` (`--all` borra también `.env` y los snapshots).

Los contenedores llevan `restart: "no"`: el laboratorio se arranca y se para a voluntad y no vuelve solo al reiniciar el PC.

## Servicios y puertos (`docker-compose.yml`)

| Servicio | Imagen | Red | Escucha en |
|---|---|---|---|
| Home Assistant | `ghcr.io/home-assistant/home-assistant:stable` | host | 8123 en **todas** las interfaces (protegido por el usuario y la contraseña de HA) |
| Mosquitto | `eclipse-mosquitto:2` | host | 127.0.0.1:1883 (MQTT) y 127.0.0.1:9001 (WebSockets), con usuarios y ACL |
| hasim-orchestrator | se construye con `orchestrator/Dockerfile` (`node:22-alpine`) | host | 127.0.0.1:8081 (HTTP + WebSocket), exige el token |
| Caddy | `caddy:2` | host | **127.0.0.1:8080** por defecto: sirve `../dist` y hace de proxy de `/orchestrator` y `/mqtt` |
| Z-Wave JS UI (perfil `zwave`, E2) | `zwavejs/zwave-js-ui` | bridge | 127.0.0.1:8091 (web) y 127.0.0.1:3000 (servidor Z-Wave JS) |
| matterjs-server (perfil `matter`, E2) | `ghcr.io/matter-js/matterjs-server` | host (mDNS, IPv6) | 5580 en **todas** las interfaces y **sin autenticación**: actívalo solo en una red de confianza o bloquea el 5580 con el cortafuegos |

**Seguridad del laboratorio:**
- **Token**: el orquestador exige `LAB_TOKEN` en el WebSocket (primer mensaje `hello`) y en `GET /project` (`Authorization: Bearer …`). Sin token válido cierra la conexión (código 4401). `/health` no lo pide y no expone el proyecto.
- **Origin**: los navegadores solo se aceptan desde el mismo origen de Caddy, `localhost` o `ALLOWED_ORIGINS`.
- **LAN (opcional)**: pon `LAB_BIND=0.0.0.0` en `emulator/.env` y vuelve a lanzar `setup.sh --no-build`. La app queda en `http://<IP del PC>:8080`; el orquestador sigue exigiendo el token. Si entras por un nombre (`http://mipc.local:8080`), añádelo a `ALLOWED_ORIGINS` en `.env`. Ojo: también quedan accesibles Mosquitto por WebSockets (`/mqtt`, con contraseña) y HA.
- **Una sola app controla el lab**: en el mismo navegador, un candado entre pestañas (Web Locks o BroadcastChannel) deja controlar solo a una; las demás muestran «El laboratorio está controlado desde otra pestaña». Desde otro navegador u otro PC, el orquestador deja la segunda app en solo lectura (estado y tráfico) hasta que la primera se desconecte.
- **Docker**: el socket de Docker **no** se monta por defecto (equivale a acceso de administrador al PC). Restaurar un snapshot lo necesita para parar HA antes de copiar la configuración: actívalo con `setup.sh --docker` (usa `docker-compose.docker.yml` y lo recuerda en `.env` con `COMPOSE_FILE`); `setup.sh --no-docker` lo quita. Sin él, «Restaurar» está desactivado.

Usuarios de Mosquitto: `hasim` (orquestador: `hasim/#`, `hasim-z2m/#`, `homeassistant/#`) y `homeassistant` (todo). El entrypoint crea `passwd` y copia la ACL a `/mosquitto/auth/` dentro del contenedor con propietario `mosquitto` y modo 0600 (sin avisos de permisos).

**Dónde viven los secretos** (nunca en el proyecto, ni en la URL compartida, ni en las versiones, ni en la exportación):
- `emulator/.env` (0600): contraseñas MQTT, usuario y contraseña de HA y `LAB_TOKEN`.
- `emulator/.secrets/ha-token` (0600, a nombre de tu usuario): token de larga duración de HA.
- En el navegador (localStorage, clave `hasim.lab.local`): si el lab está activado en esa máquina, la URL del orquestador y el token del laboratorio.
- `emulator/snapshots/` (0700/0600): copias de `ha-config`, que **incluyen** secretos (ver Snapshots).

## Cómo llegan los dispositivos a HA

| Vía hacia HA | Dispositivos | Estado en E1 |
|---|---|---|
| Zigbee2MQTT emulado (`hasim-z2m/…`) | Zigbee con integración Zigbee2MQTT (y HomeKit) | Formato de Z2M: `bridge/state`, `bridge/info`, `bridge/devices` (IEEE estable, Router/EndDevice, `power_source`, exposes), discovery por entidad con `identifiers: zigbee2mqtt_<ieee>` y `via_device: zigbee2mqtt_bridge_<ieee del coordinador>`, comandos en `/set` y `/set/<propiedad>` |
| MQTT discovery genérico (`hasim/…`) | El resto (Tuya, eWeLink, Cast, Alexa, Netatmo…), ZHA y Hue (sin radio virtual) | `homeassistant/device/<id>/config` con `dev`, `o`, `cmps`, `default_entity_id` = entity_id del simulador, `unique_id` `hasim_<proyecto>_<dispositivo>_<clave>`, `suggested_area` = sala, `via_device` = hub simulado |
| Z-Wave JS, Matter | Z-Wave, Matter y Thread | **pendiente de E2**: ahora por MQTT genérico |
| ESPHome, Shelly | ESPHome, Shelly | **pendiente de E3**: ahora por MQTT genérico |

En HA, `origin` dice «HA Simulator», `sw_version` dice «simulado» y `hw_version` dice «Radio: modelada, no real». Ninguna radio es real: la malla y la pérdida se modelan en el motor. Perfiles de radio (`radioProfiles` del proyecto, sobre los valores de `src/types.ts`): de momento se usan la latencia por protocolo (si el proyecto la ajusta, el motor la usa en lugar de su tabla) y el canal Zigbee, que el Z2M emulado publica en `bridge/info`; el resto de campos se guardan pero aún no influyen.

Notas del mapeo (`src/bridge/mqtt/`):
- Luces con esquema JSON: brillo 0-255 (Z2M 0-254), `color_temp` en mireds y color RGB (Z2M: CIE xy).
- `media_player` no existe en MQTT: se publica como `sensor` (estado), `switch` (encendido), `number` (volumen 0-100) y `select` (fuente), con entity_id `…_state`, `…_power`, `…_volume`, `…_source`. La cámara se publica como un sensor de estado.
- Los helpers, grupos, escenas, scripts y automatizaciones no se emulan: se exportan a HA como packages.
- Los exposes de Z2M salen de tablas propias por dominio (no se usa zigbee-herdsman-converters, para que la parte pura no dependa de paquetes pesados).

## Automatizaciones

Con «Automatizaciones en el HA del lab» (por defecto), el simulador no las dispara y el orquestador escribe `ha-config/packages/hasim/<área>.yaml` con el exportador de la app y llama a `homeassistant.reload_all`. Para forzarlo a mano:

```bash
cd emulator && node scripts/sync-automations.mjs                 # usa el último proyecto que mandó la app
cd emulator && node scripts/sync-automations.mjs --project casa.json
```

## Laboratorio desde la app

Botón «Lab» de la barra superior (siempre visible; también desde Ctrl+K: «Laboratorio: …»). El panel se abre bajo la barra superior y se puede plegar:
- **Nodos**: estado de cada dispositivo (parado, arrancando, en marcha, error), «Arrancar» / «Parar» y «Arrancar todo» / «Parar todo». Parar = disponibilidad `offline` y dejar de publicar; arrancar = discovery y estado.
- **Resetear lab**: borra los retenidos de discovery y de estado, publica todo de nuevo y la app vuelve a los estados iniciales del proyecto.
- **Snapshots**: guarda y restaura `ha-config` junto con el proyecto en `emulator/snapshots/`. Incluye `configuration.yaml`, `packages/` y `.storage/` (dispositivos, entidades, áreas, usuarios, integraciones). **No** incluye la base de datos del historial (`home-assistant_v2.db*`), los logs (`*.log*`) ni las cachés (`deps/`, `tts/`, `.cache/`, `backups/`).
  - **Contienen secretos**: los usuarios, las contraseñas (hash) y los tokens de HA (`.storage/auth*`) y las credenciales de las integraciones (`.storage/core.config_entries`, p. ej. la contraseña MQTT). Por eso la carpeta y cada snapshot son 0700 y los archivos 0600. No los compartas. La opción «Excluir credenciales (auth*)» no copia `.storage/auth*`; al restaurar uno así se conservan los usuarios y tokens actuales. Las credenciales de las integraciones siguen dentro.
  - **Restaurar** necesita el perfil con Docker (`setup.sh --docker`): el orquestador para HA, copia la configuración y vuelve a arrancarlo (aunque la copia falle). El proyecto del snapshot se valida y se fusiona con el actual (se conservan el id, las variantes y las imágenes del plano), sin reiniciar la simulación, y el lab vuelve a acoplarse.
  - Los ids se validan (`[A-Za-z0-9._-]`, nunca `.` ni `..`) y deben ser de un snapshot existente.
- **Tráfico**: inspector de los mensajes MQTT del lab (topic, payload, sentido, hora y dispositivo), con filtros, pausa y exportación a JSON.
- **Modo en vivo**: con el lab conectado, la simulación va a 1x con la hora real; «Ir a…» y el selector de velocidad se desactivan (HA no se puede acelerar). Pausar pregunta «¿Parar todos los nodos?»: si aceptas, se paran todos los nodos y el lab se desacopla (HA ve los dispositivos como no disponibles, sus comandos se ignoran y las automatizaciones vuelven al simulador) hasta pulsar «Volver a acoplar», que arranca de nuevo los nodos.
- **Automatizaciones**: si pasas «Automatizaciones» a «en el simulador» o desactivas el lab, el orquestador borra `packages/hasim` y recarga HA (`reload_all`).

## Protocolo WebSocket (versión 1)

Todos los mensajes llevan `v: 1`; el orquestador rechaza otras versiones. Tipos en `src/bridge/protocol.ts`.

App → orquestador:
- `hello` `{ role: 'app', client, token }`: **primer mensaje obligatorio** con el token del laboratorio; si falta o no es válido, `error` con `code: 'auth'` y cierre 4401
- `project` `{ mode: 'full', project, definitions, settings }` y después `{ mode: 'patch', changes, definitions?, settings? }` (claves de primer nivel que cambian)
- `state` `{ full?, entities, removed?, availability?: { live, unavailable } }`
- `node` `{ action: 'start' | 'stop', deviceIds: string[] | 'all' }`
- `lab` `{ action: 'reset' | 'snapshot' | 'restore' | 'list_snapshots' | 'delete_snapshot', requestId, name?, id?, excludeCredentials? }`
- `goodbye`: la app desactiva el lab (el orquestador retira las automatizaciones de HA)
- `traffic` `{ subscribe }`
- `command_result` `{ id, ok, error? }`

Orquestador → app:
- `hello` `{ server: 'hasim-orchestrator', version, protocol, readOnly }`: token aceptado; `readOnly: true` si otra app controla el lab (si esa se va, la siguiente recibe otro `hello` con `readOnly: false`)
- `command` `{ id, entityId, service, data, topic }`: comando de HA; la app lo aplica con `callService` y manda el estado resultante
- `status` `{ mqtt, ha, transports, nodes, snapshots, capabilities, lastError? }`
- `lab_result` `{ requestId, action, ok, message, snapshots?, project? }`
- `traffic` `{ entries }`
- `error` `{ message, code?: 'auth' | 'readonly' | 'invalid' }`

El orquestador valida todo lo que recibe antes de aplicarlo: el proyecto (también el resultado de un parche) con `parseProject`, los ajustes con `parseHaBridge` (un topic con `#` o `+` no es válido) y las definiciones con `parseDefinition`; si algo falla responde `error` con `code: 'invalid'` y no cambia nada. Tamaño máximo de mensaje: 4 MB. La app, a su vez, valida con `parseProject` el proyecto de un snapshot y solo acepta `lab_result` de peticiones suyas pendientes.

HTTP: `GET /health` (200 o 503 según la conexión MQTT real) y `GET /project` (con `Authorization: Bearer <LAB_TOKEN>`), también bajo `/orchestrator/…`.

MQTT: discovery retenido, republicado al recibir `homeassistant/status online` (con jitter); estados deduplicados por contenido; LWT `hasim/bridge/state offline` y `hasim-z2m/bridge/state {"state":"offline"}`; el orquestador nunca publica en `/set`; antes de reconciliar borra los retenidos de dispositivos eliminados (payload vacío).

## Desarrollo

```bash
cd emulator
npm ci
npm run typecheck
npm test            # orquestador con un broker aedes en memoria
LAB_TOKEN=$(openssl rand -hex 32) npm start   # orquestador local (también MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, PORT…)
npm run e2e         # con el laboratorio arrancado: proyecto demo → HA → comando → estado (lee LAB_TOKEN de .env)
```

El workflow `.github/workflows/emulator-e2e.yml` hace lo mismo en GitHub Actions; es solo manual (`workflow_dispatch`) y pasa a `npm run e2e` el `LAB_TOKEN` que genera `setup.sh`. El CI normal (`ci.yml`) ejecuta el typecheck y los tests del orquestador con aedes.
