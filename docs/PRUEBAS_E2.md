# Pruebas manuales del laboratorio (E2: Z-Wave y ESPHome reales)

Lista para comprobar en tu PC Linux que los dispositivos Z-Wave y ESPHome llegan al Home Assistant del laboratorio por sus **integraciones reales** (`zwave_js` y `esphome`). Parte de un laboratorio de E1 que ya funciona ([PRUEBAS_E1.md](PRUEBAS_E1.md)). Lo automático lo cubre GitHub Actions (`emulator-e2e.yml` con `perfiles: zwave,esphome`).

Tiempo estimado: 30-40 minutos. La primera vez se descarga la imagen de Z-Wave JS UI (unos 500 MB).

---

## 0. Arranque con los perfiles

- [ ] **0.1** `git pull` y `emulator/scripts/setup.sh --all`. Al terminar, el resumen dice «Perfiles (vías reales): esphome,zwave» y muestra Z-Wave JS UI en http://localhost:8091.
- [ ] **0.2** `grep COMPOSE_PROFILES emulator/.env` → `COMPOSE_PROFILES=esphome,zwave`. `docker ps` muestra además `hasim-zwave-mock` y `hasim-zwave-js-ui`.
- [ ] **0.3** `ss -ltn | grep -E ':(3000|5556|8091|605[4-9])'`: todos en `127.0.0.1` (nada en `0.0.0.0`). El 5555 no aparece (solo existe dentro de Docker).
- [ ] **0.3b** Carga la demo nueva: **Archivo → Cargar proyecto de demo** (se abre como proyecto nuevo y no borra el tuyo). La demo que guardaste en E1 no trae los dispositivos de E2: el Despacho debe tener 4 (Aspiradora, Antena Z-Wave, Enchufe despacho y Sensor despacho). Si solo ves la aspiradora, es la demo antigua.
- [ ] **0.4** `ls -l emulator/.secrets/`: `esphome-nodes.json` aparece cuando la app manda el proyecto, a tu nombre y con `-rw-------`.

## 1. Z-Wave por Z-Wave JS

