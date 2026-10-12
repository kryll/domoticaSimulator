#!/usr/bin/env node
// Onboarding automático del Home Assistant del laboratorio (por su API, sin navegador):
//   1. crea el usuario (POST /api/onboarding/users) o inicia sesión si ya existe,
//   2. obtiene un token (POST /auth/token) y completa core_config, analytics e integration,
//   3. crea un token de larga duración y lo guarda en SECRETS_DIR/ha-token (emulator/.secrets/),
//   4. ajusta idioma, país, moneda y zona horaria,
//   5. crea la entrada MQTT (POST /api/config/config_entries/flow) contra el Mosquitto del lab.
// Variables: HA_URL, HA_USERNAME, HA_PASSWORD, MQTT_HA_PASSWORD, MQTT_HOST, MQTT_PORT, SECRETS_DIR, TZ.
// Credenciales por defecto (cámbialas en emulator/.env): hasim / hasim-cambiame.
// Z-Wave JS y Matter se añaden en E2.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function waitForHa(timeoutMs = 600_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await http('GET', '/api/onboarding');
      if (r.status === 200) return r.data;
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

// Rellena el formulario del flujo de MQTT a partir del esquema que devuelve HA. Las versiones
// recientes agrupan campos en secciones (tipo «expandable», p. ej. «other_settings») que son
// obligatorias como objeto aunque vayan vacías.
const MQTT_VALUES = { broker: MQTT_HOST, port: MQTT_PORT, username: 'homeassistant', password: MQTT_PASSWORD };

function fillMqttForm(schema) {
  const values = {};
  for (const field of Array.isArray(schema) ? schema : []) {
    if (field.type === 'expandable') values[field.name] = fillMqttForm(field.schema);
    else if (field.name in MQTT_VALUES) values[field.name] = MQTT_VALUES[field.name];
    // Campos obligatorios que no conocemos (p. ej. set_ca_cert, set_client_cert): su valor por defecto.
    else if ('default' in field) values[field.name] = field.default;
    else if (field.required && (field.type === 'boolean' || field.selector?.boolean)) values[field.name] = false;
    else if (field.required && field.selector?.select?.options?.length) {
      const first = field.selector.select.options[0];
      values[field.name] = typeof first === 'object' ? first.value : first;
    }
  }
  if (!Array.isArray(schema) || schema.length === 0) return { ...MQTT_VALUES };
  return values;
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
  let step = (await http('POST', '/api/config/config_entries/flow', { token, json: { handler: 'mqtt', show_advanced_options: false } })).data;
  for (let i = 0; i < 6 && step; i++) {
    if (step.type === 'create_entry') {
      log('Integración MQTT creada');
      return;
    }
    if (step.type === 'abort') {
      if (['single_instance_allowed', 'already_configured'].includes(step.reason)) return;
      throw new Error(`El flujo de MQTT se canceló: ${step.reason}`);
    }
    let input;
    if (step.type === 'menu') input = { next_step_id: step.menu_options.includes('broker') ? 'broker' : step.menu_options[0] };
    else if (step.type === 'form') {
      if (step.errors && Object.keys(step.errors).length > 0) throw new Error(`MQTT: ${JSON.stringify(step.errors)}`);
      input = fillMqttForm(step.data_schema);
    } else throw new Error(`Paso inesperado del flujo de MQTT: ${JSON.stringify(step)}`);
    step = (await http('POST', `/api/config/config_entries/flow/${step.flow_id}`, { token, json: input })).data;
  }
  throw new Error('No se pudo completar el flujo de MQTT');
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
  await wsCall(token, { type: 'config/core/update', country: 'ES', language: 'es', currency: 'EUR', unit_system: 'metric', time_zone: env.TZ ?? 'Europe/Madrid' }).catch((e) =>
    log(`Aviso: no se pudo ajustar la configuración regional (${e.message})`),
  );
  await ensureMqtt(token);
  log('Listo');
}

main().catch((err) => {
  console.error(`[onboarding] ERROR: ${err.message}`);
  process.exit(1);
});
