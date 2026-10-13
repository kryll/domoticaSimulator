# Pruebas manuales del laboratorio (E3)

Listas para comprobar en tu PC Linux que los dispositivos de E3 llegan al Home Assistant del laboratorio por sus **integraciones reales**. Parten de un laboratorio de E1 que ya funciona ([PRUEBAS_E1.md](PRUEBAS_E1.md)). Lo automático lo cubre GitHub Actions (`emulator-e2e.yml`).

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

### Si algo falla

Recoge esto y pásamelo:
- el número del paso y qué ocurrió;
- `docker compose -f emulator/docker-compose.yml --profile matter logs --tail=200 orchestrator matter-server homeassistant`;
- una captura del panel Lab (estado de la vía Matter) o del panel de matterjs-server.
