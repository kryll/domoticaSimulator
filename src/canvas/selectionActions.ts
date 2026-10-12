// Acciones sobre la selección múltiple del lienzo: borrar, copiar, pegar, duplicar y acciones en lote.
// Cada operación es un único paso de deshacer (un solo commit en projectStore).
import type { Id, Integration } from '../types';
import { knownDefinitions } from './analysis';
import { useProjectStore } from '../store/projectStore';
import { selectedDeviceIds, useUiStore } from '../store/uiStore';
import { confirmDialog } from '../ui/confirm';
import { activeFloorId } from './actions';
import { alignPositions, distributePositions, type AlignMode, type DistributeAxis } from './arrange';
import {
  assignRoom,
  copyDevices,
  deviceReferences,
  duplicateDevices,
  parseClipboard,
  pasteDevices,
  referencesTo,
  removeDevices,
  serializeClipboard,
  type ClipboardPayload,
  type ReferenceKind,
} from './clipboard';

/** Desplazamiento de cada pegado sobre la misma planta. */
export const PASTE_OFFSET = 40;

/** Portapapeles en memoria (si el navegador no deja usar el del sistema). */
let memory: { payload: ClipboardPayload; text: string } | null = null;
/** Pegados seguidos del mismo contenido en cada planta (para ir desplazando cada copia). */
const pasteCounts = new Map<Id, number>();

