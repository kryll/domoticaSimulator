import { useProjectStore } from './projectStore';
import { stopSimulationLoop, useSimulationStore } from './simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

const sim = () => useSimulationStore.getState();

describe('simulationStore', () => {
  beforeEach(() => {
    const project = makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 100, 100, 'Luz salón')] });
    useProjectStore.getState().loadProject(project);
    sim().reset(project);
  });
  afterEach(() => stopSimulationLoop());

  it('crea el estado inicial de las entidades del proyecto', () => {
    expect(sim().sim.entities['light.luz_salon']).toBeDefined();
  });

  it('cambia el estado de una entidad manualmente y lo registra en el logbook', () => {
    const before = sim().sim.log.length;
    sim().setEntity('light.luz_salon', { state: 'on' });
    expect(sim().sim.entities['light.luz_salon']?.state).toBe('on');
    expect(sim().sim.log.length).toBeGreaterThan(before);
  });

  it('avanza el reloj según la velocidad', () => {
    const t0 = sim().sim.now;
    sim().setSpeed(60);
    sim().advance(1000);
    expect(sim().sim.now - t0).toBe(60_000);
  });

  it('start y pause cambian el estado de ejecución', () => {
    sim().start();
    expect(sim().running).toBe(true);
    sim().pause();
    expect(sim().running).toBe(false);
  });

  it('sincroniza entidades de dispositivos nuevos', () => {
    useProjectStore.getState().addDevice(makeDevice('sonoff-s26r2', 'd2', 0, 0, 'Enchufe'));
    sim().syncWithProject(useProjectStore.getState().project);
    expect(sim().sim.entities['switch.enchufe']).toBeDefined();
  });
});
