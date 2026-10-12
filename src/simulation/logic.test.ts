import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Action, Automation, Project, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS, SECOND_MS } from './clock';
import { callService, createSimulationState, evaluateCondition, renameEntities, runActions, setEntityState, tick, userWaits } from './engine';
import { pressButton } from './events';
import {
  aggregateGroupState,
  clearNotifications,
  dismissNotification,
  expandRepeat,
  groupEntityId,
  markAllNotificationsRead,
  markNotificationRead,
  peopleEntities,
  renderTemplate,
  unreadNotifications,
} from './logic';
import { movePerson } from './people';

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const LIGHT = 'light.luz';
const LIGHT2 = 'light.luz2';
const DOOR = 'binary_sensor.puerta_door';
const PLUG = 'switch.enchufe';
const BUTTON = 'sensor.boton_action';

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'single', triggers: [], conditions: [], actions: [], ...partial };
}

function home(extra: Partial<Project> = {}): Project {
  return project(
    [
      dev('l', 'hue-white-e27', undefined, { name: 'Luz' }),
      dev('l2', 'hue-white-e27', undefined, { name: 'Luz2' }),
      dev('d', 'aqara-door-window', undefined, { name: 'Puerta' }),
      dev('p', 'sonoff-s26r2zb', undefined, { name: 'Enchufe' }),
      dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Boton' }),
    ],
    {
      people: [
        { id: 'ana', name: 'Ana' },
        { id: 'luis', name: 'Luis', color: '#f00' },
      ],
      zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }],
      ...extra,
    },
  );
}

const start = (p: Project): SimulationState => createSimulationState(p, catalog, T0);
const st = (sim: SimulationState, id: string) => sim.entities[id]?.state;

describe('B9 personas y zonas', () => {
  it('crea person.<slug>, zone.home y las zonas del proyecto', () => {
    const ents = peopleEntities(home());
    expect(ents['person.ana']?.state).toBe('home');
    expect(ents['person.luis']?.attributes?.color).toBe('#f00');
    expect(ents['zone.home']?.state).toBe(2);
    expect(ents['zone.trabajo']?.state).toBe(0);
    const sim = start(home());
    expect(st(sim, 'person.ana')).toBe('home');
  });

  it('movePerson cambia el estado, cuenta personas y dispara zone enter/leave', () => {
    const p = home({
      automations: [
        auto('sale', { triggers: [{ type: 'zone', personId: 'ana', zoneId: 'home', event: 'leave' }], actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }] }),
        auto('llega', { triggers: [{ type: 'zone', personId: 'ana', zoneId: 'trabajo', event: 'enter' }], actions: [{ type: 'service', service: 'switch.turn_on', entityId: PLUG }] }),
      ],
    });
    let sim = movePerson(start(p), p, 'ana', 'trabajo');
    expect(st(sim, 'person.ana')).toBe('Trabajo');
    expect(st(sim, 'zone.home')).toBe(1);
    expect(st(sim, 'zone.trabajo')).toBe(1);
    expect(st(sim, LIGHT)).toBe('on');
    expect(st(sim, PLUG)).toBe('on');
    sim = movePerson(sim, p, 'ana', null);
    expect(st(sim, 'person.ana')).toBe('not_home');
    expect(st(sim, 'zone.trabajo')).toBe(0);
  });

  it('condición zone', () => {
    const p = home();
    let sim = start(p);
    expect(evaluateCondition({ type: 'zone', personId: 'ana', zoneId: 'home' }, sim)).toBe(true);
    sim = movePerson(sim, p, 'ana', 'trabajo');
    expect(evaluateCondition({ type: 'zone', personId: 'ana', zoneId: 'home' }, sim)).toBe(false);
    expect(evaluateCondition({ type: 'zone', personId: 'ana', zoneId: 'trabajo' }, sim)).toBe(true);
  });

  it('avisa de personas o zonas desconocidas', () => {
    const p = home();
    expect(movePerson(start(p), p, 'nadie', 'home').log.at(-1)?.message).toMatch(/Persona desconocida/);
    expect(movePerson(start(p), p, 'ana', 'marte').log.at(-1)?.message).toMatch(/Zona desconocida/);
  });

  it('trigger device_action con el evento de un mando', () => {
    const p = home({
      automations: [auto('doble', { triggers: [{ type: 'device_action', entityId: BUTTON, action: 'double' }], actions: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] })],
    });
    let sim = pressButton(start(p), p, BUTTON, 'single');
    expect(st(sim, LIGHT)).toBe('off');
    sim = pressButton(sim, p, BUTTON, 'double');
    expect(st(sim, LIGHT)).toBe('on');
  });
});

