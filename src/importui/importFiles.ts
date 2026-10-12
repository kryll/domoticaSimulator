// Asistente «Importar desde Home Assistant»: reconocer los ficheros y aplicar las correcciones
// de coincidencias del usuario. Funciones puras (la lógica de importación está en src/import).
import type { DeviceDefinition, Project } from '../types';
import { buildImportPlan, type ImportInput, type ImportPlan } from '../import/haImport';
import { allDefinitions, catalog } from '../devices/catalog';

export type HaFileKind = 'automationsYaml' | 'scenesYaml' | 'scriptsYaml' | 'deviceRegistry' | 'areaRegistry' | 'entityRegistry';

export const HA_FILE_LABELS: Record<HaFileKind, string> = {
  automationsYaml: 'automations.yaml',
  scenesYaml: 'scenes.yaml',
  scriptsYaml: 'scripts.yaml',
  deviceRegistry: '.storage/core.device_registry',
  areaRegistry: '.storage/core.area_registry',
  entityRegistry: '.storage/core.entity_registry',
};

export const HA_FILE_ORDER: HaFileKind[] = ['deviceRegistry', 'areaRegistry', 'entityRegistry', 'automationsYaml', 'scenesYaml', 'scriptsYaml'];

/** Qué fichero de HA es, por su nombre y, si no se reconoce, por su contenido. */
export function detectHaFile(name: string, content: string): HaFileKind | null {
  const n = name.toLowerCase();
  if (n.includes('automation')) return 'automationsYaml';
  if (n.includes('scene')) return 'scenesYaml';
  if (n.includes('script')) return 'scriptsYaml';
  if (n.includes('device_registry')) return 'deviceRegistry';
  if (n.includes('area_registry')) return 'areaRegistry';
  if (n.includes('entity_registry')) return 'entityRegistry';
  const t = content.trimStart();
  if (t.startsWith('{')) {
    try {
      const json: unknown = JSON.parse(t);
      const data = typeof json === 'object' && json !== null && 'data' in json ? (json as { data: unknown }).data : undefined;
      if (typeof data === 'object' && data !== null) {
        if ('devices' in data) return 'deviceRegistry';
        if ('areas' in data) return 'areaRegistry';
        if ('entities' in data) return 'entityRegistry';
      }
    } catch {
      return null;
    }
    return null;
  }
  if (/^\s*-?\s*(alias|id):/m.test(t) && /(triggers?|platform|trigger):/m.test(t)) return 'automationsYaml';
  if (/^\s*-?\s*(name|id):/m.test(t) && /entities:/m.test(t)) return 'scenesYaml';
  if (/sequence:/m.test(t)) return 'scriptsYaml';
  return null;
}

/** Corrección del usuario: otra definición del catálogo o «crear personalizado». */
export type MatchOverride = { kind: 'definition'; definitionId: string } | { kind: 'custom' };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Registro de dispositivos con las correcciones aplicadas: para forzar una definición se pone su
 * modelo (sin fabricante, para que coincida por modelo exacto); para «crear personalizado» se quitan
 * fabricante y modelo (no coincide con nada). El plan se corrige después con `restoreCustomNames`.
 */
export function registryWithOverrides(raw: string | undefined, overrides: Record<string, MatchOverride>, defs: DeviceDefinition[]): string | undefined {
  if (raw === undefined || Object.keys(overrides).length === 0) return raw;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return raw;
  }
  const list = Array.isArray(json) ? json : isObj(json) && isObj(json.data) && Array.isArray(json.data.devices) ? json.data.devices : null;
  if (!list) return raw;
  const patched = list.map((d: unknown) => {
    if (!isObj(d)) return d;
    const o = overrides[String(d.id ?? '')];
    if (!o) return d;
    const next: Json = { ...d };
    delete next.model_id;
    delete next.manufacturer;
    if (o.kind === 'custom') {
      delete next.model;
      return next;
    }
    const def = defs.find((x) => x.id === o.definitionId);
    if (def) next.model = def.model;
    return next;
  });
  const out = Array.isArray(json) ? patched : { ...(json as Json), data: { ...((json as Json).data as Json), devices: patched } };
  return JSON.stringify(out);
}

/** Fabricante y modelo originales (para devolverle el nombre a los personalizados forzados). */
export function originalModels(raw: string | undefined): Map<string, { manufacturer?: string; model?: string }> {
  const map = new Map<string, { manufacturer?: string; model?: string }>();
  if (!raw) return map;
  try {
    const json: unknown = JSON.parse(raw);
    const list = Array.isArray(json) ? json : isObj(json) && isObj(json.data) && Array.isArray(json.data.devices) ? json.data.devices : [];
    for (const d of list as unknown[]) {
      if (!isObj(d)) continue;
      const entry: { manufacturer?: string; model?: string } = {};
      if (typeof d.manufacturer === 'string') entry.manufacturer = d.manufacturer;
      const model = typeof d.model === 'string' ? d.model : typeof d.model_id === 'string' ? d.model_id : undefined;
      if (model) entry.model = model;
      map.set(String(d.id ?? ''), entry);
    }
  } catch {
    // registro ilegible: el plan ya trae el aviso
  }
  return map;
}

/** Devuelve a los personalizados forzados su fabricante y modelo originales en el plan. */
export function restoreCustomNames(plan: ImportPlan, overrides: Record<string, MatchOverride>, originals: Map<string, { manufacturer?: string; model?: string }>): ImportPlan {
  const forced = plan.matches.filter((m) => overrides[m.haDeviceId]?.kind === 'custom');
  if (forced.length === 0) return plan;
  const byDef = new Map(forced.map((m) => [m.definitionId, originals.get(m.haDeviceId) ?? {}]));
  return {
    ...plan,
    customDefinitions: plan.customDefinitions.map((d) => {
      const o = byDef.get(d.id);
      if (!o) return d;
      const model = o.model ?? d.model;
      return { ...d, model, name: `${o.manufacturer ?? d.brand} ${model}`.trim() };
    }),
    matches: plan.matches.map((m) => {
      const o = overrides[m.haDeviceId]?.kind === 'custom' ? originals.get(m.haDeviceId) : undefined;
      return o ? { ...m, ...o } : m;
    }),
  };
}

/** Entrada del plan con las correcciones aplicadas. */
export function inputWithOverrides(input: ImportInput, overrides: Record<string, MatchOverride>, defs: DeviceDefinition[]): ImportInput {
  const deviceRegistry = registryWithOverrides(input.deviceRegistry, overrides, defs);
  return deviceRegistry === undefined ? input : { ...input, deviceRegistry };
}

/** Plan con las correcciones del usuario, calculado sobre el proyecto de destino. */
export function planFor(target: Project, input: ImportInput, overrides: Record<string, MatchOverride>): ImportPlan {
  const defs = allDefinitions(target, catalog);
  const plan = buildImportPlan(target, defs, inputWithOverrides(input, overrides, defs));
  return restoreCustomNames(plan, overrides, originalModels(input.deviceRegistry));
}

