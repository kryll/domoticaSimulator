// Guardado automático fiable: revisión comprobada (saveProjectChecked), guardado inmediato al
// ocultar o cerrar la pestaña, aviso entre pestañas y copias automáticas de versiones.
import type { Project } from '../types';
import { loadProject } from './persistence';
import { createTabChannel, getTabId, saveProjectChecked, type SaveCheckedResult, type TabChannel, type TabMessage } from './sync/tabSync';
import { pruneAutoVersions, saveVersion } from './versions';
import { useProjectStore } from './projectStore';
import { browserStorage, clearBackup, writeBackup, type BackupStorage } from './unloadBackup';

type SaveResult = SaveCheckedResult;

/** Intervalo de edición activa entre copias automáticas. */
export const AUTO_VERSION_MS = 10 * 60 * 1000;

export interface AutosaveDeps {
  save: (project: Project, expectedRevision: number) => Promise<SaveResult>;
  load: (id: string) => Promise<Project | undefined>;
  channel: (projectId: string) => TabChannel | null;
  autoVersion: (project: Project) => Promise<void>;
  now: () => number;
  /** Almacenamiento síncrono del respaldo al cerrar (localStorage). */
  backupStorage?: () => BackupStorage | undefined;
}

export const defaultAutosaveDeps: AutosaveDeps = {
  save: saveProjectChecked,
  load: loadProject,
  channel: (projectId) => {
    try {
      return createTabChannel(projectId);
    } catch {
      return null;
    }
  },
  autoVersion: async (project) => {
    await saveVersion(project, { auto: true });
    await pruneAutoVersions(project.id);
  },
  now: () => Date.now(),
  backupStorage: browserStorage,
};

/** Guardado activo (para «Reintentar» y para resolver conflictos). */
let active: { flush: () => Promise<void>; deps: AutosaveDeps } | null = null;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Guarda ya, sin esperar al retardo. No hace nada si no hay guardado automático activo. */
export async function saveNow(): Promise<void> {
  await active?.flush();
}

/** Dependencias del guardado activo (o las de por defecto). */
export function autosaveDeps(): AutosaveDeps {
  return active?.deps ?? defaultAutosaveDeps;
}

/**
 * Arranca el guardado automático en IndexedDB tras `delayMs` sin cambios. Devuelve la función que
 * lo detiene.
 */
export function startAutosave(delayMs = 800, deps: AutosaveDeps = defaultAutosaveDeps): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let channel: TabChannel | null = null;
  let unsubscribeChannel: (() => void) | undefined;
  let channelProjectId: string | null = null;
  let lastAutoVersionAt = deps.now();

  const store = () => useProjectStore.getState();

  const post = (message: TabMessage) => {
    try {
      channel?.post(message);
    } catch {
      // canal cerrado: no importa
    }
  };

  const doSave = async () => {
    const { project, baseRevision, conflict } = store();
    if (conflict) return;
    store().setSaveState({ saveStatus: 'saving' });
    let result: SaveResult;
    try {
      result = await deps.save(project, baseRevision);
    } catch (err) {
      result = { ok: false, reason: 'error', error: errorText(err) };
    }
    if (result.ok) {
      const unchanged = store().project === project;
      store().setSaveState({
        baseRevision: result.revision,
        saveStatus: 'saved',
        saveError: null,
        lastSavedAt: new Date().toISOString(),
        ...(unchanged ? { dirty: false } : {}),
      });
      post({ type: 'saved', projectId: project.id, revision: result.revision, tabId: getTabId() });
      // Lo guardado ya está en IndexedDB: el respaldo de cierre sobra.
      if (unchanged) clearBackup((deps.backupStorage ?? browserStorage)(), project.id);
      if (!unchanged) again = true;
    } else if (result.reason === 'conflict') {
      store().setSaveState({
        saveStatus: 'saved',
        conflict: { reason: 'conflict', revision: result.current.revision ?? baseRevision + 1, current: result.current },
      });
    } else {
      console.error('No se pudo guardar el proyecto', result.error);
      store().setSaveState({ saveStatus: 'error', saveError: result.error });
    }
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (running) {
      again = true;
      return running;
    }
    if (!store().dirty && store().saveStatus !== 'error') return;
    running = (async () => {
      do {
        again = false;
        await doSave();
      } while (again && !store().conflict && store().saveStatus !== 'error');
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  };

  const autoVersion = (project: Project) => {
    lastAutoVersionAt = deps.now();
    deps.autoVersion(project).catch((err: unknown) => console.error('No se pudo guardar la copia automática', err));
  };

  const connect = (project: Project) => {
    if (channelProjectId === project.id) return;
    unsubscribeChannel?.();
    channel?.close();
    channelProjectId = project.id;
    channel = deps.channel(project.id);
    unsubscribeChannel = channel?.subscribe((message) => {
      const state = store();
      if (message.type === 'saved' && message.projectId === state.project.id && message.revision > state.baseRevision) {
        if (!state.conflict) state.setSaveState({ conflict: { reason: 'other-tab', revision: message.revision } });
      }
    });
    post({ type: 'opened', projectId: project.id, tabId: getTabId() });
    // Copia automática al abrir el proyecto.
    autoVersion(project);
  };

  connect(store().project);

  const unsubscribe = useProjectStore.subscribe((state, prev) => {
    if (state.project.id !== prev.project.id) connect(state.project);
    if (state.project === prev.project || !state.dirty) return;
    schedule();
    // Edición activa: una copia automática cada AUTO_VERSION_MS.
    if (deps.now() - lastAutoVersionAt >= AUTO_VERSION_MS) autoVersion(state.project);
  });

  /** Hay cambios que aún no están en IndexedDB. */
  const unsaved = () => store().dirty || running !== null;

  /** Respaldo síncrono en localStorage: IndexedDB puede no terminar antes de cerrar. */
  const backup = () => {
    const { project, baseRevision, conflict } = store();
    if (conflict || !unsaved()) return;
    writeBackup((deps.backupStorage ?? browserStorage)(), project, baseRevision, deps.now());
  };

  // Al ocultar o cerrar la pestaña: respaldo síncrono y guardado inmediato, sin esperar al retardo.
  const onHide = () => {
    backup();
    if (store().dirty) void flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onHide();
  };
  // Con cambios sin guardar, el navegador pregunta antes de cerrar o recargar.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!unsaved()) return;
    backup();
    void flush();
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);

  const handle = { flush, deps };
  active = handle;
  // Cambios pendientes al arrancar (p. ej. el respaldo de cierre recién aplicado): se guardan ya.
  if (store().dirty) schedule();

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribeChannel?.();
    channel?.close();
    if (active === handle) active = null;
  };
}
