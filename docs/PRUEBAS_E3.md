# Pruebas manuales del laboratorio (E3)

Listas para comprobar en tu PC Linux que los dispositivos de E3 llegan al Home Assistant del laboratorio por sus **integraciones reales**. Parten de un laboratorio de E1 que ya funciona ([PRUEBAS_E1.md](PRUEBAS_E1.md)). Lo automático lo cubre GitHub Actions (`emulator-e2e.yml`, añadiendo el perfil a la entrada `perfiles`).

---

## Shelly

Los Shelly Gen2+ (Plus, Pro, Gen3, Gen4) del proyecto son Shelly emulados por el orquestador (API RPC: `GET /shelly` y WebSocket `/rpc`) que HA añade con su integración **`shelly`** real. En la demo hay tres: «Luz cocina» (Shelly 1PM Gen3), «Persiana dormitorio» (Shelly 2PM Gen3 en modo persiana) y «Enchufe baño» (Shelly Plug S Gen3). Automático: `emulator-e2e.yml` con `perfiles: shelly` (o `zwave,esphome,shelly`).

Tiempo estimado: 20-30 minutos. No descarga imágenes nuevas (los Shelly van dentro del orquestador).

### 0. Arranque con el perfil

- [ ] **0.1** `git pull` y `emulator/scripts/setup.sh --shelly` (o `--all`). Al terminar, el resumen dice «Perfiles (vías reales): …shelly…» y la línea «Shelly: cada Shelly escucha en 127.0.0.1:18181, 18182…».
- [ ] **0.2** `grep COMPOSE_PROFILES emulator/.env` → incluye `shelly`. No aparece ningún contenedor nuevo en `docker ps`.
- [ ] **0.3** Con la app conectada (paso 1.1): `ss -ltn | grep -E ':1818[0-9]'` muestra los Shelly solo en `127.0.0.1` (nada en `0.0.0.0`).
- [ ] **0.4** `ls -l emulator/.secrets/`: `shelly-nodes.json` aparece cuando la app manda el proyecto, a tu nombre y con `-rw-------`.
- [ ] **0.5** `curl -s http://127.0.0.1:18181/shelly` devuelve el JSON del Shelly (`"gen":3`, `"model":"S3SW-001P16EU"`, `"auth_en":false`) y `curl -s 'http://127.0.0.1:18181/rpc/Switch.GetStatus?id=0'` su relé.

### 1. Alta en HA y vía en la app

