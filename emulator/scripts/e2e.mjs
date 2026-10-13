#!/usr/bin/env node
// Prueba de extremo a extremo con el laboratorio arrancado (HA + Mosquitto + orquestador):
// un cliente WebSocket hace de app, manda el proyecto demo y su estado, y se comprueba por la
// API de HA que aparecen las entidades, que un light.turn_on llega como comando y que el estado
// vuelve a HA. También para y arranca un nodo. La usa .github/workflows/emulator-e2e.yml.
// Con los perfiles de E2 (E2E_PROFILES o COMPOSE_PROFILES de .env: zwave, esphome) comprueba además
// las vías reales: el enchufe Z-Wave de la demo con la integración zwave_js y el sensor ESPHome con
// la integración esphome (registro de dispositivos de HA), un comando de HA al enchufe Z-Wave, un
// cambio del sensor ESPHome desde la app, y que al parar un nodo queda no disponible.
// Con el perfil matter (E3): la «Luz Matter» de la demo llega con la integración matter (bridge de
// matter.js comisionado en matterjs-server), un light.turn_on de HA llega a la app, un cambio del
// enchufe Matter en la app se ve en HA, parar la luz la deja no disponible y arrancarla la recupera;
// y en matterjs-server hay un solo nodo del bridge y en HA una sola «Luz Matter» (también después de
// reiniciar el orquestador: el workflow ejecuta la prueba dos veces).
// Variables: ORCHESTRATOR_WS, HA_URL, SECRETS_DIR, E2E_TIMEOUT_S, LAB_TOKEN (si no, se lee de emulator/.env), E2E_PROFILES, MATTER_SERVER_URL.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { tsImport } from 'tsx/esm/api';
import { labProfiles, labToken } from './labEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const ORCH = env.ORCHESTRATOR_WS ?? 'ws://127.0.0.1:8081/orchestrator';
const MATTER_SERVER = env.MATTER_SERVER_URL ?? 'ws://127.0.0.1:5580/ws';
const HA = (env.HA_URL ?? 'http://127.0.0.1:8123').replace(/\/$/, '');
const TIMEOUT = Number(env.E2E_TIMEOUT_S ?? 180) * 1000;
const TOKEN_FILE = join(env.SECRETS_DIR ?? join(here, '..', '.secrets'), 'ha-token');
let token;
try {
  token = (await readFile(TOKEN_FILE, 'utf8')).trim();
} catch (err) {
  console.error(`[e2e] No se puede leer ${TOKEN_FILE} (${err.code ?? err.message}). setup.sh lo deja a nombre de tu usuario; si es de una instalación anterior: sudo chown "$(id -u):$(id -g)" ${TOKEN_FILE}`);
  process.exit(1);
}
const LAB_TOKEN = await labToken();
const PROFILES = await labProfiles();

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

