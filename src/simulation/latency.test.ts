import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { CLOUD_LATENCY_MAX_MS, CLOUD_LATENCY_MIN_MS, latencyFor, LOCAL_LATENCY_MS, nextRandom, PROTOCOL_LATENCY_MS } from './latency';

describe('latencia', () => {
  it('nextRandom es determinista y uniforme en [0, 1)', () => {
    let state = 7;
    const values: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const [v, s] = nextRandom(state);
      values.push(v);
      state = s;
    }
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(nextRandom(7)).toEqual(nextRandom(7));
  });

  it('por integración y protocolo', () => {
    const p = project([
      dev('c', 'sonoff-s26r2', undefined, { name: 'Nube' }),
      dev('z', 'hue-white-e27', undefined, { name: 'Zigbee' }),
      dev('m', 'xiaomi-led-bulb-essential', undefined, { name: 'Miio' }),
    ]);
    expect(latencyFor(p, catalog, 'switch.nube', 0)).toEqual({ ms: CLOUD_LATENCY_MIN_MS + PROTOCOL_LATENCY_MS.wifi, cloud: true });
    expect(latencyFor(p, catalog, 'switch.nube', 1).ms).toBe(CLOUD_LATENCY_MAX_MS + PROTOCOL_LATENCY_MS.wifi);
    expect(latencyFor(p, catalog, 'light.zigbee')).toEqual({ ms: LOCAL_LATENCY_MS + PROTOCOL_LATENCY_MS.zigbee, cloud: false });
    expect(latencyFor(p, catalog, 'light.miio').ms).toBeGreaterThan(latencyFor(p, catalog, 'light.zigbee').ms);
    expect(latencyFor(p, catalog, 'light.grupo_x')).toEqual({ ms: 0, cloud: false });
  });
});
