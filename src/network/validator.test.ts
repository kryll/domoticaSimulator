import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Device, Project, ValidationIssue } from '../types';
import { suggestConnections } from './connections';
import { validateProject } from './validator';

function codes(issues: ValidationIssue[]): string[] {
  return issues.map((i) => i.code);
}

/** Proyecto con servidor, router y conexiones automáticas; todos en la sala r1. */
function connected(devices: Device[], extra: Partial<Project> = {}): Project {
  const all = [dev('srv', 'ha-green', { x: 0, y: 0 }), dev('ap', 'tplink-deco-x50', { x: 50, y: 0 }), ...devices].map((d) => ({
    ...d,
    roomId: 'r1',
  }));
  const p = project(all, { rooms: [{ id: 'r1', floorId: 'f0', name: 'Salón', polygon: [] }], ...extra });
  return { ...p, connections: suggestConnections(p, catalog) };
}

function find(issues: ValidationIssue[], code: string): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
}

describe('validateProject', () => {
  it('proyecto vacío: falta el servidor', () => {
    expect(codes(validateProject(project([]), catalog))).toEqual(['sin-servidor-ha']);
  });

  it('instalación correcta sin problemas', () => {
    const p = connected([dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 50 }), dev('s', 'sonoff-snzb-03p', { x: 100, y: 100 })]);
    expect(validateProject(p, catalog)).toEqual([]);
  });

  it('zigbee-sin-coordinador', () => {
    const issues = validateProject(connected([dev('s', 'sonoff-snzb-03p')]), catalog);
    const i = find(issues, 'zigbee-sin-coordinador');
    expect(i).toMatchObject({ severity: 'error', deviceIds: ['s'] });
    expect(i?.message).toMatch(/ningún coordinador Zigbee/);
    expect(codes(issues)).not.toContain('fuera-de-cobertura');
  });

  it('varios-coordinadores-zigbee', () => {
    const p = connected([dev('z1', 'sonoff-zbdongle-p'), dev('z2', 'sonoff-zbdongle-e')]);
    expect(find(validateProject(p, catalog), 'varios-coordinadores-zigbee')).toMatchObject({ severity: 'warning', deviceIds: ['z1', 'z2'] });
  });

  it('falta-hub-propietario para Aqara, IKEA y Hue, no si usan ZHA', () => {
    const p = connected([
      dev('a', 'aqara-door-window'),
      dev('i', 'ikea-tradfri-e27-ws'),
      dev('h', 'hue-white-e27'),
      dev('z', 'aqara-motion-p1', undefined, { integration: 'zha' }),
      dev('zc', 'sonoff-zbdongle-p'),
    ]);
    const issues = validateProject(p, catalog).filter((i) => i.code === 'falta-hub-propietario');
    expect(issues.map((i) => i.deviceIds)).toEqual([['a'], ['i'], ['h']]);
    expect(issues.map((i) => i.id)).toEqual(['falta-hub-propietario:Aqara', 'falta-hub-propietario:IKEA', 'falta-hub-propietario:Philips Hue']);
    expect(issues[0]?.message).toMatch(/hub de Aqara/);
  });

  it('con el hub presente no hay aviso de hub', () => {
    const p = connected([dev('hb', 'hue-bridge-v2', { x: 100, y: 0 }), dev('h', 'hue-white-e27', { x: 200, y: 0 })]);
    expect(validateProject(p, catalog)).toEqual([]);
  });

  it('thread-sin-border-router, zwave-sin-controlador y rf433-sin-puente', () => {
    const p = connected([dev('t', 'aqara-u200'), dev('z', 'shelly-wave-1pm'), dev('r', 'sonoff-dw2-rf')]);
    const issues = validateProject(p, catalog);
    expect(find(issues, 'thread-sin-border-router')?.deviceIds).toEqual(['t']);
    expect(find(issues, 'zwave-sin-controlador')?.deviceIds).toEqual(['z']);
    expect(find(issues, 'rf433-sin-puente')?.deviceIds).toEqual(['r']);
  });

  it('con su infraestructura, Thread, Z-Wave y RF 433 son válidos', () => {
    const p = connected([
      dev('br', 'google-nest-hub-2', { x: 100, y: 100 }),
      dev('t', 'aqara-u200', { x: 150, y: 100 }),
      dev('zw', 'ha-connect-zwa-2', { x: 0, y: 30 }),
      dev('z', 'shelly-wave-1pm', { x: 100, y: 30 }),
      dev('rb', 'sonoff-rf-bridge-r2', { x: 300, y: 0 }),
      dev('r', 'sonoff-dw2-rf', { x: 400, y: 0 }),
    ]);
    const issues = validateProject(p, catalog);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(codes(issues)).toEqual(['integracion-cloud']);
  });

  it('ble-sin-proxy si no hay proxy cerca', () => {
    const lonely = validateProject(connected([dev('b', 'xiaomi-lywsd03mmc', { x: 500, y: 0 })]), catalog);
    expect(find(lonely, 'ble-sin-proxy')).toMatchObject({ severity: 'warning', deviceIds: ['b'] });
    expect(codes(lonely)).not.toContain('fuera-de-cobertura');
    const withProxy = connected([dev('s', 'shelly-plug-s-gen3', { x: 450, y: 0 }), dev('b', 'xiaomi-lywsd03mmc', { x: 500, y: 0 })]);
    expect(validateProject(withProxy, catalog)).toEqual([]);
  });

  it('integracion-cloud: un aviso informativo por integración', () => {
    const p = connected([dev('a', 'tuya-wifi-plug'), dev('b', 'tuya-wifi-bulb-e27'), dev('c', 'sonoff-s26r2'), dev('d', 'tapo-p110')]);
    const cloud = validateProject(p, catalog).filter((i) => i.code === 'integracion-cloud');
    expect(cloud.map((i) => [i.severity, i.id, i.deviceIds])).toEqual([
      ['info', 'integracion-cloud:tuya', ['a', 'b']],
      ['info', 'integracion-cloud:ewelink', ['c']],
    ]);
    expect(cloud[0]?.message).toMatch(/Tuya depende de la nube/);
  });

  it('fuera-de-cobertura usa el análisis de malla', () => {
    const p = connected([dev('zc', 'sonoff-zbdongle-p'), dev('s', 'sonoff-snzb-03p', { x: 5000, y: 0 })]);
    expect(find(validateProject(p, catalog), 'fuera-de-cobertura')).toMatchObject({ severity: 'error', deviceIds: ['s'] });
  });

  it('conexion-protocolo-incompatible y conexion-invalida', () => {
    const p = connected([dev('t', 'tapo-p110', { x: 100, y: 0 }), dev('zc', 'sonoff-zbdongle-p')]);
    const bad = {
      ...p,
      connections: [
        ...p.connections,
        { id: 'x1', sourceId: 't', targetId: 'zc', protocol: 'wifi' as const },
        { id: 'x2', sourceId: 't', targetId: 'borrado', protocol: 'wifi' as const },
      ],
    };
    const issues = validateProject(bad, catalog);
    expect(find(issues, 'conexion-protocolo-incompatible')).toMatchObject({ id: 'conexion-protocolo-incompatible:x1', deviceIds: ['t', 'zc'] });
    expect(find(issues, 'conexion-invalida')?.deviceIds).toEqual(['t']);
  });

  it('infraestructura-sin-conexion', () => {
    const p = project([dev('srv', 'ha-green', undefined, { roomId: 'r1' }), dev('ap', 'tplink-deco-x50', undefined, { roomId: 'r1' })], {
      rooms: [{ id: 'r1', floorId: 'f0', name: 'S', polygon: [] }],
    });
    expect(codes(validateProject(p, catalog))).toEqual(['infraestructura-sin-conexion']);
  });

  it('dispositivo-sin-sala (info) y definicion-desconocida (error)', () => {
    const p = connected([]);
    const withExtra = {
      ...p,
      devices: [...p.devices, dev('nr', 'tapo-p110', { x: 60, y: 0 }), { ...dev('u', 'tapo-p110'), definitionId: 'nada', roomId: 'r1' }],
    };
    const issues = validateProject(withExtra, catalog);
    expect(find(issues, 'dispositivo-sin-sala')).toMatchObject({ severity: 'info', deviceIds: ['nr'] });
    expect(find(issues, 'definicion-desconocida')).toMatchObject({ severity: 'error', deviceIds: ['u'] });
  });

  it('ordena por gravedad e ids únicos', () => {
    const p = connected([dev('a', 'tuya-wifi-plug'), dev('s', 'sonoff-snzb-03p'), dev('z1', 'sonoff-zbdongle-p'), dev('z2', 'sonoff-zbdongle-e')]);
    const issues = validateProject(p, catalog);
    const order = { error: 0, warning: 1, info: 2 };
    const sev = issues.map((i) => order[i.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
  });
});
