// Tanda 3: helpers, nuevos disparadores (time_pattern, homeassistant, event, numeric_state con
// for), condición de día de la semana y acciones stop, parallel, continue_on_error y enabled.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Action, Automation, Helper, Project } from '../types';
import { HOUR_MS, MINUTE_MS, SECOND_MS } from './clock';
import {
  callService,
  createSimulationState,
  fireEvent,
  fireHomeAssistantEvent,
  runActions,
  runAutomation,
  setEntityState,
  tick,
  timePatternOccurrences,
} from './engine';
import { setFailures } from './availability';
import { applyHelperService, formatTimerDuration, helperEntityId, helperEntities, parseTimerDuration, renameHelperMapping, validateHelper } from './helpers';
import { describeTrigger, explainCondition } from './trace';
import { failureImpact } from './scenarios';
import { NO_FAILURES } from './connectivity';
import { pressButton } from './events';

// Lunes 12/10/2026 a las 00:00 (hora de pared simulada).
const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);

const HELPERS: Helper[] = [
  { id: 'h1', type: 'input_boolean', name: 'Modo vacaciones' },
  { id: 'h2', type: 'input_number', name: 'Consigna', min: 15, max: 25, step: 0.5, mode: 'slider', unit: '°C', initial: 20 },
  { id: 'h3', type: 'input_select', name: 'Modo casa', options: ['Normal', 'Noche', 'Fuera'] },
  { id: 'h4', type: 'input_text', name: 'Mensaje', max: 5 },
  { id: 'h5', type: 'input_datetime', name: 'Despertador', has_date: false, has_time: true, initial: '07:00:00' },
  { id: 'h6', type: 'timer', name: 'Riego', duration: 300 },
  { id: 'h7', type: 'counter', name: 'Visitas', initial: 0, step: 1, maximum: 2 },
];

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'parallel', triggers: [], conditions: [], actions: [], ...partial };
}

function home(automations: Automation[] = [], extra: Partial<Project> = {}): Project {
  return project(
    [
      dev('l1', 'hue-white-e27', undefined, { name: 'Luz uno' }),
      dev('l2', 'hue-white-e27', undefined, { name: 'Luz dos' }),
      dev('t', 'aqara-temp-hum', undefined, { name: 'Clima' }),
      dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Boton', integration: 'zha' }),
      dev('n', 'netatmo-thermostat', undefined, { name: 'Termo' }),
    ],
    { automations, helpers: HELPERS, ...extra },
  );
}

const start = (p: Project, at = T0 + 12 * HOUR_MS) => createSimulationState(p, catalog, at);
const st = (sim: ReturnType<typeof start>, id: string) => sim.entities[id]?.state;

