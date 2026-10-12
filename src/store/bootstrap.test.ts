import { lastProjectId, loadInitialProject, openAsNewProject, openProject, rememberLastProjectId, withUniqueId } from './bootstrap';
import { saveProject } from './persistence';
import { useProjectStore } from './projectStore';
import { useSimulationStore } from './simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('bootstrap', () => {
  beforeEach(() => localStorage.clear());

  it('withUniqueId asigna un id nuevo si ya existe uno guardado', async () => {
    const p = makeProject({ id: 'repetido' });
    expect((await withUniqueId(p)).id).toBe('repetido');
    await saveProject(p);
    const copy = await withUniqueId(p);
    expect(copy.id).not.toBe('repetido');
    expect(copy.name).toBe(p.name);
  });

  it('openProject reinicia la simulación y recuerda el último id', () => {
    const p = makeProject({ id: 'abierto', devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')] });
    useSimulationStore.getState().setEntity('light.otra', { state: 'on' });
    openProject(p);
    expect(useProjectStore.getState().project.id).toBe('abierto');
    expect(useSimulationStore.getState().sim.entities['light.otra']).toBeUndefined();
    expect(useSimulationStore.getState().sim.entities['light.luz']).toBeDefined();
    expect(lastProjectId()).toBe('abierto');
  });

  it('openAsNewProject no sobrescribe un proyecto guardado con el mismo id', async () => {
    const original = makeProject({ id: 'dup', name: 'Original' });
    await saveProject(original);
    const opened = await openAsNewProject(makeProject({ id: 'dup', name: 'Importado' }));
    expect(opened.id).not.toBe('dup');
    expect(useProjectStore.getState().project.name).toBe('Importado');
  });

  it('loadInitialProject abre el último proyecto recordado', async () => {
    await saveProject(makeProject({ id: 'viejo', name: 'Viejo', updatedAt: '2000-01-01T00:00:00.000Z' }));
    await saveProject(makeProject({ id: 'nuevo', name: 'Nuevo', updatedAt: '2030-01-01T00:00:00.000Z' }));
    rememberLastProjectId('viejo');
    await loadInitialProject();
    expect(useProjectStore.getState().project.id).toBe('viejo');
  });
});

describe('arranque: proyecto ilegible y respaldo de cierre', () => {
  beforeEach(() => localStorage.clear());

  it('un proyecto ilegible no se sobrescribe: se abre una demo provisional y se informa', async () => {
    const { set, get } = await import('idb-keyval');
    const { projectsStore } = await import('./persistence');
    const broken = { ...JSON.parse(JSON.stringify(makeProject({ id: 'roto', name: 'Mi casa', updatedAt: '2099-01-01T00:00:00.000Z' }))), floors: 'no es una lista' };
    await set('roto', broken, projectsStore());
    rememberLastProjectId('roto');
    const result = await loadInitialProject();
    expect(result.unreadable).toMatchObject({ id: 'roto', name: 'Mi casa' });
    expect(result.unreadable?.error).toMatch(/floors/);
    expect(result.unreadable?.raw).toEqual(broken);
    // Lo guardado sigue igual y se sigue recordando como el último proyecto.
    expect(await get('roto', projectsStore())).toEqual(broken);
    expect(lastProjectId()).toBe('roto');
    expect(useProjectStore.getState().project.id).not.toBe('roto');
  });

  it('aplica el respaldo de cierre si es más reciente que lo guardado (y lo marca para guardar)', async () => {
    const { writeBackup } = await import('./unloadBackup');
    const stored = makeProject({ id: 'casa', name: 'Casa', revision: 4, updatedAt: '2026-01-01T10:00:00.000Z' });
    await saveProject(stored);
    rememberLastProjectId('casa');
    const edited = { ...stored, name: 'Casa editada', updatedAt: '2026-01-01T10:00:05.000Z' };
    writeBackup(localStorage, edited, 4, Date.parse('2026-01-01T10:00:06.000Z'));
    const result = await loadInitialProject();
    expect(result.restoredBackup).toBe(true);
    expect(useProjectStore.getState().project.name).toBe('Casa editada');
    expect(useProjectStore.getState().dirty).toBe(true);
    expect(useProjectStore.getState().baseRevision).toBe(4);
  });

  it('descarta el respaldo si IndexedDB ya tiene una revisión posterior', async () => {
    const { writeBackup, readBackup } = await import('./unloadBackup');
    const stored = makeProject({ id: 'casa2', name: 'Guardada', revision: 5 });
    await saveProject(stored);
    rememberLastProjectId('casa2');
    writeBackup(localStorage, { ...stored, name: 'Vieja' }, 4, Date.now());
    const result = await loadInitialProject();
    expect(result.restoredBackup).toBeUndefined();
    expect(useProjectStore.getState().project.name).toBe('Guardada');
    expect(readBackup(localStorage, 'casa2')).toBeUndefined();
  });
});
