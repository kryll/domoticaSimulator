import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Action, Automation, Project, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import {
  activateScene,
  createSimulationState,
  evaluateCondition,
  MAX_LOG_ENTRIES,
  runActions,
  runScript,
  sameState,
  setEntityState,
  tick,
} from './engine';
import { closeDoor, openDoor, pressButton, setSensorValue, setTemperature, triggerMotion } from './events';

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);
const at = (h: number, m = 0) => T0 + h * HOUR_MS + m * MINUTE_MS;

const MOTION = 'binary_sensor.mov_motion';
const LIGHT = 'light.luz';
const TEMP = 'sensor.clima_temperature';
const PLUG = 'switch.ventilador';
const DOOR = 'binary_sensor.puerta_door';

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'single', triggers: [], conditions: [], actions: [], ...partial };
}

function home(extra: Partial<Project> = {}): Project {
  return project(
    [
      dev('m', 'aqara-motion-p1', undefined, { name: 'Mov' }),
      dev('l', 'hue-white-e27', undefined, { name: 'Luz' }),
      dev('t', 'aqara-temp-hum', undefined, { name: 'Clima' }),
      dev('v', 'sonoff-s26r2zb', undefined, { name: 'Ventilador' }),
      dev('d', 'aqara-door-window', undefined, { name: 'Puerta' }),
      dev('c', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana' }),
      dev('k', 'aqara-u200', undefined, { name: 'Cerradura' }),
      dev('th', 'netatmo-thermostat', undefined, { name: 'Termo' }),
      dev('tv', 'lg-oled-c3', undefined, { name: 'Tele' }),
      dev('va', 'xiaomi-robot-vacuum-s10', undefined, { name: 'Robot' }),
      dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Boton' }),
    ],
    extra,
  );
}

function start(p: Project, now = at(12)): SimulationState {
  return createSimulationState(p, catalog, now);
}

const state = (sim: SimulationState, id: string) => sim.entities[id]?.state;
const messages = (sim: SimulationState) => sim.log.map((l) => l.message);

describe('createSimulationState', () => {
  it('crea las entidades con su estado inicial', () => {
    const sim = start(home());
    expect(sim).toMatchObject({ running: false, now: at(12), speed: 1, pending: [] });
    expect(state(sim, LIGHT)).toBe('off');
    expect(state(sim, TEMP)).toBe(21.5);
    expect(sim.log).toHaveLength(1);
    expect(sim.log[0]?.id).toBe('log-1');
  });
});

describe('setEntityState', () => {
  it('cambia el estado sin mutar el original y lo registra', () => {
    const p = home();
    const sim = start(p);
    const next = setEntityState(sim, p, LIGHT, 'on');
    expect(state(sim, LIGHT)).toBe('off');
    expect(state(next, LIGHT)).toBe('on');
    expect(next.log.at(-1)).toMatchObject({ level: 'info', entityId: LIGHT, message: 'Luz: off → on', id: 'log-2', timestamp: at(12) });
  });

  it('acepta EntityState y fusiona atributos', () => {
    const p = home();
    const next = setEntityState(start(p), p, LIGHT, { state: 'on', attributes: { brightness: 100 } });
    expect(next.entities[LIGHT]?.attributes).toMatchObject({ brightness: 100, friendly_name: 'Luz' });
  });

  it('sin cambio de estado no registra nada', () => {
    const p = home();
    const sim = start(p);
    expect(setEntityState(sim, p, LIGHT, 'off').log).toHaveLength(sim.log.length);
  });

  it('entidad desconocida: aviso', () => {
    const p = home();
    expect(setEntityState(start(p), p, 'light.nada', 'on').log.at(-1)).toMatchObject({ level: 'warning', message: 'Entidad desconocida: light.nada' });
  });

  it('dispara automatizaciones por estado (to/from)', () => {
    const p = home({
      automations: [
        auto('a1', { triggers: [{ type: 'state', entityId: MOTION, to: 'on' }], actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }] }),
        auto('a2', { triggers: [{ type: 'state', entityId: MOTION, from: 'on', to: 'off' }], actions: [{ type: 'service', service: 'light.turn_off', entityId: LIGHT }] }),
      ],
    });
    let sim = triggerMotion(start(p), p, MOTION);
    expect(state(sim, LIGHT)).toBe('on');
    expect(messages(sim)).toContain('Automatización «a1» disparada (cambio de binary_sensor.mov_motion)');
    sim = triggerMotion(sim, p, MOTION, false);
    expect(state(sim, LIGHT)).toBe('off');
  });

  it('numeric_state solo dispara al cruzar el umbral', () => {
    const p = home({
      automations: [auto('calor', { triggers: [{ type: 'numeric_state', entityId: TEMP, above: 26 }], actions: [{ type: 'service', service: 'switch.toggle', entityId: PLUG }] })],
    });
    let sim = setTemperature(start(p), p, TEMP, 27);
    expect(state(sim, PLUG)).toBe('on');
    sim = setTemperature(sim, p, TEMP, 28); // sigue por encima: no vuelve a disparar
    expect(state(sim, PLUG)).toBe('on');
    sim = setTemperature(setTemperature(sim, p, TEMP, 20), p, TEMP, 30.04);
    expect(state(sim, PLUG)).toBe('off');
    expect(state(sim, TEMP)).toBe(30);
  });

  it('respeta condiciones y enabled', () => {
    const p = home({
      automations: [
        auto('noche', {
          triggers: [{ type: 'state', entityId: DOOR, to: 'on' }],
          conditions: [{ type: 'time', after: '20:00', before: '07:00' }],
          actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }],
        }),
        auto('off', { enabled: false, triggers: [{ type: 'state', entityId: DOOR }], actions: [{ type: 'service', service: 'switch.turn_on', entityId: PLUG }] }),
      ],
    });
    const day = openDoor(start(p, at(12)), p, DOOR);
    expect(state(day, LIGHT)).toBe('off');
    expect(messages(day)).toContain('Automatización «noche»: condiciones no cumplidas');
    expect(state(day, PLUG)).toBe('off');
    const night = openDoor(start(p, at(23)), p, DOOR);
    expect(state(night, LIGHT)).toBe('on');
    expect(state(closeDoor(night, p, DOOR), DOOR)).toBe('off');
  });

  it('protege contra bucles infinitos', () => {
    const p = home({
      automations: [
        auto('ping', { mode: 'parallel', triggers: [{ type: 'state', entityId: LIGHT }], actions: [{ type: 'service', service: 'switch.toggle', entityId: PLUG }] }),
        auto('pong', { mode: 'parallel', triggers: [{ type: 'state', entityId: PLUG }], actions: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] }),
      ],
    });
    const sim = setEntityState(start(p), p, LIGHT, 'on');
    expect(sim.log.some((l) => l.level === 'error' && /bucle infinito/.test(l.message))).toBe(true);
  });

  it('modo single ignora el redisparo dentro de su propia ejecución', () => {
    const p = home({
      automations: [auto('eco', { triggers: [{ type: 'state', entityId: LIGHT }], actions: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] })],
    });
    const sim = setEntityState(start(p), p, LIGHT, 'on');
    expect(state(sim, LIGHT)).toBe('off');
    expect(sim.log.some((l) => l.level === 'warning' && /modo single/.test(l.message))).toBe(true);
    expect(sim.log.some((l) => l.level === 'error')).toBe(false);
  });
});

