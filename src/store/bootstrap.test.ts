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