describe('B11 condiciones y acciones', () => {
  it('not se cumple si ninguna lo hace', () => {
    const sim = start(home());
    expect(evaluateCondition({ type: 'not', conditions: [{ type: 'state', entityId: LIGHT, state: 'on' }] }, sim)).toBe(true);
    expect(evaluateCondition({ type: 'not', conditions: [{ type: 'state', entityId: LIGHT, state: 'off' }] }, sim)).toBe(false);
  });

  it('choose elige la primera opción que se cumple o default', () => {
    const p = home();
    const choose: Action = {
      type: 'choose',
      choices: [
        { conditions: [{ type: 'state', entityId: DOOR, state: 'on' }], sequence: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }] },
        { conditions: [{ type: 'state', entityId: DOOR, state: 'off' }], sequence: [{ type: 'service', service: 'switch.turn_on', entityId: PLUG }] },
      ],
      default: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT2 }],
    };
    const sim = runActions(start(p), p, [choose]);
    expect(st(sim, PLUG)).toBe('on');
    expect(st(sim, LIGHT)).toBe('off');
    const noMatch = runActions(start(p), p, [{ ...choose, choices: [] }]);
    expect(st(noMatch, LIGHT2)).toBe('on');
  });

  it('if/then/else y un delay dentro de una rama continúa con el resto', () => {
    const p = home();
    const actions: Action[] = [
      {
        type: 'if',
        conditions: [{ type: 'state', entityId: DOOR, state: 'on' }],
        then: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }],
        else: [{ type: 'delay', seconds: 10 }, { type: 'service', service: 'light.turn_on', entityId: LIGHT2 }],
      },
      { type: 'service', service: 'switch.turn_on', entityId: PLUG },
    ];
    let sim = runActions(start(p), p, actions);
    expect(st(sim, LIGHT2)).toBe('off');
    expect(st(sim, PLUG)).toBe('off');
    sim = tick(sim, p, 10 * SECOND_MS);
    expect(st(sim, LIGHT2)).toBe('on');
    expect(st(sim, PLUG)).toBe('on');
    expect(st(sim, LIGHT)).toBe('off');
  });

  it('repeat count, while y until', () => {
    const p = home();
    const count = runActions(start(p), p, [{ type: 'repeat', count: 3, sequence: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] }]);
    expect(st(count, LIGHT)).toBe('on');
    const whileSim = runActions(start(p), p, [
      { type: 'repeat', while: [{ type: 'state', entityId: LIGHT, state: 'off' }], sequence: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] },
    ]);
    expect(st(whileSim, LIGHT)).toBe('on');
    const until = runActions(start(p), p, [
      { type: 'repeat', until: [{ type: 'state', entityId: LIGHT, state: 'on' }], sequence: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }] },
    ]);
    expect(until.log.filter((l) => l.message.startsWith('Servicio light.turn_on')).length).toBe(1);
  });

  it('repeat con delay continúa en las siguientes vueltas', () => {
    const p = home();
    let sim = runActions(start(p), p, [{ type: 'repeat', count: 2, sequence: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }, { type: 'delay', seconds: 5 }] }]);
    expect(st(sim, LIGHT)).toBe('on');
    sim = tick(sim, p, 5 * SECOND_MS);
    expect(st(sim, LIGHT)).toBe('off');
    sim = tick(sim, p, 5 * SECOND_MS);
    expect(userWaits(sim)).toHaveLength(0);
  });

  it('un repeat infinito sin espera se corta', () => {
    const p = home();
    const sim = runActions(start(p), p, [{ type: 'repeat', while: [], sequence: [{ type: 'variables', variables: { a: 1 } }] }]);
    expect(sim.log.at(-1)?.level).toBe('error');
  });

  it('wait_for_trigger continúa al cumplirse el disparador', () => {
    const p = home({
      automations: [
        auto('a', {
          triggers: [{ type: 'state', entityId: DOOR, to: 'on' }],
          actions: [
            { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'off' }], timeoutSeconds: 60 },
            { type: 'service', service: 'light.turn_on', entityId: LIGHT },
          ],
        }),
      ],
    });
    let sim = setEntityState(start(p), p, DOOR, 'on');
    expect(userWaits(sim)).toHaveLength(1);
    expect(st(sim, LIGHT)).toBe('off');
    sim = setEntityState(sim, p, DOOR, 'off');
    expect(st(sim, LIGHT)).toBe('on');
    expect(userWaits(sim)).toHaveLength(0);
  });

  it('wait_for_trigger con timeout: continúa o se detiene según continueOnTimeout', () => {
    const wait = (cont: boolean): Action[] => [
      { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'on' }], timeoutSeconds: 30, continueOnTimeout: cont },
      { type: 'service', service: 'light.turn_on', entityId: LIGHT },
    ];
    const p = home();
    let sim = tick(runActions(start(p), p, wait(true)), p, 30 * SECOND_MS);
    expect(st(sim, LIGHT)).toBe('on');
    sim = tick(runActions(start(p), p, wait(false)), p, 30 * SECOND_MS);
    expect(st(sim, LIGHT)).toBe('off');
  });

  it('wait_for_trigger sin timeout espera indefinidamente y sobrevive a tick', () => {
    const p = home();
    let sim = runActions(start(p), p, [
      { type: 'wait_for_trigger', triggers: [{ type: 'device_action', entityId: BUTTON, action: 'single' }] },
      { type: 'service', service: 'light.turn_on', entityId: LIGHT },
    ]);
    sim = tick(sim, p, 48 * HOUR_MS);
    expect(st(sim, LIGHT)).toBe('off');
    sim = pressButton(sim, p, BUTTON, 'single');
    expect(st(sim, LIGHT)).toBe('on');
  });

  it('notify va a la bandeja con variables y plantillas', () => {
    const p = home();
    const sim = runActions(start(p), p, [
      { type: 'variables', variables: { quien: 'Ana' } },
      { type: 'notify', title: 'Aviso', message: 'Hola {{ quien }}, la luz está {{ states("light.luz") }}' },
    ]);
    expect(sim.notifications).toHaveLength(1);
    expect(sim.notifications?.[0]).toMatchObject({ title: 'Aviso', message: 'Hola Ana, la luz está off', read: false, at: T0 });
    expect(unreadNotifications(sim)).toBe(1);
    const read = markNotificationRead(sim, 'notif-1');
    expect(unreadNotifications(read)).toBe(0);
    expect(unreadNotifications(markAllNotificationsRead(sim))).toBe(0);
    expect(dismissNotification(sim, 'notif-1').notifications).toHaveLength(0);
    expect(clearNotifications(sim).notifications).toHaveLength(0);
  });

  it('las variables se conservan tras un delay y se usan en los datos de servicio', () => {
    const p = home();
    let sim = runActions(start(p), p, [
      { type: 'variables', variables: { nivel: 77 } },
      { type: 'delay', seconds: 1 },
      { type: 'service', service: 'light.turn_on', entityId: LIGHT, data: { brightness: '{{ nivel }}' } },
    ]);
    sim = tick(sim, p, SECOND_MS);
    expect(sim.entities[LIGHT]?.attributes?.brightness).toBe(77);
  });

  it('renderTemplate deja lo desconocido y resuelve state_attr', () => {
    const sim = start(home());
    expect(renderTemplate('{{ nada }}', {}, sim)).toBe('{{ nada }}');
    expect(renderTemplate("{{ state_attr('light.luz', 'friendly_name') }}", {}, sim)).toBe('Luz');
  });

  it('expandRepeat sin modo no hace nada', () => {
    expect(expandRepeat({ type: 'repeat', sequence: [{ type: 'delay', seconds: 1 }] }, () => true)).toEqual([]);
  });

  it('renameEntities renombra dentro de acciones anidadas y esperas', () => {
    const p = home();
    const sim = runActions(start(p), p, [
      { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: DOOR, to: 'on' }] },
      { type: 'if', conditions: [], then: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }] },
    ]);
    const renamed = renameEntities(sim, { [LIGHT]: 'light.nueva', [DOOR]: 'binary_sensor.otra' });
    const wait = renamed.pending[0];
    expect(wait?.wait?.triggers[0]).toMatchObject({ entityId: 'binary_sensor.otra' });
    const next = wait?.actions[0];
    expect(next?.type === 'if' && next.then[0]?.type === 'service' ? next.then[0].entityId : '').toBe('light.nueva');
  });
});

