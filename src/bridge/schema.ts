// Validación de los campos de emulación del proyecto (haBridge, radioProfiles). La llama
// src/store/projectSchema.ts al final de parseProject. Lanza Error en español.
import { defaultRadioProfiles, type HaBridgeSettings, type Project, type Protocol, type RadioProfile } from '../types';

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`Proyecto no válido: ${path} ${msg}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'debe ser un objeto');
  return v as Obj;
}

const TOPIC_RE = /^[^#+\s]+$/;

function topicField(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !TOPIC_RE.test(v) || v.startsWith('/') || v.endsWith('/')) fail(`${path}.${key}`, 'debe ser un topic MQTT sin comodines ni espacios');
  return v;
}

export function parseHaBridge(v: unknown, path = 'haBridge'): HaBridgeSettings {
  const o = obj(v, path);
  if (typeof o.enabled !== 'boolean') fail(`${path}.enabled`, 'debe ser verdadero o falso');
  const url = o.orchestratorUrl;
  if (typeof url !== 'string' || !/^wss?:\/\/\S+$/.test(url)) fail(`${path}.orchestratorUrl`, 'debe ser una URL ws:// o wss://');
  const run = o.automationsRunIn;
  if (run !== 'home_assistant' && run !== 'simulator') fail(`${path}.automationsRunIn`, 'debe ser home_assistant o simulator');
  // Los secretos nunca van en el proyecto: se rechazan si alguien los mete a mano.
  for (const k of ['password', 'token', 'mqttPassword', 'haToken']) if (k in o) fail(`${path}.${k}`, 'no se admite: los secretos no se guardan en el proyecto');
  return {
    enabled: o.enabled,
    orchestratorUrl: url,
    discoveryPrefix: topicField(o, 'discoveryPrefix', path),
    baseTopic: topicField(o, 'baseTopic', path),
    z2mBaseTopic: topicField(o, 'z2mBaseTopic', path),
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
