import { entityGroups, formatEntityState, searchGroups } from './entityOptions';
import { makeDevice, makeProject } from '../test/fixtures';

const project = makeProject({
  floors: [
    { id: 'f1', name: 'Planta baja', level: 0, pixelsPerMeter: 40 },
    { id: 'f2', name: 'Primera', level: 1, pixelsPerMeter: 40 },
  ],
  rooms: [
    { id: 'r1', floorId: 'f1', name: 'Salón', polygon: [] },
    { id: 'r2', floorId: 'f2', name: 'Dormitorio', polygon: [] },
  ],
  devices: [
    { ...makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz dormitorio'), floorId: 'f2', roomId: 'r2' },
    { ...makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor salón'), roomId: 'r1' },
    makeDevice('aqara-temp-hum', 'c1', 0, 0, 'Clima'),
  ],
});

describe('entityGroups', () => {
  it('agrupa por planta y sala, en orden de nivel y con «Sin sala» al final de su planta', () => {
    const groups = entityGroups(project, {});
    expect(groups.map((g) => g.label)).toEqual(['Planta baja · Salón', 'Planta baja · Sin sala', 'Primera · Dormitorio']);
  });

  it('filtra por dominio, device_class, numérico y lista cerrada', () => {
    const ids = (f: Parameters<typeof entityGroups>[2]) => entityGroups(project, {}, f).flatMap((g) => g.options.map((o) => o.entityId));
    expect(ids({ domains: ['light'] })).toEqual(['light.luz_dormitorio']);
    expect(ids({ deviceClasses: ['motion'] })).toEqual(['binary_sensor.sensor_salon_motion']);
    expect(ids({ numericOnly: true }).every((id) => id.startsWith('sensor.'))).toBe(true);
    expect(ids({ allowedIds: ['sensor.clima_humidity'] })).toEqual(['sensor.clima_humidity']);
  });

  it('muestra el estado actual con unidad', () => {
    const groups = entityGroups(project, { 'sensor.clima_temperature': { state: 21.5 } }, { deviceClasses: ['temperature'] });
    expect(groups[0]?.options[0]?.stateText).toBe('21,5 °C');
  });
});

describe('searchGroups y formatEntityState', () => {
  it('busca sin acentos por todas las palabras, también por la sala', () => {
    const groups = entityGroups(project, {});
    expect(searchGroups(groups, 'SALON movi').flatMap((g) => g.options.map((o) => o.entityId))).toEqual(['binary_sensor.sensor_salon_motion']);
    expect(searchGroups(groups, 'dormitorio').flatMap((g) => g.options.map((o) => o.entityId))).toEqual(['light.luz_dormitorio']);
    expect(searchGroups(groups, '')).toBe(groups);
    expect(searchGroups(groups, 'zzz')).toEqual([]);
  });

  it('formatea booleanos, números y ausencia', () => {
    expect(formatEntityState(undefined)).toBe('—');
    expect(formatEntityState({ state: true })).toBe('on');
    expect(formatEntityState({ state: '7' }, '%')).toBe('7 %');
    expect(formatEntityState({ state: 'open' })).toBe('open');
  });
});
