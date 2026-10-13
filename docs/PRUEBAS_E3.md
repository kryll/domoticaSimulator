# Pruebas manuales del laboratorio (E3)

Listas para comprobar en tu PC Linux que los dispositivos de E3 (**Shelly** y **Matter**) llegan al Home Assistant del laboratorio por sus **integraciones reales**. Parten de un laboratorio de E1 que ya funciona ([PRUEBAS_E1.md](PRUEBAS_E1.md)). Lo automático lo cubre GitHub Actions (`emulator-e2e.yml`, añadiendo los perfiles a la entrada `perfiles`, p. ej. `zwave,esphome,shelly,matter`).

## Arranque

Los dos perfiles se pueden probar juntos o por separado:

- `emulator/scripts/setup.sh --all` (Z-Wave, ESPHome, Shelly y Matter) o solo los de E3: `emulator/scripts/setup.sh --shelly --matter`. Los perfiles se recuerdan en `emulator/.env` (`COMPOSE_PROFILES`); después basta con `setup.sh --no-build`.
- El resumen final muestra una línea por perfil activo: «Shelly: cada Shelly escucha en 127.0.0.1:18181, 18182…» y «Matter: bridge de matter.js (UDP 5541)…».
- Puertos: Shelly en `127.0.0.1:18181+n` (TCP), bridge Matter en UDP `5541`, matterjs-server en `127.0.0.1:5580`, ESPHome en `127.0.0.1:16054+n`; no se cruzan.

Los pasos de Shelly van numerados `S…` y los de Matter `M…`.

---

## Shelly

Los Shelly Gen2+ (Plus, Pro, Gen3, Gen4) del proyecto son Shelly emulados por el orquestador (API RPC: `GET /shelly` y WebSocket `/rpc`) que HA añade con su integración **`shelly`** real. En la demo hay tres: «Luz cocina» (Shelly 1PM Gen3), «Persiana dormitorio» (Shelly 2PM Gen3 en modo persiana) y «Enchufe baño» (Shelly Plug S Gen3). Automático: `emulator-e2e.yml` con `perfiles: shelly` (o `zwave,esphome,shelly`).

Tiempo estimado: 20-30 minutos. No descarga imágenes nuevas (los Shelly van dentro del orquestador).

### S0. Arranque con el perfil

- [ ] **S0.1** `git pull` y `emulator/scripts/setup.sh --shelly` (o `--all`). Al terminar, el resumen dice «Perfiles (vías reales): …shelly…» y la línea «Shelly: cada Shelly escucha en 127.0.0.1:18181, 18182…».
- [ ] **S0.2** `grep COMPOSE_PROFILES emulator/.env` → incluye `shelly`. No aparece ningún contenedor nuevo en `docker ps`.
- [ ] **S0.3** Con la app conectada (paso S1.1): `ss -ltn | grep -E ':1818[0-9]'` muestra los Shelly solo en `127.0.0.1` (nada en `0.0.0.0`).
- [ ] **S0.4** `ls -l emulator/.secrets/`: `shelly-nodes.json` aparece cuando la app manda el proyecto, a tu nombre y con `-rw-------`.
- [ ] **S0.5** `curl -s http://127.0.0.1:18181/shelly` devuelve el JSON del Shelly (`"gen":3`, `"model":"S3SW-001P16EU"`, `"auth_en":false`) y `curl -s 'http://127.0.0.1:18181/rpc/Switch.GetStatus?id=0'` su relé.

### S1. Alta en HA y vía en la app

