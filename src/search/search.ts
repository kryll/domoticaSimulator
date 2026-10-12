// Tanda 3: búsqueda global (Ctrl+K). Índice de dispositivos, entidades, automatizaciones,
// escenas, scripts, salas, helpers y acciones de la app, con búsqueda difusa sin acentos y
// resultados agrupados y puntuados. Funciones puras.
import type { DeviceDefinition, Helper, Id, Project } from '../types';
import { allDefinitions } from '../devices/catalog';
import { foldText } from '../devices/text';
import { CATEGORY_LABELS } from '../devices/labels';
import { helperEntityId, HELPER_TYPE_LABELS } from '../simulation/helpers';
import { scriptEntityId } from '../simulation/scriptKeys';
import { entitiesForDevice, slugify } from '../devices/entities';

export type SearchKind = 'device' | 'entity' | 'automation' | 'scene' | 'script' | 'room' | 'helper' | 'action';

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  device: 'Dispositivos',
  entity: 'Entidades',
  automation: 'Automatizaciones',
  scene: 'Escenas',
  script: 'Scripts',
  room: 'Salas',
  helper: 'Helpers',
  action: 'Acciones',
};

/** Orden de los grupos en los resultados. */
export const SEARCH_KIND_ORDER: SearchKind[] = ['action', 'device', 'entity', 'automation', 'scene', 'script', 'helper', 'room'];

/** Acciones de la aplicación que se pueden lanzar desde la búsqueda (la interfaz las ejecuta por id). */
export type AppActionId =
  | 'export-packages'
  | 'export-yaml'
  | 'export-csv'
  | 'export-png'
  | 'export-json'
  | 'report-pdf'
  | 'validate'
  | 'simulation-start'
  | 'simulation-pause'
  | 'new-automation'
  | 'new-scene'
  | 'new-script'
  | 'new-helper'
  | 'import-ha'
  | 'day-plan'
  | 'presentation'
  | 'dashboard'
  | 'settings'
  // E1: laboratorio (src/bridge/labPalette.ts).
  | 'lab-panel'
  | 'lab-settings'
  | 'lab-couple'
  | 'lab-start-all'
  | 'lab-stop-all'
  | 'lab-snapshots'
  | 'lab-traffic';

export interface AppAction {
  id: AppActionId;
  title: string;
  /** Sinónimos para la búsqueda. */
  keywords: string;
}

