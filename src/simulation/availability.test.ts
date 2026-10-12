import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { createDemoProject } from '../store/demoProject';
import type { Project, SimulationState } from '../types';
import { computeUnavailable, isDownByFailure, offlineBlockReason, setFailures, unavailabilityReasons } from './availability';
import { NO_FAILURES } from './connectivity';
import { activateScene, callService, createSimulationState, runAutomation, runScript, setDeviceBattery, userWaits } from './engine';
import { lastTrace } from './trace';
import { motionPulse, setDeviceOffline, setLeak } from './events';

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const demo: Project = createDemoProject();
const start = (p: Project = demo): SimulationState => createSimulationState(p, catalog, T0);
const st = (sim: SimulationState, id: string) => sim.entities[id]?.state;

describe('computeUnavailable (B1)', () => {
  it('sin fallos ni desconexiones no cae nada', () => {
    expect(computeUnavailable(demo, catalog, NO_FAILURES, []).size).toBe(0);
  });

  it('un dispositivo desconectado a mano cae y arrastra a los que dependen de él', () => {
    const down = computeUnavailable(demo, catalog, NO_FAILURES, ['demo-puente-hue']);
    expect([...down].sort()).toEqual(['demo-luz-dormitorio', 'demo-luz-salon', 'demo-puente-hue']);
  });

  it('un router Zigbee caído deja sin red a los que cuelgan de él', () => {
    const p = project(
      [dev('ha', 'ha-green'), dev('co', 'sonoff-zbdongle-p'), dev('r', 'sonoff-s26r2zb', undefined, { integration: 'zha' }), dev('s', 'aqara-door-window', undefined, { integration: 'zha' })],
      {
        connections: [
          { id: 'c1', sourceId: 'co', targetId: 'ha', protocol: 'zigbee' },
          { id: 'c2', sourceId: 'r', targetId: 'co', protocol: 'zigbee' },
          { id: 'c3', sourceId: 's', targetId: 'r', protocol: 'zigbee' },
        ],
      },
    );
    const reasons = unavailabilityReasons(p, catalog, { ...NO_FAILURES, devicesDown: ['r'] });
    expect(reasons.get('r')).toBe('fallo simulado del dispositivo');
    expect(reasons.get('s')).toBe('depende de «r», que no está disponible');
    expect(reasons.has('co')).toBe(false);
  });

  it('sin conexiones dibujadas usa los enlaces compatibles (Thread sin border router en línea)', () => {
    const p = project([dev('ha', 'ha-green'), dev('ap', 'tplink-deco-x50'), dev('br', 'google-nest-hub-2'), dev('lock', 'aqara-u200')]);
    expect(computeUnavailable(p, catalog, NO_FAILURES, ['br'])).toEqual(new Set(['br', 'lock']));
  });

  it('los problemas de diseño (sin coordinador desde el principio) no cuentan como fallo', () => {
    const p = project([dev('ha', 'ha-green'), dev('s', 'aqara-door-window', undefined, { integration: 'zha' })]);
    expect(computeUnavailable(p, catalog, { ...NO_FAILURES, internet: true }).size).toBe(0);
  });

  it('corte de luz: lo que tiene SAI sigue funcionando', () => {
    const p = project([{ ...dev('ha', 'ha-green'), ups: true }, dev('ap', 'tplink-deco-x50'), dev('plug', 'tapo-p110')]);
    const reasons = unavailabilityReasons(p, catalog, { ...NO_FAILURES, powerOutage: true });
    expect(reasons.has('ha')).toBe(false);
    expect(reasons.get('ap')).toBe('sin corriente por el corte de luz');
    expect(reasons.get('plug')).toBe('sin corriente por el corte de luz');
    const allUps = { ...p, devices: p.devices.map((d) => ({ ...d, ups: true })) };
    expect(computeUnavailable(allUps, catalog, { ...NO_FAILURES, powerOutage: true }).size).toBe(0);
  });
});

