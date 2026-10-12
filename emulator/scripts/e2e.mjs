#!/usr/bin/env node
// Prueba de extremo a extremo con el laboratorio arrancado (HA + Mosquitto + orquestador):
// un cliente WebSocket hace de app, manda el proyecto demo y su estado, y se comprueba por la
// API de HA que aparecen las entidades, que un light.turn_on llega como comando y que el estado
// vuelve a HA. También para y arranca un nodo. La usa .github/workflows/emulator-e2e.yml.
// Variables: ORCHESTRATOR_WS, HA_URL, SECRETS_DIR, E2E_TIMEOUT_S.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { tsImport } from 'tsx/esm/api';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const ORCH = env.ORCHESTRATOR_WS ?? 'ws://127.0.0.1:8081/orchestrator';
const HA = (env.HA_URL ?? 'http://127.0.0.1:8123').replace(/\/$/, '');
const TIMEOUT = Number(env.E2E_TIMEOUT_S ?? 180) * 1000;
const token = (await readFile(join(env.SECRETS_DIR ?? join(here, '..', '.secrets'), 'ha-token'), 'utf8')).trim();

const imp = (p) => tsImport(p, import.meta.url);
const { createDemoProject } = await imp('../../src/store/demoProject.ts');
const { catalog } = await imp('../../src/devices/catalog.ts');
const { callService, createSimulationState } = await imp('../../src/simulation/engine.ts');

const log = (m) => console.log(`[e2e] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeout = TIMEOUT) {
  const start = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    if (Date.now() - start > timeout) throw new Error(`Tiempo agotado esperando: ${what} (${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await sleep(1000);
  }
}

async function haState(entityId) {
  const res = await fetch(`${HA}/api/states/${entityId}`, { headers: { authorization: `Bearer ${token}` } });
  return res.status === 200 ? res.json() : undefined;
}

function haCall(domain, service, data) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA.replace(/^http/, 'ws')}/api/websocket`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'call_service', domain, service, service_data: data }));
      else if (msg.type === 'result') {
        ws.close();
        if (msg.success) resolve(msg.result);
        else reject(new Error(msg.error?.message));
      }
    });
    ws.on('error', reject);
  });
}

// ---------- App falsa ----------
const project = { ...createDemoProject(), id: 'e2e' };
const settings = { enabled: true, orchestratorUrl: ORCH, discoveryPrefix: 'homeassistant', baseTopic: 'hasim', z2mBaseTopic: 'hasim-z2m', automationsRunIn: 'simulator' };
project.haBridge = settings;
const definitions = catalog.filter((d) => project.devices.some((x) => x.definitionId === d.id));
let sim = createSimulationState(project, catalog, Date.now());
const commands = [];
const ws = new WebSocket(ORCH);
const send = (msg) => ws.send(JSON.stringify({ v: 1, ...msg }));
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === 'command') {
    commands.push(msg);
    sim = callService(sim, project, msg.entityId, msg.service, msg.data);
    send({ type: 'command_result', id: msg.id, ok: true });
    send({ type: 'state', entities: { [msg.entityId]: sim.entities[msg.entityId] } });
  }
});
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});
log('Conectado con el orquestador');
send({ type: 'hello', role: 'app', client: 'e2e' });
send({ type: 'project', mode: 'full', project, definitions, settings });
send({ type: 'state', full: true, entities: sim.entities, availability: { live: true, unavailable: [] } });

try {
  // 1. Entidades en HA con los entity_id del simulador.
  const expected = ['light.luz_salon', 'switch.cafetera', 'binary_sensor.puerta_entrada_door', 'sensor.clima_dormitorio_temperature', 'cover.persiana_dormitorio_cover', 'lock.cerradura_entrada_lock'];
  for (const id of expected) {
    await until(`${id} en /api/states`, async () => {
      const st = await haState(id);
      return st && st.state !== 'unavailable' && st.state !== 'unknown' ? st : undefined;
    });
    log(`OK ${id}`);
  }
  const area = await haState('light.luz_salon');
  log(`light.luz_salon: ${area.state} (${area.attributes.friendly_name})`);

  // 2. light.turn_on en HA → comando → callService → estado de vuelta.
  await haCall('light', 'turn_on', { entity_id: 'light.luz_salon', brightness: 200 });
  await until('comando light.turn_on en la app', async () => commands.find((c) => c.entityId === 'light.luz_salon' && c.service === 'light.turn_on'), 30_000);
  log('OK comando recibido por la app');
  await until('light.luz_salon encendida en HA', async () => {
    const st = await haState('light.luz_salon');
    return st?.state === 'on' && st.attributes.brightness === 200 ? st : undefined;
  }, 30_000);
  log('OK estado de vuelta en HA');

  // 3. Ciclo de vida: parar y arrancar un nodo.
  send({ type: 'node', action: 'stop', deviceIds: ['demo-cafetera'] });
  await until('switch.cafetera no disponible', async () => (await haState('switch.cafetera'))?.state === 'unavailable', 30_000);
  send({ type: 'node', action: 'start', deviceIds: ['demo-cafetera'] });
  await until('switch.cafetera disponible', async () => (await haState('switch.cafetera'))?.state === 'off', 30_000);
  log('OK parar y arrancar un nodo');
  log('Todo correcto');
  ws.close();
  process.exit(0);
} catch (err) {
  console.error(`[e2e] FALLO: ${err.message}`);
  ws.close();
  process.exit(1);
}
