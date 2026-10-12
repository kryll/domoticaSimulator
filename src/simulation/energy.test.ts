import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { def, dev, project } from '../devices/testUtils';
import { createDemoProject } from '../store/demoProject';
import type { Project, SimulationState } from '../types';
import { DAY_MS, HOUR_MS } from './clock';
import { batteryDrainPerHour, devicePowerWatts, energySummary, LOW_BATTERY_LEVEL } from './energy';
import { callService, createSimulationState, setDeviceBattery, tick } from './engine';
import { setFailures } from './availability';

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const start = (p: Project): SimulationState => createSimulationState(p, catalog, T0);

describe('potencia por dispositivo (B10)', () => {
  const p = project([
    dev('l', 'hue-white-e27', undefined, { name: 'Luz' }),
    { ...dev('e', 'shelly-plug-s-gen3', undefined, { name: 'Estufa' }), loadWatts: 1500 },
    dev('z', 'sonoff-s26r2zb', undefined, { name: 'Enchufe' }),
    dev('tv', 'lg-oled-c3', undefined, { name: 'Tele' }),
    dev('s', 'aqara-door-window', undefined, { name: 'Puerta' }),
  ]);
  const watts = (sim: SimulationState, id: string): number => {
    const d = p.devices.find((x) => x.id === id);
    if (!d) throw new Error(id);
    return devicePowerWatts(d, def(d.definitionId), sim);
  };

  it('luz: reposo apagada y powerWatts × brillo encendida', () => {
    let sim = start(p);
    expect(watts(sim, 'l')).toBeCloseTo(0.3);
    sim = callService(sim, p, 'light.luz', 'turn_on', { brightness_pct: 50 });
    expect(watts(sim, 'l')).toBeCloseTo(0.3 + 9 * (128 / 255), 2);
  });

  it('enchufe: la carga indicada (o 60 W por defecto) y el sensor power la refleja', () => {
    let sim = callService(start(p), p, 'switch.estufa_switch', 'turn_on');
    expect(watts(sim, 'e')).toBeCloseTo(1500.5);
    expect(sim.entities['sensor.estufa_power']?.state).toBe(1500);
    sim = callService(sim, p, 'switch.estufa_switch', 'turn_off');
    expect(sim.entities['sensor.estufa_power']?.state).toBe(0);
    sim = callService(sim, p, 'switch.enchufe', 'turn_on');
    expect(watts(sim, 'z')).toBeCloseTo(60.5);
  });

  it('tele encendida, a pilas 0 W y sin corriente 0 W', () => {
    let sim = callService(start(p), p, 'media_player.tele', 'turn_on');
    expect(watts(sim, 'tv')).toBeCloseTo(93);
    expect(watts(sim, 's')).toBe(0);
    sim = { ...sim, failures: { internet: false, powerOutage: true, haRestarting: false, devicesDown: [] } };
    expect(watts(sim, 'tv')).toBe(0);
  });

  it('acumula kWh en tick y calcula el coste con el precio del proyecto', () => {
    const priced: Project = { ...p, settings: { latitude: 40.4, longitude: -3.7, electricityPriceEurKwh: 0.2 } };
    let sim = callService(start(priced), priced, 'switch.estufa_switch', 'turn_on');
    sim = tick(sim, priced, 2 * HOUR_MS);
    const summary = energySummary(sim, priced, catalog);
    const estufa = summary.byDevice.find((d) => d.deviceId === 'e');
    expect(estufa?.kwh).toBeCloseTo(3.001, 3);
    expect(estufa?.cost).toBeCloseTo(0.6002, 3);
    expect(summary.totalW).toBeGreaterThan(1500);
    expect(summary.pricePerKwh).toBe(0.2);
    expect(summary.byRoom[0]).toMatchObject({ roomId: null, name: 'Sin sala' });
    expect(summary.totalCost).toBeCloseTo(summary.totalKwh * 0.2);
    expect(summary.since).toBe(T0);
    // el sensor de energía del enchufe se actualiza
    expect(Number(sim.entities['sensor.estufa_energy']?.state)).toBeGreaterThan(0);
  });

  it('la casa de ejemplo tiene consumo por salas', () => {
    const demo = createDemoProject();
    const sim = tick(start(demo), demo, HOUR_MS);
    const summary = energySummary(sim, demo, catalog);
    expect(summary.byRoom.map((r) => r.name)).toContain('Salón');
    expect(summary.totalKwh).toBeGreaterThan(0);
  });
});

