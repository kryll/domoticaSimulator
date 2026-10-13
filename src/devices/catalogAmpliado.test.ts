// Catálogo ampliado: bombillas IKEA, relés, pulsadores, cámaras Aqara, enchufes y routers de operadora.
import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { BUTTON_ACTION_LABELS } from './labels';
import { isThreadBorderRouter, zigbeeNetworkOf } from './roles';
import { def, dev } from './testUtils';
import { transportFor, type DeviceDefinition } from '../types';

const ids = (prefix: string): DeviceDefinition[] => catalog.filter((d) => d.id.startsWith(prefix));

/** Reglas comunes de coherencia para cualquier definición nueva. */
function expectCoherent(d: DeviceDefinition): void {
  // Los hubs propietarios solo se exigen sobre Zigbee y a la marca del propio dispositivo.
  if (d.requiresHub) {
    expect(d.protocols, d.id).toContain('zigbee');
    expect(d.requiresHub, d.id).toBe(d.brand);
  }
  // Zigbee de Aqara, IKEA o Hue con la integración del hub como primera opción: exige su hub.
  if (d.protocols.includes('zigbee') && d.role !== 'hub' && ['homekit_device', 'hue'].includes(d.integrations[0] ?? '')) expect(d.requiresHub, d.id).toBe(d.brand);
  if (d.protocols.includes('zigbee') && d.role !== 'hub' && !d.requiresHub) expect(d.integrations, d.id).toEqual(expect.arrayContaining(['zha', 'zigbee2mqtt']));
  // Thread o Matter: integración Matter.
  if (d.protocols.includes('thread') && d.role !== 'hub') expect(d.integrations, d.id).toContain('matter');
  // Wi-Fi solo en la nube con eWeLink o Tuya.
  if (d.integrations[0] === 'ewelink' || d.integrations[0] === 'tuya') expect(d.iotClass, d.id).toBe('cloud_push');
  // Los routers de malla van a la red eléctrica; los mandos, a pilas.
  if (d.role === 'router') expect(d.power, d.id).toBe('mains');
  if (d.entities.some((e) => e.key === 'action')) expect(d.power, d.id).toBe('battery');
}

describe('bombillas IKEA', () => {
  it('TRÅDFRI (Zigbee) en E27, E14 y GU10, blanco regulable y color: necesitan DIRIGERA o ZHA/Z2M', () => {
    const tradfri = ids('ikea-tradfri-');
    expect(tradfri.length).toBeGreaterThanOrEqual(8);
    for (const sock of ['e27', 'e14', 'gu10']) {
      expect(tradfri.some((d) => d.id.includes(sock) && d.id.endsWith('-cws')), `${sock} color`).toBe(true);
      expect(tradfri.some((d) => d.id.includes(sock) && /-ws(-|$)/.test(d.id)), `${sock} blanco`).toBe(true);
    }
    for (const d of tradfri) {
      expect(d.protocols, d.id).toEqual(['zigbee']);
      expect(d.requiresHub, d.id).toBe('IKEA');
      expect(d.role, d.id).toBe('router');
      expectCoherent(d);
    }
    expect(def('ikea-tradfri-gu10-cws').entities[0]?.capabilities?.colorModes).toContain('rgb');
    expect(def('ikea-tradfri-e14-ws').entities[0]?.capabilities?.colorModes).not.toContain('rgb');
  });

  it('KAJPLATS (Matter sobre Thread) en E27, E14 y GU10: sin hub, van por Matter en el laboratorio', () => {
    const kajplats = ids('ikea-kajplats-');
    expect(kajplats.length).toBeGreaterThanOrEqual(6);
    for (const sock of ['e14', 'gu10']) {
      expect(kajplats.some((d) => d.id === `ikea-kajplats-${sock}-cws`)).toBe(true);
      expect(kajplats.some((d) => d.id === `ikea-kajplats-${sock}-ws`)).toBe(true);
    }
    for (const d of kajplats) {
      expect(d.protocols, d.id).toEqual(['thread']);
      expect(d.integrations, d.id).toEqual(['matter']);
      expect(d.requiresHub, d.id).toBeUndefined();
      expect(transportFor(dev('x', d.id), d), d.id).toBe('matter');
      expectCoherent(d);
    }
  });

  it('TRÅDFRI con ZHA o Zigbee2MQTT llega al laboratorio por Z2M; con el hub, por MQTT genérico', () => {
    const d = def('ikea-tradfri-e27-cws');
    expect(transportFor(dev('x', d.id, undefined, { integration: 'zigbee2mqtt' }), d)).toBe('z2m_mqtt');
    expect(zigbeeNetworkOf(dev('x', d.id, undefined, { integration: 'zigbee2mqtt' }), d)).toBe('coordinator');
    expect(zigbeeNetworkOf(dev('x', d.id), d)).toBe('hub:IKEA');
  });
});