describe('B19 grupos y mostrar como luz', () => {
  const groups = [{ id: 'g', name: 'Salón', domain: 'light' as const, entityIds: [LIGHT, LIGHT2] }];

  it('crea la entidad del grupo con estado agregado', () => {
    const p = home({ groups });
    expect(groupEntityId(groups[0]!)).toBe('light.grupo_salon');
    expect(groupEntityId({ name: 'Grupo cocina', domain: 'switch' })).toBe('switch.grupo_cocina');
    const sim = start(p);
    expect(st(sim, 'light.grupo_salon')).toBe('off');
    const on = callService(sim, p, LIGHT, 'light.turn_on');
    expect(st(on, 'light.grupo_salon')).toBe('on');
  });

  it('los servicios del grupo se aplican a todos los miembros', () => {
    const p = home({ groups });
    let sim = callService(start(p), p, 'light.grupo_salon', 'light.turn_on', { brightness: 100 });
    expect(st(sim, LIGHT)).toBe('on');
    expect(st(sim, LIGHT2)).toBe('on');
    sim = callService(sim, p, 'light.grupo_salon', 'toggle');
    expect(st(sim, LIGHT)).toBe('off');
    expect(st(sim, 'light.grupo_salon')).toBe('off');
  });

  it('aggregateGroupState: unavailable si no hay miembros disponibles; cover', () => {
    expect(aggregateGroupState({ id: 'x', name: 'X', domain: 'cover', entityIds: ['cover.a'] }, { 'cover.a': { state: 'open' } }).state).toBe('open');
    expect(aggregateGroupState({ id: 'x', name: 'X', domain: 'light', entityIds: ['light.a'] }, {}).state).toBe('unavailable');
  });

  it('showAs light convierte el relé en luz', () => {
    const relay = { ...dev('r', 'shelly-1pm-gen3', undefined, { name: 'Rele' }), showAs: 'light' as const };
    const p = project([relay]);
    const sim = createSimulationState(p, catalog, T0);
    expect(sim.entities['light.rele_switch']).toBeDefined();
    expect(sim.entities['switch.rele_switch']).toBeUndefined();
    const on = callService(sim, p, 'light.rele_switch', 'light.turn_on');
    expect(st(on, 'light.rele_switch')).toBe('on');
  });
});