/** Un comando por la API WebSocket de HA (registro de dispositivos, entidades...). */
function haWs(command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA.replace(/^http/, 'ws')}/api/websocket`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...command }));
      else if (msg.type === 'result') {
        ws.close();
        if (msg.success) resolve(msg.result);
        else reject(new Error(msg.error?.message));
      }
    });
    ws.on('error', reject);
  });
}

/** Un comando de la API WebSocket de matterjs-server (get_nodes...). */
function matterServerCall(command, args) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(MATTER_SERVER);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`matterjs-server no responde en ${MATTER_SERVER}`));
    }, 30_000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.message_id === undefined) ws.send(JSON.stringify({ message_id: 'e2e', command, args }));
      else if (msg.message_id === 'e2e') {
        clearTimeout(timer);
        ws.close();
        if ('error_code' in msg) reject(new Error(msg.details));
        else resolve(msg.result);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function entryIdsOf(domain) {
  const res = await fetch(`${HA}/api/config/config_entries/entry?domain=${domain}`, { headers: { authorization: `Bearer ${token}` } });
  const list = res.status === 200 ? await res.json() : [];
  return new Set(list.map((e) => e.entry_id));
}

/** Dispositivo de HA de una integración (por sus entradas) con ese nombre. */
async function haDeviceOf(domain, name) {
  const entries = await entryIdsOf(domain);
  const devices = await haWs({ type: 'config/device_registry/list' });
  return devices.find((d) => (d.name_by_user ?? d.name) === name && d.config_entries.some((id) => entries.has(id)));
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
// Ajustes del proyecto (sin enabled ni URL: son locales de la máquina, no del proyecto).
const settings = { discoveryPrefix: 'homeassistant', baseTopic: 'hasim', z2mBaseTopic: 'hasim-z2m', automationsRunIn: 'simulator' };
project.haBridge = settings;
const definitions = catalog.filter((d) => project.devices.some((x) => x.definitionId === d.id));
let sim = createSimulationState(project, catalog, Date.now());
const commands = [];
const statuses = [];
const ws = new WebSocket(ORCH);
const send = (msg) => ws.send(JSON.stringify({ v: 1, ...msg }));
let resolveHello;
let rejectHello;
const hello = new Promise((resolve, reject) => {
  resolveHello = resolve;
  rejectHello = reject;
});
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === 'hello') resolveHello(msg);
  else if (msg.type === 'status') statuses.push(msg);
  else if (msg.type === 'error' && msg.code === 'auth') rejectHello(new Error(msg.message));
  else if (msg.type === 'command') {
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
send({ type: 'hello', role: 'app', client: 'e2e', token: LAB_TOKEN });
const welcome = await Promise.race([hello, sleep(10_000).then(() => Promise.reject(new Error('El orquestador no responde al hello')))]).catch((err) => {
  console.error(`[e2e] FALLO: ${err.message}`);
  process.exit(1);
});
if (welcome.readOnly) {
  console.error('[e2e] FALLO: otra app controla el laboratorio (cierra la app del navegador)');
  process.exit(1);
}
log('Token aceptado: esta prueba controla el laboratorio');
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

  // 4. Vías reales de E2.
  const setEntity = (id, state) => {
    sim = { ...sim, entities: { ...sim.entities, [id]: { ...sim.entities[id], state } } };
    send({ type: 'state', entities: { [id]: sim.entities[id] } });
  };
  if (PROFILES.has('zwave') || PROFILES.has('esphome') || PROFILES.has('matter')) {
    const caps = await until('capacidades de las vías reales en status', async () => statuses.at(-1)?.capabilities, 30_000);
    if (PROFILES.has('zwave') && caps.zwave !== true) throw new Error('El orquestador no anuncia el perfil zwave');
    if (PROFILES.has('esphome') && caps.esphome !== true) throw new Error('El orquestador no anuncia el perfil esphome');
    if (PROFILES.has('matter') && caps.matter !== true) throw new Error('El orquestador no anuncia el perfil matter');
    log(`Perfiles activos: ${[...PROFILES].join(', ')}`);
  }
  if (PROFILES.has('zwave')) {
    const plug = 'switch.enchufe_despacho_switch';
    const dev = await until('«Enchufe despacho» con la integración zwave_js en el registro de dispositivos', () => haDeviceOf('zwave_js', 'Enchufe despacho'), Math.max(TIMEOUT, 300_000));
    log(`OK Z-Wave: dispositivo ${dev.id} (${dev.manufacturer ?? '?'} ${dev.model ?? ''}) en zwave_js`);
    const mqttDup = (await haWs({ type: 'config/device_registry/list' })).some((d) => d.identifiers.some(([dom, id]) => dom === 'mqtt' && String(id).includes('demo-enchufe-zwave')));
    if (mqttDup) throw new Error('El enchufe Z-Wave sigue también por MQTT');
    await until(`${plug} (alineado) en /api/states`, async () => {
      const st = await haState(plug);
      return st && st.state !== 'unavailable' && st.state !== 'unknown' ? st : undefined;
    }, 180_000);
    log(`OK ${plug}`);
    await haCall('switch', 'turn_on', { entity_id: plug });
    await until('comando switch.turn_on del enchufe Z-Wave en la app', async () => commands.find((c) => c.entityId === plug && c.service === 'switch.turn_on'), 60_000);
    log('OK comando de HA por Z-Wave JS recibido por la app');
    await until(`${plug} encendido en HA (informe del nodo)`, async () => (await haState(plug))?.state === 'on', 60_000);
    log('OK estado de vuelta por Z-Wave');
    // Nodo parado: el mock deja de responder y Z-Wave JS lo marca dead. HA (2025+) no pone las
    // entidades Z-Wave en «unavailable» por un nodo dead: lo indica su sensor «Estado del nodo».
    const nodeStatus = await until('sensor de estado del nodo Z-Wave', async () => {
      const entries = await haWs({ type: 'config/entity_registry/list' });
      return entries.find((e) => e.device_id === dev.id && String(e.unique_id).endsWith('.node_status'))?.entity_id;
    }, 60_000);
    send({ type: 'node', action: 'stop', deviceIds: ['demo-enchufe-zwave'] });
    await until(`${nodeStatus} = dead (nodo parado)`, async () => (await haState(nodeStatus))?.state === 'dead', 120_000);
    log(`OK nodo Z-Wave parado → ${nodeStatus} = dead`);
    send({ type: 'node', action: 'start', deviceIds: ['demo-enchufe-zwave'] });
    await until(`${nodeStatus} = alive (nodo arrancado)`, async () => (await haState(nodeStatus))?.state === 'alive', 180_000);
    log('OK nodo Z-Wave arrancado → alive');
  }
  if (PROFILES.has('esphome')) {
    const temp = 'sensor.sensor_despacho_temperature';
    const dev = await until('«Sensor despacho» con la integración esphome en el registro de dispositivos', () => haDeviceOf('esphome', 'Sensor despacho'), Math.max(TIMEOUT, 240_000));
    log(`OK ESPHome: dispositivo ${dev.id} (${dev.model ?? ''}) en esphome`);
    await until(`${temp} (alineado) en /api/states`, async () => {
      const st = await haState(temp);
      return st && st.state !== 'unavailable' ? st : undefined;
    }, 180_000);
    // La API nativa manda los sensores como float32 (como el firmware real): 23.4 llega como 23.3999…
    const near = (st, v) => st !== undefined && Math.abs(Number(st.state) - v) < 0.01;
    setEntity(temp, 23.4);
    await until(`${temp} = 23.4 en HA`, async () => near(await haState(temp), 23.4), 60_000);
    log('OK cambio del sensor ESPHome desde la app visto en HA');
    send({ type: 'node', action: 'stop', deviceIds: ['demo-esp32'] });
    await until(`${temp} no disponible (nodo parado)`, async () => (await haState(temp))?.state === 'unavailable', 90_000);
    log('OK nodo ESPHome parado → no disponible');
    send({ type: 'node', action: 'start', deviceIds: ['demo-esp32'] });
    await until(`${temp} disponible de nuevo`, async () => near(await haState(temp), 23.4), 180_000);
    log('OK nodo ESPHome arrancado (HA se vuelve a conectar)');
  }
  if (PROFILES.has('matter')) {
    const light = 'light.luz_matter';
    const plug = 'switch.enchufe_matter_switch';
    const dev = await until('«Luz Matter» con la integración matter en el registro de dispositivos', () => haDeviceOf('matter', 'Luz Matter'), Math.max(TIMEOUT, 300_000));
    log(`OK Matter: dispositivo ${dev.id} (${dev.manufacturer ?? '?'} ${dev.model ?? ''}) en matter`);
    // Un solo bridge en matterjs-server y una sola «Luz Matter» en HA (sin comisionados repetidos).
    const bridges = (await matterServerCall('get_nodes', { only_available: false })).filter((n) => String(n.attributes?.['0/40/18'] ?? '').startsWith('hasim-bridge-'));
    if (bridges.length !== 1) throw new Error(`matterjs-server tiene ${bridges.length} nodos del bridge (se esperaba 1)`);
    log(`OK un solo bridge en matterjs-server (nodo ${bridges[0].node_id}, disponible: ${bridges[0].available})`);
    const all = await haWs({ type: 'config/device_registry/list' });
    const twins = all.filter((d) => (d.name_by_user ?? d.name) === 'Luz Matter');
    if (twins.length !== 1) throw new Error(`HA tiene ${twins.length} dispositivos «Luz Matter» (se esperaba 1)`);
    if (all.some((d) => d.identifiers.some(([dom, id]) => dom === 'mqtt' && String(id).includes('demo-luz-matter')))) throw new Error('La luz Matter sigue también por MQTT');
    await until(`${light} (alineado) en /api/states`, async () => {
      const st = await haState(light);
      return st && st.state !== 'unavailable' && st.state !== 'unknown' ? st : undefined;
    }, 180_000);
    log(`OK ${light}`);
    // HA → app: light.turn_on con brillo (MoveToLevelWithOnOff) y vuelta del estado por Matter.
    const before = commands.length;
    await haCall('light', 'turn_on', { entity_id: light, brightness: 128 });
    await until('comando light.turn_on de la luz Matter en la app', async () => commands.slice(before).find((c) => c.entityId === light && c.service === 'light.turn_on'), 60_000);
    log('OK comando de HA por Matter recibido por la app');
    await until(`${light} encendida en HA (informe por la suscripción Matter)`, async () => {
      const st = await haState(light);
      return st?.state === 'on' && Math.abs(Number(st.attributes.brightness) - 128) <= 2 ? st : undefined;
    }, 60_000);
    log('OK estado de vuelta por Matter');
    // App → HA: el enchufe Matter se enciende en el simulador.
    await until(`${plug} en /api/states`, async () => (await haState(plug))?.state === 'off', 180_000);
    setEntity(plug, 'on');
    await until(`${plug} = on en HA`, async () => (await haState(plug))?.state === 'on', 60_000);
    log('OK cambio del enchufe Matter desde la app visto en HA');
    // Parar el dispositivo: el endpoint pasa a Reachable=false y HA lo pone no disponible.
    send({ type: 'node', action: 'stop', deviceIds: ['demo-luz-matter'] });
    await until(`${light} no disponible (Reachable=false)`, async () => (await haState(light))?.state === 'unavailable', 90_000);
    log('OK dispositivo Matter parado → no disponible');
    send({ type: 'node', action: 'start', deviceIds: ['demo-luz-matter'] });
    await until(`${light} disponible de nuevo`, async () => (await haState(light))?.state === 'on', 90_000);
    log('OK dispositivo Matter arrancado → disponible');
  }
  log('Todo correcto');
  ws.close();
  process.exit(0);
} catch (err) {
  console.error(`[e2e] FALLO: ${err.message}`);
  ws.close();
  process.exit(1);
}