- [ ] **1.1** Abre la app (http://localhost:8080) con la demo y el lab conectado. En Ajustes → Laboratorio y en el panel Lab aparece «Shelly (API RPC emulada): Conectada · 3 de 3 Shellys en marcha · 3 conectados a HA».
- [ ] **1.2** Propiedades de «Luz cocina»: «Vía hacia HA: Shelly (API RPC emulada)» y «Nodo: En marcha · shelly1pmg3-… · 127.0.0.1:1818x · HA conectado».
- [ ] **1.3** En HA → Ajustes → Dispositivos y servicios → **Shelly** están «Luz cocina» (Shelly 1PM Gen3), «Persiana dormitorio» (Shelly 2PM Gen3) y «Enchufe baño» (Shelly Plug S Gen3), añadidos solos por el orquestador. En la ficha del dispositivo, el firmware es `20250924-062729/1.7.1-gd336f31` y la conexión es su MAC.
- [ ] **1.4** En HA, las entidades llevan el entity_id del simulador (el orquestador las renombra a los pocos segundos): `switch.luz_cocina_switch`, `sensor.luz_cocina_power`, `sensor.luz_cocina_energy`, `cover.persiana_dormitorio_cover`, `sensor.persiana_dormitorio_power`, `switch.enchufe_bano_switch`… No quedan duplicados de esos dispositivos en la integración **MQTT**.

### 2. Mando y estado

- [ ] **2.1** Enciende «Luz cocina» desde HA: en la app se enciende y el Registro lo apunta como comando de HA. En HA el estado se queda en «Encendido» y la potencia pasa a 36 W.
- [ ] **2.2** Apaga «Enchufe baño» desde la app: HA lo ve apagado al momento (NotifyStatus, sin esperar a ningún sondeo).
- [ ] **2.3** Mueve «Persiana dormitorio» al 50 % desde HA: en la app la persiana se mueve; en HA pasa por «Abriendo» y se queda en posición 50 al terminar. Ábrela, ciérrala y párala a medio camino desde HA y desde la app.
- [ ] **2.4** Panel Lab → Tráfico, filtro `shelly`: se ven `Switch.Set {"id":0,"on":true}` / `Cover.GoToPosition …` (entrada) y `NotifyStatus · switch:0: on 36 W` (salida), con el dispositivo.

### 3. Ciclo de vida

- [ ] **3.1** Panel Lab → Nodos → «Parar» «Luz cocina»: en HA sus entidades pasan a «No disponible» en un par de segundos. «Arrancar»: HA se reconecta solo (la integración reintenta cada 60 s, puede tardar hasta un minuto) y vuelve el estado.
- [ ] **3.2** Escenario de fallo que deje sin red/alimentación a un Shelly (p. ej. «Corte de luz»): sus entidades quedan «No disponible» y vuelven al quitar el fallo.
- [ ] **3.3** Pausa el simulador y acepta «Parar todos los nodos»: los tres Shelly quedan no disponibles. «Volver a acoplar» los recupera.
- [ ] **3.4** Renombra «Luz cocina» en la app: HA recarga la entrada (en ~1 minuto) con el nombre nuevo del dispositivo.
- [ ] **3.5** Borra «Enchufe baño» de la demo: su entrada desaparece de la integración Shelly de HA. Deshacer lo vuelve a añadir con la misma MAC (depende del proyecto y del dispositivo), así HA lo reconoce como el mismo Shelly.
- [ ] **3.6** Añade a la demo un «Shelly H&T Gen3» y un «Shelly Pro 3EM»: aparecen en HA (temperatura, humedad y batería; potencia total y por fases, tensión y energía). Cambia sus valores en la app: HA los ve.
- [ ] **3.7** Añade un «Shelly EM medidor de energía» (Gen1) y un «Shelly 1 Gen3 para puerta de garaje»: la app dice «Shelly (API RPC emulada) no disponible: ahora MQTT discovery genérico» con el motivo (Gen1 / puerta de garaje) y llegan por MQTT.
- [ ] **3.8** Snapshot: «Guardar» con los Shelly añadidos, borra uno y restaura (con `--docker`): vuelve con el mismo puerto (`shelly-nodes.json` va en el snapshot) y HA lo encuentra.
- [ ] **3.9** `emulator/scripts/setup.sh --no-build --no-shelly`: la app vuelve a mostrar «… no disponible: ahora MQTT discovery genérico» y los Shelly llegan por MQTT (las entradas `shelly` de HA quedan no disponibles; bórralas si no las vas a usar).

### Límites conocidos de Shelly (no son fallos)

- Es un **emulador de la API RPC**, no el firmware: sin autenticación (como un Shelly recién instalado), sin scripts, proxy BLE, webhooks, MQTT propio del Shelly, reinicio ni actualizaciones (si los pides desde HA, HA muestra un error).
- El H&T Gen3 va siempre despierto: un H&T real duerme y es él quien se conecta a HA por WebSocket saliente.
- Tensión nominal de 230 V e intensidad derivada (potencia / tensión) cuando el simulador no las mide; HA crea esos sensores desactivados, como con un Shelly real. En el 2PM de dos canales la potencia del dispositivo se reparte entre los canales encendidos (el simulador mide el dispositivo entero) y solo se alinean los interruptores.
- HA crea también, como con un Shelly real, sensores de diagnóstico (tiempo en marcha, «En la nube», sobretemperatura…) que no son entidades del simulador.
- Los Gen1 (CoIoT) y el Shelly 1 de puerta de garaje siguen por MQTT.

### Si algo falla

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml logs --tail=200 orchestrator homeassistant` (en HA, añade `homeassistant.components.shelly: debug` y `aioshelly: debug` en `logger` para más detalle);
- `curl -s http://127.0.0.1:18181/shelly` y `curl -s http://127.0.0.1:18181/rpc/Shelly.GetStatus`;
- una captura del panel Lab (estado de las vías) o de HA.
