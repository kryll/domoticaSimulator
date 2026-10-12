import { describe, expect, it } from 'vitest';
import {
  catalog,
  CATEGORY_LABELS,
  filterCatalog,
  getDefinition,
  INTEGRATION_LABELS,
  isCloud,
  parseCatalog,
  parseDefinition,
  PROTOCOL_LABELS,
} from './catalog';
import { BRANDS, INTEGRATIONS, PROTOCOLS } from './labels';
import { effectiveIotClass, isBleProxy, isThreadBorderRouter, isZigbeeCoordinator, requiredHubBrand, zigbeeNetworkOf } from './roles';
import { def, dev } from './testUtils';

const valid = {
  id: 'x',
  brand: 'IKEA',
  model: 'M',
  name: 'N',
  category: 'light',
  protocols: ['zigbee'],
  integrations: ['zha'],
  iotClass: 'local_push',
  role: 'router',
  power: 'mains',
  entities: [{ key: 'light', domain: 'light', name: 'Luz', initialState: 'off' }],
};

describe('catálogo', () => {
  it('carga entre 100 y 140 (Tanda 3: catálogo ampliado) definiciones válidas con ids únicos', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(100);
    expect(catalog.length).toBeLessThanOrEqual(140);
    expect(new Set(catalog.map((d) => d.id)).size).toBe(catalog.length);
  });

  it('cubre todas las marcas, protocolos e integraciones', () => {
    for (const b of BRANDS) expect(catalog.some((d) => d.brand === b), b).toBe(true);
    for (const p of PROTOCOLS) expect(catalog.some((d) => d.protocols.includes(p)), p).toBe(true);
    for (const i of INTEGRATIONS) expect(catalog.some((d) => d.integrations.includes(i)), i).toBe(true);
  });

  it('incluye la infraestructura clave', () => {
    expect(catalog.some((d) => d.role === 'ha_server')).toBe(true);
    expect(isZigbeeCoordinator(def('sonoff-zbdongle-p'))).toBe(true);
    expect(def('hue-bridge-v2').role).toBe('hub');
    expect(isThreadBorderRouter(def('aqara-hub-m3'))).toBe(true);
    expect(isThreadBorderRouter(def('ikea-dirigera'))).toBe(true);
    expect(isThreadBorderRouter(def('google-nest-hub-2'))).toBe(true);
    expect(isThreadBorderRouter(def('aqara-hub-m2'))).toBe(false);
  });

  it('los dispositivos con hub propietario son de Aqara, IKEA o Hue y existe su hub', () => {
    const withHub = catalog.filter((d) => d.requiresHub);
    expect(withHub.length).toBeGreaterThan(5);
    for (const d of withHub) {
      expect(['Aqara', 'IKEA', 'Philips Hue']).toContain(d.requiresHub);
      expect(d.requiresHub).toBe(d.brand);
      expect(catalog.some((h) => h.role === 'hub' && h.brand === d.requiresHub)).toBe(true);
    }
  });

  it('los dispositivos que no son infraestructura tienen entidades', () => {
    const infra = ['coordinator', 'hub', 'access_point', 'ha_server'];
    for (const d of catalog.filter((x) => !infra.includes(x.role))) expect(d.entities.length, d.id).toBeGreaterThan(0);
  });

  it('todas las definiciones tienen un precio orientativo razonable (B8)', () => {
    for (const d of catalog) {
      expect(d.priceEur, d.id).toBeGreaterThan(3);
      expect(d.priceEur, d.id).toBeLessThan(2000);
    }
    expect(parseDefinition({ ...valid, priceEur: 12.5 }).priceEur).toBe(12.5);
    expect(() => parseDefinition({ ...valid, priceEur: -1 })).toThrow(/priceEur/);
  });

  it('el servidor HA usa la integración propia de Home Assistant', () => {
    expect(def('ha-green').integrations).toEqual(['homeassistant']);
    expect(INTEGRATION_LABELS.homeassistant).toBe('Home Assistant');
  });

  it('getDefinition busca por id', () => {
    expect(getDefinition('shelly-1pm-gen3')?.brand).toBe('Shelly');
    expect(getDefinition('no-existe')).toBeUndefined();
    expect(getDefinition('x', [parseDefinition(valid)])?.name).toBe('N');
  });

  it('tiene etiquetas en español', () => {
    expect(PROTOCOL_LABELS.rf433).toBe('RF 433 MHz');
    expect(INTEGRATION_LABELS.zigbee2mqtt).toBe('Zigbee2MQTT');
    expect(CATEGORY_LABELS.cover).toBe('Persianas y cortinas');
  });
});

