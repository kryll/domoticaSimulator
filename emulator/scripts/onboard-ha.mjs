#!/usr/bin/env node
// Onboarding automático del Home Assistant del laboratorio (por su API, sin navegador):
//   1. crea el usuario (POST /api/onboarding/users) o inicia sesión si ya existe,
//   2. obtiene un token (POST /auth/token) y completa core_config, analytics e integration,
//   3. crea un token de larga duración y lo guarda en SECRETS_DIR/ha-token (emulator/.secrets/),
//   4. ajusta idioma, país, moneda y zona horaria,
//   5. crea la entrada MQTT (POST /api/config/config_entries/flow) contra el Mosquitto del lab,
//   6. con el perfil zwave, la entrada Z-Wave JS (ws://127.0.0.1:3000, el servidor de Z-Wave JS UI).
// Los nodos ESPHome (cada uno con su puerto y su clave) y los Shelly emulados (host y puerto) los da
// de alta el orquestador cuando la app manda el proyecto.
// Variables: HA_URL, HA_USERNAME, HA_PASSWORD, MQTT_HA_PASSWORD, MQTT_HOST, MQTT_PORT, SECRETS_DIR, TZ,
// HOST_UID y HOST_GID (setup.sh: los secretos quedan a nombre del usuario del PC, modo 0600),
// HASIM_PROFILES (perfiles activos) y ZWAVE_JS_URL.
// Credenciales por defecto (cámbialas en emulator/.env): hasim / hasim-cambiame.
import { chmod, chown, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const HA = (env.HA_URL ?? 'http://127.0.0.1:8123').replace(/\/$/, '');
const CLIENT_ID = `${HA}/`;
const USERNAME = env.HA_USERNAME ?? 'hasim';
const PASSWORD = env.HA_PASSWORD ?? 'hasim-cambiame';
const SECRETS = env.SECRETS_DIR ?? join(here, '..', '.secrets');
const TOKEN_FILE = join(SECRETS, 'ha-token');
const MQTT_HOST = env.MQTT_HOST ?? '127.0.0.1';
const MQTT_PORT = Number(env.MQTT_PORT ?? 1883);
const MQTT_PASSWORD = env.MQTT_HA_PASSWORD;
const PROFILES = new Set((env.HASIM_PROFILES ?? env.COMPOSE_PROFILES ?? '').split(',').map((p) => p.trim()).filter(Boolean));
const ZWAVE_JS_URL = env.ZWAVE_JS_URL ?? 'ws://127.0.0.1:3000';

// Formularios robustos de los flujos de HA (compartidos con el orquestador y probados con vitest).
const { runConfigFlow, flowOk } = await tsImport('../orchestrator/src/haNative.ts', import.meta.url);

const log = (msg) => console.log(`[onboarding] ${msg}`);

async function http(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(`${HA}${path}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Pasos del onboarding cuando ya está terminado (HA ya configurado al volver a lanzar setup.sh). */
const ONBOARDED = ['user', 'core_config', 'analytics', 'integration'].map((step) => ({ step, done: true }));

async function waitForHa(timeoutMs = 600_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await http('GET', '/api/onboarding');
      if (r.status === 200) return r.data;
      // Con el onboarding ya hecho, HA deja de servir /api/onboarding (404): está en marcha.
      if (r.status === 404) return ONBOARDED;
    } catch {
      // todavía arrancando
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Home Assistant no responde en ${HA}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function tokenFromCode(code) {
  const r = await http('POST', '/auth/token', { form: { grant_type: 'authorization_code', code, client_id: CLIENT_ID } });
  if (r.status !== 200) throw new Error(`No se pudo obtener el token (${r.status}): ${JSON.stringify(r.data)}`);
  return r.data.access_token;
}

async function login() {
  const flow = await http('POST', '/auth/login_flow', { json: { client_id: CLIENT_ID, handler: ['homeassistant', null], redirect_uri: CLIENT_ID } });
  if (flow.status !== 200) throw new Error(`No se pudo iniciar sesión (${flow.status})`);
  const step = await http('POST', `/auth/login_flow/${flow.data.flow_id}`, { json: { client_id: CLIENT_ID, username: USERNAME, password: PASSWORD } });
  if (step.data?.type !== 'create_entry') throw new Error('Usuario o contraseña de HA incorrectos (revisa HA_USERNAME y HA_PASSWORD en emulator/.env)');
  return tokenFromCode(step.data.result);
}

function wsCall(token, command) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA.replace(/^http/, 'ws')}/api/websocket`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Sin respuesta por WebSocket'));
    }, 30_000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_invalid') {
        clearTimeout(timer);
        ws.close();
        reject(new Error('Token no válido'));
      } else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...command }));
      else if (msg.type === 'result' && msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.success) resolve(msg.result);
        else reject(new Error(msg.error?.message ?? 'error'));
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Error de WebSocket'));
    };
  });
}