describe('relés de Aqara, Shelly y SONOFF', () => {
  it('Aqara T1 (con y sin neutro) y Dual Relay T2 son Zigbee con hub Aqara; el sin neutro no repite la malla', () => {
    expect(def('aqara-t1-relay-neutral')).toMatchObject({ protocols: ['zigbee'], role: 'router', requiresHub: 'Aqara' });
    expect(def('aqara-t1-relay-no-neutral')).toMatchObject({ role: 'end_device', requiresHub: 'Aqara' });
    expect(def('aqara-dual-relay-t2').entities.filter((e) => e.domain === 'switch')).toHaveLength(2);
    for (const id of ['aqara-t1-relay-neutral', 'aqara-t1-relay-no-neutral', 'aqara-dual-relay-t2']) expectCoherent(def(id));
  });

  it('SONOFF: MINIR4M por Matter, ZBMINIR2 y MINI-ZB2GS por Zigbee (Z2M), BASICR4 en la nube (eWeLink)', () => {
    expect(transportFor(dev('m', 'sonoff-minir4m'), def('sonoff-minir4m'))).toBe('matter');
    expect(transportFor(dev('z', 'sonoff-zbminir2', undefined, { integration: 'zigbee2mqtt' }), def('sonoff-zbminir2'))).toBe('z2m_mqtt');
    expect(transportFor(dev('z', 'sonoff-mini-zb2gs', undefined, { integration: 'zigbee2mqtt' }), def('sonoff-mini-zb2gs'))).toBe('z2m_mqtt');
    expect(def('sonoff-basicr4').iotClass).toBe('cloud_push');
    expect(transportFor(dev('b', 'sonoff-basicr4'), def('sonoff-basicr4'))).toBe('mqtt_discovery');
    for (const id of ['sonoff-minir4m', 'sonoff-zbminir2', 'sonoff-mini-zb2gs', 'sonoff-basicr4']) expectCoherent(def(id));
  });

  it('los relés Shelly nuevos van por la vía Shelly y cuentan como proxy Bluetooth', () => {
    for (const id of ['shelly-1-gen3', 'shelly-1-gen4', 'shelly-1pm-gen4', 'shelly-2pm-gen4', 'shelly-1-mini-gen3', 'shelly-1pm-mini-gen3', 'shelly-pro-1pm', 'shelly-pro-2pm']) {
      expect(transportFor(dev('s', id), def(id)), id).toBe('shelly');
      expect(def(id).protocols, id).toContain('ble');
    }
  });
});

describe('interruptores de pared y pulsadores', () => {
  it('los interruptores con relé exponen switch; los pulsadores inalámbricos, el sensor de acción y la batería', () => {
    for (const id of ['aqara-h1-switch-no-neutral', 'aqara-h1-switch-neutral', 'aqara-h1-switch-neutral-double', 'sonoff-tx-ultimate-t5-2c', 'sonoff-m5-2c-80', 'sonoff-zbm5-2c-80', 'tuya-zigbee-wall-switch']) {
      const d = def(id);
      expect(d.category, id).toBe('switch');
      expect(d.entities.some((e) => e.domain === 'switch'), id).toBe(true);
      expect(d.power, id).toBe('mains');
      expectCoherent(d);
    }
    for (const id of ['aqara-wireless-remote-h1', 'hue-tap-dial-switch', 'ikea-somrig', 'ikea-bilresa-2b']) {
      const d = def(id);
      expect(d.entities.map((e) => e.key), id).toEqual(['action', 'battery']);
      expect(d.entities[0]?.capabilities?.buttonActions?.length, id).toBeGreaterThan(2);
      for (const a of d.entities[0]?.capabilities?.buttonActions ?? []) expect(BUTTON_ACTION_LABELS[a], `${id} ${a}`).toBeDefined();
      expectCoherent(d);
    }
  });

  it('sin neutro no repiten la malla Zigbee; con neutro, sí', () => {
    expect(def('aqara-h1-switch-no-neutral').role).toBe('end_device');
    expect(def('aqara-h1-switch-neutral').role).toBe('router');
    expect(def('tuya-zigbee-wall-switch').role).toBe('end_device');
    expect(def('sonoff-zbm5-2c-80').role).toBe('router');
  });

  it('el mando Hue necesita el puente Hue (o ZHA/Z2M) y BILRESA va por Matter', () => {
    expect(def('hue-tap-dial-switch').requiresHub).toBe('Philips Hue');
    expect(transportFor(dev('b', 'ikea-bilresa-2b'), def('ikea-bilresa-2b'))).toBe('matter');
  });
});

describe('coherencia de todo el catálogo ampliado', () => {
  it('las definiciones nuevas cumplen las reglas de protocolo, hub e integración', () => {
    const fresh = catalog.filter((d) => /^(ikea-(tradfri-(e27-cws|e27-ws-1055|e14|gu10-)|kajplats-|somrig|bilresa)|aqara-(t1-|dual-relay|h1-|wireless-remote-h1|camera-|doorbell-g4|power-plug-h2)|shelly-(1-gen|1pm-gen4|2pm-gen4|1-mini|1pm-mini|pro-[12]pm)|sonoff-(minir4m|zbminir2|mini-zb2gs|basicr4|tx-ultimate|m5-|zbm5-)|hue-tap-dial|tuya-zigbee-(wall|plug))/.test(d.id));
    expect(fresh.length).toBeGreaterThanOrEqual(11);
    for (const d of fresh) expectCoherent(d);
  });

  it('ninguna marca exige un hub que no exista en el catálogo', () => {
    for (const d of catalog.filter((x) => x.requiresHub)) expect(catalog.some((h) => h.role === 'hub' && h.brand === d.requiresHub), d.id).toBe(true);
  });

  it('los hubs Thread siguen siendo border routers', () => {
    expect(isThreadBorderRouter(def('ikea-dirigera'))).toBe(true);
  });
});
