import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { SimulationState } from '../types';
import { callService, createSimulationState, renameEntities, setEntityState } from './engine';
import { attributeKey, historyAttributes, historyEntities, historySeries, recordAttributeSamples } from './history';

const T0 = Date.UTC(2026, 0, 1, 12);
const LIGHT = 'light.luz';

describe('historial de atributos', () => {
  const p = project([dev('l', 'hue-white-color-e27', undefined, { name: 'Luz' }), dev('t', 'netatmo-thermostat', undefined, { name: 'Termo' })]);

  it('guarda brillo, temperatura de color y los del termostato; historyAttributes los lista', () => {
    let sim = createSimulationState(p, catalog, T0);
    sim = callService({ ...sim, now: T0 + 1000 }, p, LIGHT, 'light.turn_on', { brightness: 100 });
    sim = callService({ ...sim, now: T0 + 2000 }, p, LIGHT, 'light.turn_on', { brightness: 200 });
    expect(historyAttributes(sim, LIGHT)).toEqual(['brightness', 'color_temp_kelvin']);
    expect(historySeries(sim, LIGHT, T0, T0 + 5000, 'brightness').map((s) => s.v)).toEqual([100, 200]);
    expect(historyAttributes(sim, 'climate.termo_climate')).toEqual(expect.arrayContaining(['current_temperature', 'hvac_action', 'temperature']));
    expect(historyEntities(sim)).not.toContain(attributeKey(LIGHT, 'brightness'));
    // al apagar, el brillo desaparece: hueco «unknown»
    sim = callService({ ...sim, now: T0 + 3000 }, p, LIGHT, 'light.turn_off');
    expect(historySeries(sim, LIGHT, T0, T0 + 5000, 'brightness').at(-1)?.v).toBe('unknown');
  });

  it('umbral: los cambios pequeños no se guardan pero la deriva acumulada sí', () => {
    let sim = createSimulationState(p, catalog, T0);
    sim = callService(sim, p, LIGHT, 'light.turn_on', { brightness: 100 });
    for (let i = 1; i <= 4; i++) sim = callService({ ...sim, now: T0 + i * 1000 }, p, LIGHT, 'light.turn_on', { brightness: 100 + i });
    expect(historySeries(sim, LIGHT, T0, T0 + 10_000, 'brightness').map((s) => s.v)).toEqual([100, 103]);
  });

  it('límite por serie', () => {
    let sim: SimulationState = { ...createSimulationState(p, catalog, T0) };
    for (let i = 0; i < 20; i++) {
      sim = recordAttributeSamples({ ...sim, now: T0 + i }, LIGHT, { state: 'on', attributes: { brightness: i * 10 } }, 5);
    }
    expect(sim.history?.[attributeKey(LIGHT, 'brightness')]?.map((s) => s.v)).toEqual([150, 160, 170, 180, 190]);
  });

  it('battery_level en cualquier dominio y renombrado de las series', () => {
    let sim = createSimulationState(p, catalog, T0);
    sim = setEntityState(sim, p, LIGHT, { state: 'off', attributes: { battery_level: 80 } });
    expect(historyAttributes(sim, LIGHT)).toContain('battery_level');
    const renamed = renameEntities(sim, { [LIGHT]: 'light.nueva' });
    expect(historyAttributes(renamed, 'light.nueva')).toContain('battery_level');
    expect(historyAttributes(renamed, LIGHT)).toEqual([]);
    expect(historySeries(renamed, 'light.nueva', T0, T0 + 1)[0]?.v).toBe('off');
  });
});
