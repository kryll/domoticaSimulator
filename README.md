# HA Simulator

Aplicación web para diseñar y simular instalaciones domóticas basadas en Home Assistant: plano de la casa, dispositivos reales de varias marcas, conexiones de red (Wi-Fi, Zigbee, Thread, Z-Wave, Matter, BLE, RF 433), validador de red, automatizaciones, escenas y un motor de simulación.

## Probarla en el navegador

Versión publicada: https://kryll.github.io/domoticaSimulator/

Se despliega automáticamente con GitHub Actions en cada push a `main`.

## Ejecutarla en local

Requisitos: Node.js 20 o superior.

```bash
git clone https://github.com/kryll/domoticaSimulator.git
cd domoticaSimulator
npm install
npm run dev
```

Abre la URL que muestra la consola (por defecto http://localhost:5173). Al arrancar por primera vez se carga una casa de demostración.

## Laboratorio con Home Assistant real (opcional)

Además de la simulación en el navegador, el proyecto trae un **laboratorio** para tu PC: un Home Assistant real (de pruebas, nunca el de tu casa) al que se conectan los dispositivos del proyecto como si fueran de verdad. Es 100 % gratuito y libre (Docker, Home Assistant, Mosquitto, Caddy y Node) y, una vez descargadas las imágenes, funciona sin Internet.

Requisitos: Linux con Docker Engine, unos 2 GB de RAM libres y unos 5 GB de disco.

```bash
# 1. Instala Docker Engine (gratuito): https://docs.docker.com/engine/install/
#    y Node.js 22 (si no lo tienes, setup.sh compila la app dentro de un contenedor).
# 2. Clona y arranca el laboratorio
git clone https://github.com/kryll/domoticaSimulator.git
cd domoticaSimulator
emulator/scripts/setup.sh
```

3. Abre la app en http://localhost:8080 → **Ajustes → Laboratorio** → «Conectar con el laboratorio».
4. Abre Home Assistant en http://localhost:8123 (usuario y contraseña en `emulator/.env`): los dispositivos del proyecto aparecen con sus entidades.

Para parar: `emulator/scripts/stop.sh`. Para borrarlo y empezar de cero: `emulator/scripts/reset.sh`. La versión publicada en GitHub Pages no puede hablar con el laboratorio (el navegador bloquea `ws://` local desde `https://`): usa la que sirve el propio laboratorio en el puerto 8080. Detalles en [emulator/README.md](emulator/README.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción en `dist/` |
| `npm run preview` | Sirve la compilación de `dist/` |
| `npm test` | Tests con Vitest |
| `npm run lint` | ESLint |
| `npm run typecheck` | Comprobación de tipos |

Los proyectos se guardan en el navegador (IndexedDB) y se pueden exportar e importar como JSON. También se exportan las automatizaciones, escenas y scripts en YAML de Home Assistant, el inventario en CSV y el plano en PNG.

Guía técnica del proyecto: [CLAUDE.md](CLAUDE.md).
