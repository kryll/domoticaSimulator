import { useProjectStore } from './projectStore';
import { startSimulationSync, stopSimulationLoop, useSimulationStore } from './simulationStore';
import { simNowFromLocalDate } from '../simulation/clock';
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

describe('simulationStore: reloj y renombrado', () => {
  beforeEach(() => {
    const project = makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 100, 100, 'Luz salón')] });
    useProjectStore.getState().loadProject(project);
    useSimulationStore.getState().reset(project);
  });

  it('arranca con la hora local de pared (simNowFromLocalDate)', () => {
    const expected = simNowFromLocalDate(new Date());
    expect(Math.abs(useSimulationStore.getState().sim.now - expected)).toBeLessThan(5000);
  });

  it('traslada el estado al renombrar y quita entidades que ya no existen', () => {
    useSimulationStore.getState().setEntity('light.luz_salon', { state: 'on' });
    const stop = startSimulationSync();
    useProjectStore.getState().updateDevice('d1', { name: 'Lámpara' });
    let entities = useSimulationStore.getState().sim.entities;
    expect(entities['light.luz_salon']).toBeUndefined();
    expect(entities['light.lampara']?.state).toBe('on');
    useProjectStore.getState().removeDevices(['d1']);
    entities = useSimulationStore.getState().sim.entities;
    expect(entities['light.lampara']).toBeUndefined();
    stop();
  });

  it('pressButton registra la acción del mando', () => {
    useProjectStore.getState().addDevice(makeDevice('aqara-wireless-mini-switch', 'm1', 0, 0, 'Mando'));
    const p = useProjectStore.getState().project;
    useSimulationStore.getState().reset(p);
    useSimulationStore.getState().pressButton('sensor.mando_action', 'double');
    const log = useSimulationStore.getState().sim.log.map((e) => e.message).join('\n');
    expect(log).toContain('double');
  });
});
