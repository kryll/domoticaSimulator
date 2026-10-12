import { useProjectStore } from './projectStore';
import { startSimulationSync, stopSimulationLoop, useSimulationStore } from './simulationStore';
import { simNowForProject } from '../simulation/clock';
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

  it('arranca con la hora de pared de la zona del proyecto (simNowForProject)', () => {
    const expected = simNowForProject(useProjectStore.getState().project, new Date());
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

describe('simulationStore · renombrar', () => {
  afterEach(() => stopSimulationLoop());

  it('una persiana en movimiento renombrada termina su recorrido con el nuevo id', () => {
    const project = makeProject({ devices: [makeDevice('shelly-2pm-gen3-cover', 'per', 0, 0, 'Persiana')] });
    useProjectStore.getState().loadProject(project);
    useSimulationStore.getState().setSpeed(1);
    useSimulationStore.getState().reset(project);
    const stop = startSimulationSync();
    try {
      useSimulationStore.getState().callService('cover.persiana_cover', 'open_cover');
      useSimulationStore.getState().advance(4000);
      expect(useSimulationStore.getState().sim.entities['cover.persiana_cover']?.state).toBe('opening');
      useProjectStore.getState().updateDevice('per', { name: 'Estor' });
      const s = useSimulationStore.getState().sim;
      expect(s.entities['cover.persiana_cover']).toBeUndefined();
      expect(s.entities['cover.estor_cover']?.state).toBe('opening');
      useSimulationStore.getState().advance(60_000);
      const end = useSimulationStore.getState().sim.entities['cover.estor_cover'];
      expect(end?.state).toBe('open');
      expect(end?.attributes?.current_position).toBe(100);
    } finally {
      stop();
    }
  });

  it('renamedEntityIds devuelve nuevo → anterior solo para los renombrados', async () => {
    const { renamedEntityIds } = await import('./simulationStore');
    const prev = makeProject({ devices: [makeDevice('aqara-temp-hum', 'c', 0, 0, 'Clima'), makeDevice('hue-white-e27', 'l', 0, 0, 'Luz')] });
    const next = { ...prev, devices: prev.devices.map((d) => (d.id === 'c' ? { ...d, name: 'Salón' } : d)) };
    const map = renamedEntityIds(prev, next);
    expect(map.get('sensor.salon_temperature')).toBe('sensor.clima_temperature');
    expect([...map.values()].some((v) => v.startsWith('light.'))).toBe(false);
  });
});