describe('evaluateCondition', () => {
  const p = home();
  const sim = setEntityState(start(p, at(21)), p, LIGHT, 'on');

  it.each([
    [{ type: 'state', entityId: LIGHT, state: 'on' }, true],
    [{ type: 'state', entityId: LIGHT, state: true }, true],
    [{ type: 'state', entityId: 'light.nada', state: 'on' }, false],
    [{ type: 'numeric_state', entityId: TEMP, above: 20, below: 22 }, true],
    [{ type: 'numeric_state', entityId: TEMP, above: 22 }, false],
    [{ type: 'numeric_state', entityId: LIGHT, above: 0 }, false],
    [{ type: 'time', after: '20:00' }, true],
    [{ type: 'time', before: 'roto' }, false],
    [{ type: 'and', conditions: [{ type: 'time', after: '20:00' }, { type: 'state', entityId: LIGHT, state: 'off' }] }, false],
    [{ type: 'or', conditions: [{ type: 'time', after: '22:00' }, { type: 'state', entityId: LIGHT, state: 'on' }] }, true],
    [{ type: 'and', conditions: [] }, true],
    [{ type: 'or', conditions: [] }, false],
  ] as const)('%j -> %s', (c, expected) => {
    expect(evaluateCondition(c as never, sim)).toBe(expected);
  });

  it('sameState normaliza booleanos y números', () => {
    expect(sameState(true, 'on')).toBe(true);
    expect(sameState(false, 'off')).toBe(true);
    expect(sameState(21, '21')).toBe(true);
    expect(sameState('on', 'off')).toBe(false);
  });
});

