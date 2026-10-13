import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Device, Project, Room } from '../types';
import { createSimulationState } from './engine';
import { setFailures } from './availability';
import { intentEntities, parseIntent, sayToAssistant, stripWakeWord, type IntentEntity } from './assist';
import { OFFLINE_REPLY } from './voice';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);
const room = (id: string, name: string): Room => ({ id, floorId: 'f0', name, polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });

const ENTITIES: IntentEntity[] = [
  { entityId: 'light.luz_salon', domain: 'light', name: 'Luz salón', areaId: 'salon', areaName: 'Salón' },
  { entityId: 'light.lampara', domain: 'light', name: 'Lámpara', areaId: 'salon', areaName: 'Salón', aliases: ['lámpara de pie'] },
  { entityId: 'light.luz_cocina', domain: 'light', name: 'Luz cocina', areaId: 'cocina', areaName: 'Cocina' },
  { entityId: 'cover.persiana', domain: 'cover', name: 'Persiana dormitorio', areaId: 'dorm', areaName: 'Dormitorio' },
  { entityId: 'climate.termostato', domain: 'climate', name: 'Termostato', areaId: 'salon', areaName: 'Salón' },
  { entityId: 'sensor.clima_dorm_temperature', domain: 'sensor', deviceClass: 'temperature', name: 'Clima dormitorio', areaId: 'dorm', areaName: 'Dormitorio' },
  { entityId: 'vacuum.robot', domain: 'vacuum', name: 'Robot', areaId: 'salon', areaName: 'Salón' },
];

const parse = (t: string) => parseIntent(t, ENTITIES, [{ id: 'cine', name: 'Cine' }]);

describe('intérprete de intenciones (assist.ts)', () => {
  it('quita la palabra de activación', () => {
    expect(stripWakeWord('Alexa, enciende la luz')).toBe('enciende la luz');
    expect(stripWakeWord('Ok Google, apaga la tele')).toBe('apaga la tele');
  });

  it('HassTurnOn/Off por nombre, alias o área (sin acentos)', () => {
    expect(parse('Enciende la luz del salón')).toMatchObject({ ok: true, intent: { name: 'HassTurnOn', entityIds: ['light.luz_salon'] } });
    expect(parse('enciende la lampara de pie')).toMatchObject({ ok: true, intent: { entityIds: ['light.lampara'] } });
    expect(parse('Apaga las luces de la cocina')).toMatchObject({ ok: true, intent: { name: 'HassTurnOff', entityIds: ['light.luz_cocina'] } });
    expect(parse('Apaga las luces del salón')).toMatchObject({ ok: true, intent: { entityIds: ['light.luz_salon', 'light.lampara'], areaId: 'salon' } });
    expect(parse('Abre la persiana')).toMatchObject({ ok: true, intent: { name: 'HassTurnOn', entityIds: ['cover.persiana'] } });
  });

  it('HassLightSet, HassSetPosition y HassClimateSetTemperature', () => {
    expect(parse('Pon la luz del salón al 30 %')).toMatchObject({ ok: true, intent: { name: 'HassLightSet', data: { brightness_pct: 30 } } });
    expect(parse('Pon la persiana al 50 %')).toMatchObject({ ok: true, intent: { name: 'HassSetPosition', entityIds: ['cover.persiana'], data: { position: 50 } } });
    expect(parse('Pon la calefacción a 22,5 grados')).toMatchObject({ ok: true, intent: { name: 'HassClimateSetTemperature', data: { temperature: 22.5 } } });
  });

  it('HassGetState, escenas y robot', () => {
    expect(parse('¿Qué temperatura hace en el dormitorio?')).toMatchObject({ ok: true, intent: { name: 'HassGetState', query: 'temperature', entityIds: ['sensor.clima_dorm_temperature'] } });
    expect(parse('¿Está encendida la luz del salón?')).toMatchObject({ ok: true, intent: { name: 'HassGetState', entityIds: ['light.luz_salon'] } });
    expect(parse('Activa la escena Cine')).toMatchObject({ ok: true, intent: { name: 'HassSceneActivate', sceneId: 'cine' } });
    expect(parse('Limpia la cocina')).toMatchObject({ ok: true, intent: { name: 'HassVacuumStart', areaId: 'cocina' } });
    expect(parse('Manda el robot a la base')).toMatchObject({ ok: true, intent: { name: 'HassVacuumReturnToBase' } });
  });

  it('no entiende o no encuentra el destino', () => {
    expect(parse('cuéntame un chiste')).toEqual({ ok: false, reason: 'not_understood' });
    expect(parse('enciende el jacuzzi')).toMatchObject({ ok: false, reason: 'no_target' });
  });
});

