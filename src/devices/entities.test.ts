import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { entitiesForDevice, entityDomain, entityIdsForDevice, initialEntityStates, slugify } from './entities';
import { createDevice, uniqueDeviceName } from './factory';
import { def, dev, project } from './testUtils';

describe('slugify', () => {
  it.each([
    ['Luz salón', 'luz_salon'],
    ['  Árbol de NAVIDAD!! ', 'arbol_de_navidad'],
    ['TRÅDFRI ñandú 2', 'tradfri_nandu_2'],
    ['---', 'dispositivo'],
  ])('%s -> %s', (input, out) => {
    expect(slugify(input)).toBe(out);
  });
});

describe('entidades', () => {
  it('una sola entidad no lleva sufijo', () => {
    const d = dev('a', 'hue-white-e27', undefined, { name: 'Luz salón' });
    expect(entityIdsForDevice(d, def('hue-white-e27'))).toEqual(['light.luz_salon']);
  });

  it('varias entidades llevan sufijo con la clave', () => {
    const d = dev('a', 'aqara-temp-hum', undefined, { name: 'Clima' });
    expect(entityIdsForDevice(d, def('aqara-temp-hum'))).toEqual([
      'sensor.clima_temperature',
      'sensor.clima_humidity',
      'sensor.clima_pressure',
      'sensor.clima_battery',
    ]);
  });

  it('entitiesForDevice incluye el nombre amigable', () => {
    const d = dev('a', 'aqara-door-window', undefined, { name: 'Entrada' });
    const [door] = entitiesForDevice(d, def('aqara-door-window'));
    expect(door).toMatchObject({ entityId: 'binary_sensor.entrada_door', friendlyName: 'Entrada · Puerta' });
  });

  it('initialEntityStates usa el estado inicial y atributos de HA', () => {
    const p = project([
      dev('a', 'aqara-temp-hum', undefined, { name: 'Clima' }),
      dev('b', 'netatmo-thermostat', undefined, { name: 'Termo' }),
    ]);
    const states = initialEntityStates(p, catalog);
    expect(states['sensor.clima_temperature']).toEqual({
      state: 21.5,
      attributes: { friendly_name: 'Clima · Temperatura', unit_of_measurement: '°C', device_class: 'temperature' },
    });
    expect(states['climate.termo_climate']?.attributes?.temperature).toBe(21);
    expect(Object.keys(states)).toHaveLength(6);
  });

  it('ignora dispositivos sin definición', () => {
    const p = project([{ ...dev('a', 'hue-white-e27'), definitionId: 'nada' }]);
    expect(initialEntityStates(p, catalog)).toEqual({});
  });

  it('entityDomain', () => {
    expect(entityDomain('light.x')).toBe('light');
    expect(entityDomain('sin_punto')).toBe('');
  });
});

describe('factory', () => {
  it('createDevice usa el primer protocolo e integración y un id único', () => {
    const d = def('aqara-motion-p1');
    const a = createDevice(d, { floorId: 'f0', position: { x: 1, y: 2 } });
    const b = createDevice(d, { floorId: 'f0', position: { x: 1, y: 2 }, name: 'Otro', roomId: 'r1' });
    expect(a).toMatchObject({ definitionId: 'aqara-motion-p1', name: d.name, protocol: 'zigbee', integration: 'homekit_device' });
    expect(a.roomId).toBeUndefined();
    expect(b).toMatchObject({ name: 'Otro', roomId: 'r1' });
    expect(a.id).not.toBe(b.id);
  });

  it('createDevice copia la posición', () => {
    const pos = { x: 1, y: 2 };
    const d = createDevice(def('tapo-p110'), { floorId: 'f0', position: pos });
    pos.x = 99;
    expect(d.position.x).toBe(1);
  });

  it('createDevice falla si la definición no tiene protocolos', () => {
    const broken = { ...def('tapo-p110'), protocols: [] };
    expect(() => createDevice(broken, { floorId: 'f0', position: { x: 0, y: 0 } })).toThrow(/no tiene protocolos/);
  });

  it('uniqueDeviceName añade un número si el slug ya existe', () => {
    expect(uniqueDeviceName('Luz', [])).toBe('Luz');
    expect(uniqueDeviceName('Luz', ['luz'])).toBe('Luz 2');
    expect(uniqueDeviceName('Luz', [{ name: 'Luz' }, { name: 'Luz 2' }])).toBe('Luz 3');
    expect(uniqueDeviceName('Salón', ['Salon'])).toBe('Salón 2');
  });

  it('uniqueDeviceName: casos límite', () => {
    expect(uniqueDeviceName('Luz', ['Luz 2'])).toBe('Luz');
    expect(uniqueDeviceName('Luz', ['Luz', 'Luz 3'])).toBe('Luz 2');
    expect(uniqueDeviceName('LUZ salón', ['luz_salon', 'Luz Salón 2'])).toBe('LUZ salón 3');
    const many = ['Sensor', ...Array.from({ length: 20 }, (_, i) => `Sensor ${i + 2}`)];
    expect(uniqueDeviceName('Sensor', many)).toBe('Sensor 22');
    expect(uniqueDeviceName('!!!', ['Dispositivo'])).toBe('!!! 2');
    expect(uniqueDeviceName('Enchufe', [dev('a', 'tapo-p110', undefined, { name: 'Enchufe' })])).toBe('Enchufe 2');
  });
});
