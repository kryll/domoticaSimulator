# Laboratorio domótico tipo GNS3: entorno emulado con Home Assistant real

**Visión:** un laboratorio en casa para hacer pruebas, nunca un entorno real. El orquestador hace de «servidor GNS3» y la app de cliente gráfico. Los dispositivos emulados son los nodos que se arrancan, se paran, se rompen y se restauran.

Diseño para que los dispositivos del simulador aparezcan en un Home Assistant real, con su panel, a través de las integraciones reales siempre que sea posible.

**Decisiones del usuario (octubre 2026):**
- El entorno corre en un PC Linux con Docker (red `host`, IPv6 disponible).
- Emulación completa directa, sin quedarse solo en MQTT.
- Las automatizaciones se ejecutan en el HA real. El simulador hace de dispositivos y de mundo físico.
- Se empieza con un HA nuevo de pruebas que trae el propio entorno.

## Principios

1. **El simulador es el mundo físico.** Su motor manda en el estado de cada dispositivo (si la luz está encendida, la temperatura, la batería, la puerta). HA solo envía comandos, como haría con un dispositivo real.
2. **Integración real siempre que exista un emulador fiel**:

   | Vía | Uso | Estado (octubre 2026) |
   |---|---|---|
   | Z-Wave JS (mock de zwave-js + Z-Wave JS UI) | Z-Wave | **Real** (E2, perfil `zwave`) |
   | ESPHome (API nativa emulada, cifrado Noise) | Nodos ESPHome | **Real** (E2, perfil `esphome`) |
   | Matter (bridge de matter.js + matterjs-server) | Matter y Thread por IP | **Real** (E3, perfil `matter`) |
   | Shelly (API RPC Gen2+ emulada) | Shelly Plus, Pro, Gen3 y Gen4 | **Real** (E3, perfil `shelly`) |
   | MQTT con el formato exacto de Zigbee2MQTT | Zigbee | Formato real de Z2M, sin radio (E1) |
   | MQTT discovery genérico | El resto (Tuya, eWeLink, Hue, Cast, Alexa…) y lo que no se puede emular | E1 |

3. **No engañar.** Cada dispositivo indica en la interfaz su «Vía hacia HA» y «Radio: modelada, no real». En HA, `origin` dice «HA Simulator» y `sw_version` dice «simulado».
4. **Las automatizaciones se ejecutan en un solo sitio.** Con el puente activo se exportan al HA (packages) y se desactivan en el simulador.
5. **Tiempo real.** Con el puente activo, el simulador entra en «modo en vivo»: velocidad 1x, sin «Ir a…» y sin poder acelerar (controles desactivados con explicación). Pausar pregunta «¿Parar todos los nodos?»: si se acepta, se paran los nodos y el puente se desacopla (se publica `offline`, HA muestra `unavailable`, sus comandos se ignoran y las automatizaciones vuelven al simulador) hasta «Volver a acoplar».
6. **Los secretos no van en el proyecto.** Las contraseñas MQTT, el usuario de HA y el token del laboratorio (`LAB_TOKEN`) están en `emulator/.env` (0600); el token de larga duración de HA, en `emulator/.secrets/ha-token` (0600). En el navegador, el token del laboratorio, la URL del orquestador y si el lab está activado son un **ajuste local de la máquina** (localStorage, `src/bridge/localLab.ts`): nunca van en el proyecto, en la exportación, en la URL compartida ni en las versiones. Así un proyecto compartido o importado no puede conectar solo con ningún orquestador. Ojo: los snapshots del lab sí contienen secretos de HA (ver Controles).
7. **Un solo controlador.** Un candado entre pestañas (Web Locks, con BroadcastChannel de reserva) deja controlar el lab a una sola pestaña; el orquestador deja en solo lectura cualquier otra app.

## Qué se puede emular con la integración real de HA