- [ ] **1.1** Abre la app (http://localhost:8080) con la demo y el lab conectado. En Ajustes → Laboratorio y en el panel Lab aparece «Z-Wave JS (mock): Conectada» con el enlace «Abrir Z-Wave JS UI».
- [ ] **1.2** Propiedades de «Enchufe despacho»: «Vía hacia HA: Z-Wave JS (mock)» y «Nodo: En marcha · nodo N · listo». La primera vez que llega el proyecto, Z-Wave tarda ~1 minuto (Z-Wave JS UI reinicia el driver para leer los nodos).
- [ ] **1.3** En HA → Ajustes → Dispositivos y servicios → **Z-Wave** aparece «Enchufe despacho» (y la antena como controlador). En Z-Wave JS UI (http://localhost:8091) el nodo está entrevistado («Ready»).
- [ ] **1.4** En HA, la entidad es `switch.enchufe_despacho_switch` (el entity_id del simulador; el orquestador la renombra a los pocos segundos) y hay sensores de potencia y energía.
- [ ] **1.5** Enciende el enchufe desde HA: en la app se enciende y el Registro lo apunta como comando de HA. En HA el estado se queda en «Encendido».
- [ ] **1.6** Apaga el enchufe desde la app: HA lo ve apagado en un par de segundos (informe del nodo).
- [ ] **1.7** Panel Lab → Tráfico, filtro `zwave`: se ven `Binary Switch · Set` (entrada) y `Binary Switch · Report` / `Meter · Report` (salida), con el nodo.
- [ ] **1.8** Panel Lab → Nodos → «Parar» el enchufe Z-Wave: en HA, el sensor «Estado del nodo» del enchufe pasa a **dead** (HA no pone las entidades en «No disponible» por un nodo dead). «Arrancar»: vuelve a **alive**.
- [ ] **1.9** Escenario «Falla el coordinador» (o parar «Antena Z-Wave»): en HA **todas** las entidades Z-Wave pasan a «No disponible» (y caen también las Zigbee). Al quitar el fallo, Z-Wave JS UI se reconecta solo en menos de un minuto.
- [ ] **1.10** Añade a la demo un «Aeotec MultiSensor 7» (Z-Wave, a pilas) en una sala: tras ~1 minuto aparece en HA con movimiento, temperatura, humedad, luminancia y batería. Simula movimiento en la app: HA lo ve.

## 2. ESPHome por su API nativa

- [ ] **2.1** En el panel Lab aparece «ESPHome (API nativa emulada): Conectada · 2 de 2 nodos en marcha · cifrado Noise». «Sensor despacho» dice «127.0.0.1:605x · HA conectado».
- [ ] **2.2** En HA → Dispositivos y servicios → **ESPHome** están «Sensor despacho» y «Voz cocina», añadidos solos por el orquestador (con su clave de cifrado).
- [ ] **2.3** Cambia en la app la temperatura del «Sensor despacho»: HA muestra el mismo valor en `sensor.sensor_despacho_temperature`. Simula movimiento: `binary_sensor.sensor_despacho_motion` se activa.
- [ ] **2.4** En HA, escribe un texto en «Voz cocina · Asistente · Anuncio» (`text.voz_cocina_satellite_announce`): en la app el satélite lo anuncia (burbuja y Registro). Cambia el volumen o el silencio: la app lo refleja.
- [ ] **2.5** «Parar» el «Sensor despacho» en el panel: en HA queda «No disponible» en unos segundos. «Arrancar»: HA se reconecta solo (puede tardar hasta un minuto) y vuelve el valor.
- [ ] **2.6** Pausa el simulador y acepta «Parar todos los nodos»: los nodos ESPHome se paran y el enchufe Z-Wave queda dead. «Volver a acoplar» los recupera.

## 3. Ciclo de vida del laboratorio

- [ ] **3.1** Snapshot con las vías reales: «Guardar», cambia algo en Z-Wave JS UI (p. ej. el nombre de un nodo) y restaura (con `--docker`): se paran y vuelven a arrancar HA, Z-Wave JS UI y el mock, y todo vuelve a como estaba.
- [ ] **3.2** `emulator/scripts/stop.sh` y `emulator/scripts/setup.sh --no-build` (sin repetir `--all`): los perfiles siguen activos y Z-Wave no necesita reiniciar el driver (el mock recuerda la red).
- [ ] **3.3** `emulator/scripts/setup.sh --no-build --no-zwave --no-esphome`: la app vuelve a mostrar «… no disponible: ahora MQTT discovery genérico» y los dispositivos llegan por MQTT (las entradas `zwave_js` y `esphome` de HA quedan no disponibles; bórralas si no las vas a usar).

---

## Límites conocidos de E2 (no son fallos)

- ESPHome es un **emulador del protocolo** de la API nativa, no firmware compilado: no hay logs del dispositivo, OTA, proxy Bluetooth ni servicios de usuario.
- Los satélites de voz no tienen `assist_satellite` real (la plataforma `host` no tiene micrófono): estado + texto de anuncio.
- Z-Wave: el mock no simula la inclusión, así que añadir o quitar dispositivos Z-Wave reinicia el driver de Z-Wave JS UI (unos 20-60 s sin Z-Wave). Fabricante y modelo genéricos. Sin endpoints: dispositivos con dos relés o termostatos Z-Wave siguen por MQTT.
- Un nodo Z-Wave parado sale «dead» en el sensor de estado del nodo, no «No disponible» en todas sus entidades: así lo hace HA con un dispositivo real.

## Si algo falla

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml --profile zwave logs --tail=200 orchestrator zwave-mock zwave-js-ui homeassistant`;
- una captura del panel Lab (estado de las vías) o de HA.
