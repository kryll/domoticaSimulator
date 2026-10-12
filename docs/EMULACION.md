# Entorno emulado con Home Assistant real

Diseño para que los dispositivos del simulador aparezcan en un Home Assistant real, con su panel, a través de las integraciones reales siempre que sea posible.

**Decisiones del usuario (octubre 2026):**
- El entorno corre en un PC Linux con Docker (red `host`, IPv6 disponible).
- Emulación completa directa, sin quedarse solo en MQTT.
- Las automatizaciones se ejecutan en el HA real. El simulador hace de dispositivos y de mundo físico.
- Se empieza con un HA nuevo de pruebas que trae el propio entorno.

## Principios

1. **El simulador es el mundo físico.** Su motor manda en el estado de cada dispositivo (si la luz está encendida, la temperatura, la batería, la puerta). HA solo envía comandos, como haría con un dispositivo real.
2. **Integración real siempre que exista un emulador fiel**:

   | Vía | Uso |
   |---|---|
   | Z-Wave JS (mock-server) | Z-Wave |
   | Matter (matter.js) | Matter y Thread por IP |
   | ESPHome (plataforma `host`) | Nodos ESPHome |
   | Emulador Shelly RPC | Shelly |
   | MQTT con el formato exacto de Zigbee2MQTT | Zigbee |
   | MQTT discovery genérico | El resto (Tuya, eWeLink, Hue, Cast, Alexa…) |

3. **No engañar.** Cada dispositivo indica en la interfaz su «Vía hacia HA» y «Radio: modelada, no real». En HA, `origin` dice «HA Simulator» y `sw_version` dice «simulado».
4. **Las automatizaciones se ejecutan en un solo sitio.** Con el puente activo se exportan al HA (packages) y se desactivan en el simulador.
5. **Tiempo real.** Con el puente activo, el simulador entra en «modo en vivo»: velocidad 1x, sin «Ir a…». Pausar o acelerar desacopla el puente: se publica `offline` y HA muestra `unavailable`.
6. **Los secretos no van en el proyecto.** La contraseña MQTT y los tokens se guardan en IndexedDB aparte y nunca se exportan, ni en la URL compartida ni en las versiones.

## Qué se puede emular con la integración real de HA

| Pieza | Viabilidad | Cómo |
|---|---|---|
| Z-Wave | **Sí, verificado** | `zwave-js` mock-server (TCP) → Z-Wave JS UI (`tcp://zwave-mock:5555`) → integración `zwave_js` (`ws://…:3000`) |
| Matter sobre IP | Sí | matter.js (bridge con `AggregatorEndpoint` + `BridgedDeviceBasicInformation`, o nodos sueltos) → matterjs-server (`ghcr.io/matter-js/matterjs-server`, API WS 5580) → integración Matter. Comisionado automático con el comando WS de HA `matter/commission`. Requiere IPv6, mDNS y red `host`. |
| ESPHome | Sí | Plataforma `host`: un binario Linux por nodo con la API nativa en 6053. HA lo añade por IP (sin autodescubrimiento). La compilación se cachea por hash. |
| Shelly Gen2 | Sí, con un emulador propio | HTTP `/shelly`, `/rpc` (`Shelly.GetDeviceInfo`, `GetStatus`, `GetConfig`, `Switch.Set`) y WebSocket `NotifyStatus`. |
| Zigbee | Parcial | No hay coordinador emulado usable. Se usa un «Z2M emulado» que publica el formato exacto de Zigbee2MQTT: `bridge/state`, `bridge/info`, `bridge/devices` con exposes de zigbee-herdsman-converters, `availability`, `last_seen` y `linkquality`; los comandos llegan por `/set`. Base topic propio (`hasim-z2m`). |
| ZHA | No viable | zigpy no tiene radio virtual. Se representa por MQTT genérico, con un aviso. |
| Thread + OTBR | Experimental (perfil opcional) | OTBR con RCP simulado de OpenThread. Solo como demostración del border router. |
| BLE | Experimental | Proxy ESPHome falso que envía anuncios BTHome. Más adelante. |
| RF 433 | Equivalente | Nodo ESPHome host con `remote_receiver` simulado, o MQTT. |
| Tuya, eWeLink, Alexa, Cast | No (son de nube o propietarios) | MQTT discovery genérico. |

## Arquitectura

