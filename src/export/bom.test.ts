import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { createDemoProject } from '../store/demoProject';
import type { Project } from '../types';
import { billOfMaterials, bomToCsv, formatEuros } from './bom';

describe('lista de materiales y presupuesto (B8)', () => {
  const p: Project = project(
    [
      dev('ha', 'ha-green', undefined, { roomId: 'r1' }),
      dev('a', 'hue-white-e27', undefined, { roomId: 'r1' }),
      dev('b', 'hue-white-e27', undefined, { roomId: 'r2' }),
      dev('c', 'aqara-door-window', undefined, { roomId: 'r2' }),
      dev('d', 'aqara-u200'),
    ],
    {
      rooms: [
        { id: 'r1', floorId: 'f0', name: 'Salón', polygon: [] },
        { id: 'r2', floorId: 'f0', name: 'Cocina', polygon: [] },
      ],
      settings: { latitude: 40, longitude: -3, electricityPriceEurKwh: 0.15, prices: { 'hue-white-e27': 14.99 } },
    },
  );

  it('agrupa por modelo con cantidad, precio (el del proyecto manda), protocolos y salas', () => {
    const r = billOfMaterials(p, catalog);
    const hue = r.lines.find((l) => l.definitionId === 'hue-white-e27');
    expect(hue).toMatchObject({ brand: 'Philips Hue', model: 'LWA017', quantity: 2, unitPrice: 14.99, total: 29.98, priceSource: 'project', protocols: ['zigbee'], rooms: ['Salón', 'Cocina'] });
    const lock = r.lines.find((l) => l.definitionId === 'aqara-u200');
    expect(lock).toMatchObject({ unitPrice: 249, priceSource: 'catalog', rooms: ['Sin sala'] });
    expect(r.total).toBe(129 + 29.98 + 15 + 249);
    expect(r.lines[0]?.definitionId).toBe('aqara-u200');
    expect(r.unpriced).toEqual([]);
  });

  it('subtotales por sala, protocolo y categoría', () => {
    const r = billOfMaterials(p, catalog);
    expect(r.byRoom.find((g) => g.label === 'Salón')).toEqual({ key: 'r1', label: 'Salón', quantity: 2, total: 143.99 });
    expect(r.byProtocol.find((g) => g.key === 'zigbee')).toMatchObject({ label: 'Zigbee', quantity: 3, total: 44.98 });
    expect(r.byCategory.find((g) => g.key === 'light')).toMatchObject({ quantity: 2, total: 29.98 });
    expect(r.byRoom.reduce((s, g) => s + g.total, 0)).toBeCloseTo(r.total);
  });

  it('señala la infraestructura que falta con su precio', () => {
    const r = billOfMaterials(p, catalog);
    expect(r.requiredInfrastructure.map((x) => x.definitionId)).toEqual(['hue-bridge-v2', 'aqara-hub-m2', 'google-nest-hub-2']);
    expect(r.requiredInfrastructure[0]).toMatchObject({ reason: 'Los dispositivos de Philips Hue con su integración necesitan su hub', unitPrice: 59 });
    expect(r.totalWithInfrastructure).toBeCloseTo(r.total + 59 + 49 + 99.99);
    const zha = billOfMaterials(project([dev('ha', 'ha-green'), dev('c', 'aqara-door-window', undefined, { integration: 'zha' })]), catalog);
    expect(zha.requiredInfrastructure.map((x) => x.definitionId)).toEqual(['sonoff-zbdongle-p']);
    const demo = billOfMaterials(createDemoProject(), catalog);
    expect(demo.requiredInfrastructure).toEqual([]);
    expect(demo.lines.reduce((s, l) => s + l.quantity, 0)).toBe(createDemoProject().devices.length);
    expect(billOfMaterials(project([dev('s', 'tapo-p110')]), catalog).requiredInfrastructure.map((x) => x.definitionId)).toEqual(['ha-green', 'tplink-deco-x50']);
  });

  it('CSV con «;», BOM y coma decimal', () => {
    const csv = bomToCsv(billOfMaterials(p, catalog));
    expect(csv.startsWith('﻿Marca;Modelo;Nombre;Cantidad;Precio unitario (€);Total (€);Protocolos;Salas\r\n')).toBe(true);
    expect(csv).toContain('Philips Hue;LWA017;Hue White E27;2;14,99;29,98;Zigbee;Salón, Cocina\r\n');
    expect(csv).toContain(';;Total;5;;422,98;;\r\n');
    expect(csv).toContain('Infraestructura necesaria (no incluida)');
    expect(formatEuros(3)).toBe('3,00');
  });
});