describe('setFailures', () => {
  it('sin Internet las entidades de nube pasan a unavailable y se restauran al volver', () => {
    let sim = callService(start(), demo, 'climate.termostato_climate', 'set_temperature', { temperature: 23 });
    sim = setFailures(sim, demo, catalog, { internet: true });
    expect(st(sim, 'climate.termostato_climate')).toBe('unavailable');
    expect(st(sim, 'switch.cafetera')).toBe('unavailable');
    expect(st(sim, 'light.luz_salon')).toBe('off');
    expect(isDownByFailure(sim, 'demo-termostato')).toBe(true);
    expect(sim.log.map((l) => l.message)).toContain('Fallo simulado: sin conexión a Internet');
    sim = setFailures(sim, demo, catalog, { internet: false });
    expect(sim.entities['climate.termostato_climate']).toMatchObject({ state: 'heat', attributes: { temperature: 23 } });
    expect(sim.failureOffline).toEqual([]);
    expect(sim.log.map((l) => l.message)).toContain('Conexión a Internet restablecida');
  });

  it('respeta los dispositivos desconectados a mano', () => {
    let sim = setDeviceOffline(start(), demo, 'demo-cafetera', true);
    sim = setFailures(sim, demo, catalog, { internet: true });
    sim = setFailures(sim, demo, catalog, { internet: false });
    expect(st(sim, 'switch.cafetera')).toBe('unavailable');
    expect(isDownByFailure(sim, 'demo-cafetera')).toBe(false);
  });

  it('devicesDown del coordinador: caen sus hijos y vuelven al recuperarse', () => {
    let sim = setFailures(start(), demo, catalog, { devicesDown: ['demo-coordinador'] });
    expect(st(sim, 'binary_sensor.fuga_bano_leak')).toBe('unavailable');
    expect(st(sim, 'light.luz_pasillo')).toBe('unavailable');
    sim = setFailures(sim, demo, catalog, { devicesDown: [] });
    expect(st(sim, 'binary_sensor.fuga_bano_leak')).toBe('off');
  });

  it('el motor no ejecuta acciones de nube sin Internet y lo deja en el registro', () => {
    // La entidad sigue disponible (p. ej. aún no se ha reconciliado), pero no hay Internet.
    const sim = callService({ ...start(), failures: { ...NO_FAILURES, internet: true } }, demo, 'switch.cafetera', 'turn_on');
    expect(st(sim, 'switch.cafetera')).toBe('off');
    expect(sim.log.at(-1)).toMatchObject({ level: 'error', message: expect.stringMatching(/nube y no hay Internet/) });
  });

  it('con HA reiniciando no se ejecuta ninguna automatización (queda traza)', () => {
    let sim = callService(start(), demo, 'switch.enchufe_bano_switch', 'turn_on');
    sim = setFailures(sim, demo, catalog, { haRestarting: true });
    sim = setLeak(sim, demo, 'binary_sensor.fuga_bano_leak');
    expect(st(sim, 'switch.enchufe_bano_switch')).toBe('on');
    expect(sim.log.map((l) => l.message)).toContain('Automatización «Fuga de agua en el baño: cortar el enchufe» no ejecutada: Home Assistant se está reiniciando');
    expect(sim.traces?.at(-1)).toMatchObject({ automationId: 'demo-auto-fuga', result: 'ha_unavailable' });
    sim = runAutomation(sim, demo, 'demo-auto-fuga');
    expect(st(sim, 'switch.enchufe_bano_switch')).toBe('on');
  });

  it('corte de luz con la casa de ejemplo: el sensor de fuga sigue (coordinador en el servidor con SAI)', () => {
    let sim = callService(start(), demo, 'switch.enchufe_bano_switch', 'turn_on');
    sim = setFailures(sim, demo, catalog, { powerOutage: true });
    expect(st(sim, 'switch.enchufe_bano_switch')).toBe('unavailable');
    sim = setLeak(sim, demo, 'binary_sensor.fuga_bano_leak');
    expect(st(sim, 'binary_sensor.fuga_bano_leak')).toBe('on');
    expect(sim.traces?.at(-1)?.actions[0]).toMatchObject({ status: 'error' });
    sim = setFailures(sim, demo, catalog, { powerOutage: false });
    expect(st(sim, 'switch.enchufe_bano_switch')).toBe('on');
  });

  it('el movimiento en curso vuelve a reposo al recuperarse', () => {
    let sim = motionPulse(start(), demo, 'binary_sensor.movimiento_pasillo_motion');
    sim = setFailures(sim, demo, catalog, { devicesDown: ['demo-coordinador'] });
    sim = setFailures(sim, demo, catalog, { devicesDown: [] });
    expect(st(sim, 'binary_sensor.movimiento_pasillo_motion')).toBe('off');
    expect(sim.now).toBe(T0);
  });
});