export const APP_ACTIONS: AppAction[] = [
  { id: 'export-packages', title: 'Exportar packages', keywords: 'home assistant paquetes yaml zip instalacion real' },
  { id: 'export-yaml', title: 'Exportar YAML', keywords: 'automations.yaml scenes scripts descargar' },
  { id: 'export-csv', title: 'Exportar CSV', keywords: 'excel lista dispositivos hoja de calculo' },
  { id: 'export-png', title: 'Exportar imagen del plano', keywords: 'png captura plano dibujo' },
  { id: 'export-json', title: 'Exportar proyecto (JSON)', keywords: 'copia guardar descargar respaldo' },
  { id: 'report-pdf', title: 'Informe PDF y presupuesto', keywords: 'propuesta cliente imprimir presupuesto' },
  { id: 'validate', title: 'Validar el proyecto', keywords: 'errores avisos comprobar problemas' },
  { id: 'simulation-start', title: 'Iniciar la simulación', keywords: 'play arrancar reloj ejecutar' },
  { id: 'simulation-pause', title: 'Pausar la simulación', keywords: 'pausa detener reloj parar' },
  { id: 'new-automation', title: 'Nueva automatización', keywords: 'crear automatizacion regla' },
  { id: 'new-scene', title: 'Nueva escena', keywords: 'crear escena ambiente' },
  { id: 'new-script', title: 'Nuevo script', keywords: 'crear script secuencia' },
  { id: 'new-helper', title: 'Nuevo helper', keywords: 'crear ayudante input_boolean temporizador contador interruptor' },
  { id: 'import-ha', title: 'Importar desde Home Assistant', keywords: 'automations.yaml registro core.device_registry areas' },
  { id: 'day-plan', title: 'Generar un día típico', keywords: 'rutina personas eventos teletrabajo oficina fin de semana' },
  { id: 'presentation', title: 'Modo presentación', keywords: 'cliente solo lectura mostrar' },
  { id: 'dashboard', title: 'Ver el dashboard', keywords: 'lovelace tarjetas panel' },
  { id: 'settings', title: 'Ajustes del proyecto', keywords: 'ubicacion precios configuracion' },
  // E1: laboratorio con un Home Assistant real (src/bridge).
  { id: 'lab-panel', title: 'Laboratorio: abrir el panel', keywords: 'lab home assistant real nodos emulacion orquestador' },
  { id: 'lab-settings', title: 'Laboratorio: ajustes y token', keywords: 'lab conectar orquestador token url' },
  { id: 'lab-couple', title: 'Laboratorio: volver a acoplar', keywords: 'lab en vivo acoplar reanudar' },
  { id: 'lab-start-all', title: 'Laboratorio: arrancar todos los nodos', keywords: 'lab nodos arrancar encender' },
  { id: 'lab-stop-all', title: 'Laboratorio: parar todos los nodos', keywords: 'lab nodos parar apagar' },
  { id: 'lab-snapshots', title: 'Laboratorio: snapshots', keywords: 'lab copia restaurar guardar instantanea' },
  { id: 'lab-traffic', title: 'Laboratorio: inspector de tráfico', keywords: 'lab mqtt mensajes trafico topics' },
];

export interface SearchEntry {
  kind: SearchKind;
  /** Id del elemento (dispositivo, automatización...), entity_id o id de la acción. */
  id: string;
  title: string;
  subtitle?: string;
  /** Dispositivo al que pertenece una entidad. */
  deviceId?: Id;
  /** Texto normalizado del título (para puntuar). */
  titleKey: string;
  /** Texto normalizado de todo lo buscable. */
  haystack: string;
}

export interface SearchIndex {
  entries: SearchEntry[];
}

export interface SearchResult {
  entry: SearchEntry;
  score: number;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  results: SearchResult[];
}

export interface SearchResults {
  query: string;
  groups: SearchGroup[];
  total: number;
}

