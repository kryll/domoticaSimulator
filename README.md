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