describe('helpers', () => {
  it('cada helper es una entidad <tipo>.<slug> con su estado inicial', () => {
    expect(HELPERS.map(helperEntityId)).toEqual([
      'input_boolean.modo_vacaciones',
      'input_number.consigna',
      'input_select.modo_casa',
      'input_text.mensaje',
      'input_datetime.despertador',
      'timer.riego',
      'counter.visitas',
    ]);
    const e = helperEntities({ helpers: HELPERS });
    expect(e['input_boolean.modo_vacaciones']?.state).toBe('off');
    expect(e['input_number.consigna']?.state).toBe(20);
    expect(e['input_select.modo_casa']?.state).toBe('Normal');
    expect(e['timer.riego']?.attributes?.duration).toBe('0:05:00');
    const sim = start(home());
    expect(st(sim, 'counter.visitas')).toBe(0);
  });

  it('servicios de input_boolean, input_number, input_select, input_text y counter', () => {
    const p = home();
    let sim = start(p);
    sim = callService(sim, p, 'input_boolean.modo_vacaciones', 'input_boolean.toggle');
    expect(st(sim, 'input_boolean.modo_vacaciones')).toBe('on');
    sim = callService(sim, p, 'input_boolean.modo_vacaciones', 'homeassistant.turn_off');
    expect(st(sim, 'input_boolean.modo_vacaciones')).toBe('off');
    sim = callService(sim, p, 'input_number.consigna', 'input_number.set_value', { value: 22.3 });
    expect(st(sim, 'input_number.consigna')).toBe(22.5);
    sim = callService(sim, p, 'input_number.consigna', 'input_number.increment');
    expect(st(sim, 'input_number.consigna')).toBe(23);
    sim = callService(sim, p, 'input_number.consigna', 'input_number.set_value', { value: 40 });
    expect(st(sim, 'input_number.consigna')).toBe(23);
    sim = callService(sim, p, 'input_select.modo_casa', 'input_select.select_previous');
    expect(st(sim, 'input_select.modo_casa')).toBe('Fuera');
    sim = callService(sim, p, 'input_select.modo_casa', 'input_select.select_option', { option: 'Noche' });
    expect(st(sim, 'input_select.modo_casa')).toBe('Noche');
    sim = callService(sim, p, 'input_select.modo_casa', 'input_select.select_option', { option: 'Playa' });
    expect(st(sim, 'input_select.modo_casa')).toBe('Noche');
    sim = callService(sim, p, 'input_text.mensaje', 'input_text.set_value', { value: 'demasiado largo' });
    expect(st(sim, 'input_text.mensaje')).toBe('');
    sim = callService(sim, p, 'input_text.mensaje', 'input_text.set_value', { value: 'hola' });
    expect(st(sim, 'input_text.mensaje')).toBe('hola');
    sim = callService(sim, p, 'input_datetime.despertador', 'input_datetime.set_datetime', { time: '06:45' });
    expect(st(sim, 'input_datetime.despertador')).toBe('06:45:00');
    for (let i = 0; i < 3; i++) sim = callService(sim, p, 'counter.visitas', 'counter.increment');
    expect(st(sim, 'counter.visitas')).toBe(2);
    expect(sim.log.some((l) => l.level === 'warning' && l.message.includes('no puede pasar a 3'))).toBe(true);
    sim = callService(sim, p, 'counter.visitas', 'counter.reset');
    expect(st(sim, 'counter.visitas')).toBe(0);
  });

  it('timer: start, pause, change, cancel y timer.finished como disparador', () => {
    const p = home([
      auto('fin', {
        triggers: [{ type: 'event', eventType: 'timer.finished', eventData: { entity_id: 'timer.riego' } }],
        actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno' }],
      }),
    ]);
    let sim = start(p);
    sim = callService(sim, p, 'timer.riego', 'timer.start');
    expect(st(sim, 'timer.riego')).toBe('active');
    sim = tick(sim, p, 2 * MINUTE_MS);
    sim = callService(sim, p, 'timer.riego', 'timer.pause');
    expect(st(sim, 'timer.riego')).toBe('paused');
    expect(sim.entities['timer.riego']?.attributes?.remaining).toBe('0:03:00');
    sim = tick(sim, p, 10 * MINUTE_MS);
    expect(st(sim, 'light.luz_uno')).toBe('off');
    sim = callService(sim, p, 'timer.riego', 'timer.start');
    sim = callService(sim, p, 'timer.riego', 'timer.change', { duration: '-00:01:00' });
    sim = tick(sim, p, 2 * MINUTE_MS - SECOND_MS);
    expect(st(sim, 'timer.riego')).toBe('active');
    sim = tick(sim, p, 2 * SECOND_MS);
    expect(st(sim, 'timer.riego')).toBe('idle');
    expect(st(sim, 'light.luz_uno')).toBe('on');
    expect(sim.traces?.[0]?.trigger).toMatchObject({ description: 'Evento timer.finished de Riego' });
    // cancel no dispara timer.finished
    sim = callService(callService(sim, p, 'light.luz_uno', 'light.turn_off'), p, 'timer.riego', 'timer.start', { duration: '00:00:30' });
    sim = callService(sim, p, 'timer.riego', 'timer.cancel');
    sim = tick(sim, p, MINUTE_MS);
    expect(st(sim, 'light.luz_uno')).toBe('off');
  });

  it('applyHelperService funciona sin el proyecto (configuración en los atributos)', () => {
    const e = helperEntities({ helpers: HELPERS });
    const r = applyHelperService('input_number', 'input_number.consigna', 'decrement', e['input_number.consigna'] ?? { state: 0 });
    expect(r?.state.state).toBe(19.5);
    expect(applyHelperService('counter', 'counter.visitas', 'nope', { state: 0 })).toBeUndefined();
    expect(parseTimerDuration('01:02:03')).toBe(3723);
    expect(parseTimerDuration('05:00')).toBe(300);
    expect(formatTimerDuration(3723)).toBe('1:02:03');
  });

  it('validateHelper y renameHelperMapping', () => {
    expect(validateHelper({ id: 'x', type: 'input_number', name: 'N', min: 5, max: 1, step: 0, mode: 'box' })).toHaveLength(2);
    expect(validateHelper({ id: 'x', type: 'input_select', name: 'S', options: [] })).toEqual(['El desplegable necesita al menos una opción']);
    expect(validateHelper({ id: 'x', type: 'timer', name: 'T', duration: 0 })).toEqual(['La duración debe ser mayor que 0']);
    expect(validateHelper(HELPERS[0] as Helper)).toEqual([]);
    expect(renameHelperMapping({ helpers: HELPERS }, 'h1', 'Vacaciones')).toEqual({ 'input_boolean.modo_vacaciones': 'input_boolean.vacaciones' });
  });
});