function home(): Project {
  const withRoom = (d: Device, roomId: string, extra: Partial<Device> = {}): Device => ({ ...d, roomId, ...extra });
  return project(
    [
      withRoom(dev('srv', 'ha-green'), 'salon'),
      withRoom(dev('luz', 'hue-white-e27', undefined, { name: 'Luz salón', integration: 'zha', protocol: 'zigbee' }), 'salon', { exposedTo: ['assist', 'alexa'] }),
      withRoom(dev('luz2', 'hue-white-e27', undefined, { name: 'Luz cocina', integration: 'zha', protocol: 'zigbee' }), 'cocina'),
      withRoom(dev('voz', 'ha-voice-pe', undefined, { name: 'Voz cocina' }), 'cocina'),
      withRoom(dev('echo', 'amazon-echo-dot-5', undefined, { name: 'Echo' }), 'salon'),
      withRoom(dev('nest', 'google-nest-audio', undefined, { name: 'Nest' }), 'salon'),
    ],
    {
      rooms: [room('salon', 'Salón'), room('cocina', 'Cocina')],
      automations: [{ id: 'a', name: 'Buenas noches', enabled: true, mode: 'single', triggers: [{ type: 'conversation', command: ['[oye] buenas noches'] }], conditions: [], actions: [{ type: 'service', service: 'light.turn_off', entityId: 'light.luz_salon' }] }],
    },
  );
}

describe('decir una frase a un asistente', () => {
  it('Assist enciende la luz, responde y vuelve a reposo', () => {
    const p = home();
    const r = sayToAssistant(createSimulationState(p, catalog, T0), p, 'voz', 'Enciende la luz de la cocina');
    expect(r.ok).toBe(true);
    expect(r.sim.entities['light.luz_cocina']?.state).toBe('on');
    expect(r.sim.entities['assist_satellite.voz_cocina_satellite']?.state).toBe('responding');
    expect(r.sim.speech?.voz?.kind).toBe('response');
    expect(r.sim.log.some((l) => l.message.includes('💬'))).toBe(true);
  });

  it('las frases personalizadas tienen prioridad', () => {
    const p = home();
    let sim = createSimulationState(p, catalog, T0);
    sim = { ...sim, entities: { ...sim.entities, 'light.luz_salon': { state: 'on', attributes: {} } } };
    const r = sayToAssistant(sim, p, 'voz', 'Oye, buenas noches');
    expect(r.response).toBe('Hecho');
    expect(r.sim.entities['light.luz_salon']?.state).toBe('off');
  });

  it('Alexa solo maneja lo expuesto y Google no ve lo que no se le expone', () => {
    const p = home();
    const sim = createSimulationState(p, catalog, T0);
    expect(sayToAssistant(sim, p, 'echo', 'Alexa, enciende la luz del salón').sim.entities['light.luz_salon']?.state).toBe('on');
    const g = sayToAssistant(sim, p, 'nest', 'Ok Google, enciende la luz del salón');
    expect(g.ok).toBe(false);
    expect(g.response).toMatch(/No encuentro/);
    expect(g.sim.log.some((l) => /no está expuesto a Google/.test(l.message))).toBe(true);
  });

  it('sin Internet, Alexa y Google no entienden nada pero Assist sigue', () => {
    const p = home();
    const offline = setFailures(createSimulationState(p, catalog, T0), p, catalog, { internet: true });
    const echo = sayToAssistant(offline, p, 'echo', 'Alexa, enciende la luz del salón');
    expect(echo.response).toBe(OFFLINE_REPLY);
    expect(echo.sim.entities['light.luz_salon']?.state).toBe('off');
    expect(sayToAssistant(offline, p, 'voz', 'Enciende la luz del salón').sim.entities['light.luz_salon']?.state).toBe('on');
  });

  it('lista de entidades candidatas con área y alias', () => {
    const p = home();
    const list = intentEntities(p);
    expect(list.find((e) => e.entityId === 'light.luz_salon')).toMatchObject({ areaName: 'Salón', deviceId: 'luz' });
  });
});
