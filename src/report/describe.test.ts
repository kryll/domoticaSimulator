import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Action, Automation, Condition, Project, Room, Trigger } from '../types';
import { createDemoProject } from '../store/demoProject';
import { describeAutomation, durationText } from './describe';

const room = (id: string, name: string): Room => ({ id, floorId: 'f0', name, polygon: [] });

const house: Project = project(
  [
    dev('m', 'aqara-motion-p1', undefined, { name: 'Movimiento pasillo', roomId: 'pasillo', integration: 'zha' }),
    dev('l', 'ikea-tradfri-e27-ws', undefined, { name: 'Luz pasillo', roomId: 'pasillo', integration: 'zha' }),
    dev('p', 'aqara-door-window', undefined, { name: 'Puerta', roomId: 'entrada', integration: 'zha' }),
    dev('t', 'aqara-temp-hum', undefined, { name: 'Clima dormitorio', roomId: 'dormitorio', integration: 'zha' }),
    dev('c', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana dormitorio', roomId: 'dormitorio' }),
    dev('k', 'aqara-u200', undefined, { name: 'Cerradura', roomId: 'entrada' }),
    dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Mando salón', roomId: 'salon', integration: 'zha' }),
    dev('th', 'netatmo-thermostat', undefined, { name: 'Termostato', roomId: 'salon' }),
    dev('f', 'aqara-water-leak', undefined, { name: 'Fuga cocina', roomId: 'cocina', integration: 'zha' }),
  ],
  {
    rooms: [room('pasillo', 'Pasillo'), room('entrada', 'Entrada'), room('dormitorio', 'Dormitorio'), room('salon', 'Salón'), room('cocina', 'Cocina')],
    people: [{ id: 'ana', name: 'Ana' }],
    zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }],
    scenes: [{ id: 'cine', name: 'Cine', entities: {} }],
    scripts: [{ id: 'salir', name: 'Salir de casa', sequence: [] }],
  },
);

const auto = (triggers: Trigger[], conditions: Condition[], actions: Action[]): Automation => ({ id: 'a', name: 'A', enabled: true, mode: 'single', triggers, conditions, actions });
const say = (triggers: Trigger[], conditions: Condition[], actions: Action[]): string => describeAutomation(auto(triggers, conditions, actions), house, catalog);
const MOTION: Trigger = { type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'on' };
const LIGHT_ON: Action = { type: 'service', service: 'light.turn_on', entityId: 'light.luz_pasillo', data: { brightness_pct: 30 } };