describe('baterías', () => {
  const p: Project = {
    ...project([dev('ha', 'ha-green'), dev('co', 'sonoff-zbdongle-p'), dev('s', 'aqara-door-window', undefined, { name: 'Puerta', integration: 'zha' }), dev('th', 'netatmo-thermostat', undefined, { name: 'Termo' })]),
    settings: { latitude: 40.4, longitude: -3.7, electricityPriceEurKwh: 0.15, batteryAcceleration: 100 },
  };

  it('se descargan de forma acelerada, avisan bajo el 20 % y al 0 % el dispositivo cae', () => {
    const perHour = batteryDrainPerHour(def('aqara-door-window'), 100);
    expect(perHour).toBeCloseTo((100 / (2 * 8760)) * 100);
    let sim = start(p);
    const hoursTo19 = 81 / perHour;
    sim = tick(sim, p, hoursTo19 * HOUR_MS);
    expect(sim.batteries?.s).toBeLessThan(LOW_BATTERY_LEVEL);
    expect(sim.entities['sensor.puerta_battery']?.state).toBe(Math.round(sim.batteries?.s ?? -1));
    expect(sim.log.some((l) => l.message === `Batería baja: «Puerta» está por debajo del ${LOW_BATTERY_LEVEL} %`)).toBe(true);
    expect(energySummary(sim, p, catalog).lowBatteries.map((b) => b.deviceId)).toContain('s');
    expect(sim.entities['climate.termo_climate']?.attributes?.battery_level).toBeLessThan(100);
    sim = tick(sim, p, 30 * DAY_MS);
    expect(sim.batteries?.s).toBe(0);
    expect(sim.entities['binary_sensor.puerta_door']?.state).toBe('unavailable');
    expect(sim.log.some((l) => l.level === 'error' && /Puerta» se ha quedado sin batería/.test(l.message))).toBe(true);
    sim = setDeviceBattery(sim, p, catalog, 's', 100);
    expect(sim.entities['binary_sensor.puerta_door']?.state).toBe('off');
    expect(sim.entities['sensor.puerta_battery']?.state).toBe(100);
  });

  it('una batería agotada convive con los fallos simulados', () => {
    let sim = setDeviceBattery(start(p), p, catalog, 's', 0);
    sim = setFailures(sim, p, catalog, { internet: true });
    sim = setFailures(sim, p, catalog, { internet: false });
    expect(sim.entities['binary_sensor.puerta_door']?.state).toBe('unavailable');
    expect(sim.entities['climate.termo_climate']?.state).not.toBe('unavailable');
  });
});

describe('consumo de dispositivos no disponibles', () => {
  it('sin Internet o desconectado sigue consumiendo su carga; solo el corte de luz la pone a 0', () => {
    const demo = createDemoProject();
    const cafetera = demo.devices.find((d) => d.id === 'demo-cafetera');
    if (!cafetera) throw new Error('demo');
    let sim = callService(start(demo), demo, 'switch.cafetera', 'turn_on');
    const on = devicePowerWatts(cafetera, def(cafetera.definitionId), sim);
    expect(on).toBeCloseTo(1200.5);
    sim = setFailures(sim, demo, catalog, { internet: true });
    expect(sim.entities['switch.cafetera']?.state).toBe('unavailable');
    expect(devicePowerWatts(cafetera, def(cafetera.definitionId), sim)).toBeCloseTo(on);
    sim = setFailures(sim, demo, catalog, { internet: false, powerOutage: true });
    expect(devicePowerWatts(cafetera, def(cafetera.definitionId), sim)).toBe(0);
  });
});
