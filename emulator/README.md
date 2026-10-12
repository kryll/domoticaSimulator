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
   emulator/scripts/setup.sh            # opciones: --no-build, --zwave, --matter
   ```
   El script:
   - crea `emulator/.env` con contraseñas aleatorias (MQTT y usuario de HA) si no existe;
   - compila la app con base `/` en `dist/`;
   - levanta Home Assistant, Mosquitto, Caddy y el orquestador (`docker compose up -d --build`);
   - hace el onboarding de HA por su API (`scripts/onboard-ha.mjs`): crea el usuario, guarda un token de larga duración en `emulator/.secrets/ha-token` y añade la integración MQTT.
4. Abre **la app en http://localhost:8080** → *Ajustes → Laboratorio* → «Conectar con el laboratorio».
5. Abre **Home Assistant en http://localhost:8123**. Usuario y contraseña: los de `emulator/.env` (`HA_USERNAME` / `HA_PASSWORD`; por defecto, en `.env.example`, `hasim` / `hasim-cambiame`). Cámbialos si quieres.

Parar: `emulator/scripts/stop.sh` (conserva todo). Volver a arrancar: `emulator/scripts/setup.sh --no-build`. Borrar y empezar de cero: `emulator/scripts/reset.sh` (`--all` borra también `.env` y los snapshots).

Los contenedores llevan `restart: "no"`: el laboratorio se arranca y se para a voluntad y no vuelve solo al reiniciar el PC.

## Servicios (`docker-compose.yml`, todos en red `host`)

| Servicio | Imagen | Puertos (solo 127.0.0.1 salvo HA) |
|---|---|---|
| Home Assistant | `ghcr.io/home-assistant/home-assistant:stable` | 8123 |
| Mosquitto | `eclipse-mosquitto:2` | 1883 (MQTT), 9001 (WebSockets) con usuarios y ACL |
| hasim-orchestrator | se construye con `orchestrator/Dockerfile` (`node:22-alpine`) | 8081 (HTTP + WebSocket) |
| Caddy | `caddy:2` | 8080: sirve `../dist` y hace de proxy de `/orchestrator` y `/mqtt` |
| Z-Wave JS UI (perfil `zwave`, E2) | `zwavejs/zwave-js-ui` | 8091, 3000 |
| matterjs-server (perfil `matter`, E2) | `ghcr.io/matter-js/matterjs-server` | 5580 |

Usuarios de Mosquitto: `hasim` (orquestador: `hasim/#`, `hasim-z2m/#`, `homeassistant/#`) y `homeassistant` (todo). Las contraseñas solo están en `emulator/.env`; **nunca** van en el proyecto, en la URL compartida ni en las versiones.

`/var/run/docker.sock` se monta en el orquestador para parar y arrancar HA al restaurar un snapshot. Es opcional: si lo quitas, el orquestador pide a HA que se reinicie por su API.

## Cómo llegan los dispositivos a HA

| Vía hacia HA | Dispositivos | Estado en E1 |
|---|---|---|
| Zigbee2MQTT emulado (`hasim-z2m/…`) | Zigbee con integración Zigbee2MQTT (y HomeKit) | Formato de Z2M: `bridge/state`, `bridge/info`, `bridge/devices` (IEEE estable, Router/EndDevice, `power_source`, exposes), discovery por entidad con `identifiers: zigbee2mqtt_<ieee>` y `via_device: zigbee2mqtt_bridge_<ieee del coordinador>`, comandos en `/set` y `/set/<propiedad>` |
| MQTT discovery genérico (`hasim/…`) | El resto (Tuya, eWeLink, Cast, Alexa, Netatmo…), ZHA y Hue (sin radio virtual) | `homeassistant/device/<id>/config` con `dev`, `o`, `cmps`, `default_entity_id` = entity_id del simulador, `unique_id` `hasim_<proyecto>_<dispositivo>_<clave>`, `suggested_area` = sala, `via_device` = hub simulado |
| Z-Wave JS, Matter | Z-Wave, Matter y Thread | **pendiente de E2**: ahora por MQTT genérico |
| ESPHome, Shelly | ESPHome, Shelly | **pendiente de E3**: ahora por MQTT genérico |