/** Solo para tests. */
export function resetClipboardMemory(): void {
  memory = null;
  pasteCounts.clear();
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function undoAction() {
  return { label: 'Deshacer', run: () => useProjectStore.getState().undo() };
}

/** Selecciona todos los dispositivos de la planta activa. */
export function selectAllOnFloor(): number {
  const floorId = activeFloorId();
  const ids = useProjectStore
    .getState()
    .project.devices.filter((d) => d.floorId === floorId)
    .map((d) => d.id);
  useUiStore.getState().setSelection(ids);
  return ids.length;
}

const KIND_WORDS: Record<ReferenceKind, [string, string]> = {
  automation: ['automatización', 'automatizaciones'],
  scene: ['escena', 'escenas'],
  script: ['script', 'scripts'],
  group: ['grupo', 'grupos'],
};

/** «Se usan en 2 automatizaciones y 1 escena:» (o null si nada los usa). */
export function referenceSummary(ids: Id[], count = ids.length): string | null {
  const refs = deviceReferences(useProjectStore.getState().project, ids, knownDefinitions());
  if (refs.length === 0) return null;
  const parts = (Object.keys(KIND_WORDS) as ReferenceKind[])
    .map((kind) => {
      const n = refs.filter((r) => r.kind === kind).length;
      return n === 0 ? null : plural(n, KIND_WORDS[kind][0], KIND_WORDS[kind][1]);
    })
    .filter((x): x is string => x !== null);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : (parts[0] ?? '');
  return `${count === 1 ? 'Se usa' : 'Se usan'} en ${list}:`;
}

/** Líneas para el diálogo de confirmación con los usos de los dispositivos (automatizaciones, escenas...). */
export function referenceDetails(ids: Id[]): string[] {
  return referencesTo(useProjectStore.getState().project, ids, knownDefinitions());
}

/**
 * Borra dispositivos. Pide confirmación si son varios o si se usan en otras partes del proyecto
 * (con el detalle de referencesTo). Tras borrar, aviso con «Deshacer».
 */
export async function deleteDevices(ids: Id[]): Promise<boolean> {
  const project = useProjectStore.getState().project;
  const existing = ids.filter((id) => project.devices.some((d) => d.id === id));
  if (existing.length === 0) return false;
  const details = referenceDetails(existing);
  if (existing.length > 1 || details.length > 0) {
    const name = existing.length === 1 ? project.devices.find((d) => d.id === existing[0])?.name : undefined;
    const summary = referenceSummary(existing);
    const ok = await confirmDialog({
      title: name ? `¿Eliminar «${name}»?` : `¿Eliminar ${plural(existing.length, 'dispositivo', 'dispositivos')}?`,
      message: summary ?? 'Puedes recuperarlos con Deshacer.',
      details,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return false;
  }
  useProjectStore.getState().update((p) => removeDevices(p, existing));
  const ui = useUiStore.getState();
  ui.select(null);
  ui.openPopover(null);
  ui.openContextMenu(null);
  ui.notify(
    existing.length === 1 ? 'Dispositivo eliminado' : `${plural(existing.length, 'dispositivo eliminado', 'dispositivos eliminados')}`,
    'success',
    { action: undoAction() },
  );
  return true;
}

/** Supr: borra exactamente la selección (dispositivos, una sala o una conexión). */
export async function deleteSelection(): Promise<boolean> {
  const ui = useUiStore.getState();
  const { selection, selectionKind } = ui;
  if (selection.length === 0 || !selectionKind) return false;
  if (selectionKind === 'device') return deleteDevices(selection);
  const store = useProjectStore.getState();
  if (selectionKind === 'room') {
    store.removeElements({ roomIds: selection });
    ui.select(null);
    ui.notify('Sala eliminada', 'success', { action: undoAction() });
  } else {
    store.removeElements({ connectionIds: selection });
    ui.select(null);
    ui.notify('Conexión eliminada', 'success', { action: undoAction() });
  }
  return true;
}

/** Copia los dispositivos seleccionados al portapapeles (del sistema y en memoria). */
export async function copySelection(ids: Id[] = selectedDeviceIds(useUiStore.getState())): Promise<number> {
  if (ids.length === 0) return 0;
  const payload = copyDevices(useProjectStore.getState().project, ids);
  const text = serializeClipboard(payload);
  memory = { payload, text };
  pasteCounts.clear();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sin permiso o sin API: queda el portapapeles en memoria.
  }
  useUiStore.getState().notify(`${plural(ids.length, 'dispositivo copiado', 'dispositivos copiados')}`, 'info');
  return ids.length;
}

/** Datos para el evento `copy` del documento (Ctrl+C sin texto seleccionado). */
export function copyPayloadText(ids: Id[]): string | null {
  if (ids.length === 0) return null;
  const payload = copyDevices(useProjectStore.getState().project, ids);
  const text = serializeClipboard(payload);
  memory = { payload, text };
  pasteCounts.clear();
  return text;
}

/** Contenido a pegar: el texto del portapapeles del sistema si es nuestro, o el de memoria. */
function resolvePayload(text: string | null): ClipboardPayload | null {
  if (text) {
    const parsed = parseClipboard(text);
    if (parsed) {
      if (!memory || memory.text !== text) {
        memory = { payload: parsed, text };
        pasteCounts.clear();
      }
      return parsed;
    }
  }
  return memory?.payload ?? null;
}

/** Pega en la planta activa: desplazado si es la misma planta de origen; en otra, en el mismo sitio. */
export function pastePayload(payload: ClipboardPayload): Id[] {
  const floorId = activeFloorId();
  if (!floorId) return [];
  const store = useProjectStore.getState();
  const sameFloor = payload.sourceFloorId === floorId;
  const count = (pasteCounts.get(floorId) ?? 0) + 1;
  pasteCounts.set(floorId, count);
  // En la planta de origen cada pegado se desplaza; en otra, el primero va en el mismo sitio.
  const step = sameFloor ? count : count - 1;
  const offset = { x: PASTE_OFFSET * step, y: PASTE_OFFSET * step };
  const result = pasteDevices(store.project, payload, { floorId, offset, defs: knownDefinitions() });
  if (result.newIds.length === 0) return [];
  store.update(() => result.project);
  const ui = useUiStore.getState();
  ui.setSelection(result.newIds);
  ui.notify(`${plural(result.newIds.length, 'dispositivo pegado', 'dispositivos pegados')}`, 'success', { action: undoAction() });
  return result.newIds;
}

/** Pega a partir del texto de un evento `paste` (o, si es null, del portapapeles en memoria). */
export function pasteText(text: string | null): Id[] {
  const payload = resolvePayload(text);
  if (!payload) return [];
  return pastePayload(payload);
}

/** Pegar desde un menú: intenta leer el portapapeles del sistema; si no hay permiso, usa el de memoria. */
export async function pasteFromClipboard(): Promise<Id[]> {
  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = null;
  }
  const ids = pasteText(text);
  if (ids.length === 0) useUiStore.getState().notify('No hay dispositivos copiados para pegar', 'info');
  return ids;
}

/** Ctrl+D: duplica la selección junto al original. */
export function duplicateSelection(ids: Id[] = selectedDeviceIds(useUiStore.getState())): Id[] {
  if (ids.length === 0) return [];
  const store = useProjectStore.getState();
  const result = duplicateDevices(store.project, ids, { defs: knownDefinitions(), offset: { x: PASTE_OFFSET, y: PASTE_OFFSET } });
  if (result.newIds.length === 0) return [];
  store.update(() => result.project);
  const ui = useUiStore.getState();
  ui.setSelection(result.newIds);
  ui.notify(`${plural(result.newIds.length, 'dispositivo duplicado', 'dispositivos duplicados')}`, 'success', { action: undoAction() });
  return result.newIds;
}

/** Asigna una sala (o ninguna) a varios dispositivos. */
export function assignRoomToDevices(ids: Id[], roomId: Id | undefined): void {
  useProjectStore.getState().update((p) => assignRoom(p, ids, roomId));
}

/** Cambia la integración de varios dispositivos (deben compartir definición). */
export function setIntegrationForDevices(ids: Id[], integration: Integration): void {
  const set = new Set(ids);
  useProjectStore.getState().update((p) => {
    let changed = false;
    const devices = p.devices.map((d) => {
      if (!set.has(d.id) || d.integration === integration) return d;
      changed = true;
      return { ...d, integration };
    });
    return changed ? { ...p, devices } : p;
  });
}

function placedOf(ids: Id[]) {
  const set = new Set(ids);
  return useProjectStore
    .getState()
    .project.devices.filter((d) => set.has(d.id))
    .map((d) => ({ id: d.id, position: d.position }));
}

export function alignDevices(ids: Id[], mode: AlignMode): void {
  const moves = alignPositions(placedOf(ids), mode);
  if (moves.length > 0) useProjectStore.getState().moveDevicesTo(moves);
}

export function distributeDevices(ids: Id[], axis: DistributeAxis): void {
  const moves = distributePositions(placedOf(ids), axis);
  if (moves.length > 0) useProjectStore.getState().moveDevicesTo(moves);
}