| Pieza | Viabilidad | Cómo |
|---|---|---|
| Z-Wave | **Sí, hecho en E2** | Controlador y nodos mock de `zwave-js` (TCP) → Z-Wave JS UI (`tcp://zwave-mock:5555`) → integración `zwave_js` (`ws://127.0.0.1:3000`). Command classes: Binary Switch, Multilevel Switch, Meter, Multilevel Sensor, Notification, Binary Sensor, Door Lock, Battery y Wake Up. Probado con el driver real de zwave-js (tests) y con HA 2026.10 + zwave-js-server (ensayo local). |
| Matter sobre IP | **Sí, hecho en E3** | Un bridge de matter.js 0.17.9 en el orquestador (`AggregatorEndpoint` + un endpoint con `BridgedDeviceBasicInformation` por dispositivo, UDP 5541) → matterjs-server 1.4.0 (`ghcr.io/matter-js/matterjs-server:1.4.0`, API WS solo en 127.0.0.1:5580) → integración `matter`. El orquestador lo comisiona solo con `commission_with_code` (código manual, `network_only`). Requiere IPv6, mDNS y red `host`. Ver [Matter (E3)](#matter-e3). |
| ESPHome | **Sí, hecho en E2** | Emulador de la API nativa (protobuf + Noise) en el orquestador, un servidor por nodo en `127.0.0.1:16053+n`; el orquestador lo añade a HA con el flujo de `esphome` (host, puerto y clave). Se descartó compilar la plataforma `host` (minutos y cientos de MB por nodo, PlatformIO, y canales extra para fijar valores y recibir comandos). Probado con `aioesphomeapi` y HA 2026.10. |
| Shelly Gen2+ | **Sí, hecho en E3** | Emulador de la API RPC en el orquestador, un servidor por Shelly en `127.0.0.1:18181+n`: `GET /shelly` y WebSocket `/rpc` con JSON-RPC (`Shelly.GetDeviceInfo`, `GetConfig`, `GetStatus`, `GetComponents`, `ListMethods`, `Switch.Set/Toggle`, `Cover.Open/Close/Stop/GoToPosition`, `Light.Set`) y notificaciones `NotifyStatus`/`NotifyEvent`. El orquestador lo añade a HA con el flujo de `shelly` (host y puerto; el unique_id es su MAC). Componentes `switch`, `cover`, `light`, `em`/`emdata`, `temperature`, `humidity` y `devicepower`. Probado con `aioshelly` 13.34.1 y HA 2026.10. Los Gen1 (CoIoT) siguen por MQTT. |
| Zigbee | Parcial | No hay coordinador emulado usable. Se usa un «Z2M emulado» que publica el formato exacto de Zigbee2MQTT: `bridge/state`, `bridge/info`, `bridge/devices` con exposes de zigbee-herdsman-converters, `availability`, `last_seen` y `linkquality`; los comandos llegan por `/set`. Base topic propio (`hasim-z2m`). |
| ZHA | No viable | zigpy no tiene radio virtual. Se representa por MQTT genérico, con un aviso. |
| Thread + OTBR | Experimental (perfil opcional) | OTBR con RCP simulado de OpenThread. Solo como demostración del border router. |
| BLE | Experimental | Proxy ESPHome falso que envía anuncios BTHome. Más adelante. |
| RF 433 | Equivalente | Nodo ESPHome host con `remote_receiver` simulado, o MQTT. |
| Tuya, eWeLink, Alexa, Cast | No (son de nube o propietarios) | MQTT discovery genérico. |
| Robots aspiradores (Roborock, Dreame, Roomba, Ecovacs, Eufy) | No (nube del fabricante o protocolo propietario) | `vacuum` MQTT (esquema `state`): `state` y `fan_speed` en el JSON, `fan_speed_list`, `send_command_topic` (p. ej. `app_segment_clean` con `[16, 17]`), atributos (sala, progreso, error) por `json_attributes_topic`. La batería es un sensor aparte (HA ya no admite `battery_level` en el vacuum MQTT); consumibles, base y superficie, sensores; modo de mopa y agua, `select`. |
| Satélites de Assist (HA Voice PE, ESP32-S3-BOX-3) | Parcial (E2) | Llegan por la integración ESPHome real, pero sin `assist_satellite`: `voice_assistant` necesita micrófono y la plataforma `host` no tiene. Se publican como `text_sensor` de estado (`idle`, `listening`, `processing`, `responding`) + `text` «Anuncio» (→ `assist_satellite.announce` en el simulador). Sin el perfil `esphome`: sensor + `notify` por MQTT. |
| Satélite Wyoming (Raspberry Pi) | Probable, candidato para E2 | Contenedor `rhasspy/wyoming-satellite` real con `--mic-command`/`--snd-command` leyendo y escribiendo ficheros de audio, y la integración Wyoming de HA. Hay que comprobar que arranca sin dispositivo de audio. Ahora: igual que HA Voice (sensor + notify). |
| Alexa y Google (control por voz) | No | Sus nubes necesitan cuentas reales de Amazon y Google. **El control por voz de Alexa y Google se simula en la app** (exposición de entidades, «Alexa, …», sin Internet no responden). En el HA real los altavoces llegan como reproductor (sensor, switch, number, select) + `notify` de anuncios por MQTT; el comando se traduce a `notify.alexa_media_<echo>` (Alexa Media Player) o a `tts.speak` sobre el reproductor (Google Cast). Las rutinas de Alexa y Google no son de HA y no se modelan. |
| HomePod (Apple) | No | HA solo lo ve como reproductor (integración Apple TV/AirPlay); Siri no se controla desde HA. |

## Arquitectura

```
Navegador (app)  ──WS──►  hasim-orchestrator (Node, red host)
                            ├─ motor ↔ estado (fuente de verdad la app; el orquestador replica)
                            ├─ Z2M emulado ─────────► Mosquitto ─► HA (MQTT)
                            ├─ MQTT discovery genérico ─► Mosquitto ─► HA (MQTT)
                            ├─ (WS 5556) zwave-mock ─(TCP 5555)─► Z-Wave JS UI ─(WS 3000)─► HA (zwave_js)
                            ├─ API nativa ESPHome por nodo (127.0.0.1:16053+n, Noise) ─► HA (esphome)
                            ├─ bridge matter.js (UDP 5541, mDNS) ─► matterjs-server (127.0.0.1:5580) ─► HA (matter)
                            └─ Shelly Gen2+ emulados (127.0.0.1:18181+n, /shelly + WS /rpc) ─► HA (shelly)
Caddy sirve la app y hace de proxy de /orchestrator y /mqtt en el mismo origen (sin contenido mixto).
Caddy escucha solo en 127.0.0.1 (LAB_BIND=0.0.0.0 para la LAN) y el orquestador exige el token.
```

- El orquestador reconcilia de forma declarativa el JSON del proyecto con los emuladores (crear, actualizar, borrar) y reenvía en los dos sentidos los estados y comandos entre la app y los emuladores.
- Los fallos del simulador se aplican de verdad: `docker network disconnect` o `pause`, parar el emulador del coordinador, una red Docker `internal` para cortar Internet, y `tc netem` para la latencia y la pérdida.
- Recursos aproximados: entre 1,5 y 2 GB de RAM y 2 vCPU.

## Perfil de radio configurable (valores por defecto)

Los perfiles se ajustan por protocolo en el proyecto (`radioProfiles`, sobre estos valores). Hoy se usan de verdad la **latencia** (si el proyecto la ajusta, el motor la usa en lugar de su tabla, `src/simulation/latency.ts`) y el **canal Zigbee**, que el Z2M emulado publica en `bridge/info`. El resto de la tabla (pérdida, saltos, hijos, disponibilidad, interferencia) se guarda y se valida, pero todavía no influye en el motor.

| Protocolo | Latencia/salto | Pérdida | Saltos máx. | Hijos/padre | Canal | Disponibilidad |
|---|---|---|---|---|---|---|
| Zigbee | 15 ms (+40 si reintento) | 1 % | 5 | 20 coord. / 16 router | 11 (11-26) | 10 min activos, 25 h a pilas |
| Thread | 10 ms | 0,5 % | 6 | 10 | 15 | timeout de hijo 240 s |
| Matter (Wi-Fi) | 20 ms | 0,2 % | — | — | — | suscripción ≥60 s |
| Z-Wave | 30 ms | 1 % | 4 (LR: 1) | — | 868,4 MHz | «dead» tras 3 fallos; wake up 3600 s |
| Wi-Fi / ESPHome / Shelly | 20 ms | 0,5 % | — | ~30 por AP | 1/6/11 | ping de la API 60 s (Shelly: reconexión cada 60 s) |
| BLE | anuncio cada 1-10 s | 5 % | — | — | 37/38/39 | ~15 min sin anuncios |
| RF 433 | 50 ms | 10 % (sin acuse) | — | — | — | nunca (sin estado) |

Interferencia: el canal Wi-Fi 1 solapa con los Zigbee/Thread 11-14, el 6 con los 16-19 y el 11 con los 21-24. Penalización por defecto: +3 % de pérdida.

## Controles de laboratorio

- Ciclo de vida por dispositivo: arrancar y parar (estados: parado, arrancando, en marcha, error). También «Arrancar todo» y «Parar todo».
- «Resetear lab»: limpia los mensajes retenidos, vuelve a publicar todo y restaura los estados iniciales.
- Snapshots: proyecto y `ha-config` (sin base de datos ni logs), guardados en `emulator/snapshots/` (carpetas 0700, archivos 0600). **Incluyen secretos**: usuarios y tokens de HA (`.storage/auth*`) y credenciales de las integraciones (`.storage/core.config_entries`); la opción «Excluir credenciales (auth*)» deja fuera los primeros. Restaurar necesita el perfil con Docker (`setup.sh --docker`) para parar HA antes de copiar; el proyecto restaurado se valida y se fusiona con el actual.
- Inspector de tráfico: mensajes del lab con dirección, hora, dispositivo, filtros y exportación.

## Plan por tandas (E = emulación)

- **E1, base:**
  - paquete `emulator/` con docker-compose (HA, Mosquitto, Caddy, Z-Wave JS UI, matterjs-server) y el orquestador en Node con su API WebSocket;
  - script de onboarding automático de HA (usuario, MQTT, Z-Wave JS, Matter);
  - Z2M emulado y MQTT discovery genérico;
  - en la app: ajustes «Home Assistant real», panel de estado, modo en vivo y vía por dispositivo;
  - perfiles de radio en el motor;
  - CI con HA en Docker (job manual o nocturno).
- **E2 (hecho, pendiente de verificar en GitHub Actions):** Z-Wave con el mock de zwave-js + Z-Wave JS UI (integración `zwave_js`) y nodos ESPHome con la API nativa emulada (integración `esphome`), perfiles `zwave` y `esphome` de `setup.sh`, alineación de entity_id en HA, estado de las vías en el panel y tráfico Z-Wave/ESPHome en el inspector. Los satélites de voz llegan por ESPHome sin `assist_satellite` (sin micrófono). Queda como candidato: satélite Wyoming real en contenedor.
- **E3:** bridge Matter con matter.js (comisionado automático, **hecho**, perfil `matter`) y emulador Shelly (**hecho**, perfil `shelly`, integración `shelly` real); los dos probados en local con HA 2026.10, pruebas manuales en `docs/PRUEBAS_E3.md`; inyección de fallos con Docker y `tc netem`.

(Alineado con docs/ROADMAP.md en octubre de 2026: Z-Wave y ESPHome (E2) y Matter y Shelly (E3) son reales con sus perfiles (`PROFILE_TRANSPORTS` en src/types.ts); `PENDING_TRANSPORTS` queda vacío.)
- **E4 (opcional):** BLE con proxy falso y OTBR con RCP simulado.

## Limitaciones conocidas

- Ninguna radio física se emula: Zigbee y Thread no generan tramas 802.15.4 reales. La malla, la latencia y la pérdida se modelan en el motor.
- Matter necesita Linux con red `host` e IPv6. No funciona en Docker Desktop de Mac ni de Windows.
- HA va en tiempo real: no se puede acelerar el reloj de HA sin romperlo (`libfaketime` no es fiable).
- Robots aspiradores: el mapa es el de las salas del plano (segmentos 16, 17… en el orden de «Mapa del robot»), no un mapa SLAM. `vacuum.clean_area` (HA 2026.3) usa los ids de sala del proyecto; en el HA real hay que mapear los segmentos a las áreas en el diálogo del vacuum.
- Asistentes: el intérprete de intenciones de la app es sencillo (español, sin acentos, por nombre, alias o área); no es el motor de intenciones de HA (hassil). El evento `hasim_vacuum_finished` es del simulador; en HA real se usa el cambio de estado `cleaning` → `returning`.
- La app pública de GitHub Pages no puede conectar con `ws://` local (contenido mixto y Local Network Access de Chrome). Para usar el puente, la app se sirve desde el propio entorno (Caddy en `http://localhost:8080`).
- matterjs-server (perfil `matter`) necesita red `host`; su API (5580) no tiene autenticación, por eso escucha solo en 127.0.0.1 (`LISTEN_ADDRESS`).
- En este contenedor de desarrollo no se pueden descargar imágenes Docker. La verificación de extremo a extremo se hace en GitHub Actions.
- Z-Wave: HA no pone «No disponible» las entidades de un nodo dead (lo dice su sensor «Estado del nodo»); solo el fallo del controlador las deja no disponibles. Añadir o quitar dispositivos Z-Wave reinicia el driver de Z-Wave JS UI (~20-60 s sin Z-Wave): el mock no simula la inclusión. Fabricante y modelo genéricos (no se aplican los ficheros de configuración de los modelos reales). Sin endpoints: un dispositivo con dos relés o con termostato sigue por MQTT.
- ESPHome: es un emulador del protocolo, no el firmware; no hay logs, OTA, Bluetooth proxy, `voice_assistant` ni servicios de usuario. Los dominios cover, climate, fan, lock… siguen por MQTT.
- Shelly: emulador de la API RPC, no el firmware. Sin autenticación (como un Shelly recién instalado), sin scripts, proxy BLE, webhooks, MQTT del Shelly, reinicio ni OTA (HA muestra error si se piden). El H&T Gen3 va siempre despierto (un H&T real duerme y se conecta él a HA por WebSocket saliente). Tensión nominal de 230 V e intensidad derivada (potencia / tensión) cuando el simulador no las mide; en los 2PM de dos canales la medida del dispositivo se reparte entre los canales. Los Gen1 (CoIoT, p. ej. Shelly EM) y el Shelly 1 de puerta de garaje siguen por MQTT. HA no recibe el área del Shelly (un Shelly real tampoco la da).

## Matter (E3)

**Decisiones:**
- **Un bridge, no un nodo por dispositivo.** Un solo nodo Matter de matter.js con un `AggregatorEndpoint` y un endpoint «bridged» (tipo de dispositivo + `BridgedDeviceBasicInformation`) por cada dispositivo Matter/Thread del proyecto. Un único comisionado (segundos) en lugar de uno por dispositivo, y añadir o quitar endpoints funciona en caliente (matter.js guarda el número de cada endpoint por su id, así los `unique_id` de HA no cambian al reiniciar). Lo que se pierde: en HA los dispositivos cuelgan de un «HA Simulator» (modelo «Bridge del laboratorio») y comparten nodo Matter (un fallo del bridge los tira todos, como en un bridge real).
- **Parar un dispositivo = `Reachable=false`** en su `BridgedDeviceBasicInformation`. Comprobado con HA 2026.10: la integración `matter` pone sus entidades «No disponible» (`MatterEntity._get_bridged_reachable`) y al volver a `true` se recuperan sin reconectar. Sin app en vivo, todos los endpoints quedan no alcanzables.
- **Comisionado automático.** El orquestador genera un passcode válido, un discriminador y un `UniqueID` del bridge (`emulator/.secrets/matter.json`, 0600) y llama a matterjs-server por su API WebSocket: `get_nodes` (¿ya conoce un nodo con nuestro `UniqueID`, atributo `0/40/18`?) y, si no, `commission_with_code` con el código manual y `network_only: true` (lo encuentra por mDNS). Las claves de la fabric las guarda matter.js en `emulator/matter/bridge/`. Al reiniciar el orquestador se reutiliza el comisionado (no hay `commission_with_code` ni dispositivos duplicados). Si el servidor perdió sus datos, el bridge se restablece de fábrica y se vuelve a comisionar; si el bridge perdió los suyos, se quita el nodo viejo del servidor (`remove_node`).
- **Al reiniciar el orquestador manda el simulador.** matter.js también guarda en `emulator/matter/bridge/` los atributos no volátiles de cada endpoint (OnOff, CurrentLevel, color, posición de la persiana) y, al recrear un endpoint con el mismo id, lo guardado gana a lo que se le pasa al crearlo. El bridge vuelve a escribir el estado inicial que manda el simulador justo después de crear cada endpoint; si no, HA vería el estado de la ejecución anterior (p. ej. un enchufe encendido que en el simulador está apagado) hasta el siguiente cambio. Tras un reinicio, matterjs-server no se entera hasta que caduca su suscripción (~1m45s: intervalo máximo de ~1 min más margen); mientras, HA muestra los dispositivos Matter «No disponible». El bridge intenta reanudar la suscripción guardada al arrancar, pero no resuelve la dirección del controlador en los 2 s que espera matter.js (en las pruebas: «Reestablished 0 of 1 former subscriptions»). Pedir a matterjs-server un `interview_node` lo pondría «disponible» antes, pero sin suscripción: HA no vería cambios hasta que caducara igualmente, así que no se hace.
- **Arranque sin endpoints fantasma.** El bridge no sale a la red hasta que la app manda el proyecto y se han añadido sus endpoints: si arrancase vacío, HA borraría los dispositivos (`endpoint_removed`).
- **Certificados de pruebas.** El bridge usa la atestación de desarrollo de matter.js (vendor `0xFFF1`). matterjs-server los rechaza salvo con `ENABLE_TEST_NET_DCL=true`, que el `docker-compose.yml` activa (solo afecta a lo que el propio laboratorio pide comisionar).
- **Puertos.** matterjs-server: API en 127.0.0.1:5580 (`LISTEN_ADDRESS`) y su panel web en http://localhost:5580; el bridge: UDP **5541** (`MATTER_BRIDGE_PORT`) para no chocar con el 5540 habitual de los controladores; mDNS 5353 compartido. Ni HA (6054), ni ESPHome (16054+), ni Shelly (18181+) se cruzan.
- **Seguridad.** El bridge escucha en todas las interfaces (Matter anuncia por mDNS las IP de la máquina), pero mientras no está comisionado solo acepta PASE con el passcode secreto y, comisionado, solo sesiones CASE de la fabric de matterjs-server.

**Tipos de dispositivo** (`src/bridge/matter/plan.ts`): luz On/Off, regulable, de temperatura de color y de color extendido (OnOff + LevelControl + ColorControl con tono/saturación, xy y temperatura), enchufe On/Off con `ElectricalPowerMeasurement` (W→mW) y `ElectricalEnergyMeasurement` (kWh→mWh), sensor de contacto y de fuga (`BooleanState`), de ocupación (`OccupancySensing`), de temperatura, humedad, luz y presión, cerradura (`DoorLock`) y persiana con posición (`WindowCovering` Lift + PositionAwareLift); batería como `PowerSource` en el mismo endpoint. Los comandos de HA (OnOff, MoveToLevelWithOnOff, MoveToColorTemperature, MoveToHueAndSaturation, MoveToColor, LockDoor/UnlockDoor, UpOrOpen/DownOrClose/StopMotion/GoToLiftPercentage) no cambian el estado en el bridge: van al simulador como servicio y el estado vuelve desde la app. Los entity_id se alinean con los del simulador por el `unique_id` de HA (`<fabric>-<nodo>-<endpoint>-<endpoint>-<clave>-<cluster>-<atributo>`).

HA crea además sus entidades de configuración de Matter (nivel de encendido y comportamiento al arrancar de la luz, modo y límites de código de la cerradura, diagnósticos del bridge); cambiarlas no llega al simulador.

**No se emula todavía** (siguen por MQTT con el motivo en «Vía hacia HA»): termostatos, ventiladores, mandos y botones (cluster `Switch` con eventos), sensores de calidad del aire (PM2.5, COV, CO₂), humo y CO, reproductores, y dispositivos con dos entidades principales (dos relés, luz + enchufe). Thread no tiene radio: los dispositivos Thread llegan a HA por IP a través del bridge (no hay border router real).

**Verificación:** tests con un controlador de matter.js en el mismo proceso sobre la red simulada de matter.js (`emulator/orchestrator/test/matter.test.ts`) y prueba de extremo a extremo contra HA 2026.10 + matterjs-server 1.4.0 (`scripts/e2e.mjs`, perfil `matter`). matter.js exige IPv6: en un contenedor sin IPv6 solo funciona con un adaptador que convierte los sockets UDP6 en UDP4 (se usó para el ensayo local, no forma parte del laboratorio); en un Linux normal o en GitHub Actions con red `host` no hace falta.
