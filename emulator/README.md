# Laboratorio de HA Simulator

Entorno de pruebas tipo GNS3 en tu PC: un **Home Assistant real** (de pruebas, nunca el de tu casa) al que se conectan los dispositivos del proyecto a través de sus integraciones. La app hace de cliente gráfico y de «mundo físico»; el orquestador (`hasim-orchestrator`) hace de servidor del laboratorio.

Desde E2, los dispositivos **Z-Wave** llegan a HA por la integración real **Z-Wave JS** (controlador emulado con el mock de zwave-js + Z-Wave JS UI) y los **ESPHome** por la integración real **ESPHome** (API nativa emulada por el orquestador, con cifrado Noise). Ver [Vías reales (E2)](#vías-reales-e2-z-wave-js-y-esphome).

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
   emulator/scripts/setup.sh --all      # opciones: --no-build, --zwave, --esphome, --all, --matter, --docker
   ```
   El script:
   - crea `emulator/.env` (modo 0600) con contraseñas aleatorias (MQTT y usuario de HA) y el **token del laboratorio** (`LAB_TOKEN`) si no existe; a un `.env` antiguo le añade el token;
   - compila la app con base `/` en `dist/`;
   - levanta Home Assistant, Mosquitto, Caddy y el orquestador (`docker compose up -d --build`);
   - con `--zwave`, `--esphome` o `--all` activa las vías reales de E2 y lo recuerda en `.env` (`COMPOSE_PROFILES`); con `--zwave` deja los ajustes iniciales de Z-Wave JS UI en `emulator/zwave/ui/settings.json` (antena `tcp://zwave-mock:5555`, servidor en el 3000, claves de seguridad aleatorias, sin MQTT ni estadísticas);
   - hace el onboarding de HA por su API (`scripts/onboard-ha.mjs`): crea el usuario, guarda un token de larga duración en `emulator/.secrets/ha-token` (a nombre de tu usuario, modo 0600), añade la integración MQTT y, con `--zwave`, la integración Z-Wave JS (`ws://127.0.0.1:3000`, espera a que Z-Wave JS UI arranque);
   - muestra el token del laboratorio.
4. Abre **la app en http://localhost:8080** → *Ajustes → Laboratorio*: marca «Conectar con el laboratorio» y pega el token (`LAB_TOKEN` de `emulator/.env`). Se guarda solo en ese navegador (localStorage), nunca en el proyecto.
5. Abre **Home Assistant en http://localhost:8123**. Usuario y contraseña: los de `emulator/.env` (`HA_USERNAME` / `HA_PASSWORD`; por defecto, en `.env.example`, `hasim` / `hasim-cambiame`). Cámbialos si quieres.

Parar: `emulator/scripts/stop.sh` (conserva todo). Volver a arrancar: `emulator/scripts/setup.sh --no-build` (recuerda los perfiles). Quitar un perfil: `--no-zwave`, `--no-esphome`. Borrar y empezar de cero: `emulator/scripts/reset.sh` (también los datos de Z-Wave JS UI y las claves de ESPHome; `--all` borra además `.env` y los snapshots).

Los contenedores llevan `restart: "no"`: el laboratorio se arranca y se para a voluntad y no vuelve solo al reiniciar el PC.

Listas de pruebas manuales: [docs/PRUEBAS_E1.md](../docs/PRUEBAS_E1.md) (base) y [docs/PRUEBAS_E2.md](../docs/PRUEBAS_E2.md) (Z-Wave y ESPHome reales).

## Servicios y puertos (`docker-compose.yml`)

| Servicio | Imagen | Red | Escucha en |
|---|---|---|---|
| Home Assistant | `ghcr.io/home-assistant/home-assistant:stable` | host | 8123 en **todas** las interfaces (protegido por el usuario y la contraseña de HA) |
| Mosquitto | `eclipse-mosquitto:2` | host | 127.0.0.1:1883 (MQTT) y 127.0.0.1:9001 (WebSockets), con usuarios y ACL |
| hasim-orchestrator | se construye con `orchestrator/Dockerfile` (`node:22-alpine`) | host | 127.0.0.1:8081 (HTTP + WebSocket), exige el token |
| Caddy | `caddy:2` | host | **127.0.0.1:8080** por defecto: sirve `../dist` y hace de proxy de `/orchestrator` y `/mqtt` |
| zwave-mock (perfil `zwave`) | la imagen del orquestador (`orchestrator/src/zwave/mockMain.ts`) | bridge | puerto serie emulado 5555 **solo en la red interna de Docker**; 127.0.0.1:5556 (control, exige el token) |
| Z-Wave JS UI (perfil `zwave`) | `zwavejs/zwave-js-ui` | bridge | 127.0.0.1:8091 (web, sin contraseña: solo este PC) y 127.0.0.1:3000 (servidor Z-Wave JS para HA) |
| Nodos ESPHome (perfil `esphome`) | dentro del orquestador | host | 127.0.0.1:16054, 16055… (API nativa de cada nodo, cifrada con Noise) |
| matterjs-server (perfil `matter`, E3) | `ghcr.io/matter-js/matterjs-server` | host (mDNS, IPv6) | 5580 en **todas** las interfaces y **sin autenticación**: actívalo solo en una red de confianza o bloquea el 5580 con el cortafuegos |

**Seguridad del laboratorio:**
- **Token**: el orquestador exige `LAB_TOKEN` en el WebSocket (primer mensaje `hello`) y en `GET /project` (`Authorization: Bearer …`). Sin token válido cierra la conexión (código 4401). `/health` no lo pide y no expone el proyecto.
- **Origin**: los navegadores solo se aceptan desde el mismo origen de Caddy, `localhost` o `ALLOWED_ORIGINS`.
- **LAN (opcional)**: pon `LAB_BIND=0.0.0.0` en `emulator/.env` y vuelve a lanzar `setup.sh --no-build`. La app queda en `http://<IP del PC>:8080`; el orquestador sigue exigiendo el token. Si entras por un nombre (`http://mipc.local:8080`), añádelo a `ALLOWED_ORIGINS` en `.env`. Ojo: también quedan accesibles Mosquitto por WebSockets (`/mqtt`, con contraseña) y HA.
- **Una sola app controla el lab**: en el mismo navegador, un candado entre pestañas (Web Locks o BroadcastChannel) deja controlar solo a una; las demás muestran «El laboratorio está controlado desde otra pestaña». Desde otro navegador u otro PC, el orquestador deja la segunda app en solo lectura (estado y tráfico) hasta que la primera se desconecte.
- **Docker**: el socket de Docker **no** se monta por defecto (equivale a acceso de administrador al PC). Restaurar un snapshot lo necesita para parar HA antes de copiar la configuración: actívalo con `setup.sh --docker` (usa `docker-compose.docker.yml` y lo recuerda en `.env` con `COMPOSE_FILE`); `setup.sh --no-docker` lo quita. Sin él, «Restaurar» está desactivado.

- **Vías reales (E2)**: no abren nada a la LAN. Z-Wave JS UI y el control del mock se publican en 127.0.0.1; el puerto serie emulado (5555) solo existe en la red interna de Docker; los nodos ESPHome escuchan en 127.0.0.1 (el orquestador va en red `host`, igual que HA). La interfaz de Z-Wave JS UI no tiene contraseña: no la publiques fuera de 127.0.0.1. Aunque pongas `LAB_BIND=0.0.0.0`, estos puertos siguen en local.

Usuarios de Mosquitto: `hasim` (orquestador: `hasim/#`, `hasim-z2m/#`, `homeassistant/#`) y `homeassistant` (todo). El entrypoint crea `passwd` y copia la ACL a `/mosquitto/auth/` dentro del contenedor con propietario `mosquitto` y modo 0600 (sin avisos de permisos).

**Dónde viven los secretos** (nunca en el proyecto, ni en la URL compartida, ni en las versiones, ni en la exportación):
- `emulator/.env` (0600): contraseñas MQTT, usuario y contraseña de HA y `LAB_TOKEN`.
- `emulator/.secrets/ha-token` (0600, a nombre de tu usuario): token de larga duración de HA.
- En el navegador (localStorage, clave `hasim.lab.local`): si el lab está activado en esa máquina, la URL del orquestador y el token del laboratorio.
- `emulator/.secrets/esphome-nodes.json` (0600): puerto y clave de cifrado (Noise, 32 bytes en base64) de cada nodo ESPHome. HA guarda la misma clave en su entrada `esphome`.
- `emulator/zwave/ui/settings.json`: claves de seguridad S0/S2 de Z-Wave JS UI (aleatorias; los nodos mock no usan seguridad).
- `emulator/snapshots/` (0700/0600): copias de `ha-config`, de `zwave/` y de `esphome-nodes.json`, que **incluyen** secretos (ver Snapshots).

## Cómo llegan los dispositivos a HA

| Vía hacia HA | Dispositivos | Estado en E1 |
|---|---|---|
| Zigbee2MQTT emulado (`hasim-z2m/…`) | Zigbee con integración Zigbee2MQTT (y HomeKit) | Formato de Z2M: `bridge/state`, `bridge/info`, `bridge/devices` (IEEE estable, Router/EndDevice, `power_source`, exposes), discovery por entidad con `identifiers: zigbee2mqtt_<ieee>` y `via_device: zigbee2mqtt_bridge_<ieee del coordinador>`, comandos en `/set` y `/set/<propiedad>` |
| MQTT discovery genérico (`hasim/…`) | El resto (Tuya, eWeLink, Cast, Alexa, Netatmo…), ZHA y Hue (sin radio virtual) | `homeassistant/device/<id>/config` con `dev`, `o`, `cmps`, `default_entity_id` = entity_id del simulador, `unique_id` `hasim_<proyecto>_<dispositivo>_<clave>`, `suggested_area` = sala, `via_device` = hub simulado |
| **Z-Wave JS (mock)** | Z-Wave (protocolo Z-Wave o integración zwave_js) | **Real con el perfil `zwave`**: nodo mock de zwave-js → Z-Wave JS UI → integración `zwave_js`. Sin el perfil, MQTT genérico con el aviso |
| **ESPHome (API nativa emulada)** | Integración esphome (ESPHome genérico, HA Voice PE, ESP32-S3-BOX-3…) | **Real con el perfil `esphome`**: API nativa (Noise) → integración `esphome`. Sin el perfil, MQTT genérico con el aviso |
| Matter, Shelly | Matter, Thread y Shelly | **pendiente de E3**: ahora por MQTT genérico |

En HA, `origin` dice «HA Simulator», `sw_version` dice «simulado» y `hw_version` dice «Radio: modelada, no real». Ninguna radio es real: la malla y la pérdida se modelan en el motor. Perfiles de radio (`radioProfiles` del proyecto, sobre los valores de `src/types.ts`): de momento se usan la latencia por protocolo (si el proyecto la ajusta, el motor la usa en lugar de su tabla) y el canal Zigbee, que el Z2M emulado publica en `bridge/info`; el resto de campos se guardan pero aún no influyen.

Notas del mapeo (`src/bridge/mqtt/`):
- Luces con esquema JSON: brillo 0-255 (Z2M 0-254), `color_temp` en mireds y color RGB (Z2M: CIE xy).
- `media_player` no existe en MQTT: se publica como `sensor` (estado), `switch` (encendido), `number` (volumen 0-100) y `select` (fuente), con entity_id `…_state`, `…_power`, `…_volume`, `…_source`. La cámara se publica como un sensor de estado.
- Los helpers, grupos, escenas, scripts y automatizaciones no se emulan: se exportan a HA como packages.
- Los exposes de Z2M salen de tablas propias por dominio (no se usa zigbee-herdsman-converters, para que la parte pura no dependa de paquetes pesados).

## Vías reales (E2): Z-Wave JS y ESPHome

Se activan con los perfiles de `setup.sh` (`--zwave`, `--esphome` o `--all`). El orquestador anuncia en `status.capabilities` (`zwave`, `esphome`) qué vías tiene, y la app cambia la «Vía hacia HA» de esos dispositivos. Un dispositivo que no se puede emular (p. ej. un Z-Wave con termostato o dos relés) sigue por MQTT genérico y la app explica por qué.

**Alineación de entity_id**: zwave_js y esphome ponen sus propios entity_id (`switch.despacho_enchufe_despacho`…). El orquestador los renombra en el registro de entidades de HA al del simulador (`switch.enchufe_despacho_switch`), así las automatizaciones exportadas como packages siguen funcionando. Si el entity_id ya está ocupado (p. ej. una entidad MQTT que aún no se ha borrado), lo reintenta cada 15 s.

### Z-Wave (perfil `zwave`)

```
simulador ⇄ orquestador ⇄ (WS 127.0.0.1:5556) zwave-mock ⇄ (TCP 5555, red interna) Z-Wave JS UI ⇄ (WS 127.0.0.1:3000) HA zwave_js
```

- **zwave-mock** usa el controlador y los nodos mock de `zwave-js` (`@zwave-js/testing`, libre): un puerto serie emulado por TCP que Z-Wave JS UI usa como si fuera una antena USB. Home ID fijo del laboratorio (`0xe2c0de01`): la entrada zwave_js de HA va ligada a él.
- Cada dispositivo Z-Wave del proyecto es un nodo (id estable 2-232) con sus **command classes reales**:

  | Entidad del simulador | Command class | En HA |
  |---|---|---|
  | `switch` (relés, enchufes) | Binary Switch v2 | switch |
  | `light` (reguladores) | Multilevel Switch v4 (clase Multilevel Power Switch) | light |
  | `cover` (persianas) | Multilevel Switch v4 (clase Motor Control) | cover |
  | potencia W y energía kWh (Fibaro Wall Plug, Qubino) | Meter v4 (eléctrico, escalas W y kWh) | sensor |
  | temperatura, humedad, luminancia (Aeotec MultiSensor 7) | Multilevel Sensor v11 | sensor |
  | movimiento, puerta/ventana, fuga, humo | Notification v8 (Home Security, Access Control, Water Alarm, Smoke Alarm) | binary_sensor |
  | otros binary_sensor | Binary Sensor v2 (General Purpose) | binary_sensor |
  | `lock` | Door Lock v4 | lock |
  | batería | Battery | sensor |
  | dispositivos a pilas | Wake Up v2 (no escuchan; despiertan cada `ZWAVE_WAKEUP_S`, 120 s por defecto, y varias veces al conectar) | — |

  Además: Version, Manufacturer Specific, Z-Wave Plus Info y Node Naming and Location (nombre del dispositivo y sala, como mucho 16 caracteres). Fabricante y producto genéricos (`0xffff`): así Z-Wave JS no aplica el fichero de configuración del modelo real, que esperaría parámetros o endpoints que el mock no tiene.
- **Simulador → HA**: cuando cambia un estado (la puerta se abre, la temperatura sube), el nodo manda un informe no solicitado (*unsolicited report*) al controlador y llega a HA por Z-Wave JS.
- **HA → simulador**: los Set (encender, regular, cerrar) llegan al nodo mock; el orquestador los traduce (`switch.turn_on`, `light.turn_on` con brillo, `cover.set_cover_position`, `lock.lock`) y los manda a la app como `command`, igual que en MQTT. El estado vuelve con el informe.
- **Parar un nodo**: el mock deja de confirmar (sin ACK) y de responder; el orquestador le hace un ping por el servidor de Z-Wave JS y Z-Wave JS lo marca **dead**. Ojo: HA (desde 2025) no pone las entidades de un nodo dead en «No disponible»; lo indica su sensor «Estado del nodo» (`dead`). Arrancarlo: el nodo vuelve a informar y pasa a `alive`. Un nodo a pilas parado deja de despertar (como uno real: Z-Wave JS lo ve dormido).
- **Fallo del controlador** (parar la antena Z-Wave o el escenario «Falla el coordinador»): se cierra el puerto serie emulado; el driver de Z-Wave JS UI falla, HA pierde la conexión y **todas** las entidades Z-Wave pasan a «No disponible». Al arrancarla, Z-Wave JS UI se reconecta solo (reintenta cada pocos segundos).
- **Cambios de la red** (añadir o quitar dispositivos Z-Wave): el mock cierra la antena ~20 s (`ZWAVE_MOCK_REINIT_MS`) para que Z-Wave JS UI reinicie el driver y lea la lista de nodos nueva (el driver no conoce nodos añadidos sin una inclusión). Durante ese rato lo Z-Wave está no disponible. Con `--docker`, si Z-Wave JS UI no vuelve en 60 s, el orquestador reinicia su contenedor. El mock recuerda la última red (`zwave/mock/mock-state.json`), así que al volver a arrancar el laboratorio no hace falta reiniciar nada. Renombrar un dispositivo no reinicia la red (el nombre nuevo llega en la siguiente entrevista).
- **Inspector de tráfico**: cada trama resumida (`zwave/nodo 7` · `Binary Switch · Set · targetValue=true`, informes de salida, Wake Up).
- Interfaz: Z-Wave JS UI en http://localhost:8091 (nodos, valores, logs del driver).

### ESPHome (perfil `esphome`)

**Vía elegida: emulador de la API nativa en el orquestador**, no firmware compilado. Cada dispositivo ESPHome del proyecto es un servidor TCP en `127.0.0.1:16053+n` (lejos de 6054, donde escucha HA) que habla la API nativa (protobuf, el mismo protocolo que el firmware) con **cifrado Noise** (`Noise_NNpsk0_25519_ChaChaPoly_SHA256`, clave aleatoria por nodo en `.secrets/esphome-nodes.json`). HA lo añade con su integración `esphome` real: el orquestador hace el flujo de configuración (host `127.0.0.1`, puerto y clave) en cuanto el nodo arranca, y borra la entrada si el dispositivo sale del proyecto.

Por qué no la plataforma `host` compilada: compilar un binario por nodo con la imagen de ESPHome tarda minutos y ocupa cientos de MB por nodo, necesita PlatformIO/toolchain en el contenedor, y para fijar los valores desde el simulador haría falta un canal extra (servidor web REST o acciones de API) y otro de vuelta para los comandos (`http_request`). El emulador arranca al instante, no compila nada, publica los valores directamente y recibe los comandos de HA tal cual. Lo que ve HA es lo mismo: un dispositivo ESPHome con su API nativa cifrada. Se ha probado contra el cliente de HA (`aioesphomeapi`) y contra `@2colors/esphome-native-api` (tests).

- Entidades: `sensor` (con unidad, `device_class` y `state_class`), `binary_sensor`, `switch`, `light` (modos onoff, brillo, temperatura de color y RGB), `select`, `button`; un `sensor` no numérico va como `text_sensor`. Un `media_player` se publica como en MQTT (estado, encendido, volumen y fuente). Otros dominios (cover, climate…) siguen por MQTT con el aviso.
- **Asistentes (HA Voice PE, ESP32-S3-BOX-3)**: `voice_assistant` necesita un micrófono y la plataforma `host` no tiene, así que no hay `assist_satellite` real. Se publican como un `text_sensor` de estado (`idle`, `listening`…) y un `text` «Anuncio»: lo que escribas en él desde HA se convierte en `assist_satellite.announce` en el simulador.
- **Comandos de HA** (switch, light, number, select, text, button) → `command` a la app.
- **Ciclo de vida**: parar el nodo cierra su servidor (HA lo ve «No disponible»); arrancarlo lo abre y HA se reconecta solo (puede tardar hasta un minuto por la espera entre reintentos de HA). Sin app en vivo (pausa o app cerrada) los nodos se paran.
- Sin cifrado: `ESPHOME_ENCRYPTION=0` en `.env` (no recomendado; los puertos son locales igualmente).
- Los sensores van como float32, como en el firmware: en la API de HA, 23,4 puede verse como `23.399999618530273`.

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
- **Snapshots**: guarda y restaura `ha-config` junto con el proyecto en `emulator/snapshots/`; con las vías reales, también `emulator/zwave/` (Z-Wave JS UI y el mock) y `.secrets/esphome-nodes.json` (al restaurar se paran también los contenedores de Z-Wave). Incluye `configuration.yaml`, `packages/` y `.storage/` (dispositivos, entidades, áreas, usuarios, integraciones). **No** incluye la base de datos del historial (`home-assistant_v2.db*`), los logs (`*.log*`) ni las cachés (`deps/`, `tts/`, `.cache/`, `backups/`).
  - **Contienen secretos**: los usuarios, las contraseñas (hash) y los tokens de HA (`.storage/auth*`) y las credenciales de las integraciones (`.storage/core.config_entries`, p. ej. la contraseña MQTT). Por eso la carpeta y cada snapshot son 0700 y los archivos 0600. No los compartas. La opción «Excluir credenciales (auth*)» no copia `.storage/auth*`; al restaurar uno así se conservan los usuarios y tokens actuales. Las credenciales de las integraciones siguen dentro.
  - **Restaurar** necesita el perfil con Docker (`setup.sh --docker`): el orquestador para HA, copia la configuración y vuelve a arrancarlo (aunque la copia falle). El proyecto del snapshot se valida y se fusiona con el actual (se conservan el id, las variantes y las imágenes del plano), sin reiniciar la simulación, y el lab vuelve a acoplarse.
  - Los ids se validan (`[A-Za-z0-9._-]`, nunca `.` ni `..`) y deben ser de un snapshot existente.
- **Tráfico**: inspector de los mensajes del lab (topic, payload, sentido, hora y dispositivo): MQTT, tramas Z-Wave resumidas (nodo, CC, comando y valor) y mensajes de la API nativa de ESPHome, marcados con su vía. Filtros (escribe `zwave` o `esphome` en el filtro de topic), pausa y exportación a JSON.
- **Vías reales**: el panel muestra el estado de Z-Wave JS UI (conectado, esperando a la antena…) con el enlace a http://localhost:8091, y el de los nodos ESPHome (en marcha, esperando a HA, error), con el detalle de cada nodo.
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
- `status` `{ mqtt, ha, transports, nodes, snapshots, capabilities, native?, lastError? }`: `capabilities.zwave` y `capabilities.esphome` dicen qué vías reales hay; `native.zwave_js` y `native.esphome` llevan su estado (`state`, `detail`, `url`, `nodes`)
- `lab_result` `{ requestId, action, ok, message, snapshots?, project? }`
- `traffic` `{ entries }` (cada entrada con `via`: sin valor = MQTT; `zwave` o `esphome`)
- `error` `{ message, code?: 'auth' | 'readonly' | 'invalid' }`

El orquestador valida todo lo que recibe antes de aplicarlo: el proyecto (también el resultado de un parche) con `parseProject`, los ajustes con `parseHaBridge` (un topic con `#` o `+` no es válido) y las definiciones con `parseDefinition`; si algo falla responde `error` con `code: 'invalid'` y no cambia nada. Tamaño máximo de mensaje: 4 MB. La app, a su vez, valida con `parseProject` el proyecto de un snapshot y solo acepta `lab_result` de peticiones suyas pendientes.

HTTP: `GET /health` (200 o 503 según la conexión MQTT real) y `GET /project` (con `Authorization: Bearer <LAB_TOKEN>`), también bajo `/orchestrator/…`.

MQTT: discovery retenido, republicado al recibir `homeassistant/status online` (con jitter); estados deduplicados por contenido; LWT `hasim/bridge/state offline` y `hasim-z2m/bridge/state {"state":"offline"}`; el orquestador nunca publica en `/set`; antes de reconciliar borra los retenidos de dispositivos eliminados (payload vacío).

## Desarrollo

```bash
cd emulator
npm ci
npm run typecheck
npm test            # orquestador con aedes, el mock de Z-Wave con el driver real de zwave-js y la API de ESPHome con un cliente independiente
LAB_TOKEN=$(openssl rand -hex 32) npm start   # orquestador local (también MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, PORT…)
npm run e2e         # con el laboratorio arrancado: proyecto demo → HA → comando → estado y, con perfiles, Z-Wave y ESPHome (lee LAB_TOKEN y COMPOSE_PROFILES de .env)
```

El workflow `.github/workflows/emulator-e2e.yml` hace lo mismo en GitHub Actions; es solo manual (`workflow_dispatch`), con la entrada `perfiles` (por defecto `zwave,esphome`; vacía = solo MQTT), y pasa a `npm run e2e` el `LAB_TOKEN` y los perfiles que deja `setup.sh` en `.env`. Con perfiles comprueba en el registro de dispositivos de HA que «Enchufe despacho» llega con `zwave_js` y «Sensor despacho» con `esphome`, enciende el enchufe desde HA, cambia el sensor desde la app y para y arranca los dos nodos. El CI normal (`ci.yml`) ejecuta el typecheck y los tests del orquestador con aedes.
