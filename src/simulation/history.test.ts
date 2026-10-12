import { describe, expect, it } from 'vitest';
import type { SimulationState } from '../types';
import { historyEntities, historySeries, isNumericSeries, recordSample, sampleValue, seriesStats } from './history';
import { latencyFor, nextRandom } from './latency';
import { dev, project } from '../devices/testUtils';
import { catalog } from '../devices/catalog';

const base = (history?: SimulationState['history']): SimulationState => ({ running: false, now: 0, speed: 1, entities: {}, pending: [], log: [], ...(history ? { history } : {}) });

describe('historial', () => {
  it('registra, sustituye en el mismo instante, no repite y respeta el límite', () => {
    let sim = recordSample(base({}), 's', 1);
    sim = recordSample(sim, 's', 2);
    expect(sim.history?.s).toEqual([{ t: 0, v: 2 }]);
    sim = recordSample({ ...sim, now: 10 }, 's', 2);
    expect(sim.history?.s).toHaveLength(1);
    for (let i = 1; i <= 5; i++) sim = recordSample({ ...sim, now: i * 100 }, 's', i * 10, 3);
    expect(sim.history?.s?.map((x) => x.v)).toEqual([30, 40, 50]);
    expect(recordSample(base(), 's', 1).history).toBeUndefined();
  });

  it('historySeries incluye el valor vigente al inicio del intervalo', () => {
    const sim = base({ s: [{ t: 0, v: 1 }, { t: 100, v: 2 }, { t: 200, v: 3 }] });
    expect(historySeries(sim, 's', 50, 150)).toEqual([{ t: 50, v: 1 }, { t: 100, v: 2 }]);
    expect(historySeries(sim, 'x', 0, 10)).toEqual([]);
    expect(historyEntities(sim)).toEqual(['s']);
  });

  it('valores, estadísticas y tipo de serie', () => {
    expect(sampleValue('21.5')).toBe(21.5);
    expect(sampleValue(true)).toBe('on');
    expect(sampleValue('on')).toBe('on');
    const samples = [{ t: 0, v: 10 }, { t: 100, v: 20 }];
    expect(isNumericSeries(samples)).toBe(true);
    expect(isNumericSeries([{ t: 0, v: 'on' }])).toBe(false);
    expect(seriesStats(samples, 200)).toEqual({ min: 10, max: 20, mean: 15 });
    expect(seriesStats([], 10)).toBeUndefined();
  });
});

describe('latencia', () => {
  it('generador determinista en [0, 1)', () => {
    const [a, s1] = nextRandom(42);
    const [b] = nextRandom(42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(nextRandom(s1)[0]).not.toBe(a);
  });

  it('nube 1-3 s, local ~100 ms, sin dispositivo 0', () => {
    const p = project([dev('c', 'sonoff-s26r2', undefined, { name: 'Nube' }), dev('l', 'hue-white-e27', undefined, { name: 'Luz' })]);
    const cloud = latencyFor(p, catalog, 'switch.nube', 0);
    expect(cloud.cloud).toBe(true);
    expect(cloud.ms).toBeGreaterThanOrEqual(1000);
    expect(latencyFor(p, catalog, 'switch.nube', 0.999).ms).toBeLessThanOrEqual(3100);
    const local = latencyFor(p, catalog, 'light.luz');
    expect(local.cloud).toBe(false);
    expect(local.ms).toBeGreaterThanOrEqual(100);
    expect(local.ms).toBeLessThan(300);
    expect(latencyFor(p, catalog, 'person.x')).toEqual({ ms: 0, cloud: false });
  });
});
