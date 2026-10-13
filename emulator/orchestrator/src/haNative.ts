// Home Assistant del laboratorio para las vías reales: flujos de configuración robustos (los
// formularios cambian entre versiones de HA), entradas de la integración `esphome` por nodo y
// alineación de entity_id (las entidades que crean zwave_js, esphome y matter reciben el entity_id
// del simulador, así las automatizaciones exportadas siguen funcionando).
import { haWsCall } from './haSync';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface HaApi {
  rest(method: 'GET' | 'POST' | 'DELETE', path: string, json?: unknown): Promise<{ status: number; data: unknown }>;
  ws(command: Json): Promise<unknown>;
}

export function haApi(haUrl: string, token: () => Promise<string | undefined>): HaApi {
  const base = haUrl.replace(/\/$/, '');
  const need = async (): Promise<string> => {
    const t = await token();
    if (!t) throw new Error('Sin token de Home Assistant (emulator/.secrets/ha-token): ejecuta setup.sh');
    return t;
  };
  return {
    rest: async (method, path, json) => {
      const t = await need();
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${t}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = text ? (JSON.parse(text) as unknown) : undefined;
      } catch {
        // texto plano
      }
      return { status: res.status, data };
    },
    ws: async (command) => haWsCall(base, await need(), command),
  };
}

// ---------- Formularios de los flujos ----------

/**
 * Rellena un formulario de un flujo de HA a partir de su esquema (data_schema): los campos que
 * conocemos con su valor, las secciones plegables («expandable») como objeto, y el resto con su
 * valor por defecto (o false / la primera opción si son obligatorios). Sin esquema: los valores.
 */
export function fillForm(schema: unknown, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!Array.isArray(schema) || schema.length === 0) return { ...values };
  const out: Record<string, unknown> = {};
  for (const raw of schema) {
    if (!isObj(raw) || typeof raw.name !== 'string') continue;
    const name = raw.name;
    const selector = isObj(raw.selector) ? raw.selector : {};
    if (raw.type === 'expandable') out[name] = fillForm(raw.schema, values);
    else if (name in values) out[name] = values[name];
    else if ('default' in raw) out[name] = raw.default;
    else if (raw.required === true && (raw.type === 'boolean' || 'boolean' in selector)) out[name] = false;
    else if (raw.required === true && isObj(selector.select) && Array.isArray(selector.select.options) && selector.select.options.length > 0) {
      const first: unknown = selector.select.options[0];
      out[name] = isObj(first) ? first.value : first;
    }
  }
  return out;
}

export type FlowOutcome =
  | { result: 'created'; entryId?: string; title?: string }
  | { result: 'aborted'; reason: string }
  | { result: 'error'; message: string };

const OK_ABORTS = new Set(['already_configured', 'single_instance_allowed', 'already_in_progress']);

/**
 * ¿El flujo terminó bien (creado o ya existía)? HA usa variantes del motivo «ya configurado»
 * (p. ej. already_configured_updates cuando actualiza el host o la clave de una entrada existente).
 */
export function flowOk(o: FlowOutcome): boolean {
  return o.result === 'created' || (o.result === 'aborted' && (OK_ABORTS.has(o.reason) || o.reason.startsWith('already_configured')));
}

/**
 * Ejecuta un flujo de configuración por la API REST de HA con los valores dados. Los menús se
 * resuelven con `pickMenu` (por defecto, la opción que contiene «manual» o la primera).
 */
