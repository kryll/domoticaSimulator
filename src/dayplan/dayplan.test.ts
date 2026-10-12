// Tanda 3: generador de día típico.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { createSimulationState, tick } from '../simulation/engine';
import { DAY_MS, HOUR_MS } from '../simulation/clock';
import { applyDayPlan, clearDayPlan, eventsPerHour, generateDayPlan, planTime, roomKind, seededRandom } from './dayplan';

const DAY = Date.UTC(2026, 9, 12);

describe('generateDayPlan', () => {
  it('es determinista con la semilla y cambia con otra semilla', () => {
    const p = createDemoProject();
    const a = generateDayPlan(p, catalog, { people: 2, profile: 'teletrabajo', seed: 42 });
    const b = generateDayPlan(p, catalog, { people: 2, profile: 'teletrabajo', seed: 42 });
    const c = generateDayPlan(p, catalog, { people: 2, profile: 'teletrabajo', seed: 7 });
    expect(a).toEqual(b);
    expect(a.events.map((e) => e.at)).not.toEqual(c.events.map((e) => e.at));
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });

  it('incluye movimiento, luces, puerta, ducha, TV y salir y volver', () => {
    const p = createDemoProject();
    const plan = generateDayPlan(p, catalog, { people: 2, profile: 'oficina', seed: 1 });
    const kinds = new Set(plan.events.map((e) => e.step.event));
    expect(kinds).toEqual(new Set(['motion', 'service', 'door', 'state', 'person']));
    expect(plan.events.some((e) => e.step.entityId === 'binary_sensor.movimiento_pasillo_motion')).toBe(true);
    expect(plan.events.some((e) => e.step.entityId === 'sensor.sensor_bano_humidity' && e.step.value === 85)).toBe(true);
    expect(plan.events.some((e) => e.step.service === 'media_player.turn_on' && e.step.entityId === 'media_player.televisor')).toBe(true);
    expect(plan.events.filter((e) => e.step.event === 'person' && e.step.personId === 'demo-ana').map((e) => e.step.zoneId)).toEqual(['demo-trabajo', 'home']);
    expect(plan.events.every((e, i, xs) => i === 0 || (xs[i - 1]?.at ?? 0) <= e.at)).toBe(true);
    expect(eventsPerHour(plan).reduce((a, b) => a + b, 0)).toBe(plan.events.length);
  });

  it('reconoce el tipo de sala por su nombre', () => {
    expect(roomKind('Baño principal')).toBe('bathroom');
    expect(roomKind('Habitación de invitados')).toBe('bedroom');
    expect(roomKind('Distribuidor')).toBe('corridor');
    expect(roomKind('Trastero')).toBe('other');
    expect(planTime(7 * HOUR_MS + 61_000)).toBe('07:01:01');
  });
});

describe('applyDayPlan', () => {
  it('programa los eventos como temporizadores y a 600x la casa reacciona', () => {
    const p = createDemoProject();
    const plan = generateDayPlan(p, catalog, { people: 1, profile: 'oficina', seed: 3 });
    let sim = createSimulationState(p, catalog, DAY);
    sim = applyDayPlan(sim, p, plan, DAY, DAY + DAY_MS);
    const scheduled = sim.pending.filter((x) => x.key?.startsWith('dayplan:'));
    expect(scheduled.length).toBe(plan.events.length);
    expect(sim.log.at(-1)?.message).toMatch(/^Día típico \(oficina, 1 persona\): \d+ eventos programados$/);
    sim = { ...sim, speed: 600 };
    for (let i = 0; i < 60 * 24; i++) sim = tick(sim, p, 100); // 24 h simuladas
    expect(sim.log.some((l) => l.message.startsWith('Día típico: Ana'))).toBe(true);
    expect(sim.traces?.some((t) => t.automationId === 'demo-auto-pasillo-on')).toBe(true);
    expect(sim.pending.some((x) => x.key?.startsWith('dayplan:'))).toBe(false);
    expect(clearDayPlan(applyDayPlan(sim, p, plan, sim.now, sim.now + DAY_MS)).pending.some((x) => x.key?.startsWith('dayplan:'))).toBe(false);
  });
});
