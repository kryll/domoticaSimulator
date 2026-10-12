// Reparación tolerante de un proyecto guardado que no pasa parseProject: conserva todo lo que se
// puede leer y descarta, con una nota en español, solo los elementos o campos no válidos.
// Función pura (salvo los ids y fechas que faltan), separada de React.
import type { Project } from '../types';
import { PROJECT_LIST_KEYS, parseProject, parseProjectItem, type ProjectListKey } from './projectSchema';

type Obj = Record<string, unknown>;

export interface RepairResult {
  project: Project;
  /** Qué se ha descartado o rellenado, en español. */
  notes: string[];
}

const LIST_LABELS: Record<ProjectListKey, string> = {
  floors: 'plantas',
  rooms: 'salas',
  devices: 'dispositivos',
  connections: 'conexiones',
  automations: 'automatizaciones',
  scenes: 'escenas',
  scripts: 'scripts',
  people: 'personas',
  zones: 'zonas',
  timelines: 'líneas de tiempo',
  variants: 'variantes',
  groups: 'grupos',
  helpers: 'ayudantes',
};

/** Listas obligatorias (las demás son opcionales). */
const REQUIRED_LISTS: readonly ProjectListKey[] = ['floors', 'rooms', 'devices', 'connections', 'automations', 'scenes', 'scripts'];
const BASE_KEYS = new Set(['version', 'id', 'name', 'createdAt', 'updatedAt', 'revision', ...PROJECT_LIST_KEYS]);

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function tryParse(candidate: Obj): Project | undefined {
  try {
    return parseProject(candidate);
  } catch {
    return undefined;
  }
}

