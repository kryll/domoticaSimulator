import { useProjectStore } from './projectStore';
import { startSimulationSync, useSimulationStore } from './simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

const state = (id: string) => useSimulationStore.getState().sim.entities[id]?.state;

describe('disponibilidad sincronizada con el proyecto', () => {
  let stop: () => void;
  beforeEach(() => {
    const motion = { ...makeDevice('aqara-motion-p1', 'mov', 0, 0, 'Movimiento'), integration: 'zha' as const, protocol: 'zigbee' as const };
    const p = makeProject({
      devices: [makeDevice('ha-green', 'ha', 0, 0, 'Home Assistant'), makeDevice('sonoff-zbdongle-p', 'coord', 0, 0, 'Coordinador'), motion],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    stop = startSimulationSync();
  });
  afterEach(() => stop());

  it('un dispositivo en la nube añadido durante «Sin Internet» nace no disponible', () => {
    useSimulationStore.getState().setFailures({ internet: true });
    useProjectStore.getState().addDevice(makeDevice('tuya-wifi-plug', 'plug', 0, 0, 'Enchufe'));
    expect(state('switch.enchufe_switch')).toBe('unavailable');
    // deshacer y rehacer mantiene la coherencia
    useProjectStore.getState().undo();
    useProjectStore.getState().redo();
    expect(state('switch.enchufe_switch')).toBe('unavailable');
    useSimulationStore.getState().setFailures({ internet: false });
    expect(state('switch.enchufe_switch')).not.toBe('unavailable');
  });

  it('desconectar a mano el coordinador tira a sus hijos, y borrarlo caído no deja restos', () => {
    useSimulationStore.getState().setDeviceOffline('coord', true);
    expect(state('binary_sensor.movimiento_motion')).toBe('unavailable');
    useSimulationStore.getState().setDeviceOffline('coord', false);
    expect(state('binary_sensor.movimiento_motion')).not.toBe('unavailable');

    useSimulationStore.getState().setFailures({ devicesDown: ['coord'] });
    expect(state('binary_sensor.movimiento_motion')).toBe('unavailable');
    useProjectStore.getState().removeDevices(['coord']);
    // sin coordinador el sensor sigue sin servicio (falta coordinador), pero el sim no falla
    expect(useSimulationStore.getState().sim.failureOffline).not.toContain('coord');
  });

  it('marcar el SAI durante un corte de luz recupera el dispositivo', () => {
    useSimulationStore.getState().setFailures({ powerOutage: true });
    expect(state('binary_sensor.movimiento_motion')).toBe('unavailable');
    useProjectStore.getState().updateDevice('coord', { ups: true });
    useProjectStore.getState().updateDevice('ha', { ups: true });
    expect(useSimulationStore.getState().sim.failureOffline).not.toContain('coord');
  });
});

describe('reloj inicial', () => {
  it('arranca a la hora de pared de la zona horaria del proyecto', () => {
    const madrid = makeProject({ settings: { latitude: 40.4, longitude: -3.7, timeZone: 'Europe/Madrid', electricityPriceEurKwh: 0.15 } });
    const canarias = makeProject({ settings: { latitude: 28.1, longitude: -15.4, timeZone: 'Atlantic/Canary', electricityPriceEurKwh: 0.15 } });
    useSimulationStore.getState().reset(madrid);
    const a = useSimulationStore.getState().sim.now;
    useSimulationStore.getState().reset(canarias);
    const b = useSimulationStore.getState().sim.now;
    expect(Math.round((a - b) / 60_000)).toBe(60);
  });
});
