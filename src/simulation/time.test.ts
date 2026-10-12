import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Automation, Project, SimulationState } from '../types';
import { DAY_MS, formatSimTime, HOUR_MS, MINUTE_MS } from './clock';
import { createSimulationState, evaluateCondition, isNight, jumpTo, projectSunTimes, runActions, tick } from './engine';
import { motionPulse } from './events';

const T0 = Date.UTC(2026, 5, 21, 0, 0, 0); // 21/06/2026
const at = (h: number, m = 0) => T0 + h * HOUR_MS + m * MINUTE_MS;

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'single', triggers: [], conditions: [], actions: [], ...partial };
}

const devices = [dev('l', 'hue-white-e27', undefined, { name: 'Luz' }), dev('c', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana' }), dev('m', 'aqara-motion-p1', undefined, { name: 'Mov' })];
const madrid = (extra: Partial<Project> = {}): Project => project(devices, { settings: { latitude: 40.4168, longitude: -3.7038, timeZone: 'Europe/Madrid', electricityPriceEurKwh: 0.15 }, ...extra });
const oslo = (extra: Partial<Project> = {}): Project => project(devices, { settings: { latitude: 59.91, longitude: 10.75, timeZone: 'Europe/Oslo', electricityPriceEurKwh: 0.15 }, ...extra });
const start = (p: Project, now = at(12)): SimulationState => createSimulationState(p, catalog, now);
const turnOnLight = [{ type: 'service' as const, service: 'light.turn_on', entityId: 'light.luz' }];

describe('sol real por ubicación (B12)', () => {
  it('projectSunTimes e isNight usan la ubicación del proyecto (Madrid por defecto)', () => {
    const p = madrid();
    const { sunrise, sunset } = projectSunTimes(start(p), p);
    expect(formatSimTime(sunrise)).toMatch(/^06:4\d$/);
    expect(formatSimTime(sunset)).toMatch(/^21:4\d$/);
    expect(isNight(start(p, at(12)), p)).toBe(false);
    expect(isNight(start(p, at(22)), p)).toBe(true);
    expect(isNight(start(p, at(5)), p)).toBe(true);
    const noSettings = project(devices);
    expect(formatSimTime(projectSunTimes(start(noSettings), noSettings).sunset)).toMatch(/^21:4\d$/);
  });

  it('el disparador sun usa la ubicación: en Oslo el atardecer es más tarde', () => {
    const autos = [auto('sol', { triggers: [{ type: 'sun', event: 'sunset' }], actions: turnOnLight })];
    const pm = madrid({ automations: autos });
    const po = oslo({ automations: autos });
    const state = (sim: SimulationState) => sim.entities['light.luz']?.state;
    expect(state(tick(start(pm, at(21)), pm, HOUR_MS))).toBe('on');
    expect(state(tick(start(po, at(21)), po, HOUR_MS))).toBe('off');
    expect(state(tick(start(po, at(21)), po, 2 * HOUR_MS))).toBe('on');
  });

  it('condición sun (after/before con desplazamiento, cruce de medianoche)', () => {
    const p = madrid();
    const night = { type: 'sun' as const, after: 'sunset' as const, before: 'sunrise' as const };
    expect(evaluateCondition(night, start(p, at(23)), p)).toBe(true);
    expect(evaluateCondition(night, start(p, at(3)), p)).toBe(true);
    expect(evaluateCondition(night, start(p, at(12)), p)).toBe(false);
    const evening = { type: 'sun' as const, after: 'sunset' as const, afterOffsetMinutes: -60 };
    expect(evaluateCondition(evening, start(p, at(21)), p)).toBe(true);
    expect(evaluateCondition(evening, start(p, at(20, 30)), p)).toBe(false);
    const morning = { type: 'sun' as const, after: 'sunrise' as const, before: 'sunset' as const };
    expect(evaluateCondition(morning, start(p, at(12)), p)).toBe(true);
  });

  it('las automatizaciones evalúan la condición sun con la ubicación del proyecto', () => {
    const autos = [auto('noche', { triggers: [{ type: 'state', entityId: 'binary_sensor.mov_motion', to: 'on' }], conditions: [{ type: 'sun', after: 'sunset', before: 'sunrise' }], actions: turnOnLight })];
    const p = madrid({ automations: autos });
    expect(motionPulse(start(p, at(13)), p, 'binary_sensor.mov_motion').entities['light.luz']?.state).toBe('off');
    expect(motionPulse(start(p, at(23)), p, 'binary_sensor.mov_motion').entities['light.luz']?.state).toBe('on');
  });
});

describe('jumpTo', () => {
  it('ejecuta por pasos esperas, temporizadores y disparadores de hora y sol', () => {
    const autos = [
      auto('hora', { triggers: [{ type: 'time', at: '18:00' }], actions: [{ type: 'service', service: 'cover.open_cover', entityId: 'cover.persiana_cover' }] }),
      auto('sol', { triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: 10 }], actions: turnOnLight }),
    ];
    const p = madrid({ automations: autos });
    let sim = runActions(motionPulse(start(p), p, 'binary_sensor.mov_motion'), p, [{ type: 'delay', seconds: 600 }, { type: 'service', service: 'cover.close_cover', entityId: 'cover.persiana_cover' }]);
    sim = { ...sim, speed: 60 };
    const target = at(23);
    const jumped = jumpTo(sim, p, catalog, target);
    expect(jumped.now).toBe(target);
    expect(jumped.speed).toBe(60);
    expect(jumped.entities['binary_sensor.mov_motion']?.state).toBe('off');
    expect(jumped.entities['cover.persiana_cover']?.state).toBe('open');
    expect(jumped.entities['light.luz']?.state).toBe('on');
    expect(jumped.pending).toEqual([]);
    const messages = jumped.log.map((l) => l.message);
    expect(messages.indexOf('Automatización «hora» disparada (hora 18:00)')).toBeGreaterThan(messages.findIndex((m) => m.includes('cover.close_cover')));
    expect(messages.at(-1)).toBe('Salto en el tiempo hasta las 23:00 del 21/06/2026');
    expect(Object.keys(jumped.energy?.kwhByDevice ?? {})).toContain('l');
  });

  it('no va hacia atrás y no hace nada si la hora es la actual', () => {
    const p = madrid();
    const sim = start(p);
    const back = jumpTo(sim, p, catalog, sim.now - 1);
    expect(back.now).toBe(sim.now);
    expect(back.log.at(-1)?.message).toMatch(/hacia atrás/);
    expect(jumpTo(sim, p, catalog, sim.now)).toBe(sim);
  });

  it('salta varios días disparando cada día', () => {
    const p = madrid({ automations: [auto('t', { triggers: [{ type: 'time', at: '07:00' }], actions: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz' }] })] });
    const sim = jumpTo(start(p), p, catalog, at(12) + 3 * DAY_MS);
    expect(sim.log.filter((l) => l.message.startsWith('Automatización «t» disparada')).length).toBe(3);
  });
});
