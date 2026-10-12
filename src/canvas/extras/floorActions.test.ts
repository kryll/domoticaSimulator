import { floorOffCalls } from './floorActions';
import { makeDevice, makeProject } from '../../test/fixtures';

describe('floorOffCalls', () => {
  it('apaga solo lo encendido de la planta indicada', () => {
    const upstairs = { ...makeDevice('hue-white-e27', 'd2', 0, 0, 'Luz arriba'), floorId: 'f2' };
    const project = makeProject({
      floors: [
        { id: 'f1', name: 'Baja', level: 0, pixelsPerMeter: 40 },
        { id: 'f2', name: 'Alta', level: 1, pixelsPerMeter: 40 },
      ],
      devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'), makeDevice('aqara-motion-p1', 'd3', 0, 0, 'Sensor'), upstairs],
    });
    const calls = floorOffCalls(project, 'f1', {
      'light.luz_salon': { state: 'on' },
      'light.luz_arriba': { state: 'on' },
      'binary_sensor.sensor_motion': { state: 'on' },
    });
    expect(calls).toEqual([{ entityId: 'light.luz_salon', service: 'light.turn_off' }]);
  });
});