describe('validación del catálogo', () => {
  it('acepta una definición correcta', () => {
    expect(parseDefinition(valid).id).toBe('x');
  });

  it.each([
    [{ ...valid, brand: 'Apple' }, /brand/],
    [{ ...valid, protocols: [] }, /protocols/],
    [{ ...valid, protocols: ['lora'] }, /protocols/],
    [{ ...valid, id: '' }, /id/],
    [{ ...valid, rangeMeters: -3 }, /rangeMeters/],
    [{ ...valid, requiresHub: 'Apple' }, /requiresHub/],
    [{ ...valid, entities: 'x' }, /entities/],
    [{ ...valid, entities: [{ key: 'a b', domain: 'light', name: 'L', initialState: 'off' }] }, /clave de entidad/],
    [{ ...valid, entities: [{ key: 'a', domain: 'tv', name: 'L', initialState: 'off' }] }, /domain/],
    [{ ...valid, entities: [{ key: 'a', domain: 'light', name: 'L' }] }, /estado inicial/],
    [{ ...valid, entities: [valid.entities[0], valid.entities[0]] }, /repetida/],
    [{ ...valid, entities: [{ key: 'a', domain: 'light', name: 'L', initialState: 'off', capabilities: [] }] }, /capabilities/],
    [{ ...valid, entities: [{ key: 'a', domain: 'light', name: 'L', initialState: 'off', capabilities: { colorModes: ['hs'] } }] }, /colorModes/],
    [{ ...valid, entities: [{ key: 'a', domain: 'light', name: 'L', initialState: 'off', capabilities: { minKelvin: 6500, maxKelvin: 2000 } }] }, /minKelvin/],
    [{ ...valid, entities: [{ key: 'a', domain: 'cover', name: 'L', initialState: 'closed', capabilities: { travelSeconds: -1 } }] }, /travelSeconds/],
    [{ ...valid, entities: [{ key: 'a', domain: 'climate', name: 'L', initialState: 'heat', capabilities: { hvacModes: [1] } }] }, /hvacModes/],
    [{ ...valid, entities: [{ key: 'a', domain: 'light', name: 'L', initialState: 'off', capabilities: { color: true } }] }, /capacidad desconocida/],
    ['texto', /objeto/],
  ])('rechaza definiciones mal formadas (%#)', (raw, msg) => {
    expect(() => parseDefinition(raw)).toThrow(msg);
  });

  it('los errores están en español e identifican la definición', () => {
    expect(() => parseDefinition({ ...valid, role: 'x' })).toThrow('Catálogo de dispositivos inválido ("x"): "role" tiene un valor no válido: "x"');
  });

  it('rechaza ids repetidos y no listas', () => {
    expect(() => parseCatalog([valid, valid])).toThrow(/id repetido "x"/);
    expect(() => parseCatalog({})).toThrow(/se esperaba una lista/);
  });
});

describe('capacidades del catálogo', () => {
  const caps = (id: string, key: string) => def(id).entities.find((e) => e.key === key)?.capabilities;

  it('luces: Hue White solo brillo, Hue Color rgb + color_temp, TRÅDFRI 2200-4000 K', () => {
    expect(caps('hue-white-e27', 'light')?.colorModes).toEqual(['brightness']);
    expect(caps('hue-white-color-e27', 'light')?.colorModes).toEqual(expect.arrayContaining(['rgb', 'color_temp']));
    expect(caps('ikea-tradfri-e27-ws', 'light')).toMatchObject({ colorModes: ['brightness', 'color_temp'], minKelvin: 2200, maxKelvin: 4000 });
  });

  it('movimiento, persianas, termostatos, enchufes, TV y mandos', () => {
    expect(caps('aqara-motion-p1', 'motion')?.motionTimeoutSeconds).toBe(60);
    expect(caps('ikea-vallhorn', 'motion')?.motionTimeoutSeconds).toBe(180);
    expect(caps('shelly-2pm-gen3-cover', 'cover')?.travelSeconds).toBe(20);
    expect(caps('netatmo-thermostat', 'climate')).toMatchObject({ hvacModes: expect.arrayContaining(['off', 'heat']), tempStep: 0.5 });
    expect(caps('tapo-p110', 'switch')?.powerWatts).toBeGreaterThan(0);
    expect(caps('lg-oled-c3', 'media')?.sources?.length).toBeGreaterThan(2);
    expect(caps('aqara-wireless-mini-switch', 'action')?.buttonActions).toContain('double');
  });

  it('todas las luces, persianas y termostatos declaran capacidades', () => {
    const missing = catalog.flatMap((d) => d.entities.filter((e) => ['light', 'cover', 'climate'].includes(e.domain) && !e.capabilities).map((e) => `${d.id}.${e.key}`));
    expect(missing).toEqual([]);
  });
});