describe('nuevos disparadores', () => {
  it('time_pattern: /5 minutos, con los valores por defecto de HA', () => {
    expect(timePatternOccurrences({ minutes: '/15' }, T0, T0 + HOUR_MS, 100).map((t) => (t - T0) / MINUTE_MS)).toEqual([15, 30, 45, 60]);
    expect(timePatternOccurrences({ hours: '/6' }, T0, T0 + 13 * HOUR_MS, 100).map((t) => (t - T0) / HOUR_MS)).toEqual([6, 12]);
    expect(timePatternOccurrences({ seconds: '/20' }, T0, T0 + MINUTE_MS, 100)).toHaveLength(3);
    expect(timePatternOccurrences({ minutes: '99' }, T0, T0 + HOUR_MS, 100)).toEqual([]);
    const p = home([auto('cada', { triggers: [{ type: 'time_pattern', minutes: '/10' }], actions: [{ type: 'service', service: 'counter.increment', entityId: 'counter.visitas' }] })]);
    const sim = tick(start(p, T0), p, 25 * MINUTE_MS);
    expect(st(sim, 'counter.visitas')).toBe(2);
    expect(describeTrigger({ type: 'time_pattern', minutes: '/10' }, sim)).toBe('Patrón de hora: cada 10 min');
  });

  it('homeassistant start/shutdown: al arrancar y al reiniciar HA en los escenarios', () => {
    const p = home([
      auto('arranque', { triggers: [{ type: 'homeassistant', event: 'start' }], actions: [{ type: 'service', service: 'counter.increment', entityId: 'counter.visitas' }] }),
      auto('parada', { triggers: [{ type: 'homeassistant', event: 'shutdown' }], actions: [{ type: 'service', service: 'input_boolean.turn_on', entityId: 'input_boolean.modo_vacaciones' }] }),
    ]);
    let sim = fireHomeAssistantEvent(start(p), p, 'start');
    expect(st(sim, 'counter.visitas')).toBe(1);
    sim = setFailures(sim, p, catalog, { haRestarting: true });
    expect(st(sim, 'input_boolean.modo_vacaciones')).toBe('on');
    sim = setFailures(sim, p, catalog, { haRestarting: false });
    expect(st(sim, 'counter.visitas')).toBe(2);
    const impact = failureImpact(p, catalog, { ...NO_FAILURES, haRestarting: true });
    expect(impact.automations.find((a) => a.automationId === 'arranque')?.status).toBe('degraded');
  });

  it('event: datos del evento y eventos de mando (zha_event)', () => {
    const p = home([
      auto('ev', {
        triggers: [{ type: 'event', eventType: 'zha_event', eventData: { command: 'double' } }],
        actions: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_dos' }],
      }),
    ]);
    let sim = pressButton(start(p), p, 'sensor.boton_action', 'single');
    expect(st(sim, 'light.luz_dos')).toBe('off');
    sim = pressButton(sim, p, 'sensor.boton_action', 'double');
    expect(st(sim, 'light.luz_dos')).toBe('on');
    sim = fireEvent(sim, p, 'zha_event', { command: 'double', device_id: 'otro' });
    expect(st(sim, 'light.luz_dos')).toBe('off');
  });

  it('numeric_state con for: dispara si el valor sigue en el rango ese tiempo', () => {
    const p = home([
      auto('calor', {
        triggers: [{ type: 'numeric_state', entityId: 'sensor.clima_temperature', above: 26, for: 300 }],
        actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno' }],
      }),
    ]);
    let sim = setEntityState(start(p), p, 'sensor.clima_temperature', 27);
    sim = tick(sim, p, 2 * MINUTE_MS);
    sim = setEntityState(sim, p, 'sensor.clima_temperature', 28); // sigue en el rango
    sim = tick(sim, p, 2 * MINUTE_MS);
    expect(st(sim, 'light.luz_uno')).toBe('off');
    sim = tick(sim, p, 2 * MINUTE_MS);
    expect(st(sim, 'light.luz_uno')).toBe('on');
    // si sale del rango se cancela
    sim = callService(sim, p, 'light.luz_uno', 'light.turn_off');
    sim = setEntityState(setEntityState(sim, p, 'sensor.clima_temperature', 20), p, 'sensor.clima_temperature', 27);
    sim = tick(sim, p, MINUTE_MS);
    sim = setEntityState(sim, p, 'sensor.clima_temperature', 22);
    sim = tick(sim, p, 10 * MINUTE_MS);
    expect(st(sim, 'light.luz_uno')).toBe('off');
  });

  it('un disparador con enabled: false no dispara', () => {
    const p = home([auto('x', { triggers: [{ type: 'state', entityId: 'light.luz_uno', to: 'on', enabled: false }], actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_dos' }] })]);
    const sim = callService(start(p), p, 'light.luz_uno', 'light.turn_on');
    expect(st(sim, 'light.luz_dos')).toBe('off');
  });
});

describe('condición de día de la semana', () => {
  it('weekday: el lunes se cumple mon y no sat/sun; enabled: false se ignora', () => {
    const p = home();
    const sim = start(p); // lunes
    const where = { sunrise: '07:00', sunset: '20:00' };
    expect(explainCondition({ type: 'time', weekday: ['mon', 'tue'] }, sim, where).result).toBe(true);
    const weekend = explainCondition({ type: 'time', after: '08:00', weekday: ['sat', 'sun'] }, sim, where);
    expect(weekend.result).toBe(false);
    expect(weekend.description).toBe('Hora a partir de las 08:00, días: sábado, domingo');
    expect(weekend.detail).toBe('son las 12:00 del lunes');
    expect(explainCondition({ type: 'time', weekday: ['sun'], enabled: false }, sim, where).result).toBe(true);
  });
});

describe('stop, parallel, continue_on_error y enabled en acciones', () => {
  const on = (id: string): Action => ({ type: 'service', service: 'light.turn_on', entityId: id });

  it('stop detiene la secuencia; con error la traza acaba en error', () => {
    const p = home([
      auto('a', { actions: [on('light.luz_uno'), { type: 'stop', message: 'basta' }, on('light.luz_dos')] }),
      auto('b', { actions: [{ type: 'stop', message: 'fallo', error: true }, on('light.luz_dos')] }),
    ]);
    let sim = runAutomation(start(p), p, 'a');
    expect(st(sim, 'light.luz_uno')).toBe('on');
    expect(st(sim, 'light.luz_dos')).toBe('off');
    expect(sim.traces?.[0]?.result).toBe('ran');
    sim = runAutomation(sim, p, 'b');
    expect(sim.traces?.[1]?.result).toBe('error');
    expect(sim.traces?.[1]?.actions[0]).toMatchObject({ status: 'error', detail: 'fallo' });
  });

  it('parallel: las ramas avanzan a la vez y la secuencia sigue al terminar todas', () => {
    const p = home([
      auto('par', {
        actions: [
          {
            type: 'parallel',
            branches: [
              [{ type: 'delay', seconds: 60 }, on('light.luz_uno')],
              [{ type: 'delay', seconds: 120 }, on('light.luz_dos')],
              [{ type: 'service', service: 'counter.increment', entityId: 'counter.visitas' }],
            ],
          },
          { type: 'service', service: 'input_boolean.turn_on', entityId: 'input_boolean.modo_vacaciones' },
        ],
      }),
    ]);
    let sim = runAutomation(start(p), p, 'par');
    expect(st(sim, 'counter.visitas')).toBe(1);
    expect(sim.traces?.[0]?.actions[0]?.status).toBe('waiting');
    sim = tick(sim, p, 61 * SECOND_MS);
    expect(st(sim, 'light.luz_uno')).toBe('on');
    expect(st(sim, 'light.luz_dos')).toBe('off');
    expect(st(sim, 'input_boolean.modo_vacaciones')).toBe('off');
    sim = tick(sim, p, 60 * SECOND_MS);
    expect(st(sim, 'light.luz_dos')).toBe('on');
    expect(st(sim, 'input_boolean.modo_vacaciones')).toBe('on');
    expect(sim.joins).toEqual({});
    expect(sim.traces?.[0]?.actions.map((a) => a.status)).toEqual(['done', 'done']);
  });

  it('parallel sin esperas sigue en el mismo paso; stop en una rama cancela el resto', () => {
    const p = home();
    let sim = runActions(start(p), p, [{ type: 'parallel', branches: [[on('light.luz_uno')], [on('light.luz_dos')]] }, { type: 'service', service: 'counter.increment', entityId: 'counter.visitas' }]);
    expect([st(sim, 'light.luz_uno'), st(sim, 'light.luz_dos'), st(sim, 'counter.visitas')]).toEqual(['on', 'on', 1]);
    sim = runActions(start(p), p, [
      { type: 'parallel', branches: [[{ type: 'delay', seconds: 30 }, on('light.luz_uno')], [{ type: 'stop', message: 'no' }]] },
      on('light.luz_dos'),
    ]);
    sim = tick(sim, p, MINUTE_MS);
    expect([st(sim, 'light.luz_uno'), st(sim, 'light.luz_dos')]).toEqual(['off', 'off']);
  });

  it('un error de la nube detiene la secuencia salvo con continue_on_error', () => {
    const p = home();
    let sim = setFailures(start(p), p, catalog, { internet: true });
    const cloud: Action = { type: 'service', service: 'climate.turn_off', entityId: 'climate.termo_climate' };
    let ran = runActions(sim, p, [cloud, on('light.luz_uno')]);
    expect(st(ran, 'light.luz_uno')).toBe('off');
    ran = runActions(sim, p, [{ ...cloud, continueOnError: true }, on('light.luz_uno')]);
    expect(st(ran, 'light.luz_uno')).toBe('on');
    sim = runActions(sim, p, [{ ...on('light.luz_uno'), enabled: false }, on('light.luz_dos')]);
    expect([st(sim, 'light.luz_uno'), st(sim, 'light.luz_dos')]).toEqual(['off', 'on']);
  });
});
