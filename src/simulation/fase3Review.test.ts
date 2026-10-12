// Correcciones de la revisión final de la Fase 3.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { slugify } from '../devices/entities';
import { createDemoProject } from '../store/demoProject';
import { projectToPackages } from '../export/packages';
import { parseYaml } from '../automations/yaml-parse';
import { isYamlMap } from '../export/yaml';
import type { Project, SimulationState } from '../types';
import { MINUTE_MS, SECOND_MS } from './clock';
import { cancelAllRuns, createSimulationState, runActions, setEntityState, tick } from './engine';
import { setFailures } from './availability';
import { groupEntityId, groupHaName } from './logic';
import { movePerson, syncPeopleEntities } from './people';
import { historySeries, isGap, isNumericSeries, seriesStats } from './history';
import { clampEnvironment, DEFAULT_ENVIRONMENT, illuminanceChanged, stepRoomTemperature } from './thermal';
import { runTimeline, recordedTimeline, timelineStart } from './timeline';

const T0 = Date.UTC(2026, 0, 15, 12);

describe('grupos: el entity_id coincide con el que crea HA a partir de name', () => {
  it('todos los grupos de la demo y casos límite', () => {
    const demo = createDemoProject();
    const groups = [...(demo.groups ?? []), { id: 'a', name: 'Grupo cocina', domain: 'switch' as const, entityIds: [] }, { id: 'b', name: 'Grupos salón', domain: 'light' as const, entityIds: [] }, { id: 'c', name: '  ', domain: 'cover' as const, entityIds: [] }];
    for (const g of groups) expect(`${g.domain}.${slugify(groupHaName(g))}`).toBe(groupEntityId(g));
    expect(groupEntityId({ name: 'Grupo cocina', domain: 'switch' })).toBe('switch.grupo_cocina');
    const files = projectToPackages(demo, catalog).filter((f) => f.path.startsWith('packages/'));
    const exported = files.flatMap((f) => {
      const root = parseYaml(f.content);
      return isYamlMap(root) && Array.isArray(root.light) ? root.light : [];
    });
    expect(exported).toHaveLength(demo.groups?.length ?? 0);
    for (const item of exported) {
      if (!isYamlMap(item)) throw new Error('grupo no válido');
      expect(demo.groups?.map(groupEntityId)).toContain(`light.${slugify(String(item.name))}`);
    }
  });
});

describe('syncPeopleEntities', () => {
  it('conserva el estado por person_id al renombrar, borra lo obsoleto y recalcula zonas', () => {
    const demo = createDemoProject();
    let sim = createSimulationState(demo, catalog, T0);
    sim = movePerson(sim, demo, 'demo-ana', 'demo-trabajo');
    const renamed: Project = {
      ...demo,
      people: [{ id: 'demo-ana', name: 'Ana María' }],
      zones: [{ id: 'demo-trabajo', name: 'Oficina', kind: 'work' }, { id: 'gym', name: 'Gimnasio', kind: 'other' }],
    };
    const next = syncPeopleEntities(sim, renamed);
    expect(next.entities['person.ana']).toBeUndefined();
    expect(next.entities['person.luis']).toBeUndefined();
    expect(next.entities['person.ana_maria']).toMatchObject({ state: 'Oficina', attributes: { zone_id: 'demo-trabajo', person_id: 'demo-ana' } });
    expect(next.entities['zone.oficina']?.state).toBe(1);
    expect(next.entities['zone.trabajo']).toBeUndefined();
    expect(next.entities['zone.gimnasio']?.state).toBe(0);
    expect(next.entities['zone.home']?.state).toBe(0);
    // zona borrada: la persona pasa a fuera de casa
    const noZone = syncPeopleEntities(next, { ...renamed, zones: [] });
    expect(noZone.entities['person.ana_maria']?.state).toBe('not_home');
  });
});