describe('runActions y servicios', () => {
  const p = home();
  const run = (actions: Action[], sim = start(p)) => runActions(sim, p, actions);

  it('light y switch', () => {
    const sim = run([
      { type: 'service', service: 'light.turn_on', entityId: LIGHT, data: { brightness: 200 } },
      { type: 'service', service: 'switch.turn_on', entityId: PLUG },
    ]);
    expect(sim.entities[LIGHT]).toMatchObject({ state: 'on', attributes: { brightness: 200 } });
    expect(state(sim, PLUG)).toBe('on');
    expect(state(run([{ type: 'service', service: 'light.toggle', entityId: LIGHT }], sim), LIGHT)).toBe('off');
    expect(state(run([{ type: 'service', service: 'homeassistant.turn_on', entityId: LIGHT }]), LIGHT)).toBe('on');
  });

  it('cover, lock, climate, media_player y vacuum', () => {
    const sim = run([
      { type: 'service', service: 'cover.open_cover', entityId: 'cover.persiana_cover' },
      { type: 'service', service: 'lock.unlock', entityId: 'lock.cerradura_lock' },
      { type: 'service', service: 'climate.set_temperature', entityId: 'climate.termo_climate', data: { temperature: 23 } },
      { type: 'service', service: 'media_player.turn_on', entityId: 'media_player.tele' },
      { type: 'service', service: 'media_player.volume_set', entityId: 'media_player.tele', data: { volume_level: 0.5 } },
      { type: 'service', service: 'vacuum.start', entityId: 'vacuum.robot_vacuum' },
    ]);
    expect(sim.entities['cover.persiana_cover']).toMatchObject({ state: 'opening', attributes: { current_position: 0 } });
    expect(tick(sim, p, 20_000).entities['cover.persiana_cover']).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
    expect(state(sim, 'lock.cerradura_lock')).toBe('unlocked');
    expect(sim.entities['climate.termo_climate']).toMatchObject({ state: 'heat', attributes: { temperature: 23 } });
    expect(sim.entities['media_player.tele']).toMatchObject({ state: 'on', attributes: { volume_level: 0.5 } });
    expect(state(sim, 'vacuum.robot_vacuum')).toBe('cleaning');
    const after = tick(run(
      [
        { type: 'service', service: 'cover.close', entityId: 'cover.persiana_cover' },
        { type: 'service', service: 'lock.lock', entityId: 'lock.cerradura_lock' },
        { type: 'service', service: 'climate.set_hvac_mode', entityId: 'climate.termo_climate', data: { hvac_mode: 'off' } },
        { type: 'service', service: 'media_player.media_play', entityId: 'media_player.tele' },
        { type: 'service', service: 'vacuum.return_to_base', entityId: 'vacuum.robot_vacuum' },
      ],
      tick(sim, p, 20_000),
    ), p, 30_000);
    expect(state(after, 'cover.persiana_cover')).toBe('closed');
    expect(state(after, 'lock.cerradura_lock')).toBe('locked');
    expect(state(after, 'climate.termo_climate')).toBe('off');
    expect(state(after, 'media_player.tele')).toBe('playing');
    expect(state(after, 'vacuum.robot_vacuum')).toBe('docked');
  });

  it('avisa de servicios no soportados, de dominio incorrecto o entidad desconocida', () => {
    const sim = run([
      { type: 'service', service: 'light.blink', entityId: LIGHT },
      { type: 'service', service: 'switch.turn_on', entityId: LIGHT },
      { type: 'service', service: 'light.turn_on', entityId: 'light.nada' },
    ]);
    expect(sim.log.slice(-3).map((l) => l.level)).toEqual(['warning', 'warning', 'warning']);
    expect(state(sim, LIGHT)).toBe('off');
  });

  it('delay crea una acción pendiente con el resto', () => {
    const sim = runActions(start(p), p, [
      { type: 'service', service: 'light.turn_on', entityId: LIGHT },
      { type: 'delay', seconds: 30 },
      { type: 'service', service: 'light.turn_off', entityId: LIGHT },
    ], { automationId: 'x' });
    expect(state(sim, LIGHT)).toBe('on');
    expect(sim.pending).toHaveLength(1);
    expect(sim.pending[0]).toMatchObject({ dueAt: at(12) + 30_000, automationId: 'x', actions: [{ type: 'service', service: 'light.turn_off' }] });
  });

  it('los ids del log son deterministas y el log está acotado', () => {
    let sim = start(p);
    for (let i = 0; i < MAX_LOG_ENTRIES + 20; i++) sim = run([{ type: 'service', service: 'light.toggle', entityId: LIGHT }], sim);
    expect(sim.log).toHaveLength(MAX_LOG_ENTRIES);
    const nums = sim.log.map((l) => Number(l.id.slice(4)));
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums.at(-1)).toBe((nums.at(-2) ?? 0) + 1);
  });
});

