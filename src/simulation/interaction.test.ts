import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Automation, Project, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import {
  activateScene,
  callService,
  capturableEntities,
  captureSceneEntities,
  createSimulationState,
  evaluateCondition,
  renameEntities,
  runActions,
  runAutomation,
  setEntityState,
  tick,
  userWaits,
} from './engine';
import {
  isDeviceOffline,
  jamLock,
  motionPulse,
  openDoor,
  pressButton,
  setDeviceOffline,
  setLeak,
  setSensorValue,
  setTemperature,
  triggerMotion,
} from './events';

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const MOTION = 'binary_sensor.mov_motion';
const IKEA_MOTION = 'binary_sensor.vallhorn_motion';
const LIGHT = 'light.luz';
const COVER = 'cover.persiana_cover';
const CLIMATE = 'climate.termo_climate';
const LOCK = 'lock.cerradura_lock';

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'single', triggers: [], conditions: [], actions: [], ...partial };
}

function home(extra: Partial<Project> = {}): Project {
  return project(
    [
      dev('m', 'aqara-motion-p1', undefined, { name: 'Mov' }),
      dev('v', 'ikea-vallhorn', undefined, { name: 'Vallhorn' }),
      dev('l', 'hue-white-color-e27', undefined, { name: 'Luz' }),
      dev('c', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana' }),
      dev('th', 'netatmo-thermostat', undefined, { name: 'Termo' }),
      dev('k', 'aqara-u200', undefined, { name: 'Cerradura' }),
    ],
    extra,
  );
}

const start = (p: Project): SimulationState => createSimulationState(p, catalog, T0);
const state = (sim: SimulationState, id: string) => sim.entities[id]?.state;
const lastMessages = (sim: SimulationState, n = 3) => sim.log.slice(-n).map((l) => l.message);

describe('callService', () => {
  it('registra la llamada con nombre y datos aunque el estado no cambie', () => {
    const p = home();
    const on = callService(start(p), p, LIGHT, 'light.turn_on', { brightness_pct: 60 });
    expect(on.log.map((l) => l.message)).toContain('Servicio light.turn_on → Luz (brillo 60 %)');
    const again = callService(on, p, LIGHT, 'turn_on', { brightness_pct: 60 });
    expect(again.log.at(-1)?.message).toBe('Servicio light.turn_on → Luz (brillo 60 %)');
    expect(again.entities[LIGHT]?.lastChanged).toBe(T0);
  });

  it('dispara automatizaciones y avisa de datos ignorados', () => {
    const p = home({ automations: [auto('a', { triggers: [{ type: 'state', entityId: LIGHT, to: 'on' }], actions: [{ type: 'service', service: 'lock.unlock', entityId: LOCK }] })] });
    const sim = callService(start(p), p, LIGHT, 'light.turn_on', { color_temp_kelvin: 9000 });
    expect(state(sim, LOCK)).toBe('unlocked');
    expect(sim.log.some((l) => l.level === 'warning' && /6500 K/.test(l.message))).toBe(true);
  });

  it('acepta rgb_color como lista y lo guarda como texto', () => {
    const p = home();
    const sim = callService(start(p), p, LIGHT, 'light.turn_on', { rgb_color: [0, 128, 255] });
    expect(sim.entities[LIGHT]?.attributes).toMatchObject({ rgb_color: '[0, 128, 255]', color_mode: 'rgb' });
  });

  it('las automatizaciones usan la misma vía (servicios con datos nuevos)', () => {
    const p = home({
      automations: [auto('a', { triggers: [{ type: 'state', entityId: MOTION, to: 'on' }], actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT, data: { brightness_pct: 30 } }] })],
    });
    const sim = setEntityState(start(p), p, MOTION, 'on');
    expect(sim.log.map((l) => l.message)).toContain('Servicio light.turn_on → Luz (brillo 30 %)');
  });

  it('entidad no disponible: aviso y sin cambios', () => {
    const p = home();
    const offline = setDeviceOffline(start(p), p, 'l', true);
    const sim = callService(offline, p, LIGHT, 'light.turn_on');
    expect(sim.log.at(-1)).toMatchObject({ level: 'warning' });
    expect(state(sim, LIGHT)).toBe('unavailable');
  });
});

