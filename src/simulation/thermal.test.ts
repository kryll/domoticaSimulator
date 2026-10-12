import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project, Room } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import { callService, createSimulationState, setEntityState, tick } from './engine';
import {
  applyEnvironment,
  daylightFactor,
  DEFAULT_ENVIRONMENT,
  environmentSettings,
  outdoorTemperature,
  stepRoomTemperature,
} from './thermal';

const T0 = Date.UTC(2026, 0, 15, 0, 0);
const room = (id: string): Room => ({ id, floorId: 'f0', name: id, polygon: [] });

function house(envEnabled = true): Project {
  return project(
    [
      dev('t', 'aqara-temp-hum', undefined, { name: 'Temp', roomId: 'salon' }),
      dev('c', 'aqara-thermostat-e1', undefined, { name: 'Radiador', roomId: 'salon' }),
      dev('v', 'aqara-door-window', undefined, { name: 'Ventana', roomId: 'dormitorio' }),
      dev('t2', 'aqara-temp-hum', undefined, { name: 'Temp2', roomId: 'dormitorio' }),
      dev('m', 'aqara-motion-p1', undefined, { name: 'Mov', roomId: 'dormitorio' }),
      dev('l', 'hue-white-e27', undefined, { name: 'Luz', roomId: 'dormitorio' }),
    ],
    {
      rooms: [room('salon'), room('dormitorio')],
      environment: { enabled: envEnabled, outdoorMean: 5, outdoorAmplitude: 0, tauHours: 4, windowFactor: 6, hvacRatePerHour: 8 },
    },
  );
}

const num = (v: unknown) => Number(v);

describe('modelo térmico', () => {
  it('temperatura exterior senoidal: máximo a las 15:00 y mínimo a las 03:00', () => {
    const env = { outdoorMean: 10, outdoorAmplitude: 5 };
    expect(outdoorTemperature(env, T0 + 15 * HOUR_MS)).toBeCloseTo(15);
    expect(outdoorTemperature(env, T0 + 3 * HOUR_MS)).toBeCloseTo(5);
  });

  it('sin calefacción la sala tiende a la temperatura exterior; con ventana abierta más deprisa', () => {
    const env = { ...environmentSettings({ environment: { enabled: true, outdoorMean: 0, outdoorAmplitude: 0 } }), tauHours: 4 };
    const closed = stepRoomTemperature(20, T0, 4 * HOUR_MS, env, { windowOpen: false, hvac: () => 0 });
    const open = stepRoomTemperature(20, T0, 4 * HOUR_MS, env, { windowOpen: true, hvac: () => 0 });
    expect(closed).toBeLessThan(20);
    expect(closed).toBeGreaterThan(5);
    expect(open).toBeLessThan(closed);
    expect(open).toBeGreaterThanOrEqual(0);
  });

  it('desactivado no cambia nada', () => {
    const p = house(false);
    const sim = createSimulationState(p, catalog, T0);
    expect(applyEnvironment(sim, p, catalog, HOUR_MS)).toBe(sim);
    expect(DEFAULT_ENVIRONMENT.enabled).toBe(true);
  });

  it('los sensores de la sala reflejan el modelo y la calefacción la mantiene', () => {
    const p = house();
    let sim = createSimulationState(p, catalog, T0);
    sim = callService(sim, p, 'climate.radiador_climate', 'set_hvac_mode', { hvac_mode: 'heat' });
    sim = callService(sim, p, 'climate.radiador_climate', 'set_temperature', { temperature: 22 });
    for (let i = 0; i < 6 * 60; i++) sim = tick(sim, p, MINUTE_MS);
    const salon = num(sim.entities['sensor.temp_temperature']?.state);
    const dormitorio = num(sim.entities['sensor.temp2_temperature']?.state);
    expect(salon).toBeGreaterThan(20);
    expect(dormitorio).toBeLessThan(salon);
    expect(sim.environment?.rooms.salon?.temperature).toBeCloseTo(salon, 0);
    expect(num(sim.entities['climate.radiador_climate']?.attributes?.current_temperature)).toBeCloseTo(salon, 1);
    // los cambios de los sensores no inundan el registro
    expect(sim.log.filter((l) => l.entityId === 'sensor.temp_temperature')).toHaveLength(0);
    expect(sim.history?.['sensor.temp_temperature']?.length).toBeGreaterThan(1);
  });

  it('una ventana abierta enfría más deprisa', () => {
    const p = house();
    const base = createSimulationState(p, catalog, T0);
    const open = setEntityState(base, p, 'binary_sensor.ventana_door', 'on');
    const after = (s: typeof base) => num(tick(s, p, 2 * HOUR_MS).entities['sensor.temp2_temperature']?.state);
    expect(after(open)).toBeLessThan(after(base));
  });

  it('los disparadores numéricos se cumplen con el modelo', () => {
    const p: Project = {
      ...house(),
      automations: [
        { id: 'frio', name: 'Frío', enabled: true, mode: 'single', triggers: [{ type: 'numeric_state', entityId: 'sensor.temp2_temperature', below: 18 }], conditions: [], actions: [{ type: 'notify', message: 'Hace frío' }] },
      ],
    };
    let sim = createSimulationState(p, catalog, T0);
    sim = setEntityState(sim, p, 'binary_sensor.ventana_door', 'on');
    for (let i = 0; i < 12; i++) sim = tick(sim, p, 10 * MINUTE_MS);
    expect(sim.notifications?.map((n) => n.message)).toContain('Hace frío');
  });

  it('iluminancia según el sol y las luces', () => {
    expect(daylightFactor(T0 + 2 * HOUR_MS)).toBe(0);
    expect(daylightFactor(T0 + 13 * HOUR_MS + 45 * MINUTE_MS)).toBeCloseTo(1, 1);
    const p = house();
    let sim = createSimulationState(p, catalog, T0 + 22 * HOUR_MS);
    sim = tick(sim, p, MINUTE_MS);
    expect(num(sim.entities['sensor.mov_illuminance']?.state)).toBe(0);
    sim = callService(sim, p, 'light.luz', 'turn_on', { brightness: 255 });
    sim = tick(sim, p, MINUTE_MS);
    expect(num(sim.entities['sensor.mov_illuminance']?.state)).toBe(300);
    let day = createSimulationState(p, catalog, T0 + 13 * HOUR_MS);
    day = tick(day, p, MINUTE_MS);
    expect(num(day.entities['sensor.mov_illuminance']?.state)).toBeGreaterThan(300);
  });
});
