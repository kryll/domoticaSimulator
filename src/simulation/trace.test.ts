import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import type { Automation, Project, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import { createSimulationState, runAutomation, testTrigger, tick } from './engine';
import { motionPulse, pressButton } from './events';
import { describeTrigger, explainCondition, formatTraceCondition, lastTrace, MAX_TRACES_PER_AUTOMATION, stateLabel, tracesFor } from './trace';

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);
const at = (h: number, m = 0) => T0 + h * HOUR_MS + m * MINUTE_MS;
const demo: Project = createDemoProject();
const start = (now = at(15, 12), p: Project = demo): SimulationState => createSimulationState(p, catalog, now);
const MADRID = { latitude: 40.4168, longitude: -3.7038, timeZone: 'Europe/Madrid' };

describe('descripciones legibles', () => {
  it('estados en español según el dominio y la clase', () => {
    expect(stateLabel('light.x', 'on')).toBe('Encendida');
    expect(stateLabel('switch.x', false)).toBe('Apagado');
    expect(stateLabel('binary_sensor.x', 'on', 'motion')).toBe('Movimiento detectado');
    expect(stateLabel('binary_sensor.x', 'off', 'door')).toBe('Cerrada');
    expect(stateLabel('lock.x', 'locked')).toBe('Cerrada con llave');
    expect(stateLabel('sensor.x', 'unavailable')).toBe('No disponible');
    expect(stateLabel('sensor.x', 'single')).toBe('single');
  });

  it('disparadores', () => {
    const sim = start();
    expect(describeTrigger({ type: 'state', entityId: 'light.luz_salon', to: 'on' }, sim)).toBe('Luz salón cambió a Encendida');
    expect(describeTrigger({ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'off', for: 120 }, sim)).toBe(
      'Movimiento pasillo Movimiento cambió a Sin movimiento durante 2 min',
    );
    expect(describeTrigger({ type: 'numeric_state', entityId: 'sensor.clima_dormitorio_temperature', above: 26 }, sim)).toBe(
      'Clima dormitorio Temperatura pasa a estar por encima de 26 °C',
    );
    expect(describeTrigger({ type: 'time', at: '07:30' }, sim)).toBe('Son las 07:30');
    expect(describeTrigger({ type: 'sun', event: 'sunset', offsetMinutes: -15 }, sim)).toBe('Atardecer (15 min antes)');
  });

  it('condiciones con resultado y detalle', () => {
    const sim = start();
    const time = explainCondition({ type: 'time', after: '20:00', before: '07:30' }, sim, MADRID);
    expect(formatTraceCondition(time)).toBe('Hora entre 20:00 y 07:30 → no (son las 15:12)');
    const num = explainCondition({ type: 'numeric_state', entityId: 'sensor.clima_dormitorio_temperature', below: 30 }, sim, MADRID);
    expect(num.result).toBe(true);
    expect(num.detail).toMatch(/^vale \d/);
    const state = explainCondition({ type: 'state', entityId: 'light.luz_salon', state: 'on' }, sim, MADRID);
    expect(formatTraceCondition(state)).toBe('Luz salón está Encendida → no (está Apagada)');
    const sun = explainCondition({ type: 'sun', after: 'sunset', before: 'sunrise' }, sim, MADRID);
    expect(sun.result).toBe(false);
    expect(sun.description).toBe('Después del atardecer y antes del amanecer');
    expect(sun.detail).toMatch(/^son las 15:12; amanecer 08:\d\d, atardecer 19:\d\d$/);
  });
});