describe('persiana con recorrido', () => {
  it('avanza por pasos, informa en movimiento y se puede parar', () => {
    const p = home();
    const sim = callService(start(p), p, COVER, 'cover.open_cover');
    expect(state(sim, COVER)).toBe('opening');
    expect(userWaits(sim)).toEqual([]);
    const mid = tick(sim, p, 9_000);
    expect(mid.entities[COVER]).toMatchObject({ state: 'opening', attributes: { current_position: 40 } });
    const stopped = callService(mid, p, COVER, 'cover.stop_cover');
    expect(stopped.entities[COVER]).toMatchObject({ state: 'open', attributes: { current_position: 40 } });
    expect(tick(stopped, p, 60_000).entities[COVER]?.attributes?.current_position).toBe(40);
    const done = tick(sim, p, 20_000);
    expect(done.entities[COVER]).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
  });

  it('una nueva orden sustituye al recorrido en curso', () => {
    const p = home();
    const opening = tick(callService(start(p), p, COVER, 'cover.open_cover'), p, 6_000);
    const closing = callService(opening, p, COVER, 'cover.close_cover');
    expect(state(closing, COVER)).toBe('closing');
    expect(tick(closing, p, 20_000).entities[COVER]).toMatchObject({ state: 'closed', attributes: { current_position: 0 } });
  });
});

describe('climate', () => {
  it('el sensor de temperatura del mismo dispositivo actualiza hvac_action', () => {
    const p = home();
    const sim = start(p);
    expect(sim.entities[CLIMATE]?.attributes?.hvac_action).toBe('idle');
    const cold = setTemperature(sim, p, 'sensor.termo_temperature', 19.8);
    expect(cold.entities[CLIMATE]?.attributes).toMatchObject({ current_temperature: 19.8, hvac_action: 'heating' });
    const offState = callService(cold, p, CLIMATE, 'climate.turn_off');
    expect(offState.entities[CLIMATE]?.attributes?.hvac_action).toBe('off');
    expect(state(callService(offState, p, CLIMATE, 'climate.turn_on'), CLIMATE)).toBe('heat');
  });
});

describe('movimiento con autoapagado', () => {
  it('motionPulse vuelve a off según el modelo (Aqara P1 60 s, IKEA 180 s)', () => {
    const p = home();
    const sim = motionPulse(motionPulse(start(p), p, MOTION), p, IKEA_MOTION);
    expect(state(sim, MOTION)).toBe('on');
    expect(state(tick(sim, p, 59_000), MOTION)).toBe('on');
    const after60 = tick(sim, p, 60_000);
    expect(state(after60, MOTION)).toBe('off');
    expect(state(after60, IKEA_MOTION)).toBe('on');
    expect(state(tick(sim, p, 180_000), IKEA_MOTION)).toBe('off');
    expect(state(tick(motionPulse(start(p), p, MOTION, 5), p, 5_000), MOTION)).toBe('off');
  });

  it('un nuevo pulso reinicia la cuenta y triggerMotion usa el autoapagado', () => {
    const p = home();
    const first = triggerMotion(start(p), p, MOTION);
    const second = motionPulse(tick(first, p, 40_000), p, MOTION);
    expect(state(tick(second, p, 30_000), MOTION)).toBe('on');
    expect(state(tick(second, p, 60_000), MOTION)).toBe('off');
    expect(state(triggerMotion(first, p, MOTION, false), MOTION)).toBe('off');
    expect(triggerMotion(first, p, MOTION, false).pending).toEqual([]);
  });
});