describe('escenas y scripts', () => {
  const p = home({
    scenes: [
      { id: 'cine', name: 'Modo cine', entities: { [LIGHT]: { state: 'on', attributes: { brightness: 30 } }, 'media_player.tele': { state: 'on' } } },
    ],
    scripts: [
      { id: 'salir', name: 'Salir', sequence: [{ type: 'scene', sceneId: 'cine' }, { type: 'delay', seconds: 10 }, { type: 'service', service: 'light.turn_off', entityId: LIGHT }] },
      { id: 'bucle', name: 'Bucle', sequence: [{ type: 'script', scriptId: 'bucle' }] },
    ],
  });

  it('activateScene aplica todos los estados', () => {
    const sim = activateScene(start(p), p, 'cine');
    expect(sim.entities[LIGHT]).toMatchObject({ state: 'on', attributes: { brightness: 30 } });
    expect(state(sim, 'media_player.tele')).toBe('on');
    expect(messages(sim)).toContain('Escena «Modo cine» activada');
    expect(activateScene(start(p), p, 'nada').log.at(-1)?.level).toBe('warning');
  });

  it('scene.turn_on por entity_id con slug del nombre', () => {
    const sim = runActions(start(p), p, [{ type: 'service', service: 'scene.turn_on', entityId: 'scene.modo_cine' }]);
    expect(state(sim, LIGHT)).toBe('on');
  });

  it('runScript ejecuta la secuencia y deja el resto pendiente tras el delay', () => {
    const sim = runScript(start(p), p, 'salir');
    expect(state(sim, LIGHT)).toBe('on');
    expect(sim.pending[0]).toMatchObject({ scriptId: 'salir' });
    const later = tick(sim, p, 10_000);
    expect(state(later, LIGHT)).toBe('off');
    expect(later.pending).toEqual([]);
  });

  it('script.turn_on y script.<slug>', () => {
    expect(state(runActions(start(p), p, [{ type: 'service', service: 'script.turn_on', entityId: 'script.salir' }]), LIGHT)).toBe('on');
    expect(state(runActions(start(p), p, [{ type: 'service', service: 'script.salir', entityId: '' }]), LIGHT)).toBe('on');
  });

  it('un script recursivo se detiene con error', () => {
    const sim = runScript(start(p), p, 'bucle');
    expect(sim.log.at(-1)).toMatchObject({ level: 'error' });
    expect(runScript(start(p), p, 'nada').log.at(-1)?.level).toBe('warning');
  });
});