// Valores del flujo de MQTT. Las versiones recientes de HA agrupan campos en secciones (tipo
// «expandable», p. ej. «other_settings») que son obligatorias como objeto aunque vayan vacías:
// fillForm las rellena (ver orchestrator/src/haNative.ts).
const MQTT_VALUES = { broker: MQTT_HOST, port: MQTT_PORT, username: 'homeassistant', password: MQTT_PASSWORD };

/** API mínima de HA para runConfigFlow (REST con el token). */
function haApiFor(token) {
  return {
    rest: async (method, path, json) => http(method, path, { token, ...(json !== undefined ? { json } : {}) }),
    ws: (command) => wsCall(token, command),
  };
}

async function existingToken() {
  try {
    const token = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (!token) return undefined;
    const r = await http('GET', '/api/', { token });
    return r.status === 200 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function ensureMqtt(token) {
  const entries = await http('GET', '/api/config/config_entries/entry?domain=mqtt', { token });
  if (Array.isArray(entries.data) && entries.data.length > 0) {
    log('La integración MQTT ya existe');
    return;
  }
  if (!MQTT_PASSWORD) throw new Error('Falta MQTT_HA_PASSWORD (está en emulator/.env)');
  const out = await runConfigFlow(haApiFor(token), 'mqtt', MQTT_VALUES, (options) => (options.includes('broker') ? 'broker' : options[0]));
  if (!flowOk(out)) throw new Error(`No se pudo completar el flujo de MQTT: ${out.result === 'error' ? out.message : out.reason}`);
  log(out.result === 'created' ? 'Integración MQTT creada' : 'La integración MQTT ya existe');
}

/** ¿Responde el servidor de Z-Wave JS (Z-Wave JS UI) con su mensaje «version»? */
function zwaveServerUp(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ya cerrado
      }
      resolve(ok);
    };
    const ws = new WebSocket(ZWAVE_JS_URL);
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.onmessage = (ev) => {
      try {
        finish(JSON.parse(String(ev.data)).type === 'version');
      } catch {
        finish(false);
      }
    };
    ws.onerror = () => finish(false);
  });
}