export async function runConfigFlow(api: HaApi, handler: string, values: Readonly<Record<string, unknown>>, pickMenu?: (options: string[]) => string, maxSteps = 8): Promise<FlowOutcome> {
  const start = await api.rest('POST', '/api/config/config_entries/flow', { handler, show_advanced_options: false });
  let step: unknown = start.data;
  if (start.status >= 400) return { result: 'error', message: `HA respondió ${start.status} al iniciar el flujo de ${handler}: ${JSON.stringify(start.data)}` };
  for (let i = 0; i < maxSteps && isObj(step); i++) {
    const flowId = typeof step.flow_id === 'string' ? step.flow_id : '';
    if (step.type === 'create_entry') {
      const result = isObj(step.result) ? step.result : {};
      return { result: 'created', ...(typeof result.entry_id === 'string' ? { entryId: result.entry_id } : {}), ...(typeof step.title === 'string' ? { title: step.title } : {}) };
    }
    if (step.type === 'abort') return { result: 'aborted', reason: String(step.reason ?? 'desconocido') };
    let input: unknown;
    if (step.type === 'menu') {
      const options = Array.isArray(step.menu_options) ? step.menu_options.map(String) : isObj(step.menu_options) ? Object.keys(step.menu_options) : [];
      const chosen = pickMenu?.(options) ?? options.find((o) => o.includes('manual')) ?? options[0];
      if (!chosen) return { result: 'error', message: `Menú sin opciones en el flujo de ${handler}` };
      input = { next_step_id: chosen };
    } else if (step.type === 'form') {
      if (isObj(step.errors) && Object.keys(step.errors).length > 0 && i > 0) {
        await api.rest('DELETE', `/api/config/config_entries/flow/${flowId}`);
        return { result: 'error', message: `${handler} (${String(step.step_id)}): ${JSON.stringify(step.errors)}` };
      }
      input = fillForm(step.data_schema, values);
    } else if (step.type === 'progress' || step.type === 'external') {
      await new Promise((r) => setTimeout(r, 2000));
      input = undefined;
    } else return { result: 'error', message: `Paso inesperado del flujo de ${handler}: ${JSON.stringify(step)}` };
    const next = await api.rest('POST', `/api/config/config_entries/flow/${flowId}`, input);
    step = next.data;
  }
  return { result: 'error', message: `El flujo de ${handler} no terminó` };
}

// ---------- ESPHome: una entrada por nodo ----------

export interface EsphomeNodeEntry {
  mac: string;
  name: string;
  host: string;
  port: number;
  psk?: string;
}

const normMac = (mac: string): string => mac.toLowerCase().replace(/[^0-9a-f]/g, '');

interface RegistryDevice {
  id: string;
  config_entries: string[];
  connections: Array<[string, string]>;
  identifiers: Array<[string, string]>;
  name?: string | null;
  name_by_user?: string | null;
}

export async function listDevices(api: HaApi): Promise<RegistryDevice[]> {
  const res = await api.ws({ type: 'config/device_registry/list' });
  return Array.isArray(res) ? (res.filter(isObj) as unknown as RegistryDevice[]) : [];
}

/** Ids de las entradas de una integración. */
export async function entryIds(api: HaApi, domain: string): Promise<Set<string>> {
  const res = await api.rest('GET', `/api/config/config_entries/entry?domain=${encodeURIComponent(domain)}`);
  const list = Array.isArray(res.data) ? res.data : [];
  return new Set(list.filter(isObj).map((e) => String(e.entry_id)));
}

/** Añade el nodo a HA con la integración esphome (host, puerto y clave). Idempotente. */
export async function ensureEsphomeEntry(api: HaApi, node: EsphomeNodeEntry): Promise<FlowOutcome> {
  return runConfigFlow(api, 'esphome', { host: node.host, port: node.port, noise_psk: node.psk ?? '', password: '' });
}

/** Borra de HA la entrada esphome del nodo con esa MAC (si existe). */
export async function removeEsphomeEntry(api: HaApi, mac: string): Promise<boolean> {
  return removeEntriesByMac(api, 'esphome', mac);
}

/** Borra las entradas de una integración cuyo dispositivo tiene esa MAC. */
export async function removeEntriesByMac(api: HaApi, domain: string, mac: string): Promise<boolean> {
  const entries = await entryIds(api, domain);
  const target = normMac(mac);
  let removed = false;
  for (const d of await listDevices(api)) {
    if (!d.connections.some(([kind, value]) => kind === 'mac' && normMac(value) === target)) continue;
    for (const id of d.config_entries) {
      if (!entries.has(id)) continue;
      await api.rest('DELETE', `/api/config/config_entries/entry/${id}`);
      entries.delete(id);
      removed = true;
    }
  }
  return removed;
}

// ---------- Shelly: una entrada por Shelly emulado ----------

/**
 * Añade el Shelly a HA con la integración shelly (paso manual: host y puerto; «manual» si HA ofrece
 * antes una lista de Shellys descubiertos en la red). Idempotente: el unique_id es su MAC.
 */
export async function ensureShellyEntry(api: HaApi, node: { host: string; port: number }): Promise<FlowOutcome> {
  return runConfigFlow(api, 'shelly', { device: 'manual', host: node.host, port: node.port, verify_ssl: false });
}

/** Borra de HA la entrada shelly del Shelly con esa MAC (si existe). */
export async function removeShellyEntry(api: HaApi, mac: string): Promise<boolean> {
  return removeEntriesByMac(api, 'shelly', mac);
}

