import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { createDevice, defaultIntegration } from './factory';
import { def, dev, project } from './testUtils';
import { explainUnconnected } from '../network/connections';

const server = dev('srv', 'ha-green');
const router = dev('ap', 'tplink-deco-x50');
const coordinator = dev('zb', 'sonoff-zbdongle-p');
const hueBridge = dev('hb', 'hue-bridge-v2');

describe('defaultIntegration (B5)', () => {
  it('sin infraestructura usa el orden del catálogo, local antes que nube', () => {
    expect(defaultIntegration(def('hue-white-e27'), project([]), catalog)).toEqual({ protocol: 'zigbee', integration: 'hue' });
    expect(defaultIntegration(def('netatmo-weather-station'), project([]), catalog)).toEqual({ protocol: 'wifi', integration: 'homekit_device' });
  });

  it('con coordinador Zigbee elige ZHA (o Zigbee2MQTT si es la que ya se usa)', () => {
    expect(defaultIntegration(def('aqara-motion-p1'), project([server, coordinator]), catalog)).toEqual({ protocol: 'zigbee', integration: 'zha' });
    const z2m = project([server, coordinator, dev('s', 'sonoff-snzb-02d', undefined, { integration: 'zigbee2mqtt' })]);
    expect(defaultIntegration(def('ikea-tradfri-e27-ws'), z2m, catalog).integration).toBe('zigbee2mqtt');
  });

  it('con el hub de la marca usa su integración', () => {
    expect(defaultIntegration(def('hue-white-e27'), project([server, coordinator, hueBridge]), catalog)).toEqual({ protocol: 'zigbee', integration: 'hue' });
    expect(defaultIntegration(def('ikea-tradfri-e27-ws'), project([server, dev('dg', 'ikea-dirigera')]), catalog)).toEqual({ protocol: 'zigbee', integration: 'matter' });
  });

  it('elige el protocolo con infraestructura disponible', () => {
    expect(defaultIntegration(def('tapo-p110m'), project([server, router]), catalog)).toEqual({ protocol: 'matter', integration: 'matter' });
    expect(defaultIntegration(def('shelly-wave-1pm'), project([dev('zw', 'ha-connect-zwa-2')]), catalog)).toEqual({ protocol: 'zwave', integration: 'zwave_js' });
  });

  it('createDevice usa la integración por defecto si recibe el proyecto', () => {
    const opts = { floorId: 'f0', position: { x: 0, y: 0 } };
    expect(createDevice(def('aqara-motion-p1'), opts).integration).toBe('homekit_device');
    expect(createDevice(def('aqara-motion-p1'), opts, project([coordinator]), catalog).integration).toBe('zha');
  });
});

describe('explainUnconnected', () => {
  it('explica por qué no se puede conectar cada dispositivo', () => {
    const p = project([
      server,
      dev('m', 'aqara-motion-p1', undefined, { name: 'Movimiento', integration: 'zha' }),
      dev('h', 'hue-white-e27', undefined, { name: 'Bombilla' }),
      dev('t', 'aqara-door-p2', undefined, { name: 'Puerta Thread' }),
      dev('w', 'sonoff-s26r2', undefined, { name: 'Enchufe' }),
    ]);
    const reasons = explainUnconnected(p, catalog);
    const byId = Object.fromEntries(reasons.map((r) => [r.deviceId, r.reason]));
    expect(byId.m).toMatch(/^Movimiento: .*no hay coordinador Zigbee/);
    expect(byId.h).toMatch(/falta el hub de Philips Hue/);
    expect(byId.t).toMatch(/border router Thread/);
    expect(byId.w).toMatch(/router ni punto de acceso/);
    expect(byId.srv).toBeUndefined();
  });

  it('no lista lo que Autoconectar sí puede enlazar', () => {
    const p = project([server, router, coordinator, dev('m', 'aqara-motion-p1', undefined, { integration: 'zha' })]);
    expect(explainUnconnected(p, catalog)).toEqual([]);
  });
});
