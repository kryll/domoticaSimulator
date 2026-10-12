# HA Simulator

Laboratorio domótico tipo GNS3 para hacer pruebas en casa sin tocar nunca un entorno real. Funciona de dos maneras:

- **En el navegador:** lienzo con el plano de la casa, dispositivos reales de varias marcas, conexiones de red y un motor que simula el mundo físico (personas, clima, sol, consumo, fallos), con un modo rápido de automatizaciones propio.
- **Como laboratorio:** un orquestador opcional (`emulator/`) levanta un Home Assistant real con su panel y conecta a él los dispositivos emulados a través de sus integraciones reales (MQTT con formato Zigbee2MQTT, Z-Wave JS, Matter, ESPHome, Shelly). Desde la app los dispositivos se arrancan, se paran, se rompen y se restauran, y hay snapshots e inspector de tráfico.

Visión y límites en docs/EMULACION.md. Plan en docs/ROADMAP.md.

## Stack
- React 18 + TypeScript (strict) + Vite
- React Flow para el lienzo, Zustand para el estado, Tailwind CSS
- Persistencia en IndexedDB (idb-keyval), exportar/importar JSON
- Vitest + Testing Library para tests
- Sin backend obligatorio: la app funciona sola (GitHub Pages). `emulator/` es un backend opcional para el laboratorio (Node 22 + TypeScript con tsx, mqtt.js y ws; Docker Compose con Home Assistant, Mosquitto y Caddy), con su propio package.json, tsconfig y tests (aedes)

## Estructura
```
src/
  canvas/        # lienzo, nodos, aristas, plano
  catalog/       # panel del catálogo y filtros
  devices/       # tipos y lógica de dispositivos
  network/       # conexiones, cobertura, malla, validador
  automations/   # editor visual + YAML
  scenes/        # escenas y scripts
  simulation/    # motor, reloj, eventos, logbook
  export/        # generación de YAML, CSV, PNG
  store/         # stores de Zustand
  ui/            # componentes compartidos
  bridge/        # puente con el laboratorio: mapeo MQTT puro (mqtt/), protocolo WS, panel «Laboratorio»
data/devices.json  # catálogo de dispositivos
emulator/        # laboratorio opcional: orquestador, docker-compose y scripts (ver emulator/README.md)
```

## Modelo de datos (fuente de verdad en src/types.ts)
Project, Floor, Room, Device, DeviceDefinition, Connection, Automation (trigger/condition/action), Scene, Script, SimulationState, LogEntry.

## Dominio
- Protocolos: Wi-Fi, Ethernet, Zigbee, Z-Wave, Thread, Matter, BLE, RF 433
- Integraciones HA: ZHA, Zigbee2MQTT, Matter, HomeKit Device, Xiaomi Miio, Tuya, eWeLink, Shelly, Hue, Google Cast, Alexa Media Player
- Marcas: IKEA, SONOFF, Aqara, Xiaomi, Shelly, Philips Hue, Amazon, Google, Tuya, TP-Link, Netatmo, Reolink, Sonos, Samsung, LG
- Reglas: Zigbee necesita coordinador o hub; Thread necesita border router; dispositivos con hub propietario (Aqara, IKEA, Hue) avisan si falta el hub; marcar integraciones cloud vs local

## Convenciones
- Componentes funcionales, sin `any`
- La lógica de simulación y del validador va en funciones puras, separada de React, y siempre con tests
- Textos de la interfaz en español
- Commits pequeños con mensajes en español tipo `feat: ...`, `fix: ...`
- Antes de terminar una tarea: `npm run lint`, `npm run typecheck` y `npm test` deben pasar

## Comandos
```
npm run dev | npm run build | npm test | npm run lint | npm run typecheck
```