/** unique_id de una entidad de la integración shelly: «<MAC>-<componente>[-<atributo>]». */
export function shellyUniqueIdMatcher(mac: string, suffix: string): (uid: string) => boolean {
  const want = `${normMac(mac)}-${suffix}`.toLowerCase();
  return (uid) => {
    const dash = uid.indexOf('-');
    return dash > 0 && `${normMac(uid.slice(0, dash))}${uid.slice(dash)}`.toLowerCase() === want;
  };
}

// ---------- Alineación de entity_id ----------

export interface AlignTarget {
  platform: 'zwave_js' | 'esphome' | 'shelly' | 'matter';
  /** entity_id deseado (el del simulador). */
  entityId: string;
  match: (uniqueId: string) => boolean;
}

interface RegistryEntity {
  entity_id: string;
  unique_id?: string;
  platform: string;
}

/** Normaliza una MAC para comparar unique_id de ESPHome («aa:bb…», «AABB…»). */
export function esphomeUniqueIdMatcher(mac: string, kind: string, objectId: string, name: string): (uid: string) => boolean {
  const m = normMac(mac);
  const type = kind === 'text' ? 'text_info' : kind;
  return (uid) => {
    const slash = uid.split('/');
    if (slash.length === 4) return normMac(slash[0] ?? '') === m && slash[1] === '0' && slash[2] === type && slash[3] === name;
    const dash = uid.indexOf('-');
    return dash > 0 && normMac(uid.slice(0, dash)) === m && uid.slice(dash + 1) === `${type}-${objectId}`;
  };
}

/**
 * Value ID de Z-Wave JS en el unique_id de HA: «<homeId>.<nodo>-<cc>-<endpoint>-<propiedad>[-<clave>][.<estado>]».
 */
export function zwaveUniqueIdMatcher(homeId: number, nodeId: number, cc: number, property: string, propertyKey?: string | number): (uid: string) => boolean {
  const prefix = `${homeId}.${nodeId}-${cc}-0-${property}`;
  return (uid) => {
    if (!uid.startsWith(prefix)) return false;
    const rest = uid.slice(prefix.length);
    if (propertyKey === undefined) return rest === '' || rest.startsWith('.');
    return rest === `-${propertyKey}` || rest.startsWith(`-${propertyKey}.`);
  };
}

/**
 * unique_id de una entidad de la integración matter de HA:
 * «<fabric comprimida (16 hex)>-<nodo (16 hex)>-<endpoint bridged>-<endpoint>-<clave>-<cluster>-<atributo>»
 * (helpers.get_device_id + entity.py de HA). En el bridge, el endpoint del dispositivo es el bridged.
 */
export function matterUniqueIdMatcher(nodeId: number, endpoint: number, clusterId: number, attributeId: number): (uid: string) => boolean {
  const node = nodeId.toString(16).toUpperCase().padStart(16, '0');
  const re = new RegExp(`^[0-9A-F]{16}-${node}-${endpoint}-${endpoint}-[^-]+-${clusterId}-${attributeId}$`);
  return (uid) => re.test(uid);
}

/**
 * Renombra las entidades de las vías reales al entity_id del simulador. Devuelve los renombrados y
 * cuántas faltan (todavía sin crear en HA).
 */
export async function alignEntities(api: HaApi, targets: readonly AlignTarget[]): Promise<{ renamed: string[]; missing: number; conflicts: string[] }> {
  if (targets.length === 0) return { renamed: [], missing: 0, conflicts: [] };
  const res = await api.ws({ type: 'config/entity_registry/list' });
  const entries = (Array.isArray(res) ? res.filter(isObj) : []) as unknown as RegistryEntity[];
  const taken = new Set(entries.map((e) => e.entity_id));
  const renamed: string[] = [];
  const conflicts: string[] = [];
  let missing = 0;
  for (const t of targets) {
    const domain = t.entityId.slice(0, t.entityId.indexOf('.'));
    const found = entries.find((e) => e.platform === t.platform && typeof e.unique_id === 'string' && e.entity_id.startsWith(`${domain}.`) && t.match(e.unique_id));
    if (!found) {
      missing += 1;
      continue;
    }
    if (found.entity_id === t.entityId) continue;
    if (taken.has(t.entityId)) {
      conflicts.push(t.entityId);
      continue;
    }
    await api.ws({ type: 'config/entity_registry/update', entity_id: found.entity_id, new_entity_id: t.entityId });
    taken.delete(found.entity_id);
    taken.add(t.entityId);
    renamed.push(`${found.entity_id} → ${t.entityId}`);
  }
  return { renamed, missing, conflicts };
}