describe('filterCatalog', () => {
  it('sin filtros devuelve todo', () => {
    expect(filterCatalog(catalog, {})).toHaveLength(catalog.length);
  });

  it('busca sin distinguir mayúsculas ni acentos y por varias palabras', () => {
    expect(filterCatalog(catalog, { query: 'tradfri GU10' }).map((d) => d.id)).toEqual(['ikea-tradfri-gu10']);
    expect(filterCatalog(catalog, { query: 'ESTACION netatmo' }).map((d) => d.id)).toEqual(['netatmo-weather-station']);
    expect(filterCatalog(catalog, { query: 'nada-que-exista' })).toEqual([]);
  });

  it('filtra por marca, protocolo y categoría', () => {
    const r = filterCatalog(catalog, { brands: ['Aqara'], protocols: ['thread'], categories: ['sensor'] });
    expect(r.length).toBeGreaterThan(0);
    for (const d of r) {
      expect(d.brand).toBe('Aqara');
      expect(d.protocols).toContain('thread');
      expect(d.category).toBe('sensor');
    }
    expect(filterCatalog(catalog, { brands: [], protocols: [], categories: [] })).toHaveLength(catalog.length);
  });

  it('filtra por conectividad local o nube', () => {
    const cloud = filterCatalog(catalog, { connectivity: 'cloud' });
    const local = filterCatalog(catalog, { connectivity: 'local' });
    expect(cloud.every((d) => isCloud(d.iotClass))).toBe(true);
    expect(local.some((d) => isCloud(d.iotClass))).toBe(false);
    expect(cloud.length + local.length).toBe(catalog.length);
    expect(filterCatalog(catalog, { connectivity: 'all' })).toHaveLength(catalog.length);
  });

  it('isCloud distingue clases IoT', () => {
    expect(isCloud('cloud_push')).toBe(true);
    expect(isCloud('cloud_polling')).toBe(true);
    expect(isCloud('local_push')).toBe(false);
    expect(isCloud('local_polling')).toBe(false);
  });
});

describe('roles', () => {
  it('la red Zigbee depende de la integración elegida', () => {
    const viaHub = dev('a', 'aqara-motion-p1');
    const viaZha = dev('b', 'aqara-motion-p1', undefined, { integration: 'zha' });
    expect(zigbeeNetworkOf(viaHub, def('aqara-motion-p1'))).toBe('hub:Aqara');
    expect(zigbeeNetworkOf(viaZha, def('aqara-motion-p1'))).toBe('coordinator');
    expect(requiredHubBrand(viaHub, def('aqara-motion-p1'))).toBe('Aqara');
    expect(requiredHubBrand(viaZha, def('aqara-motion-p1'))).toBeUndefined();
    expect(zigbeeNetworkOf(dev('c', 'sonoff-snzb-03p'), def('sonoff-snzb-03p'))).toBe('coordinator');
  });

  it('clase IoT efectiva según integración', () => {
    expect(effectiveIotClass(dev('a', 'netatmo-thermostat'), def('netatmo-thermostat'))).toBe('cloud_polling');
    expect(effectiveIotClass(dev('a', 'netatmo-thermostat', undefined, { integration: 'homekit_device' }), def('netatmo-thermostat'))).toBe('local_push');
  });

  it('proxy BLE: Shelly Gen3 sí, sensor BLE a pilas no', () => {
    expect(isBleProxy(def('shelly-plug-s-gen3'))).toBe(true);
    expect(isBleProxy(def('xiaomi-lywsd03mmc'))).toBe(false);
    expect(isBleProxy(def('ha-green'))).toBe(false);
  });
});