describe('for: en disparadores y condiciones', () => {
  const offFor2 = auto('apagar', {
    triggers: [{ type: 'state', entityId: MOTION, to: 'off', for: 120 }],
    actions: [{ type: 'service', service: 'light.turn_off', entityId: LIGHT }],
  });

  it('dispara solo si el estado se mantiene el tiempo indicado', () => {
    const p = home({ automations: [offFor2] });
    const lit = callService(start(p), p, LIGHT, 'light.turn_on');
    const pulse = motionPulse(lit, p, MOTION); // off a los 60 s
    expect(state(tick(pulse, p, 60_000 + 119_000), LIGHT)).toBe('on');
    const later = tick(pulse, p, 60_000 + 120_000);
    expect(state(later, LIGHT)).toBe('off');
    expect(later.log.map((l) => l.message)).toContain('Automatización «apagar» disparada (binary_sensor.mov_motion lleva 2 min en off)');
  });

  it('un cambio de estado intermedio cancela la cuenta', () => {
    const p = home({ automations: [offFor2] });
    const lit = callService(start(p), p, LIGHT, 'light.turn_on');
    const offNow = tick(motionPulse(lit, p, MOTION), p, 60_000);
    const again = motionPulse(tick(offNow, p, 100_000), p, MOTION);
    expect(state(tick(again, p, 50_000), LIGHT)).toBe('on');
    // nuevo off a los 60 s del segundo pulso + 120 s
    expect(state(tick(again, p, 179_000), LIGHT)).toBe('on');
    expect(state(tick(again, p, 180_000), LIGHT)).toBe('off');
  });

  it('condición de estado con for usa lastChanged', () => {
    const p = home();
    const sim = setEntityState(start(p), p, LOCK, 'unlocked');
    const cond = { type: 'state' as const, entityId: LOCK, state: 'unlocked', for: 300 };
    expect(evaluateCondition(cond, sim)).toBe(false);
    expect(evaluateCondition(cond, tick(sim, p, 5 * MINUTE_MS))).toBe(true);
    // sin cambios: cuenta desde el inicio de la simulación (startedAt)
    const hourCond = { type: 'state' as const, entityId: MOTION, state: 'off', for: 3600 };
    expect(evaluateCondition(hourCond, start(p))).toBe(false);
    expect(evaluateCondition(hourCond, tick(start(p), p, HOUR_MS))).toBe(true);
    // estados antiguos sin startedAt ni lastChanged: se cumple
    const legacy = { ...start(p) };
    delete legacy.startedAt;
    expect(evaluateCondition(hourCond, legacy)).toBe(true);
  });
});

describe('runAutomation (ejecución manual)', () => {
  const a = auto('manual', {
    enabled: false,
    conditions: [{ type: 'time', after: '22:00', before: '23:00' }],
    actions: [{ type: 'service', service: 'light.turn_on', entityId: LIGHT }],
  });

  it('respeta condiciones salvo con skipConditions; ejecuta aunque esté desactivada', () => {
    const p = home({ automations: [a] });
    expect(state(runAutomation(start(p), p, 'manual'), LIGHT)).toBe('off');
    const forced = runAutomation(start(p), p, 'manual', { skipConditions: true });
    expect(state(forced, LIGHT)).toBe('on');
    expect(forced.log.map((l) => l.message)).toContain('Automatización «manual» disparada (ejecución manual sin condiciones)');
    expect(runAutomation(start(p), p, 'nada').log.at(-1)?.level).toBe('warning');
  });
});