/** Perfil zwave: entrada Z-Wave JS en HA contra el servidor de Z-Wave JS UI (espera a que arranque). */
async function ensureZwave(token, timeoutMs = 300_000) {
  const entries = await http('GET', '/api/config/config_entries/entry?domain=zwave_js', { token });
  if (Array.isArray(entries.data) && entries.data.length > 0) {
    log('La integración Z-Wave JS ya existe');
    return;
  }
  log(`Esperando al servidor de Z-Wave JS UI en ${ZWAVE_JS_URL} (la primera vez tarda un poco)`);
  const start = Date.now();
  while (!(await zwaveServerUp())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Z-Wave JS UI no responde en ${ZWAVE_JS_URL} (mira: docker compose logs zwave-js-ui zwave-mock)`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  let last;
  for (let i = 0; i < 10; i++) {
    // El formulario del flujo cambia entre versiones (paso «manual» con «url»; en HA OS hay un menú
    // antes): se rellena por el esquema y se elige la opción manual si aparece un menú.
    last = await runConfigFlow(haApiFor(token), 'zwave_js', { url: ZWAVE_JS_URL, use_addon: false }, (options) => options.find((o) => o.includes('manual')) ?? options.find((o) => o.includes('custom')) ?? options[0]);
    if (flowOk(last)) {
      log(last.result === 'created' ? `Integración Z-Wave JS creada (${ZWAVE_JS_URL})` : 'La integración Z-Wave JS ya existe');
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`No se pudo añadir Z-Wave JS a HA: ${last?.result === 'error' ? last.message : last?.reason}`);
}

/**
 * El onboarding corre como root dentro del contenedor del orquestador: el token quedaría a nombre
 * de root y el usuario del PC (o el del runner de CI) no podría leerlo. Con HOST_UID/HOST_GID se
 * deja a su nombre (carpeta 0700, archivo 0600). El orquestador, como root, lo sigue leyendo.
 */
async function fixOwnership() {
  const uid = Number(env.HOST_UID);
  const gid = Number(env.HOST_GID);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || env.HOST_UID === undefined || env.HOST_GID === undefined) return;
  for (const [path, mode] of [
    [SECRETS, 0o700],
    [TOKEN_FILE, 0o600],
  ]) {
    try {
      await chown(path, uid, gid);
      await chmod(path, mode);
    } catch (err) {
      if (err.code !== 'ENOENT') log(`Aviso: no se pudo ajustar el propietario de ${path} (${err.message})`);
    }
  }
}

async function main() {
  log(`Esperando a Home Assistant en ${HA}`);
  const steps = await waitForHa();
  const done = (name) => Array.isArray(steps) && steps.some((s) => s.step === name && s.done);
  let token = await existingToken();
  let access;
  if (!done('user')) {
    log(`Creando el usuario «${USERNAME}»`);
    const r = await http('POST', '/api/onboarding/users', { json: { client_id: CLIENT_ID, name: 'Laboratorio', username: USERNAME, password: PASSWORD, language: 'es' } });
    if (r.status !== 200) throw new Error(`No se pudo crear el usuario (${r.status}): ${JSON.stringify(r.data)}`);
    access = await tokenFromCode(r.data.auth_code);
  } else if (!token) {
    access = await login();
  }
  access ??= token;
  for (const [name, path, json] of [
    ['core_config', '/api/onboarding/core_config', {}],
    ['analytics', '/api/onboarding/analytics', {}],
    ['integration', '/api/onboarding/integration', { client_id: CLIENT_ID, redirect_uri: CLIENT_ID }],
  ]) {
    if (done(name)) continue;
    const r = await http('POST', path, { token: access, json });
    if (r.status !== 200 && r.status !== 403) log(`Aviso: ${name} respondió ${r.status}`);
  }
  if (!token) {
    token = await wsCall(access, { type: 'auth/long_lived_access_token', client_name: 'hasim-lab', lifespan: 3650 });
    await mkdir(SECRETS, { recursive: true, mode: 0o700 });
    await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
    log(`Token de larga duración guardado en ${TOKEN_FILE}`);
  }
  await fixOwnership();
  await wsCall(token, { type: 'config/core/update', country: 'ES', language: 'es', currency: 'EUR', unit_system: 'metric', time_zone: env.TZ ?? 'Europe/Madrid' }).catch((e) =>
    log(`Aviso: no se pudo ajustar la configuración regional (${e.message})`),
  );
  await ensureMqtt(token);
  if (PROFILES.has('zwave')) await ensureZwave(token);
  if (PROFILES.has('esphome')) log('Perfil esphome: el orquestador añadirá cada nodo ESPHome a HA cuando la app mande el proyecto');
  if (PROFILES.has('shelly')) log('Perfil shelly: el orquestador añadirá cada Shelly emulado a HA (integración shelly) cuando la app mande el proyecto');
  log('Listo');
}

main().catch((err) => {
  console.error(`[onboarding] ERROR: ${err.message}`);
  process.exit(1);
});
