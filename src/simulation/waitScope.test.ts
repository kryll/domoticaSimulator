// wait_for_trigger con hora, sol y `for:`; ámbito de variables, repeat.* y trigger.*.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Action, Automation, Project, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS, SECOND_MS } from './clock';
import { cancelAllRuns, createSimulationState, jumpTo, projectSunTimes, renameEntities, runActions, setEntityState, tick, userWaits } from './engine';
import { automationToYaml } from '../export/yaml';
import { parseAutomationYaml } from '../automations/yaml-parse';

const T0 = Date.UTC(2026, 5, 10, 12, 0);
const LIGHT = 'light.luz';
const DOOR = 'binary_sensor.puerta_door';

function home(extra: Partial<Project> = {}): Project {
  return project([dev('l', 'hue-white-e27', undefined, { name: 'Luz' }), dev('d', 'aqara-door-window', undefined, { name: 'Puerta' })], extra);
}
const start = (p: Project, now = T0): SimulationState => createSimulationState(p, catalog, now);
const st = (sim: SimulationState, id: string) => sim.entities[id]?.state;
const turnOn: Action = { type: 'service', service: 'light.turn_on', entityId: LIGHT };
const changedAt = (sim: SimulationState, id: string) => sim.entities[id]?.lastChanged;

describe('wait_for_trigger con hora, sol y for', () => {
  it('espera hasta las 22:00 (tick y jumpTo reanudan en el momento exacto)', () => {
    const p = home();
    const actions: Action[] = [{ type: 'wait_for_trigger', triggers: [{ type: 'time', at: '22:00' }] }, turnOn];
    let sim = runActions(start(p), p, actions);
    expect(userWaits(sim)[0]?.wait?.timedAt).toBe(T0 + 10 * HOUR_MS);
    sim = tick(sim, p, 9 * HOUR_MS);
    expect(st(sim, LIGHT)).toBe('off');
    sim = tick(sim, p, 2 * HOUR_MS);
    expect(st(sim, LIGHT)).toBe('on');
    expect(changedAt(sim, LIGHT)).toBe(T0 + 10 * HOUR_MS);
    const jumped = jumpTo(runActions(start(p), p, actions), p, catalog, T0 + 20 * HOUR_MS);
    expect(changedAt(jumped, LIGHT)).toBe(T0 + 10 * HOUR_MS);
    expect(userWaits(jumped)).toHaveLength(0);
  });

  it('espera hasta el atardecer −15 min con el sol del proyecto', () => {
    const p = home();
    const sunset = projectSunTimes({ now: T0 }, p).sunset;
    const actions: Action[] = [{ type: 'wait_for_trigger', triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: -15 }], timeoutSeconds: 24 * 3600 }, turnOn];
    const sim = jumpTo(runActions(start(p), p, actions), p, catalog, T0 + 12 * HOUR_MS);
    expect(changedAt(sim, LIGHT)).toBe(sunset - 15 * MINUTE_MS);
    expect(sim.log.some((l) => l.message.startsWith('Espera completada'))).toBe(true);
  });

  it('el tiempo límite gana si llega antes que la hora', () => {
    const p = home();
    let sim = runActions(start(p), p, [{ type: 'wait_for_trigger', triggers: [{ type: 'time', at: '22:00' }], timeoutSeconds: 60, continueOnTimeout: false }, turnOn]);
    sim = tick(sim, p, 11 * HOUR_MS);
    expect(st(sim, LIGHT)).toBe('off');
    expect(sim.log.some((l) => l.message.includes('Tiempo de espera agotado'))).toBe(true);
  });

  it('espera a «puerta abierta durante 2 min»', () => {
    const p = home();
    const actions: Action[] = [{ type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'on', for: 120 }] }, turnOn];
    let sim = runActions(start(p), p, actions);
    sim = setEntityState(sim, p, DOOR, 'on');
    sim = tick(sim, p, 60 * SECOND_MS);
    sim = setEntityState(sim, p, DOOR, 'off'); // se cierra antes de los 2 min: no cuenta
    sim = tick(sim, p, 5 * MINUTE_MS);
    expect(st(sim, LIGHT)).toBe('off');
    sim = setEntityState(sim, p, DOOR, 'on');
    const opened = sim.now;
    sim = tick(sim, p, 119 * SECOND_MS);
    expect(st(sim, LIGHT)).toBe('off');
    sim = tick(sim, p, 2 * SECOND_MS);
    expect(st(sim, LIGHT)).toBe('on');
    expect(changedAt(sim, LIGHT)).toBe(opened + 120 * SECOND_MS);
    expect(sim.pending.filter((x) => x.timer?.kind === 'wait_for')).toHaveLength(0);
  });

  it('reiniciar HA cancela la espera y sus temporizadores; el renombrado los traslada', () => {
    const p = home();
    let sim = runActions(start(p), p, [{ type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'on', for: 120 }] }, turnOn]);
    sim = setEntityState(sim, p, DOOR, 'on');
    const renamed = renameEntities(sim, { [DOOR]: 'binary_sensor.otra' });
    const timer = renamed.pending.find((x) => x.timer?.kind === 'wait_for');
    expect(timer?.timer).toMatchObject({ entityId: 'binary_sensor.otra' });
    const cancelled = cancelAllRuns(sim);
    expect(cancelled.pending).toHaveLength(0);
  });

  it('YAML de ida y vuelta con hora, sol y for', () => {
    const a: Automation = {
      id: 'w', name: 'W', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: DOOR, to: 'on' }], conditions: [],
      actions: [{ type: 'wait_for_trigger', triggers: [{ type: 'time', at: '22:00' }, { type: 'sun', event: 'sunset', offsetMinutes: -15 }, { type: 'state', entityId: DOOR, to: 'on', for: 120 }], timeoutSeconds: 3600 }],
    };
    expect(parseAutomationYaml(automationToYaml(a))).toEqual(a);
  });
});