describe('cerradura y dispositivos desconectados', () => {
  it('jamLock fuerza jammed y lock lo resuelve', () => {
    const p = home();
    const jammed = jamLock(start(p), p, LOCK);
    expect(state(jammed, LOCK)).toBe('jammed');
    expect(state(callService(jammed, p, LOCK, 'lock.lock'), LOCK)).toBe('locked');
  });

  it('setDeviceOffline deja las entidades unavailable y las restaura', () => {
    const p = home({ automations: [auto('aviso', { triggers: [{ type: 'state', entityId: LIGHT, to: 'unavailable' }], actions: [{ type: 'service', service: 'lock.unlock', entityId: LOCK }] })] });
    const lit = callService(start(p), p, LIGHT, 'light.turn_on', { brightness_pct: 50 });
    const offline = setDeviceOffline(lit, p, 'l', true);
    expect(state(offline, LIGHT)).toBe('unavailable');
    expect(isDeviceOffline(offline, 'l')).toBe(true);
    expect(state(offline, LOCK)).toBe('unlocked');
    const back = setDeviceOffline(offline, p, 'l', false);
    expect(back.entities[LIGHT]).toMatchObject({ state: 'on', attributes: { brightness: 128 } });
    expect(isDeviceOffline(back, 'l')).toBe(false);
  });

  it('una persiana en movimiento se detiene al caer y queda en reposo al volver', () => {
    const p = home();
    const moving = tick(callService(start(p), p, COVER, 'cover.open_cover'), p, 4_000);
    const offline = setDeviceOffline(moving, p, 'c', true);
    expect(offline.pending).toEqual([]);
    const back = setDeviceOffline(tick(offline, p, HOUR_MS), p, 'c', false);
    expect(back.entities[COVER]).toMatchObject({ state: 'open', attributes: { current_position: 20 } });
  });

  it('un movimiento activo vuelve a off tras recuperarse', () => {
    const p = home();
    const sim = setDeviceOffline(setDeviceOffline(motionPulse(start(p), p, MOTION), p, 'm', true), p, 'm', false);
    expect(state(sim, MOTION)).toBe('off');
  });
});

describe('escenas mediante servicios', () => {
  it('aplica brillo, color y posición con la lógica de cada dominio', () => {
    const p = home({
      scenes: [
        {
          id: 's',
          name: 'Tarde',
          entities: {
            [LIGHT]: { state: 'on', attributes: { brightness: 100, rgb_color: '[255, 120, 40]', friendly_name: 'ignorado' } },
            [COVER]: { state: 'open', attributes: { current_position: 50 } },
          },
        },
      ],
    });
    const sim = activateScene(start(p), p, 's');
    expect(sim.entities[LIGHT]?.attributes).toMatchObject({ brightness: 100, rgb_color: '[255, 120, 40]', friendly_name: 'Luz' });
    expect(state(sim, COVER)).toBe('opening');
    expect(tick(sim, p, 20_000).entities[COVER]?.attributes?.current_position).toBe(50);
    expect(lastMessages(sim, 4)).toContain('Servicio cover.set_cover_position → Persiana Persiana (posición 50 %)');
  });
});