- [ ] **S1.1** Abre la app (http://localhost:8080) con la demo y el lab conectado. En Ajustes → Laboratorio y en el panel Lab aparece «Shelly (API RPC emulada): Conectada · 3 de 3 Shellys en marcha · 3 conectados a HA».
- [ ] **S1.2** Propiedades de «Luz cocina»: «Vía hacia HA: Shelly (API RPC emulada)» y «Nodo: En marcha · shelly1pmg3-… · 127.0.0.1:1818x · HA conectado».
- [ ] **S1.3** En HA → Ajustes → Dispositivos y servicios → **Shelly** están «Luz cocina» (Shelly 1PM Gen3), «Persiana dormitorio» (Shelly 2PM Gen3) y «Enchufe baño» (Shelly Plug S Gen3), añadidos solos por el orquestador. En la ficha del dispositivo, el firmware es `20250924-062729/1.7.1-gd336f31` y la conexión es su MAC.
- [ ] **S1.4** En HA, las entidades llevan el entity_id del simulador (el orquestador las renombra a los pocos segundos): `switch.luz_cocina_switch`, `sensor.luz_cocina_power`, `sensor.luz_cocina_energy`, `cover.persiana_dormitorio_cover`, `sensor.persiana_dormitorio_power`, `switch.enchufe_bano_switch`… No quedan duplicados de esos dispositivos en la integración **MQTT**.

### S2. Mando y estado

- [ ] **S2.1** Enciende «Luz cocina» desde HA: en la app se enciende y el Registro lo apunta como comando de HA. En HA el estado se queda en «Encendido» y la potencia pasa a 36 W.
- [ ] **S2.2** Apaga «Enchufe baño» desde la app: HA lo ve apagado al momento (NotifyStatus, sin esperar a ningún sondeo).
- [ ] **S2.3** Mueve «Persiana dormitorio» al 50 % desde HA: en la app la persiana se mueve; en HA pasa por «Abriendo» y se queda en posición 50 al terminar. Ábrela, ciérrala y párala a medio camino desde HA y desde la app.
- [ ] **S2.4** Panel Lab → Tráfico, filtro `shelly`: se ven `Switch.Set {"id":0,"on":true}` / `Cover.GoToPosition …` (entrada) y `NotifyStatus · switch:0: on 36 W` (salida), con el dispositivo.

### S3. Ciclo de vida

- [ ] **S3.1** Panel Lab → Nodos → «Parar» «Luz cocina»: en HA sus entidades pasan a «No disponible» en un par de segundos. «Arrancar»: HA se reconecta solo (la integración reintenta cada 60 s, puede tardar hasta un minuto) y vuelve el estado.
- [ ] **S3.2** Escenario de fallo que deje sin red/alimentación a un Shelly (p. ej. «Corte de luz»): sus entidades quedan «No disponible» y vuelven al quitar el fallo.
- [ ] **S3.3** Pausa el simulador y acepta «Parar todos los nodos»: los tres Shelly quedan no disponibles. «Volver a acoplar» los recupera.
- [ ] **S3.4** Renombra «Luz cocina» en la app: HA recarga la entrada (en ~1 minuto) con el nombre nuevo del dispositivo.
- [ ] **S3.5** Borra «Enchufe baño» de la demo: su entrada desaparece de la integración Shelly de HA. Deshacer lo vuelve a añadir con la misma MAC (depende del proyecto y del dispositivo), así HA lo reconoce como el mismo Shelly.
- [ ] **S3.6** Añade a la demo un «Shelly H&T Gen3» y un «Shelly Pro 3EM»: aparecen en HA (temperatura, humedad y batería; potencia total y por fases, tensión y energía). Cambia sus valores en la app: HA los ve.
- [ ] **S3.7** Añade un «Shelly EM medidor de energía» (Gen1) y un «Shelly 1 Gen3 para puerta de garaje»: la app dice «Shelly (API RPC emulada) no disponible: ahora MQTT discovery genérico» con el motivo (Gen1 / puerta de garaje) y llegan por MQTT.
- [ ] **S3.8** Snapshot: «Guardar» con los Shelly añadidos, borra uno y restaura (con `--docker`): vuelve con el mismo puerto (`shelly-nodes.json` va en el snapshot) y HA lo encuentra.
- [ ] **S3.9** `emulator/scripts/setup.sh --no-build --no-shelly`: la app vuelve a mostrar «… no disponible: ahora MQTT discovery genérico» y los Shelly llegan por MQTT (las entradas `shelly` de HA quedan no disponibles; bórralas si no las vas a usar).

### Límites conocidos de Shelly (no son fallos)

- Es un **emulador de la API RPC**, no el firmware: sin autenticación (como un Shelly recién instalado), sin scripts, proxy BLE, webhooks, MQTT propio del Shelly, reinicio ni actualizaciones (si los pides desde HA, HA muestra un error).
- El H&T Gen3 va siempre despierto: un H&T real duerme y es él quien se conecta a HA por WebSocket saliente.
- Tensión nominal de 230 V e intensidad derivada (potencia / tensión) cuando el simulador no las mide; HA crea esos sensores desactivados, como con un Shelly real. En el 2PM de dos canales la potencia del dispositivo se reparte entre los canales encendidos (el simulador mide el dispositivo entero) y solo se alinean los interruptores.
- HA crea también, como con un Shelly real, sensores de diagnóstico (tiempo en marcha, «En la nube», sobretemperatura…) que no son entidades del simulador.
- Los Gen1 (CoIoT) y el Shelly 1 de puerta de garaje siguen por MQTT.

### Si algo falla (Shelly)

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml logs --tail=200 orchestrator homeassistant` (en HA, añade `homeassistant.components.shelly: debug` y `aioshelly: debug` en `logger` para más detalle);
- `curl -s http://127.0.0.1:18181/shelly` y `curl -s http://127.0.0.1:18181/rpc/Shelly.GetStatus`;
- una captura del panel Lab (estado de las vías) o de HA.

---

## Matter

Bridge Matter de matter.js en el orquestador, comisionado solo en matterjs-server, e integración `matter` de HA. Lo automático: `emulator-e2e.yml` con `perfiles: zwave,esphome,matter`. Tiempo estimado: 20-30 minutos. La primera vez se descarga la imagen de matterjs-server (unos 300 MB).

### M0. Arranque con el perfil

- [ ] **M0.1** `git pull` y `emulator/scripts/setup.sh --matter` (o `--all`). El onboarding dice «Integración Matter creada (ws://127.0.0.1:5580/ws)» y el resumen muestra la línea «Matter: bridge de matter.js (UDP 5541)…».
- [ ] **M0.2** `grep COMPOSE_PROFILES emulator/.env` incluye `matter`. `docker ps` muestra `hasim-matter-server`.
- [ ] **M0.3** `ss -ltn | grep 5580`: solo `127.0.0.1:5580` (nada en `0.0.0.0` ni `*`). `ss -lun | grep 5541` muestra el bridge (todas las interfaces: lo exige Matter).
- [ ] **M0.4** Abre la app con la demo y el lab conectado. En unos segundos `ls -l emulator/.secrets/matter.json` aparece con `-rw-------` y `emulator/matter/bridge/` tiene datos.

### M1. Comisionado y dispositivos

- [ ] **M1.1** Panel Lab → «Matter (matter.js): Conectada · Bridge comisionado en matterjs-server (nodo N) · 3 de 3 dispositivos alcanzables», con el enlace «Abrir el panel de matterjs-server» (http://localhost:5580): ahí aparece el nodo del bridge.
- [ ] **M1.2** Propiedades de «Luz Matter»: «Vía hacia HA: Matter (matter.js)» y «Nodo: En marcha · endpoint N · Extended Color Light · en marcha».
- [ ] **M1.3** En HA → Ajustes → Dispositivos y servicios → **Matter**: «HA Simulator» (modelo «Bridge del laboratorio»), «Luz Matter», «Enchufe Matter» y «Cerradura entrada» (cada uno con su fabricante y modelo del catálogo).
- [ ] **M1.4** Las entidades llevan el entity_id del simulador (el orquestador las renombra a los pocos segundos): `light.luz_matter`, `switch.enchufe_matter_switch`, `sensor.enchufe_matter_power`, `sensor.enchufe_matter_energy`, `lock.cerradura_entrada_lock` y `sensor.cerradura_entrada_battery`. HA crea además entidades de configuración propias de Matter (nivel de encendido de la luz, modo de la cerradura…); cambiarlas no llega al simulador.

### M2. Comandos y estados

- [ ] **M2.1** En HA enciende «Luz Matter» con brillo al 50 %: en la app se enciende y el Registro lo apunta como comando de HA. Cambia la temperatura de color y el color (rueda de color): la app los refleja.
- [ ] **M2.2** Apaga la luz desde la app: HA la ve apagada en un segundo (suscripción Matter).
- [ ] **M2.3** Enciende el enchufe desde la app: HA lo ve encendido y la potencia en W (el bridge la manda en mW).
- [ ] **M2.4** Abre la cerradura desde HA: la app la abre y HA queda «Abierta».
- [ ] **M2.5** Panel Lab → Tráfico, filtro `matter`: `OnOff · On`, `LevelControl · MoveToLevelWithOnOff · level=…` (entrada) y `OnOff=on Level=…` (salida), con el dispositivo.

### M3. Ciclo de vida

- [ ] **M3.1** Panel Lab → Nodos → «Parar» «Luz Matter»: en HA queda «No disponible» en un par de segundos (Reachable=false). «Arrancar»: vuelve sola.
- [ ] **M3.2** Pausa el simulador y acepta «Parar todos los nodos»: todos los dispositivos Matter quedan no disponibles. «Volver a acoplar» los recupera.
- [ ] **M3.3** `docker restart hasim-orchestrator` con la app abierta: en `docker logs hasim-orchestrator` sale «bridge ya comisionado en matterjs-server (nodo N): se reutiliza» y **no** «comisionando el bridge». En HA no hay dispositivos duplicados y el panel de matterjs-server sigue con un solo nodo del bridge.
- [ ] **M3.4** Añade a la demo un «Eve Door & Window (Matter)» en una sala con el border router al alcance: aparece en HA con su sensor de puerta y batería sin reiniciar nada. Bórralo: desaparece de HA.
- [ ] **M3.5** Añade un «IKEA STYRBAR» con integración Matter: «Vía hacia HA» explica que sigue por MQTT (el sensor de acción no tiene cluster Matter emulado).
- [ ] **M3.6** `emulator/scripts/setup.sh --no-build --no-matter`: la app vuelve a mostrar «Matter (matter.js) no disponible: ahora MQTT discovery genérico».

### Límites conocidos de Matter (no son fallos)

- Thread no tiene radio: los dispositivos Thread llegan a HA por IP a través del bridge.
- Todos los dispositivos cuelgan de un bridge (un solo nodo Matter): si el bridge cae, caen todos.
- No se emulan termostatos, ventiladores, mandos (eventos del cluster `Switch`), calidad del aire, humo ni reproductores: siguen por MQTT.
- matterjs-server acepta certificados de pruebas (`ENABLE_TEST_NET_DCL=true`) porque el bridge usa la atestación de desarrollo de matter.js.
- Los snapshots guardan el bridge (`emulator/matter/`, `matter.json`) pero no el volumen de matterjs-server; si no casan, el orquestador vuelve a comisionar el bridge.

### Si algo falla (Matter)

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml --profile matter logs --tail=200 orchestrator matter-server homeassistant`;
- una captura del panel Lab (estado de la vía Matter) o del panel de matterjs-server.