describe('ámbito de variables', () => {
  it('las variables de un bloque son locales; las de nivel superior, globales', () => {
    const p = home();
    const sim = runActions(start(p), p, [
      { type: 'variables', variables: { x: 'fuera' } },
      { type: 'if', conditions: [], then: [{ type: 'variables', variables: { x: 'dentro', y: 'local' } }, { type: 'notify', message: 'a={{ x }} {{ y }}' }] },
      { type: 'notify', message: 'b={{ x }} {{ y }}' },
      { type: 'choose', choices: [{ conditions: [], sequence: [{ type: 'notify', message: 'c={{ x }}' }] }] },
    ]);
    expect(sim.notifications?.map((n) => n.message)).toEqual(['a=dentro local', 'b=fuera {{ y }}', 'c=fuera']);
  });

  it('el ámbito sobrevive a un delay dentro de un bloque', () => {
    const p = home();
    let sim = runActions(start(p), p, [
      { type: 'variables', variables: { x: 1 } },
      { type: 'if', conditions: [], then: [{ type: 'variables', variables: { x: 2 } }, { type: 'delay', seconds: 5 }, { type: 'notify', message: 'dentro {{ x }}' }] },
      { type: 'notify', message: 'fuera {{ x }}' },
    ]);
    sim = tick(sim, p, 5 * SECOND_MS);
    expect(sim.notifications?.map((n) => n.message)).toEqual(['dentro 2', 'fuera 1']);
  });

  it('repeat.index, repeat.first y repeat.last (también tras un delay)', () => {
    const p = home();
    let sim = runActions(start(p), p, [
      { type: 'repeat', count: 3, sequence: [{ type: 'notify', message: '{{ repeat.index }} {{ repeat.first }} {{ repeat.last }}' }, { type: 'delay', seconds: 1 }] },
      { type: 'notify', message: 'fin {{ repeat.index }}' },
    ]);
    sim = tick(sim, p, 5 * SECOND_MS);
    expect(sim.notifications?.map((n) => n.message)).toEqual(['1 on off', '2 off off', '3 off on', 'fin {{ repeat.index }}']);
    const w = runActions(start(p), p, [
      { type: 'repeat', until: [{ type: 'state', entityId: LIGHT, state: 'on' }], sequence: [{ type: 'notify', message: 'vuelta {{ repeat.index }}' }, { type: 'service', service: 'light.toggle', entityId: LIGHT }] },
    ]);
    expect(w.notifications?.map((n) => n.message)).toEqual(['vuelta 1']);
  });

  it('trigger.entity_id, trigger.from_state.state y trigger.to_state.state', () => {
    const p = home({
      automations: [{ id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: DOOR }], conditions: [], actions: [{ type: 'notify', message: '{{ trigger.entity_id }}: {{ trigger.from_state.state }} → {{ trigger.to_state.state }}' }] }],
    });
    const sim = setEntityState(start(p), p, DOOR, 'on');
    expect(sim.notifications?.[0]?.message).toBe(`${DOOR}: off → on`);
  });

  it('wait.trigger.* tras completar la espera', () => {
    const p = home();
    let sim = runActions(start(p), p, [{ type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'on' }] }, { type: 'notify', message: '{{ wait.trigger.entity_id }}' }]);
    sim = setEntityState(sim, p, DOOR, 'on');
    expect(sim.notifications?.[0]?.message).toBe(DOOR);
  });
});
