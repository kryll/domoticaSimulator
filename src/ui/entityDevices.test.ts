import { automationDeviceIds, devicesOfEntities, entityOwnerMap, revealDevice } from './entityDevices';
import { makeDevice, makeProject } from '../test/fixtures';

const project = makeProject({
  floors: [
    { id: 'f1', name: 'PB', level: 0, pixelsPerMeter: 40 },
    { id: 'f2', name: 'P1', level: 1, pixelsPerMeter: 40 },
  ],
  devices: [makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor'), { ...makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz'), floorId: 'f2' }],
  automations: [
    {
      id: 'a1',
      name: 'x',
      enabled: true,
      mode: 'single',
      triggers: [{ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' }],
      conditions: [{ type: 'sun', after: 'sunset' }],
      actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz' }, { type: 'delay', seconds: 1 }],
    },
  ],
});

describe('entityDevices', () => {
  it('relaciona entidades con sus dispositivos (memorizado)', () => {
    expect(entityOwnerMap(project)).toBe(entityOwnerMap(project));
    expect(devicesOfEntities(project, ['light.luz', 'light.luz', 'sensor.nada'])).toEqual(['l1']);
  });

  it('dispositivos que usa una automatización', () => {
    expect(automationDeviceIds(project, 'a1').sort()).toEqual(['l1', 'm1']);
    expect(automationDeviceIds(project, 'otra')).toEqual([]);
  });

  it('revealDevice cambia de planta, selecciona y centra', () => {
    const calls: string[] = [];
    const ui = {
      activeFloorId: 'f1',
      setActiveFloor: (id: string | null) => calls.push(`floor:${id}`),
      select: (s: { kind: 'device'; id: string } | null) => calls.push(`select:${s?.id}`),
      focusDevices: (ids: string[]) => calls.push(`focus:${ids.join()}`),
    };
    revealDevice(project, 'l1', ui);
    expect(calls).toEqual(['floor:f2', 'select:l1', 'focus:l1']);
    calls.length = 0;
    revealDevice(project, 'nada', ui);
    expect(calls).toEqual([]);
  });
});