describe('automatizaciones en lenguaje natural', () => {
  it('el ejemplo de referencia', () => {
    expect(
      say([MOTION], [{ type: 'sun', after: 'sunset', before: 'sunrise' }], [LIGHT_ON, { type: 'delay', seconds: 120 }, { type: 'service', service: 'light.turn_off', entityId: 'light.luz_pasillo' }]),
    ).toBe('Cuando se detecta movimiento en el pasillo y es de noche, enciende la luz del pasillo al 30 % durante 2 minutos');
  });

  it('disparadores', () => {
    const turnOff: Action[] = [{ type: 'service', service: 'light.turn_off', entityId: 'light.luz_pasillo' }];
    expect(say([{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'off', for: 120 }], [], turnOff)).toBe(
      'Cuando no hay movimiento en el pasillo durante 2 minutos, apaga la luz del pasillo',
    );
    expect(say([{ type: 'state', entityId: 'binary_sensor.puerta_door', to: 'on' }], [], turnOff)).toMatch(/^Cuando se abre la puerta de la entrada,/);
    expect(say([{ type: 'state', entityId: 'binary_sensor.puerta_door', to: 'on', for: 300 }], [], turnOff)).toMatch(/^Cuando la puerta de la entrada lleva abierta 5 minutos,/);
    expect(say([{ type: 'numeric_state', entityId: 'sensor.clima_dormitorio_temperature', above: 26 }], [], turnOff)).toMatch(/^Cuando la temperatura del dormitorio supera 26 °C,/);
    expect(say([{ type: 'time', at: '07:30' }], [], turnOff)).toMatch(/^Cuando son las 07:30,/);
    expect(say([{ type: 'sun', event: 'sunset', offsetMinutes: -15 }], [], turnOff)).toMatch(/^Cuando faltan 15 minutos para la puesta de sol,/);
    expect(say([{ type: 'sun', event: 'sunrise' }], [], turnOff)).toMatch(/^Cuando sale el sol,/);
    expect(say([{ type: 'zone', personId: 'ana', zoneId: 'home', event: 'leave' }], [], turnOff)).toMatch(/^Cuando Ana sale de casa,/);
    expect(say([{ type: 'zone', personId: 'ana', zoneId: 'trabajo', event: 'enter' }], [], turnOff)).toMatch(/^Cuando Ana llega a «Trabajo»,/);
    expect(say([{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'double' }], [], turnOff)).toMatch(/^Cuando se pulsa el mando del salón \(doble\),/);
    expect(say([{ type: 'state', entityId: 'binary_sensor.fuga_cocina_leak', to: 'on' }], [], turnOff)).toMatch(/^Cuando se detecta una fuga de agua en la cocina,/);
    expect(say([MOTION, { type: 'time', at: '07:30' }], [], turnOff)).toMatch(/^Cuando se detecta movimiento en el pasillo o son las 07:30,/);
  });

  it('condiciones', () => {
    const conds: Condition[] = [
      { type: 'time', after: '20:00', before: '07:30' },
      { type: 'state', entityId: 'binary_sensor.puerta_door', state: 'off' },
      { type: 'zone', personId: 'ana', zoneId: 'home' },
      { type: 'or', conditions: [{ type: 'sun', after: 'sunrise', before: 'sunset' }, { type: 'numeric_state', entityId: 'sensor.clima_dormitorio_temperature', below: 18 }] },
      { type: 'not', conditions: [{ type: 'state', entityId: 'lock.cerradura_lock', state: 'locked' }] },
    ];
    expect(say([MOTION], conds, [LIGHT_ON])).toBe(
      'Cuando se detecta movimiento en el pasillo y es entre las 20:00 y las 07:30, «Puerta» está «cerrada», Ana está en casa, (es de día o la temperatura del dormitorio está por debajo de 18 °C) y no se cumple que «Cerradura» está «bloqueada», enciende la luz del pasillo al 30 %',
    );
  });

  it('acciones', () => {
    const actions: Action[] = [
      { type: 'service', service: 'cover.close_cover', entityId: 'cover.persiana_dormitorio_cover' },
      { type: 'service', service: 'climate.set_temperature', entityId: 'climate.termostato_climate', data: { temperature: 21 } },
      { type: 'service', service: 'climate.set_preset_mode', entityId: 'climate.termostato_climate', data: { preset_mode: 'frost_guard' } },
      { type: 'service', service: 'lock.lock', entityId: 'lock.cerradura_lock' },
      { type: 'scene', sceneId: 'cine' },
      { type: 'script', scriptId: 'salir' },
      { type: 'notify', title: 'Casa', message: 'Hola' },
      { type: 'delay', seconds: 90 },
      { type: 'service', service: 'light.turn_off', entityId: '', targets: { areaIds: ['pasillo'] } },
    ];
    expect(say([MOTION], [], actions)).toBe(
      'Cuando se detecta movimiento en el pasillo, baja la persiana del dormitorio, pone «Termostato» a 21 °C, pone «Termostato» en modo antihielo, bloquea «Cerradura», activa la escena «Cine», ejecuta el script «Salir de casa», envía la notificación «Casa», espera 1 minuto y 30 segundos y apaga las luces del pasillo',
    );
    const logic: Action[] = [
      { type: 'if', conditions: [{ type: 'sun', after: 'sunset' }], then: [LIGHT_ON], else: [{ type: 'service', service: 'light.turn_off', entityId: 'light.luz_pasillo' }] },
      { type: 'repeat', count: 3, sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_pasillo' }] },
      { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: 'binary_sensor.puerta_door', to: 'off' }], timeoutSeconds: 600 },
      { type: 'choose', choices: [{ conditions: [{ type: 'time', after: '22:00' }], sequence: [LIGHT_ON] }], default: [{ type: 'delay', seconds: 1 }] },
    ];
    expect(say([MOTION], [], logic)).toBe(
      'Cuando se detecta movimiento en el pasillo, si ya se ha puesto el sol, enciende la luz del pasillo al 30 %; si no, apaga la luz del pasillo, repite 3 veces: enciende o apaga la luz del pasillo, espera a que ocurra esto: se cierra la puerta de la entrada (como mucho 10 minutos) y si son más de las 22:00, enciende la luz del pasillo al 30 %; si no, espera 1 segundo',
    );
  });

  it('sin disparadores ni acciones y entidades que no existen', () => {
    expect(say([], [], [])).toBe('Al ejecutarla a mano, no hace nada');
    expect(say([{ type: 'state', entityId: 'light.no_existe', to: 'on' }], [], [])).toBe('Cuando se enciende light.no_existe, no hace nada');
  });

  it('la demo se describe entera', () => {
    const demo = createDemoProject();
    const texts = demo.automations.map((a) => describeAutomation(a, demo));
    expect(texts[8]).toBe('Cuando Ana sale de casa, si no queda nadie en casa, apaga el grupo «Planta baja» y envía la notificación «Casa vacía»; si no, envía la notificación «Ana ha salido»');
    expect(texts[0]).toBe('Cuando se detecta movimiento en el pasillo y es entre las 20:00 y las 07:30, enciende la luz del salón al 47 % durante 2 minutos');
    for (const t of texts) expect(t).toMatch(/^Cuando .+, .+/);
  });

  it('duraciones', () => {
    expect(durationText(120)).toBe('2 minutos');
    expect(durationText(3600)).toBe('1 hora');
    expect(durationText(3661)).toBe('1 hora, 1 minuto y 1 segundo');
    expect(durationText(0)).toBe('0 segundos');
  });
});