describe('latencia, reinicio y repeat', () => {
  it('cancelAllRuns cancela los disparadores con for pendientes', () => {
    const p = project([dev('d', 'aqara-door-window', undefined, { name: 'Puerta' }), dev('l', 'hue-white-e27', undefined, { name: 'Luz' })], {
      automations: [{ id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: 'binary_sensor.puerta_door', to: 'on', for: 60 }], conditions: [], actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz' }] }],
    });
    let sim = setEntityState(createSimulationState(p, catalog, T0), p, 'binary_sensor.puerta_door', 'on');
    expect(sim.pending.some((x) => x.timer?.kind === 'state_for')).toBe(true);
    sim = cancelAllRuns(sim);
    expect(sim.pending.some((x) => x.timer?.kind === 'state_for')).toBe(false);
    sim = tick(sim, p, 2 * MINUTE_MS);
    expect(sim.entities['light.luz']?.state).toBe('off');
  });

  it('repeat until no deja un «if» sintético en el registro y respeta hacer… hasta', () => {
    const p = project([dev('l', 'hue-white-e27', undefined, { name: 'Luz' })]);
    const sim = runActions(createSimulationState(p, catalog, T0), p, [
      { type: 'repeat', until: [{ type: 'state', entityId: 'light.luz', state: 'on' }], sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz' }] },
    ]);
    expect(sim.log.some((l) => l.message.startsWith('if:'))).toBe(false);
    expect(sim.log.filter((l) => l.message.startsWith('Servicio light.toggle'))).toHaveLength(1);
    const twice = runActions(createSimulationState(p, catalog, T0), p, [
      { type: 'repeat', until: [{ type: 'state', entityId: 'light.luz', state: 'off' }], sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz' }] },
    ]);
    expect(twice.log.filter((l) => l.message.startsWith('Servicio light.toggle'))).toHaveLength(2);
  });

  it('las notificaciones a la app necesitan Internet; la persistente no', () => {
    const p = project([dev('l', 'hue-white-e27', undefined, { name: 'Luz' })]);
    let sim: SimulationState = createSimulationState(p, catalog, T0);
    sim = setFailures(sim, p, catalog, { internet: true });
    sim = runActions(sim, p, [
      { type: 'notify', message: 'a la app' },
      { type: 'service', service: 'notify.mobile_app_ana', entityId: '', data: { message: 'móvil' } },
      { type: 'service', service: 'notify.persistent_notification', entityId: '', data: { message: 'local' } },
    ]);
    expect(sim.notifications?.map((n) => n.message)).toEqual(['local']);
    expect(sim.log.filter((l) => l.level === 'error' && l.message.includes('necesita Internet'))).toHaveLength(2);
  });
});

describe('historial con huecos', () => {
  it('unavailable y unknown son huecos', () => {
    const samples = [{ t: 0, v: 10 }, { t: 100, v: 'unavailable' }, { t: 200, v: 30 }];
    expect(isGap('unknown')).toBe(true);
    expect(isNumericSeries(samples)).toBe(true);
    expect(isNumericSeries([{ t: 0, v: 'unavailable' }])).toBe(false);
    expect(seriesStats(samples, 300)).toEqual({ min: 10, max: 30, mean: 20 });
    const sim = { history: { s: samples } } as unknown as SimulationState;
    expect(historySeries(sim, 's', 150, 300)).toEqual([{ t: 150, v: 'unavailable' }, { t: 200, v: 30 }]);
  });

  it('umbral de iluminancia', () => {
    expect(illuminanceChanged(100, 104)).toBe(false);
    expect(illuminanceChanged(100, 115)).toBe(true);
    expect(illuminanceChanged(1000, 1040)).toBe(false);
    expect(illuminanceChanged(3, 0)).toBe(true);
    expect(illuminanceChanged(0, 2)).toBe(true);
    expect(illuminanceChanged(undefined, 5)).toBe(true);
  });
});

describe('modelo térmico estable', () => {
  it('con parámetros extremos no oscila ni se dispara', () => {
    const env = { ...DEFAULT_ENVIRONMENT, outdoorMean: 0, outdoorAmplitude: 0, tauHours: 0.01, windowFactor: 1000, hvacRatePerHour: 1e6 };
    const clamped = clampEnvironment(env);
    expect(clamped).toMatchObject({ tauHours: 0.5, windowFactor: 20, hvacRatePerHour: 10 });
    const cold = stepRoomTemperature(20, T0, 10 * 60 * MINUTE_MS, env, { windowOpen: true, hvac: () => 0 });
    expect(cold).toBeGreaterThanOrEqual(0);
    expect(cold).toBeLessThan(20);
    const heated = stepRoomTemperature(20, T0, 48 * 60 * MINUTE_MS, env, { windowOpen: false, hvac: (t) => (t < 21 ? 1e6 : 0) });
    expect(Number.isFinite(heated)).toBe(true);
    expect(heated).toBeLessThan(25);
    // un solo paso enorme da lo mismo que muchos pequeños (solución exacta con Text constante)
    const flat = { ...DEFAULT_ENVIRONMENT, outdoorMean: 5, outdoorAmplitude: 0 };
    const one = stepRoomTemperature(20, T0, MINUTE_MS, flat, { windowOpen: false, hvac: () => 0 });
    let many = 20;
    for (let i = 0; i < 60; i++) many = stepRoomTemperature(many, T0, SECOND_MS, flat, { windowOpen: false, hvac: () => 0 });
    expect(one).toBeCloseTo(many, 10);
  });
});

describe('timeline con startAt', () => {
  it('runTimeline arranca en startAt y recordedTimeline lo guarda', () => {
    const p = project([dev('l', 'hue-white-e27', undefined, { name: 'Luz' })]);
    const start = Date.UTC(2026, 5, 1, 7, 0);
    const tl = recordedTimeline([], { id: 't', name: 'T', startAt: start });
    expect(tl.startAt).toBe(start);
    expect(timelineStart(tl, 0)).toBe(start);
    expect(timelineStart({}, 42)).toBe(42);
    const run = runTimeline(p, catalog, { ...tl, steps: [{ at: '08:00', kind: 'assert', entityId: 'light.luz', expect: 'off' }] }, Date.UTC(2020, 0, 1));
    expect(run.results[0]?.at).toBe(start + 60 * MINUTE_MS);
  });
});