describe('tick', () => {
  it('avanza el reloj multiplicado por la velocidad', () => {
    const p = home();
    expect(tick(start(p), p, 1000).now).toBe(at(12) + 1000);
    expect(tick({ ...start(p), speed: 60 }, p, 1000).now).toBe(at(12, 1));
    const sim = start(p);
    expect(tick(sim, p, 0)).toBe(sim);
  });

  it('dispara triggers de hora cruzados una sola vez', () => {
    const p = home({ automations: [auto('t', { mode: 'parallel', triggers: [{ type: 'time', at: '07:00' }], actions: [{ type: 'service', service: 'switch.toggle', entityId: PLUG }] })] });
    let sim = start(p, at(6, 59));
    sim = tick(sim, p, 60_000);
    expect(state(sim, PLUG)).toBe('on');
    sim = tick(sim, p, 60_000);
    expect(state(sim, PLUG)).toBe('on');
    // Dos días enteros: dos disparos más (on -> off -> on).
    sim = tick(sim, p, 48 * HOUR_MS);
    expect(sim.log.filter((l) => l.message.startsWith('Automatización «t» disparada')).length).toBe(3);
  });

  it('dispara amanecer/atardecer con desplazamiento y configuración', () => {
    const p = home({
      automations: [auto('sol', { triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: -30 }], actions: [{ type: 'service', service: 'cover.close_cover', entityId: 'cover.persiana_cover' }] })],
    });
    const open = tick(runActions(start(p, at(19)), p, [{ type: 'service', service: 'cover.open_cover', entityId: 'cover.persiana_cover' }]), p, 20_000);
    expect(state(tick(open, p, 29 * MINUTE_MS), 'cover.persiana_cover')).toBe('open');
    expect(state(tick(open, p, 29 * MINUTE_MS + 50_000), 'cover.persiana_cover')).toBe('closing');
    expect(state(tick(open, p, 30 * MINUTE_MS), 'cover.persiana_cover')).toBe('closed');
    expect(state(tick(open, p, 30 * MINUTE_MS, { sun: { sunrise: '07:00', sunset: '21:00' } }), 'cover.persiana_cover')).toBe('open');
  });

  it('ejecuta pendientes en orden cronológico junto a los triggers', () => {
    const p = home({
      automations: [
        auto('mov', {
          mode: 'restart',
          triggers: [{ type: 'state', entityId: MOTION, to: 'on' }],
          actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }, { type: 'delay', seconds: 120 }, { type: 'service', service: 'light.turn_off', entityId: LIGHT }],
        }),
      ],
    });
    let sim = triggerMotion(start(p), p, MOTION);
    sim = tick(sim, p, 60_000);
    expect(state(sim, LIGHT)).toBe('on');
    sim = tick(sim, p, 60_000);
    expect(state(sim, LIGHT)).toBe('off');
    const off = sim.log.find((l) => l.message === 'Luz: on → off');
    expect(off?.timestamp).toBe(at(12, 2));
  });

  it('modo restart cancela el temporizador anterior; single lo respeta', () => {
    const actions: Action[] = [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }, { type: 'delay', seconds: 120 }, { type: 'service', service: 'light.turn_off', entityId: LIGHT }];
    const restart = home({ automations: [auto('r', { mode: 'restart', triggers: [{ type: 'state', entityId: MOTION, to: 'on' }], actions })] });
    let sim = triggerMotion(start(restart), restart, MOTION);
    sim = tick(sim, restart, 90_000);
    sim = triggerMotion(triggerMotion(sim, restart, MOTION, false), restart, MOTION);
    sim = tick(sim, restart, 60_000);
    expect(state(sim, LIGHT)).toBe('on');
    expect(sim.pending).toHaveLength(1);

    const single = home({ automations: [auto('s', { mode: 'single', triggers: [{ type: 'state', entityId: MOTION, to: 'on' }], actions })] });
    let s2 = triggerMotion(start(single), single, MOTION);
    s2 = tick(s2, single, 90_000);
    s2 = triggerMotion(triggerMotion(s2, single, MOTION, false), single, MOTION);
    expect(s2.log.at(-1)?.message).toMatch(/modo single/);
    s2 = tick(s2, single, 60_000);
    expect(state(s2, LIGHT)).toBe('off');
  });
});