describe('renameEntities', () => {
  it('traslada una persiana en movimiento y sigue su recorrido con el nuevo id', () => {
    const p = home();
    const moving = tick(callService(start(p), p, COVER, 'cover.open_cover'), p, 4_000);
    const renamed = renameEntities(moving, { [COVER]: 'cover.estor_cover' });
    expect(renamed.entities[COVER]).toBeUndefined();
    expect(renamed.pending[0]).toMatchObject({ key: 'entity:cover.estor_cover', timer: { kind: 'cover_step', entityId: 'cover.estor_cover' } });
    const p2 = { ...p, devices: p.devices.map((d) => (d.id === 'c' ? { ...d, name: 'Estor' } : d)) };
    expect(tick(renamed, p2, 20_000).entities['cover.estor_cover']).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
  });

  it('traslada el autoapagado del movimiento y los for: pendientes', () => {
    const p = home({ automations: [auto('f', { triggers: [{ type: 'state', entityId: MOTION, to: 'on', for: 10 }] })] });
    const pulse = motionPulse(start(p), p, MOTION);
    const renamed = renameEntities(pulse, { [MOTION]: 'binary_sensor.pasillo_motion' });
    const timers = renamed.pending.map((x) => x.timer);
    expect(timers).toContainEqual({ kind: 'set_states', setStates: { 'binary_sensor.pasillo_motion': { state: 'off' } }, reason: 'sin movimiento' });
    expect(timers).toContainEqual({ kind: 'state_for', entityId: 'binary_sensor.pasillo_motion', automationId: 'f', triggerIndex: 0 });
    const p2 = { ...p, devices: p.devices.map((d) => (d.id === 'm' ? { ...d, name: 'Pasillo' } : d)) };
    expect(state(tick(renamed, p2, 60_000), 'binary_sensor.pasillo_motion')).toBe('off');
  });

  it('traslada los dispositivos offline, que se reconectan con el nuevo id', () => {
    const p = home();
    const lit = callService(start(p), p, LIGHT, 'light.turn_on', { brightness_pct: 50 });
    const renamed = renameEntities(setDeviceOffline(lit, p, 'l', true), { [LIGHT]: 'light.lampara' });
    expect(renamed.offline?.l?.['light.lampara']).toMatchObject({ state: 'on' });
    const p2 = { ...p, devices: p.devices.map((d) => (d.id === 'l' ? { ...d, name: 'Lámpara' } : d)) };
    expect(setDeviceOffline(renamed, p2, 'l', false).entities['light.lampara']).toMatchObject({ state: 'on', attributes: { brightness: 128 } });
  });

  it('traslada esperas de automatizaciones y no cambia nada con un mapeo vacío', () => {
    const p = home();
    const sim = runActions(start(p), p, [{ type: 'delay', seconds: 5 }, { type: 'service', service: 'light.turn_off', entityId: LIGHT }]);
    expect(renameEntities(sim, { [LIGHT]: 'light.x' }).pending[0]?.actions[0]).toMatchObject({ entityId: 'light.x' });
    expect(renameEntities(sim, {})).toBe(sim);
  });
});

describe('eventos sobre entidades no disponibles', () => {
  it('se ignoran con aviso, igual que los servicios', () => {
    const p = home();
    const sim = setDeviceOffline(setDeviceOffline(setDeviceOffline(start(p), p, 'm', true), p, 'k', true), p, 'th', true);
    const checks: [SimulationState, string][] = [
      [openDoor(sim, p, MOTION), MOTION],
      [setLeak(sim, p, MOTION), MOTION],
      [setSensorValue(sim, p, 'sensor.mov_illuminance', 5), 'sensor.mov_illuminance'],
      [pressButton(sim, p, MOTION), MOTION],
      [jamLock(sim, p, LOCK), LOCK],
      [setTemperature(sim, p, 'sensor.termo_temperature', 10), 'sensor.termo_temperature'],
      [callService(sim, p, LOCK, 'lock.unlock'), LOCK],
    ];
    for (const [after, id] of checks) {
      expect(state(after, id), id).toBe('unavailable');
      expect(after.log.at(-1)?.level).toBe('warning');
    }
  });
});

describe('tick sin cambios', () => {
  it('reutiliza las referencias de entities, pending y offline', () => {
    const p = home();
    const sim = setDeviceOffline(motionPulse(start(p), p, MOTION), p, 'l', true);
    const later = tick(sim, p, 1_000);
    expect(later).not.toBe(sim);
    expect(later.now).toBe(sim.now + 1_000);
    expect(later.entities).toBe(sim.entities);
    expect(later.pending).toBe(sim.pending);
    expect(later.offline).toBe(sim.offline);
    expect(later.log).toBe(sim.log);
  });
});

describe('capturableEntities', () => {
  it('separa capturables, no disponibles y desconocidas', () => {
    const p = home();
    const sim = setDeviceOffline(start(p), p, 'l', true);
    expect(capturableEntities(sim, [LIGHT, COVER, 'light.nada'])).toEqual({ capturable: [COVER], unavailable: [LIGHT], missing: ['light.nada'] });
    expect(Object.keys(captureSceneEntities(sim, [LIGHT, COVER]))).toEqual([COVER]);
  });
});