describe('trazas de ejecución (B4)', () => {
  it('una ejecución deja traza con disparador, condiciones y acciones (con espera)', () => {
    let sim = motionPulse(start(at(22)), demo, 'binary_sensor.movimiento_pasillo_motion');
    const trace = lastTrace(sim, 'demo-auto-movimiento');
    expect(trace).toMatchObject({
      automationId: 'demo-auto-movimiento',
      startedAt: at(22),
      result: 'ran',
      trigger: { index: 0, description: 'Movimiento pasillo Movimiento cambió a Movimiento detectado' },
      conditions: [{ index: 0, description: 'Hora entre 20:00 y 07:30', result: true, detail: 'son las 22:00' }],
    });
    expect(trace?.actions.map((a) => [a.description, a.status])).toEqual([
      ['Encender Luz salón (brillo 47 %)', 'done'],
      ['Esperar 2 min', 'waiting'],
      ['Apagar Luz salón', 'skipped'],
    ]);
    sim = tick(sim, demo, 3 * MINUTE_MS);
    expect(lastTrace(sim, 'demo-auto-movimiento')?.actions.map((a) => a.status)).toEqual(['done', 'done', 'done']);
    expect(lastTrace(sim, 'demo-auto-movimiento')?.actions[2]?.at).toBe(at(22, 2));
  });

  it('condiciones no cumplidas', () => {
    const sim = motionPulse(start(), demo, 'binary_sensor.movimiento_pasillo_motion');
    const trace = lastTrace(sim, 'demo-auto-movimiento');
    expect(trace?.result).toBe('conditions_failed');
    expect(trace?.conditions[0]).toMatchObject({ result: false, detail: 'son las 15:12' });
    expect(trace?.actions.every((a) => a.status === 'skipped')).toBe(true);
  });

  it('modo restart: la espera anterior queda cancelada en su traza', () => {
    let sim = motionPulse(start(at(22)), demo, 'binary_sensor.movimiento_pasillo_motion');
    sim = tick(sim, demo, 70_000); // el sensor vuelve a off a los 60 s
    sim = motionPulse(sim, demo, 'binary_sensor.movimiento_pasillo_motion');
    const [latest, previous] = tracesFor(sim, 'demo-auto-movimiento');
    expect(latest?.actions[1]?.status).toBe('waiting');
    expect(previous?.actions[1]).toMatchObject({ status: 'skipped', detail: 'cancelada: la automatización se reinició' });
  });

  it('modo single ignorado y error de acción', () => {
    const p: Project = {
      ...demo,
      automations: [
        { id: 'x', name: 'X', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'single' }], conditions: [], actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.no_existe' }, { type: 'delay', seconds: 60 }] },
      ],
    };
    let sim = pressButton(start(), p, 'sensor.mando_salon_action');
    sim = pressButton(sim, p, 'sensor.mando_salon_action');
    const [second, first] = tracesFor(sim, 'x');
    expect(first?.actions[0]).toMatchObject({ status: 'error', detail: 'entidad desconocida light.no_existe' });
    expect(second?.result).toBe('skipped_single');
  });

  it('modo queued: la traza pasa de queued a ran al ejecutarse', () => {
    const queued: Automation = { id: 'q', name: 'Q', enabled: true, mode: 'queued', triggers: [{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'single' }], conditions: [], actions: [{ type: 'delay', seconds: 10 }] };
    const p: Project = { ...demo, automations: [queued] };
    let sim = pressButton(pressButton(start(), p, 'sensor.mando_salon_action'), p, 'sensor.mando_salon_action');
    expect(tracesFor(sim, 'q').map((t) => t.result)).toEqual(['queued', 'ran']);
    sim = tick(sim, p, 11_000);
    expect(tracesFor(sim, 'q').map((t) => t.result)).toEqual(['ran', 'ran']);
    expect(tracesFor(sim, 'q')[0]?.actions[0]?.status).toBe('waiting');
  });

  it('ejecutar a mano deja traza manual; como mucho 50 trazas por automatización', () => {
    let sim = start();
    for (let i = 0; i < MAX_TRACES_PER_AUTOMATION + 5; i++) sim = runAutomation(sim, demo, 'demo-auto-mando', { skipConditions: true });
    const traces = tracesFor(sim, 'demo-auto-mando');
    expect(traces).toHaveLength(MAX_TRACES_PER_AUTOMATION);
    expect(traces[0]?.trigger).toEqual({ manual: true });
    expect(traces[0]?.conditions).toEqual([]);
  });

  it('testTrigger simula el disparador y evalúa las condiciones de verdad', () => {
    const day = testTrigger(start(), demo, 'demo-auto-movimiento', 0);
    expect(lastTrace(day, 'demo-auto-movimiento')).toMatchObject({ result: 'conditions_failed', trigger: { index: 0 } });
    expect(day.entities['binary_sensor.movimiento_pasillo_motion']?.state).toBe('off');
    const night = testTrigger(start(at(23)), demo, 'demo-auto-movimiento', 0);
    expect(lastTrace(night, 'demo-auto-movimiento')?.result).toBe('ran');
    expect(night.entities['light.luz_salon']?.state).toBe('on');
    expect(testTrigger(start(), demo, 'demo-auto-movimiento', 5).log.at(-1)?.message).toMatch(/no tiene el disparador 6/);
  });

  it('disparadores de hora y sol dejan su índice y descripción', () => {
    const sim = tick(start(at(18)), demo, 3 * HOUR_MS);
    const trace = lastTrace(sim, 'demo-auto-atardecer');
    expect(trace?.trigger).toEqual({ index: 0, description: 'Atardecer (15 min antes)' });
    expect(trace?.result).toBe('ran');
  });
});

describe('revisión de trazas', () => {
  it('and/or incluyen las subcondiciones con su resultado', () => {
    const sim = start();
    const and = explainCondition({ type: 'and', conditions: [{ type: 'time', after: '20:00' }, { type: 'or', conditions: [{ type: 'state', entityId: 'light.luz_salon', state: 'off' }] }] }, sim, MADRID);
    expect(and.result).toBe(false);
    expect(and.children?.map((c) => [c.index, c.result])).toEqual([[0, false], [1, true]]);
    expect(and.children?.[1]?.children?.[0]).toMatchObject({ index: 0, result: true, detail: 'está Apagada' });
    const p: Project = { ...demo, automations: [{ ...demo.automations[0]!, conditions: [{ type: 'or', conditions: [{ type: 'time', after: '20:00' }] }] }] };
    const traced = testTrigger(sim, p, 'demo-auto-movimiento', 0);
    expect(lastTrace(traced, 'demo-auto-movimiento')?.conditions[0]?.children).toHaveLength(1);
  });

  it('en una espera, at es la hora de inicio y no hay detalle con la hora', () => {
    let sim = motionPulse(start(at(22)), demo, 'binary_sensor.movimiento_pasillo_motion');
    expect(lastTrace(sim, 'demo-auto-movimiento')?.actions[1]).toEqual({ index: 1, description: 'Esperar 2 min', status: 'waiting', at: at(22) });
    sim = tick(sim, demo, 3 * MINUTE_MS);
    expect(lastTrace(sim, 'demo-auto-movimiento')?.actions[1]).toEqual({ index: 1, description: 'Esperar 2 min', status: 'done', at: at(22) });
  });
});