describe('modo queued', () => {
  const actions: Action[] = [
    { type: 'service', service: 'switch.toggle', entityId: PLUG },
    { type: 'delay', seconds: 60 },
    { type: 'service', service: 'light.toggle', entityId: LIGHT },
  ];
  const p = home({ automations: [auto('q', { mode: 'queued', triggers: [{ type: 'state', entityId: MOTION, to: 'on' }], actions })] });
  const runs = (sim: SimulationState) => sim.log.filter((l) => /disparada|disparo en cola/.test(l.message)).length;

  it('dos disparos seguidos: el segundo espera a que termine el primero', () => {
    let sim = triggerMotion(start(p), p, MOTION);
    sim = triggerMotion(triggerMotion(sim, p, MOTION, false), p, MOTION);
    expect(sim.queue).toHaveLength(1);
    expect(sim.queue?.[0]).toMatchObject({ automationId: 'q', dueAt: at(12) });
    expect(sim.log.at(-1)?.message).toMatch(/en cola/);
    expect(state(sim, PLUG)).toBe('on'); // solo ha corrido la primera ejecución
    expect(runs(sim)).toBe(1);

    sim = tick(sim, p, 60_000); // termina la primera y arranca la encolada
    expect(state(sim, LIGHT)).toBe('on');
    expect(state(sim, PLUG)).toBe('off');
    expect(sim.queue).toEqual([]);
    expect(sim.pending).toHaveLength(1);
    expect(runs(sim)).toBe(2);

    sim = tick(sim, p, 60_000);
    expect(state(sim, LIGHT)).toBe('off');
    expect(sim.pending).toEqual([]);
    expect(sim.log.some((l) => l.level !== 'info')).toBe(false);
  });

  it('sin delay se encadenan en el mismo instante', () => {
    const quick = home({
      automations: [auto('q', { mode: 'queued', triggers: [{ type: 'state', entityId: LIGHT }], actions: [{ type: 'service', service: 'switch.toggle', entityId: PLUG }] })],
    });
    let sim = setEntityState(start(quick), quick, LIGHT, 'on');
    sim = setEntityState(sim, quick, LIGHT, 'off');
    expect(state(sim, PLUG)).toBe('off');
    expect(sim.queue).toEqual([]);
  });

  it('una automatización queued que se redispara a sí misma acaba por el límite de bucles', () => {
    const loop = home({
      automations: [auto('q', { mode: 'queued', triggers: [{ type: 'state', entityId: LIGHT }], actions: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] })],
    });
    const sim = setEntityState(start(loop), loop, LIGHT, 'on');
    expect(sim.log.some((l) => l.level === 'error')).toBe(true);
  });
});

describe('events', () => {
  it('pressButton deja la acción y vuelve a "none" disparando automatizaciones', () => {
    const p = home({
      automations: [auto('btn', { triggers: [{ type: 'state', entityId: 'sensor.boton_action', to: 'single' }], actions: [{ type: 'service', service: 'light.toggle', entityId: LIGHT }] })],
    });
    const sim = pressButton(start(p), p, 'sensor.boton_action');
    expect(state(sim, LIGHT)).toBe('on');
    expect(state(sim, 'sensor.boton_action')).toBe('none');
    expect(state(setSensorValue(sim, p, 'sensor.mov_illuminance', 5), 'sensor.mov_illuminance')).toBe(5);
  });
});