describe('revisión de la fase 2', () => {
  it('la disponibilidad no depende del orden de los dispositivos', () => {
    const devices = [
      dev('ha', 'ha-green'),
      dev('ap', 'tplink-deco-x50'),
      dev('co', 'sonoff-zbdongle-p'),
      dev('r', 'sonoff-s26r2zb', undefined, { integration: 'zha' }),
      dev('s', 'aqara-door-window', undefined, { integration: 'zha' }),
      dev('plug', 'tapo-p110'),
    ];
    // r y s no tienen conexiones dibujadas: usan enlaces implícitos (antes dependía del orden).
    const connections = [{ id: 'c1', sourceId: 'co', targetId: 'ha', protocol: 'zigbee' as const }];
    const failures = { ...NO_FAILURES, devicesDown: ['co'] };
    const forward = computeUnavailable(project(devices, { connections }), catalog, failures);
    const backward = computeUnavailable(project([...devices].reverse(), { connections }), catalog, failures);
    expect([...backward].sort()).toEqual([...forward].sort());
    expect([...forward].sort()).toEqual(['co', 'r', 's']);
  });

  it('HA reiniciando: cancela las esperas y bloquea servicios, escenas y scripts', () => {
    let sim = createSimulationState(demo, catalog, Date.UTC(2026, 9, 12, 22));
    sim = motionPulse(sim, demo, 'binary_sensor.movimiento_pasillo_motion');
    sim = runScript(sim, demo, 'demo-script-salir');
    expect(userWaits(sim).length).toBe(2);
    sim = setFailures(sim, demo, catalog, { haRestarting: true });
    expect(userWaits(sim)).toEqual([]);
    expect(sim.pending.some((p) => p.timer)).toBe(true); // el autoapagado del sensor sigue
    expect(lastTrace(sim, 'demo-auto-movimiento')?.actions[1]).toMatchObject({ status: 'skipped', detail: 'cancelada: Home Assistant se reinició' });
    const before = sim.entities['switch.luz_cocina_switch'];
    sim = callService(sim, demo, 'switch.luz_cocina_switch', 'turn_on');
    expect(sim.entities['switch.luz_cocina_switch']).toBe(before);
    expect(sim.log.at(-1)).toMatchObject({ level: 'warning', message: 'Servicio switch.turn_on no ejecutado: Home Assistant se está reiniciando' });
    sim = activateScene(sim, demo, 'demo-escena-cine');
    expect(sim.log.at(-1)?.message).toBe('Escena Cine no activada: Home Assistant se está reiniciando');
    sim = runScript(sim, demo, 'demo-script-salir');
    expect(sim.log.at(-1)?.message).toBe('Script Salir de casa no ejecutado: Home Assistant se está reiniciando');
    expect(userWaits(sim)).toEqual([]);
    sim = setFailures(sim, demo, catalog, { haRestarting: false });
    expect(callService(sim, demo, 'switch.luz_cocina_switch', 'turn_on').entities['switch.luz_cocina_switch']?.state).toBe('on');
  });

  it('reconectar a mano no deja disponible lo que sigue caído por un fallo o sin batería', () => {
    let sim = setFailures(start(), demo, catalog, { devicesDown: ['demo-coordinador'] });
    expect(offlineBlockReason(sim, demo, catalog, 'demo-fuga-bano')).toBe('Depende de «Coordinador Zigbee»');
    expect(offlineBlockReason(sim, demo, catalog, 'demo-coordinador')).toBe('Fallo simulado del dispositivo');
    expect(offlineBlockReason(sim, demo, catalog, 'demo-luz-salon')).toBeNull();
    sim = setDeviceOffline(sim, demo, 'demo-fuga-bano', false);
    expect(st(sim, 'binary_sensor.fuga_bano_leak')).toBe('unavailable');
    expect(sim.log.at(-1)?.message).toBe('«Fuga baño» sigue sin estar disponible: Depende de «Coordinador Zigbee»');
    // desconectado a mano y luego reconectado mientras su coordinador sigue caído
    sim = setDeviceOffline(sim, demo, 'demo-mando', true);
    sim = setDeviceOffline(sim, demo, 'demo-mando', false);
    expect(st(sim, 'sensor.mando_salon_action')).toBe('unavailable');
    expect(isDownByFailure(sim, 'demo-mando')).toBe(true);
    sim = setFailures(sim, demo, catalog, { devicesDown: [] });
    expect(st(sim, 'sensor.mando_salon_action')).toBe('none');
    // batería agotada
    sim = setDeviceBattery(sim, demo, catalog, 'demo-puerta', 0);
    expect(offlineBlockReason(sim, demo, catalog, 'demo-puerta')).toBe('Sin batería');
    sim = setDeviceOffline(sim, demo, 'demo-puerta', false);
    expect(st(sim, 'binary_sensor.puerta_entrada_door')).toBe('unavailable');
  });
});