const running = (sim: SimulationState): SimulationState => ({ ...sim, running: true });

describe('B22 latencia', () => {
  it('las llamadas a la nube llegan con retraso y los fallos son deterministas', () => {
    const cloud = dev('c', 'sonoff-s26r2', undefined, { name: 'Nube' });
    const p = project([cloud], { reliability: { latency: true, seed: 42 } });
    let sim = callService(running(createSimulationState(p, catalog, T0)), p, 'switch.nube', 'turn_on');
    expect(st(sim, 'switch.nube')).toBe('off');
    sim = tick(sim, p, 3.2 * SECOND_MS);
    expect(st(sim, 'switch.nube')).toBe('on');
    const failing = project([cloud], { reliability: { latency: true, seed: 1, failureRate: 1 } });
    const failed = callService(running(createSimulationState(failing, catalog, T0)), failing, 'switch.nube', 'turn_on');
    expect(failed.log.at(-1)?.level).toBe('error');
    const a = callService(running(createSimulationState(p, catalog, T0)), p, 'switch.nube', 'turn_on');
    const b = callService(running(createSimulationState(p, catalog, T0)), p, 'switch.nube', 'turn_on');
    expect(a.pending).toEqual(b.pending);
  });

  it('las locales tardan unos 100 ms', () => {
    const p = home({ reliability: { latency: true } });
    let sim = callService(running(start(p)), p, LIGHT, 'turn_on');
    expect(st(sim, LIGHT)).toBe('off');
    sim = tick(sim, p, 200);
    expect(st(sim, LIGHT)).toBe('on');
  });

  it('en pausa se aplica al momento y la latencia queda como información', () => {
    const cloud = dev('c', 'sonoff-s26r2', undefined, { name: 'Nube' });
    const p = project([cloud], { reliability: { latency: true, seed: 42, failureRate: 1 } });
    const sim = callService(createSimulationState(p, catalog, T0), p, 'switch.nube', 'turn_on');
    expect(st(sim, 'switch.nube')).toBe('on');
    expect(sim.pending).toHaveLength(0);
    expect(sim.log.some((l) => l.level === 'info' && /latencia simulada de \d+ ms \(nube\)/.test(l.message))).toBe(true);
  });
});

describe('B14 anotación del registro', () => {
  it('marca los eventos de usuario y los cambios', () => {
    const p = home();
    const sim = callService(setEntityState(start(p), p, DOOR, 'on'), p, LIGHT, 'turn_on', { brightness: 10 });
    const events = sim.log.filter((l) => l.event);
    expect(events.map((e) => e.event?.kind)).toEqual(['state', 'service']);
    expect(sim.log.some((l) => l.change?.to === 'on' && l.entityId === LIGHT)).toBe(true);
  });

  it('el historial guarda los cambios', () => {
    const p = home();
    const sim = tick(setEntityState(start(p), p, DOOR, 'on'), p, MINUTE_MS);
    expect(sim.history?.[DOOR]).toEqual([{ t: T0, v: 'on' }]);
  });
});