/** Texto sin acentos, en minúsculas y con los signos como espacios. */
export function normalizeSearch(text: string): string {
  return foldText(text).replace(/[^a-z0-9.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function entry(kind: SearchKind, id: string, title: string, extra: string[] = [], subtitle?: string, deviceId?: Id): SearchEntry {
  const e: SearchEntry = { kind, id, title, titleKey: normalizeSearch(title), haystack: normalizeSearch([title, id, subtitle ?? '', ...extra].join(' ')) };
  if (subtitle !== undefined) e.subtitle = subtitle;
  if (deviceId !== undefined) e.deviceId = deviceId;
  return e;
}

function helperSubtitle(h: Helper): string {
  return `${HELPER_TYPE_LABELS[h.type]} · ${helperEntityId(h)}`;
}

/** Construye el índice del proyecto (memorízalo mientras el proyecto no cambie). */
export function buildSearchIndex(project: Project, defs: DeviceDefinition[]): SearchIndex {
  const all = allDefinitions(project, defs);
  const roomName = (id: Id | undefined): string => project.rooms.find((r) => r.id === id)?.name ?? '';
  const entries: SearchEntry[] = APP_ACTIONS.map((a) => entry('action', a.id, a.title, [a.keywords]));
  for (const d of project.devices) {
    const def = all.find((x) => x.id === d.definitionId);
    const room = roomName(d.roomId);
    const model = def ? `${def.brand} ${def.model}` : d.definitionId;
    entries.push(entry('device', d.id, d.name, [def?.name ?? '', def ? CATEGORY_LABELS[def.category] : '', room, d.integration, d.protocol], [model, room].filter(Boolean).join(' · ')));
    if (!def) continue;
    for (const e of entitiesForDevice(d, def)) {
      entries.push(entry('entity', e.entityId, e.friendlyName, [e.definition.deviceClass ?? '', e.definition.domain, room], e.entityId, d.id));
    }
  }
  for (const a of project.automations) entries.push(entry('automation', a.id, a.name, [a.enabled ? '' : 'desactivada'], a.enabled ? undefined : 'Desactivada'));
  for (const s of project.scenes) entries.push(entry('scene', s.id, s.name, [`scene.${slugify(s.name)}`]));
  for (const s of project.scripts) entries.push(entry('script', s.id, s.name, [scriptEntityId(project.scripts, s.id)]));
  for (const h of project.helpers ?? []) entries.push(entry('helper', h.id, h.name, [h.type, helperEntityId(h)], helperSubtitle(h)));
  for (const r of project.rooms) {
    const floor = project.floors.find((f) => f.id === r.floorId)?.name ?? '';
    entries.push(entry('room', r.id, r.name, [floor, 'area'], floor || undefined));
  }
  return { entries };
}

/** ¿Están las letras de `needle` en orden dentro de `hay`? (coincidencia difusa). */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

function tokenScore(token: string, e: SearchEntry): number {
  const words = e.titleKey.split(' ');
  if (words.some((w) => w === token)) return 12;
  if (words.some((w) => w.startsWith(token))) return 9;
  if (e.titleKey.includes(token)) return 6;
  if (e.haystack.split(' ').some((w) => w.startsWith(token))) return 4;
  if (e.haystack.includes(token)) return 3;
  if (token.length >= 3 && isSubsequence(token, e.titleKey.replace(/ /g, ''))) return 1;
  return 0;
}

/** Puntuación de una entrada para la consulta (0: no coincide). */
export function scoreEntry(query: string, e: SearchEntry): number {
  const q = normalizeSearch(query);
  if (q === '') return 0;
  let total = 0;
  for (const token of q.split(' ')) {
    const s = tokenScore(token, e);
    if (s === 0) return 0;
    total += s;
  }
  if (e.titleKey === q) total += 20;
  else if (e.titleKey.startsWith(q)) total += 10;
  // A igualdad, los títulos cortos primero.
  return total - Math.min(5, e.titleKey.length / 20);
}

/**
 * Busca en el índice: resultados agrupados por tipo (en SEARCH_KIND_ORDER), ordenados por
 * puntuación y con `limitPerGroup` como máximo en cada grupo. Sin consulta devuelve las acciones.
 */
export function search(index: SearchIndex, query: string, limitPerGroup = 8): SearchResults {
  const q = query.trim();
  const scored: SearchResult[] =
    q === ''
      ? index.entries.filter((e) => e.kind === 'action').map((entry) => ({ entry, score: 0 }))
      : index.entries.map((entry) => ({ entry, score: scoreEntry(q, entry) })).filter((r) => r.score > 0);
  const groups: SearchGroup[] = [];
  let total = 0;
  for (const kind of SEARCH_KIND_ORDER) {
    const all = scored.filter((r) => r.entry.kind === kind).sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'es'));
    if (all.length === 0) continue;
    total += all.length;
    groups.push({ kind, label: SEARCH_KIND_LABELS[kind], results: all.slice(0, limitPerGroup) });
  }
  // El grupo con el mejor resultado va primero (las acciones, solo si son lo mejor).
  if (q !== '') groups.sort((a, b) => (b.results[0]?.score ?? 0) - (a.results[0]?.score ?? 0) || SEARCH_KIND_ORDER.indexOf(a.kind) - SEARCH_KIND_ORDER.indexOf(b.kind));
  return { query: q, groups, total };
}
