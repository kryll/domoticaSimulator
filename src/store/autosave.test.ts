import type { Project } from '../types';
import { AUTO_VERSION_MS, saveNow, startAutosave, type AutosaveDeps } from './autosave';
import { loadLatestVersion, overwriteWithMine, saveMineAsCopy } from './conflict';
import { useProjectStore } from './projectStore';
import type { SaveCheckedResult, TabChannel, TabMessage } from './sync/tabSync';
import { makeDevice, makeProject } from '../test/fixtures';

const store = () => useProjectStore.getState();

/** Canal falso: guarda lo publicado y permite simular mensajes de otra pestaña. */
function fakeChannel() {
  const posted: TabMessage[] = [];
  const listeners = new Set<(m: TabMessage) => void>();
  const channel: TabChannel = {
    post: (m) => posted.push(m),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: () => listeners.clear(),
  };
  return { channel, posted, receive: (m: TabMessage) => listeners.forEach((fn) => fn(m)) };
}

function setup(results: Array<SaveCheckedResult | Error> = []) {
  const fake = fakeChannel();
  let clock = 1_000_000;
  const disk = new Map<string, Project>();
  const save = vi.fn(async (project: Project, expected: number): Promise<SaveCheckedResult> => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    disk.set(project.id, { ...project, revision: expected + 1 });
    return { ok: true, revision: expected + 1 };
  });
  const deps: AutosaveDeps = {
    save,
    load: vi.fn(async (id: string) => disk.get(id)),
    channel: () => fake.channel,
    autoVersion: vi.fn(async () => undefined),
    now: () => clock,
  };
  const stop = startAutosave(5, deps);
  return { deps, save, fake, disk, stop, advance: (ms: number) => (clock += ms) };
}

