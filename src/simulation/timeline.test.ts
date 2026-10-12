import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project, Timeline } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import { callService, createSimulationState, setEntityState, tick } from './engine';
import { pressButton, triggerMotion } from './events';
import { movePerson } from './people';
import { compareValues, recordTimeline, runTimeline, stepTimes } from './timeline';

const START = Date.UTC(2026, 9, 12, 7, 0);
const MOTION = 'binary_sensor.mov_motion';
const LIGHT = 'light.luz';
const BUTTON = 'sensor.boton_action';

const p: Project = project(
  [
    dev('m', 'aqara-motion-p1', undefined, { name: 'Mov' }),
    dev('l', 'hue-white-e27', undefined, { name: 'Luz' }),
    dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Boton' }),
  ],
  {
    people: [{ id: 'ana', name: 'Ana' }],
    zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }],
    automations: [
      {
        id: 'a',
        name: 'Luz con movimiento',
        enabled: true,
        mode: 'restart',
        triggers: [{ type: 'state', entityId: MOTION, to: 'on' }],
        conditions: [],
        actions: [
          { type: 'service', service: 'light.turn_on', entityId: LIGHT },
          { type: 'delay', seconds: 120 },
          { type: 'service', service: 'light.turn_off', entityId: LIGHT },
        ],
      },
    ],
  },
);

const timeline: Timeline = {
  id: 't',
  name: 'Mañana',
  steps: [
    { at: '08:00', kind: 'event', event: 'motion', entityId: MOTION },
    { at: '08:00', kind: 'assert', entityId: LIGHT, expect: 'on' },
    { at: '08:01', kind: 'assert', entityId: LIGHT, expect: 'on' },
    { at: '08:03', kind: 'assert', entityId: LIGHT, expect: 'off' },
    { at: '08:03', kind: 'assert', entityId: LIGHT, expect: 'on', op: 'ne' },
    { at: '09:00', kind: 'event', event: 'person', personId: 'ana', zoneId: 'trabajo' },
    { at: '09:00', kind: 'assert', entityId: 'zone.home', expect: 1, op: 'lt' },
    { at: '09:00', kind: 'assert', entityId: 'person.ana', expect: 'Trabajo' },
  ],
};

describe('runTimeline', () => {
  it('ejecuta eventos y aserciones y aprueba', () => {
    const run = runTimeline(p, catalog, timeline, START);
    expect(run.results.filter((r) => !r.ok).map((r) => r.message)).toEqual([]);
    expect(run.passed).toBe(true);
    expect(run.results[1]?.at).toBe(START + HOUR_MS);
  });

  it('es determinista', () => {
    const a = runTimeline(p, catalog, timeline, START);
    const b = runTimeline(p, catalog, timeline, START);
    expect(a.results).toEqual(b.results);
    expect(a.sim).toEqual(b.sim);
  });

  it('informa de los fallos con el valor observado', () => {
    const run = runTimeline(p, catalog, { id: 'x', name: 'x', steps: [{ at: '08:00', kind: 'assert', entityId: LIGHT, expect: 'on' }, { at: '08:00', kind: 'assert', entityId: 'light.nada', expect: 'on' }, { at: '08:00', kind: 'event', event: 'service', entityId: LIGHT }] }, START);
    expect(run.passed).toBe(false);
    expect(run.results[0]).toMatchObject({ ok: false, actual: 'off', expected: 'on' });
    expect(run.results[0]?.message).toMatch(/se esperaba = on y es off/);
    expect(run.results[1]?.message).toMatch(/no existe/);
    expect(run.results[2]?.message).toMatch(/Evento no válido/);
  });

  it('una hora no válida falla todos los pasos', () => {
    const run = runTimeline(p, catalog, { id: 'x', name: 'x', steps: [{ at: '25:00', kind: 'assert', entityId: LIGHT, expect: 'on' }] }, START);
    expect(run.passed).toBe(false);
  });

  it('las horas anteriores pasan al día siguiente', () => {
    const times = stepTimes([{ at: '23:00', kind: 'assert', entityId: 'x', expect: 1 }, { at: '01:00', kind: 'assert', entityId: 'x', expect: 1 }, { at: '06:00', kind: 'assert', entityId: 'x', expect: 1 }], START);
    expect(times).toEqual([START + 16 * HOUR_MS, START + 18 * HOUR_MS, START + 23 * HOUR_MS]);
  });

  it('compareValues', () => {
    expect(compareValues(true, 'on')).toBe(true);
    expect(compareValues('21.5', 21, 'gt')).toBe(true);
    expect(compareValues('abc', 1, 'gt')).toBe(false);
    expect(compareValues(null, 'on', 'ne')).toBe(true);
    expect(compareValues(5, 5, 'lte')).toBe(true);
    expect(compareValues(5, 5, 'gte')).toBe(true);
    expect(compareValues(4, 5, 'lt')).toBe(true);
  });
});

describe('recordTimeline', () => {
  it('graba una sesión y al reproducirla pasa', () => {
    let sim = createSimulationState(p, catalog, START);
    sim = tick(sim, p, HOUR_MS);
    sim = triggerMotion(sim, p, MOTION);
    sim = tick(sim, p, 5 * MINUTE_MS);
    sim = pressButton(sim, p, BUTTON, 'double');
    sim = movePerson(sim, p, 'ana', 'trabajo');
    sim = callService(sim, p, LIGHT, 'light.turn_on', { brightness: 50 });
    sim = tick(sim, p, 30 * 1000);
    sim = setEntityState(sim, p, LIGHT, 'off');
    const steps = recordTimeline(sim.log);
    expect(steps.filter((s) => s.kind === 'event').map((s) => (s.kind === 'event' ? s.event : ''))).toEqual(['motion', 'button', 'person', 'service', 'state']);
    expect(steps.some((s) => s.kind === 'assert' && s.entityId === LIGHT && s.at === '08:02' && s.expect === 'off')).toBe(true);
    const run = runTimeline(p, catalog, { id: 'r', name: 'Grabada', steps }, START);
    expect(run.results.filter((r) => !r.ok).map((r) => r.message)).toEqual([]);
  });
});