En HA, `origin` dice «HA Simulator», `sw_version` dice «simulado» y `hw_version` dice «Radio: modelada, no real». Ninguna radio es real: la malla, la latencia y la pérdida se modelan en el motor (perfiles de radio en `src/types.ts`).

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

Botón «Lab» de la barra superior (o *Exportar → Laboratorio…*):
- **Nodos**: estado de cada dispositivo (parado, arrancando, en marcha, error), «Arrancar» / «Parar» y «Arrancar todo» / «Parar todo». Parar = disponibilidad `offline` y dejar de publicar; arrancar = discovery y estado.
- **Resetear lab**: borra los retenidos de discovery y de estado, publica todo de nuevo y la app vuelve a los estados iniciales del proyecto.
- **Snapshots**: guarda y restaura `ha-config` junto con el proyecto en `emulator/snapshots/`. Incluye `configuration.yaml`, `packages/` y `.storage/` (dispositivos, entidades, áreas, usuarios, integraciones). **No** incluye la base de datos del historial (`home-assistant_v2.db*`), los logs (`*.log*`) ni las cachés (`deps/`, `tts/`, `.cache/`, `backups/`).
- **Tráfico**: inspector de los mensajes MQTT del lab (topic, payload, sentido, hora y dispositivo), con filtros, pausa y exportación a JSON.
- **Modo en vivo**: con el lab conectado, la simulación va a 1x con la hora real y «Ir a…» se desactiva. Pausar o acelerar desacopla el lab (HA ve los dispositivos como no disponibles) hasta pulsar «Volver a acoplar».

## Protocolo WebSocket (versión 1)

Todos los mensajes llevan `v: 1`; el orquestador rechaza otras versiones. Tipos en `src/bridge/protocol.ts`.

App → orquestador:
- `hello` `{ role: 'app', client }`
- `project` `{ mode: 'full', project, definitions, settings }` y después `{ mode: 'patch', changes, definitions?, settings? }` (claves de primer nivel que cambian)
- `state` `{ full?, entities, removed?, availability?: { live, unavailable } }`
- `node` `{ action: 'start' | 'stop', deviceIds: string[] | 'all' }`
- `lab` `{ action: 'reset' | 'snapshot' | 'restore' | 'list_snapshots' | 'delete_snapshot', requestId, name?, id? }`
- `traffic` `{ subscribe }`
- `command_result` `{ id, ok, error? }`

Orquestador → app:
- `hello` `{ server: 'hasim-orchestrator', version, protocol }`
- `command` `{ id, entityId, service, data, topic }`: comando de HA; la app lo aplica con `callService` y manda el estado resultante
- `status` `{ mqtt, ha, transports, nodes, snapshots, capabilities, lastError? }`
- `lab_result` `{ requestId, action, ok, message, snapshots?, project? }`
- `traffic` `{ entries }`
- `error` `{ message }`

HTTP: `GET /health` y `GET /project` (también bajo `/orchestrator/…`).

MQTT: discovery retenido, republicado al recibir `homeassistant/status online` (con jitter); estados deduplicados por contenido; LWT `hasim/bridge/state offline` y `hasim-z2m/bridge/state {"state":"offline"}`; el orquestador nunca publica en `/set`; antes de reconciliar borra los retenidos de dispositivos eliminados (payload vacío).

## Desarrollo

```bash
cd emulator
npm ci
npm run typecheck
npm test            # orquestador con un broker aedes en memoria
npm start           # orquestador local (variables MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, PORT…)
npm run e2e         # con el laboratorio arrancado: proyecto demo → HA → comando → estado
```

El workflow `.github/workflows/emulator-e2e.yml` hace lo mismo en GitHub Actions; es solo manual (`workflow_dispatch`).