describe('guardado automático fiable', () => {
  let stop: () => void = () => undefined;
  beforeEach(() => {
    store().loadProject(makeProject({ revision: 3 }));
  });
  afterEach(() => stop());

  it('guarda con la revisión esperada, la actualiza y avisa a otras pestañas', async () => {
    const t = setup();
    stop = t.stop;
    expect(t.fake.posted[0]).toMatchObject({ type: 'opened', projectId: 'p1' });
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    expect(store().dirty).toBe(true);
    await vi.waitFor(() => expect(store().dirty).toBe(false));
    expect(t.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 3);
    expect(store().baseRevision).toBe(4);
    expect(store().saveStatus).toBe('saved');
    expect(t.fake.posted.at(-1)).toMatchObject({ type: 'saved', projectId: 'p1', revision: 4 });
    // el siguiente guardado parte de la revisión nueva
    store().renameProject('Otro');
    await vi.waitFor(() => expect(t.save).toHaveBeenCalledTimes(2));
    expect(t.save.mock.calls[1]?.[1]).toBe(4);
  });

  it('guarda al instante al ocultar o cerrar la pestaña, sin esperar al retardo', async () => {
    const fake = fakeChannel();
    const save = vi.fn(async (): Promise<SaveCheckedResult> => ({ ok: true, revision: 4 }));
    stop = startAutosave(60_000, { save, load: async () => undefined, channel: () => fake.channel, autoVersion: async () => undefined, now: () => 0 });
    store().renameProject('Cambio');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    store().renameProject('Otro cambio');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('si falla queda en error y «Reintentar» vuelve a guardar', async () => {
    const t = setup([{ ok: false, reason: 'error', error: 'Cuota excedida' }]);
    stop = t.stop;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store().renameProject('Cambio');
    await vi.waitFor(() => expect(store().saveStatus).toBe('error'));
    expect(store().saveError).toBe('Cuota excedida');
    expect(store().dirty).toBe(true);
    await saveNow();
    expect(store().saveStatus).toBe('saved');
    expect(store().dirty).toBe(false);
    spy.mockRestore();
  });

  it('un conflicto detiene el guardado hasta resolverlo', async () => {
    const other = makeProject({ name: 'De la otra pestaña', revision: 7 });
    const t = setup([{ ok: false, reason: 'conflict', current: other }]);
    stop = t.stop;
    store().renameProject('Mío');
    await vi.waitFor(() => expect(store().conflict).not.toBeNull());
    expect(store().conflict).toMatchObject({ reason: 'conflict', revision: 7 });
    store().renameProject('Mío 2');
    await new Promise((r) => setTimeout(r, 30));
    expect(t.save).toHaveBeenCalledTimes(1);

    // «Mantener la mía y sobrescribir»: guarda sobre la revisión de la otra pestaña.
    t.disk.set('p1', other);
    await overwriteWithMine();
    expect(store().conflict).toBeNull();
    expect(t.save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Mío 2' }), 7);
    expect(store().baseRevision).toBe(8);
  });

  it('un aviso «saved» de otra pestaña con revisión mayor abre el conflicto; cargar la reciente lo resuelve', async () => {
    const t = setup();
    stop = t.stop;
    t.fake.receive({ type: 'saved', projectId: 'p1', revision: 2, tabId: 'otra' });
    expect(store().conflict).toBeNull();
    t.fake.receive({ type: 'saved', projectId: 'p1', revision: 9, tabId: 'otra' });
    expect(store().conflict).toMatchObject({ reason: 'other-tab', revision: 9 });

    t.disk.set('p1', makeProject({ name: 'Reciente', revision: 9 }));
    expect(await loadLatestVersion()).toBe(true);
    expect(store().project.name).toBe('Reciente');
    expect(store().baseRevision).toBe(9);
    expect(store().conflict).toBeNull();
  });

  it('«Guardar la mía como copia» crea un proyecto nuevo y sigue en él', async () => {
    const t = setup();
    stop = t.stop;
    store().renameProject('Mi versión');
    store().setSaveState({ conflict: { reason: 'other-tab', revision: 9 } });
    const copy = await saveMineAsCopy();
    expect(copy?.id).not.toBe('p1');
    expect(store().project.id).toBe(copy?.id);
    expect(store().project.name).toBe('Mi versión (copia)');
    expect(store().conflict).toBeNull();
    expect(t.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: copy?.id }), 0);
  });

  it('copia automática al abrir y cada 10 minutos de edición activa', async () => {
    const t = setup();
    stop = t.stop;
    expect(t.deps.autoVersion).toHaveBeenCalledTimes(1);
    store().renameProject('a');
    expect(t.deps.autoVersion).toHaveBeenCalledTimes(1);
    t.advance(AUTO_VERSION_MS);
    store().renameProject('b');
    expect(t.deps.autoVersion).toHaveBeenCalledTimes(2);
    // abrir otro proyecto también hace copia
    store().loadProject(makeProject({ id: 'p2' }));
    expect(t.deps.autoVersion).toHaveBeenCalledTimes(3);
  });
});

describe('respaldo síncrono al cerrar', () => {
  let stop: () => void = () => undefined;
  beforeEach(() => {
    localStorage.clear();
    store().loadProject(makeProject({ revision: 3 }));
  });
  afterEach(() => stop());

  it('en pagehide escribe el respaldo en localStorage y lo borra al terminar de guardar', async () => {
    const { readBackup } = await import('./unloadBackup');
    const t = setup();
    stop = t.stop;
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    window.dispatchEvent(new Event('pagehide'));
    const backup = readBackup(localStorage, 'p1');
    expect(backup).toMatchObject({ projectId: 'p1', revision: 3 });
    expect(JSON.parse(backup?.json ?? '{}').devices).toHaveLength(1);
    await vi.waitFor(() => expect(store().dirty).toBe(false));
    expect(readBackup(localStorage, 'p1')).toBeUndefined();
  });

  it('beforeunload pide confirmación solo con cambios sin guardar', async () => {
    const t = setup();
    stop = t.stop;
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(store().dirty).toBe(false));
  });
});

describe('cambios pendientes al arrancar', () => {
  it('si el proyecto ya está sin guardar al arrancar (respaldo aplicado), se guarda sin esperar a otra edición', async () => {
    store().loadProject(makeProject({ revision: 3 }));
    store().setSaveState({ dirty: true });
    const t = setup();
    await vi.waitFor(() => expect(store().dirty).toBe(false));
    expect(t.save).toHaveBeenCalledTimes(1);
    t.stop();
  });
});
