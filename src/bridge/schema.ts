// Validación de los campos de emulación del proyecto (haBridge, radioProfiles). La llama
// src/store/projectSchema.ts al final de parseProject. Lanza Error en español.
import { defaultHaBridgeSettings, defaultRadioProfiles, type HaBridgeSettings, type Project, type Protocol, type RadioProfile } from '../types';

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`Proyecto no válido: ${path} ${msg}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'debe ser un objeto');
  return v as Obj;
}

const TOPIC_RE = /^[^#+\s]+$/;

/**
 * Error de un topic base MQTT, o undefined si es válido. La misma regla en la interfaz
 * (Ajustes → Laboratorio) y al validar el proyecto: sin comodines (# +), sin espacios, sin barra
 * al principio ni al final y sin niveles vacíos.
 */
export function topicError(v: unknown): string | undefined {
  if (typeof v !== 'string' || v === '') return 'no puede estar vacío';
  if (!TOPIC_RE.test(v)) return 'no admite comodines (# +) ni espacios';
  if (v.startsWith('/') || v.endsWith('/')) return 'no puede empezar ni terminar por «/»';
  if (v.includes('//')) return 'no puede tener niveles vacíos («//»)';
  return undefined;
}

function topicField(o: Obj, key: string, path: string): string {
  const v = o[key];
  const err = topicError(v);
  if (err !== undefined) fail(`${path}.${key}`, `debe ser un topic MQTT válido: ${err}`);
  return v as string;
}

/**
 * Ajustes del puente del proyecto. Los proyectos antiguos traían `enabled` y `orchestratorUrl`:
 * se ignoran (ahora son ajustes locales de la máquina, src/bridge/localLab.ts), para que un enlace
 * compartido o un JSON importado nunca conecte solo con el orquestador que lleve dentro.
 */
export function parseHaBridge(v: unknown, path = 'haBridge'): HaBridgeSettings {
  const o = obj(v, path);
  const def = defaultHaBridgeSettings();
  const run = o.automationsRunIn ?? def.automationsRunIn;
  if (run !== 'home_assistant' && run !== 'simulator') fail(`${path}.automationsRunIn`, 'debe ser home_assistant o simulator');
  // Los secretos nunca van en el proyecto: se rechazan si alguien los mete a mano.
  for (const k of ['password', 'token', 'mqttPassword', 'haToken', 'labToken']) if (k in o) fail(`${path}.${k}`, 'no se admite: los secretos no se guardan en el proyecto');
  const withDefaults: Obj = { ...def, ...o };
  return {
    discoveryPrefix: topicField(withDefaults, 'discoveryPrefix', path),
    baseTopic: topicField(withDefaults, 'baseTopic', path),
    z2mBaseTopic: topicField(withDefaults, 'z2mBaseTopic', path),
    automationsRunIn: run,
  };
}

const NUMERIC_KEYS = [
  'latencyMs',
  'retryLatencyMs',
  'lossPct',
  'maxHops',
  'longRangeMaxHops',
  'maxChildrenCoordinator',
  'maxChildrenRouter',
  'maxChildrenPerParent',
  'channel',
  'channelMin',
  'channelMax',
  'frequencyMhz',
] as const;

export function parseRadioProfiles(v: unknown, path = 'radioProfiles'): Partial<Record<Protocol, Partial<RadioProfile>>> {
  const o = obj(v, path);
  const known = defaultRadioProfiles();
  const out: Partial<Record<Protocol, Partial<RadioProfile>>> = {};
  for (const [protocol, raw] of Object.entries(o)) {
    if (!(protocol in known)) fail(`${path}.${protocol}`, 'no es un protocolo conocido');
    const p = obj(raw, `${path}.${protocol}`);
    const profile: Partial<RadioProfile> = {};
    for (const key of NUMERIC_KEYS) {
      const n = p[key];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) fail(`${path}.${protocol}.${key}`, 'debe ser un número no negativo');
      profile[key] = n;
    }
    if (profile.lossPct !== undefined && profile.lossPct > 100) fail(`${path}.${protocol}.lossPct`, 'debe estar entre 0 y 100');
    if (p.noAck !== undefined) {
      if (typeof p.noAck !== 'boolean') fail(`${path}.${protocol}.noAck`, 'debe ser verdadero o falso');
      profile.noAck = p.noAck;
    }
    if (p.availability !== undefined) {
      const a = obj(p.availability, `${path}.${protocol}.availability`);
      const availability: RadioProfile['availability'] = {};
      for (const [k, val] of Object.entries(a)) {
        if (k === 'never') {
          if (typeof val !== 'boolean') fail(`${path}.${protocol}.availability.never`, 'debe ser verdadero o falso');
          availability.never = val;
        } else if (['activeSeconds', 'batterySeconds', 'childTimeoutSeconds', 'subscriptionSeconds', 'deadAfterFailures', 'wakeUpSeconds', 'pingSeconds', 'noAdvertSeconds'].includes(k)) {
          if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) fail(`${path}.${protocol}.availability.${k}`, 'debe ser un número no negativo');
          (availability as Record<string, number>)[k] = val;
        } else fail(`${path}.${protocol}.availability.${k}`, 'no es un campo conocido');
      }
      profile.availability = availability;
    }
    out[protocol as Protocol] = profile;
  }
  return out;
}

/** Copia en `project` los campos de emulación de `o` (el JSON importado), validados. */
export function parseEmulationFields(o: Obj, project: Project): void {
  if (o.haBridge !== undefined) project.haBridge = parseHaBridge(o.haBridge);
  if (o.radioProfiles !== undefined) project.radioProfiles = parseRadioProfiles(o.radioProfiles);
}

/**
 * Ajustes del puente del proyecto con los valores por defecto rellenos y solo los campos que
 * viajan con el proyecto (un `haBridge` antiguo con `enabled`/`orchestratorUrl` se limpia).
 * Única copia: la usan la app, el orquestador y los tests.
 */
export function bridgeSettings(project: Pick<Project, 'haBridge'>): HaBridgeSettings {
  const raw: unknown = project.haBridge;
  const o: Obj = typeof raw === 'object' && raw !== null ? (raw as Obj) : {};
  const def = defaultHaBridgeSettings();
  const pick = (k: 'discoveryPrefix' | 'baseTopic' | 'z2mBaseTopic'): string => (topicError(o[k]) === undefined ? (o[k] as string) : def[k]);
  const run = o.automationsRunIn === 'simulator' || o.automationsRunIn === 'home_assistant' ? o.automationsRunIn : def.automationsRunIn;
  return { discoveryPrefix: pick('discoveryPrefix'), baseTopic: pick('baseTopic'), z2mBaseTopic: pick('z2mBaseTopic'), automationsRunIn: run };
}

/**
 * El proyecto sin los ajustes locales del laboratorio (activado, URL del orquestador, token) que
 * pudieran quedar en `haBridge` de versiones antiguas. Lo usan el enlace compartido y la
 * exportación a JSON: en el proyecto solo viajan los topics y `automationsRunIn`.
 */
export function withoutLocalLabFields(project: Project): Project {
  if (project.haBridge === undefined) return project;
  return { ...project, haBridge: bridgeSettings(project) };
}