```
Navegador (app)  ──WS──►  hasim-orchestrator (Node, red host)
                            ├─ motor ↔ estado (fuente de verdad la app; el orquestador replica)
                            ├─ Z2M emulado ─────────► Mosquitto ─► HA (MQTT)
                            ├─ MQTT discovery genérico ─► Mosquitto ─► HA (MQTT)
                            ├─ mock-server Z-Wave ─► Z-Wave JS UI ─► HA (zwave_js)
                            ├─ bridge matter.js ─► matterjs-server ─► HA (matter)
                            ├─ nodos ESPHome host ─► HA (esphome)
                            └─ emuladores Shelly ─► HA (shelly)
Caddy sirve la app y hace de proxy de /orchestrator y /mqtt en el mismo origen (sin contenido mixto).
```

- El orquestador reconcilia de forma declarativa el JSON del proyecto con los emuladores (crear, actualizar, borrar) y reenvía en los dos sentidos los estados y comandos entre la app y los emuladores.
- Los fallos del simulador se aplican de verdad: `docker network disconnect` o `pause`, parar el emulador del coordinador, una red Docker `internal` para cortar Internet, y `tc netem` para la latencia y la pérdida.
- Recursos aproximados: entre 1,5 y 2 GB de RAM y 2 vCPU.

## Perfil de radio configurable (valores por defecto)

| Protocolo | Latencia/salto | Pérdida | Saltos máx. | Hijos/padre | Canal | Disponibilidad |
|---|---|---|---|---|---|---|
| Zigbee | 15 ms (+40 si reintento) | 1 % | 5 | 20 coord. / 16 router | 11 (11-26) | 10 min activos, 25 h a pilas |
| Thread | 10 ms | 0,5 % | 6 | 10 | 15 | timeout de hijo 240 s |
| Matter (Wi-Fi) | 20 ms | 0,2 % | — | — | — | suscripción ≥60 s |
| Z-Wave | 30 ms | 1 % | 4 (LR: 1) | — | 868,4 MHz | «dead» tras 3 fallos; wake up 3600 s |
| Wi-Fi / ESPHome / Shelly | 20 ms | 0,5 % | — | ~30 por AP | 1/6/11 | ping de la API 60 s |
| BLE | anuncio cada 1-10 s | 5 % | — | — | 37/38/39 | ~15 min sin anuncios |
| RF 433 | 50 ms | 10 % (sin acuse) | — | — | — | nunca (sin estado) |

Interferencia: el canal Wi-Fi 1 solapa con los Zigbee/Thread 11-14, el 6 con los 16-19 y el 11 con los 21-24. Penalización por defecto: +3 % de pérdida.

## Plan por tandas (E = emulación)

- **E1, base:**
  - paquete `emulator/` con docker-compose (HA, Mosquitto, Caddy, Z-Wave JS UI, matterjs-server) y el orquestador en Node con su API WebSocket;
  - script de onboarding automático de HA (usuario, MQTT, Z-Wave JS, Matter);
  - Z2M emulado y MQTT discovery genérico;
  - en la app: ajustes «Home Assistant real», panel de estado, modo en vivo y vía por dispositivo;
  - perfiles de radio en el motor;
  - CI con HA en Docker (job manual o nocturno).
- **E2:** Z-Wave con mock-server y bridge Matter con matter.js; comisionado automático.
- **E3:** nodos ESPHome host y emulador Shelly; inyección de fallos con Docker y `tc netem`.
- **E4 (opcional):** BLE con proxy falso y OTBR con RCP simulado.

## Limitaciones conocidas

- Ninguna radio física se emula: Zigbee y Thread no generan tramas 802.15.4 reales. La malla, la latencia y la pérdida se modelan en el motor.
- Matter necesita Linux con red `host` e IPv6. No funciona en Docker Desktop de Mac ni de Windows.
- HA va en tiempo real: no se puede acelerar el reloj de HA sin romperlo (`libfaketime` no es fiable).
- La app pública de GitHub Pages no puede conectar con `ws://` local (contenido mixto y Local Network Access de Chrome). Para usar el puente, la app se sirve desde el propio entorno (Caddy en `http://localhost:8080`).
- En este contenedor de desarrollo no se pueden descargar imágenes Docker. La verificación de extremo a extremo se hace en GitHub Actions.