function parseError(candidate: Obj): string | undefined {
  try {
    parseProject(candidate);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function idOf(v: unknown): string | undefined {
  return isObj(v) ? text(v.id) : undefined;
}

/** Elementos válidos de una lista, sin ids repetidos. */
function validItems(key: ProjectListKey, value: unknown, notes: string[]): unknown[] {
  if (!Array.isArray(value)) {
    notes.push(`«${key}» no era una lista: se deja vacía`);
    return [];
  }
  const seen = new Set<string>();
  const kept: unknown[] = [];
  let dropped = 0;
  value.forEach((item, i) => {
    try {
      const parsed = parseProjectItem(key, item, i);
      if (seen.has(parsed.id)) {
        dropped++;
        return;
      }
      seen.add(parsed.id);
      kept.push(item);
    } catch {
      dropped++;
    }
  });
  if (dropped > 0) notes.push(`${LIST_LABELS[key][0]?.toUpperCase() ?? ''}${LIST_LABELS[key].slice(1)}: se descartan ${dropped} no válidos o repetidos`);
  return kept;
}

/**
 * Repara un proyecto ilegible de forma tolerante: rellena lo imprescindible (id, nombre, fechas,
 * una planta), quita los elementos no válidos o repetidos de cada lista, las referencias rotas
 * (salas o conexiones a plantas o dispositivos que no existen) y los campos opcionales que no se
 * pueden leer (se intenta conservar cada subcampo válido de los ajustes). Lanza Error si el
 * documento no es ni siquiera un objeto.
 */
export function repairProject(raw: unknown, now: Date = new Date()): RepairResult {
  if (!isObj(raw)) throw new Error('El documento guardado no es un proyecto (no es un objeto JSON)');
  const notes: string[] = [];
  const iso = now.toISOString();
  const base: Obj = {
    version: 1,
    id: text(raw.id) ?? crypto.randomUUID(),
    name: text(raw.name) ?? 'Proyecto recuperado',
    createdAt: text(raw.createdAt) ?? iso,
    updatedAt: text(raw.updatedAt) ?? iso,
  };
  if (raw.version !== 1) notes.push(`Versión de formato no válida (${JSON.stringify(raw.version)}): se trata como la 1`);
  if (text(raw.id) === undefined) notes.push('Faltaba el id: se asigna uno nuevo');
  if (text(raw.name) === undefined) notes.push('Faltaba el nombre: «Proyecto recuperado»');
  const revision = raw.revision;
  if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) base.revision = revision;

  // Listas obligatorias.
  for (const key of REQUIRED_LISTS) base[key] = validItems(key, raw[key], notes);
  let floors = base.floors as unknown[];
  if (floors.length === 0) {
    floors = [{ id: crypto.randomUUID(), name: 'Planta baja', level: 0, pixelsPerMeter: 50 }];
    base.floors = floors;
    notes.push('No quedaba ninguna planta válida: se añade «Planta baja»');
  }
  const floorIds = new Set(floors.map(idOf));
  const firstFloor = idOf(floors[0]);
  // Salas en plantas que no existen: fuera. Dispositivos: a la primera planta (no se pierden).
  const rooms = (base.rooms as unknown[]).filter((r) => isObj(r) && floorIds.has(text(r.floorId)));
  if (rooms.length < (base.rooms as unknown[]).length) notes.push(`Se descartan ${(base.rooms as unknown[]).length - rooms.length} salas de plantas que no existen`);
  base.rooms = rooms;
  const roomIds = new Set(rooms.map(idOf));
  let moved = 0;
  base.devices = (base.devices as unknown[]).map((d) => {
    if (!isObj(d)) return d;
    let next: Obj = d;
    if (!floorIds.has(text(d.floorId))) {
      moved++;
      next = { ...next, floorId: firstFloor };
    }
    if (next.roomId !== undefined && !roomIds.has(text(next.roomId))) {
      next = { ...next };
      delete next.roomId;
    }
    return next;
  });
  if (moved > 0) notes.push(`${moved} dispositivos apuntaban a una planta que no existe: se pasan a la primera`);
  const deviceIds = new Set((base.devices as unknown[]).map(idOf));
  const connections = (base.connections as unknown[]).filter((c) => isObj(c) && deviceIds.has(text(c.sourceId)) && deviceIds.has(text(c.targetId)));
  if (connections.length < (base.connections as unknown[]).length) notes.push(`Se descartan ${(base.connections as unknown[]).length - connections.length} conexiones con dispositivos que no existen`);
  base.connections = connections;

  // Listas opcionales.
  for (const key of PROJECT_LIST_KEYS) {
    if (REQUIRED_LISTS.includes(key) || raw[key] === undefined) continue;
    base[key] = validItems(key, raw[key], notes);
  }

  // El esqueleto ya debe ser válido; si no, se quitan las listas opcionales.
  let candidate: Obj = base;
  if (!tryParse(candidate)) {
    for (const key of PROJECT_LIST_KEYS) {
      if (REQUIRED_LISTS.includes(key) || candidate[key] === undefined) continue;
      const without: Obj = { ...candidate };
      delete without[key];
      notes.push(`Se descartan los ${LIST_LABELS[key]} (referencias no válidas)`);
      candidate = without;
      if (tryParse(candidate)) break;
    }
  }

  // Resto de campos (ajustes, entorno, fiabilidad, definiciones propias, laboratorio...).
  for (const key of Object.keys(raw)) {
    if (BASE_KEYS.has(key) || raw[key] === undefined) continue;
    const value = raw[key];
    const whole: Obj = { ...candidate, [key]: value };
    if (tryParse(whole)) {
      candidate = whole;
      continue;
    }
    if (Array.isArray(value)) {
      const kept = value.filter((item) => tryParse({ ...candidate, [key]: [item] }) !== undefined);
      const attempt: Obj = { ...candidate, [key]: kept };
      if (tryParse(attempt)) {
        candidate = attempt;
        notes.push(`Se descartan ${value.length - kept.length} elementos no válidos de «${key}»`);
        continue;
      }
    } else if (isObj(value)) {
      // Se quitan, uno a uno, los subcampos que señala el error (o, si no se sabe cuál, el
      // primero cuya ausencia lo arregla) hasta que el resto se pueda leer.
      const kept: Obj = { ...value };
      for (let guard = Object.keys(value).length; guard > 0; guard--) {
        const error = parseError({ ...candidate, [key]: kept });
        if (error === undefined) break;
        const named = Object.keys(kept).find((sub) => error.includes(`${key}.${sub}`));
        const culprit = named ?? Object.keys(kept).find((sub) => {
          const rest: Obj = { ...kept };
          delete rest[sub];
          return tryParse({ ...candidate, [key]: rest }) !== undefined;
        });
        if (culprit === undefined) break;
        delete kept[culprit];
      }
      const attempt: Obj = { ...candidate, [key]: kept };
      if (Object.keys(kept).length > 0 && tryParse(attempt)) {
        candidate = attempt;
        const lost = Object.keys(value).filter((k) => !(k in kept));
        notes.push(`Se descartan campos no válidos de «${key}»: ${lost.join(', ')}`);
        continue;
      }
    }
    notes.push(`Se descarta «${key}» (no válido)`);
  }

  const project = tryParse(candidate) ?? parseProject(base);
  return { project, notes };
}
