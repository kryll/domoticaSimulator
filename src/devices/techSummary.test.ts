import { catalog, getDefinition } from './catalog';
import { entitiesForDevice, entityFriendlyName } from './entities';
import { deviceTechSummary } from './techSummary';
import { dev, project } from './testUtils';
import type { DeviceDefinition } from '../types';

const def = (id: string): DeviceDefinition => {
  const d = getDefinition(id, catalog);
  if (!d) throw new Error(id);
  return d;
};

describe('ficha técnica coherente (deviceTechSummary)', () => {
  it('ZHA: no repite «Local» ni pide el hub de IKEA', () => {
    const bulb = dev('b', 'ikea-tradfri-e27-ws', undefined, { integration: 'zha', protocol: 'zigbee' });
    const p = project([bulb, dev('c', 'sonoff-zbdongle-p')]);
    const s = deviceTechSummary(bulb, def('ikea-tradfri-e27-ws'), p);
    expect(s.connectivity).toBe('Local, por sondeo');
    expect(s.text).not.toMatch(/Local.*Local/);
    expect(s.hub).toBe('Coordinador Zigbee (ZHA); no necesita el hub de IKEA');
    expect(s.hubMissing).toBe(false);
    expect(s.rows.map(([k]) => k)).not.toContain('Requiere hub');
  });

  it('con la integración del hub avisa si falta y lo nombra si está', () => {
    const bulb = dev('b', 'hue-white-e27');
    expect(deviceTechSummary(bulb, def('hue-white-e27'), project([bulb]))).toMatchObject({ hubMissing: true, hub: 'Necesita el hub de Philips Hue (no está en el proyecto)' });
    const withHub = project([bulb, dev('h', 'hue-bridge-v2')]);
    expect(deviceTechSummary(bulb, def('hue-white-e27'), withHub)).toMatchObject({ hubMissing: false, hub: 'A través de Philips Hue Bridge', connectivity: 'Local, al instante (push)' });
  });

  it('nube', () => {
    const plug = dev('p', 'tuya-wifi-plug');
    const s = deviceTechSummary(plug, def('tuya-wifi-plug'), project([plug]));
    expect(s).toMatchObject({ cloud: true, locality: 'Nube', connectivity: 'Nube, al instante (push)' });
    expect(s.hub).toBeUndefined();
  });
});

describe('nombre amigable «Dispositivo · Entidad» sin repeticiones', () => {
  it('reglas', () => {
    expect(entityFriendlyName('Termostato', 'Termostato')).toBe('Termostato');
    expect(entityFriendlyName('Termostato salón', 'termostato')).toBe('Termostato salón');
    expect(entityFriendlyName('Salón', 'Temperatura')).toBe('Salón · Temperatura');
    expect(entityFriendlyName('Luz', 'Luz', true)).toBe('Luz');
    expect(entityFriendlyName('Fuga baño', 'Fuga de agua')).toBe('Fuga baño · Fuga de agua');
  });

  it('en las entidades del dispositivo', () => {
    const t = dev('t', 'netatmo-thermostat', undefined, { name: 'Termostato' });
    expect(entitiesForDevice(t, def('netatmo-thermostat')).map((e) => e.friendlyName)).toEqual(['Termostato', 'Termostato · Temperatura']);
    const plug = dev('p', 'tapo-p110', undefined, { name: 'Enchufe potencia' });
    const names = entitiesForDevice(plug, def('tapo-p110')).map((e) => e.friendlyName);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe('Enchufe potencia');
  });
});
