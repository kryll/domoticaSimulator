// Guardado fiable entre pestañas: revisión del proyecto comprobada en IndexedDB (sin pisar lo
// que guardó otra pestaña) y aviso entre pestañas con BroadcastChannel.
import { update } from 'idb-keyval';
import type { Id, Project } from '../../types';
import { projectsStore } from '../persistence';
import { parseProject } from '../projectSchema';

export type SaveCheckedResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'conflict'; current: Project }
  | { ok: false; reason: 'error'; error: string };

/** Revisión de un proyecto (los anteriores a la Tanda 1 no la tienen: 0). */
export function revisionOf(project: Pick<Project, 'revision'> | undefined): number {
  return project?.revision ?? 0;
}

/** Señal interna: la revisión guardada no es la esperada (aborta la escritura). */
class RevisionConflict extends Error {
  constructor(readonly stored: unknown) {
    super('conflicto de revisión');
  }
}

function storedRevision(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0;
  const rev = (raw as { revision?: unknown }).revision;
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Guarda el proyecto solo si la revisión guardada en IndexedDB es `expectedRevision` (o si aún
 * no está guardado). Lee y escribe en la misma transacción (idb-keyval `update`), así que dos
 * pestañas no pueden guardar a la vez sobre la misma revisión. Guarda con revisión + 1.
 * Si otra pestaña guardó antes, devuelve { reason: 'conflict', current } con lo guardado.
 */
export async function saveProjectChecked(project: Project, expectedRevision: number): Promise<SaveCheckedResult> {
  const saved = expectedRevision + 1;
  try {
    await update<unknown>(
      project.id,
      (raw) => {
        if (raw !== undefined && storedRevision(raw) !== expectedRevision) throw new RevisionConflict(raw);
        return { ...project, revision: saved };
      },
      projectsStore(),
    );
    return { ok: true, revision: saved };
  } catch (e) {
    if (e instanceof RevisionConflict) {
      try {
        return { ok: false, reason: 'conflict', current: parseProject(e.stored) };
      } catch (parseError) {
        return { ok: false, reason: 'error', error: `Otra pestaña guardó una versión que no se puede leer: ${errorText(parseError)}` };
      }
    }
    return { ok: false, reason: 'error', error: `No se pudo guardar el proyecto: ${errorText(e)}` };
  }
}

// ---------- Pestañas ----------

export type TabMessage =
  | { type: 'saved'; projectId: Id; revision: number; tabId: string }
  | { type: 'opened'; projectId: Id; tabId: string };

export interface TabChannel {
  post(msg: TabMessage): void;
  /** Recibe los mensajes de otras pestañas sobre este proyecto. Devuelve la función para darse de baja. */
  subscribe(fn: (msg: TabMessage) => void): () => void;
  close(): void;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Id de esta pestaña: fijo mientras la página esté abierta. No se guarda en sessionStorage
 * porque «Duplicar pestaña» lo copiaría y las dos pestañas tendrían el mismo.
 */
export const tabId: string = randomId();

export function getTabId(): string {
  return tabId;
}

/** Valida un mensaje recibido (puede venir de otra versión de la aplicación). */
export function isTabMessage(v: unknown): v is TabMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  if (typeof m.projectId !== 'string' || typeof m.tabId !== 'string') return false;
  if (m.type === 'opened') return true;
  return m.type === 'saved' && typeof m.revision === 'number' && Number.isFinite(m.revision);
}

/** Nombre del canal de un proyecto. */
export function channelName(projectId: Id): string {
  return `ha-simulator:project:${projectId}`;
}

const NOOP_CHANNEL: TabChannel = {
  post: () => undefined,
  subscribe: () => () => undefined,
  close: () => undefined,
};

/**
 * Canal entre pestañas del proyecto. Solo entrega mensajes válidos del mismo proyecto y de
 * otras pestañas. Sin BroadcastChannel (navegadores antiguos, tests) no hace nada.
 */
export function createTabChannel(projectId: Id): TabChannel {
  if (typeof BroadcastChannel === 'undefined') return NOOP_CHANNEL;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(channelName(projectId));
  } catch {
    return NOOP_CHANNEL;
  }
  const listeners = new Set<(msg: TabMessage) => void>();
  let closed = false;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const msg = event.data;
    if (!isTabMessage(msg) || msg.projectId !== projectId || msg.tabId === tabId) return;
    for (const fn of [...listeners]) fn(msg);
  };
  return {
    post(msg) {
      if (closed) return;
      try {
        channel.postMessage(msg);
      } catch {
        // Canal cerrado o mensaje no clonable: se ignora.
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      channel.close();
    },
  };
}
