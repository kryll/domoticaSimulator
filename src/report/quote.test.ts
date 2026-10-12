import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project } from '../types';
import { createDemoProject } from '../store/demoProject';
import { billOfMaterials } from '../export/bom';
import { buildQuote, CONFIG_MINUTES, INSTALL_MINUTES } from './quote';

const base = (quote: NonNullable<Project['settings']>['quote'] = {}): Project =>
  project([dev('srv', 'ha-green'), dev('ap', 'tplink-deco-x50'), dev('p1', 'tuya-wifi-plug'), dev('p2', 'tuya-wifi-plug')], {
    settings: { latitude: 40, longitude: -3, electricityPriceEurKwh: 0.15, quote },
  });

const cents = (eur: number): number => Math.round(eur * 100);

describe('presupuesto por partidas', () => {
  it('materiales, infraestructura y mano de obra con los valores por defecto', () => {
    const q = buildQuote(base(), catalog);
    expect(q.materialLines).toHaveLength(1);
    expect(q.materialLines[0]).toMatchObject({ description: 'Enchufe Tuya Wi-Fi 16 A', quantity: 2, unitPrice: 9, total: 18 });
    expect(q.infrastructureLines.map((l) => l.definitionId).sort()).toEqual(['ha-green', 'tplink-deco-x50']);
    expect(q.subtotalMaterials).toBe(18 + 129 + 99);
    const install = q.laborLines.find((l) => l.key === 'install:plug');
    expect(install).toMatchObject({ quantity: Math.round(((2 * INSTALL_MINUTES.plug) / 60) * 4) / 4, unitPrice: 45 });
    expect(q.laborLines.find((l) => l.key === 'config:server')?.detail).toBe('2 integraciones: TP-Link Smart Home, Tuya');
    expect(q.vatPct).toBe(21);
    expect(q.currency).toBe('EUR');
  });

  it('margen, descuento e IVA en céntimos enteros', () => {
    const q = buildQuote(base({ marginPct: 12.5, showMargin: true, discountPct: 7, vatPct: 21, laborRateEurH: 38.33, laborHours: 1.5 }), catalog);
    const c = q.cents;
    for (const v of Object.values(c)) expect(Number.isInteger(v)).toBe(true);
    for (const l of [...q.materialLines, ...q.infrastructureLines, ...q.laborLines]) expect(Number.isInteger(l.totalCents)).toBe(true);
    expect(c.subtotalLabor).toBe(q.laborLines.reduce((s, l) => s + l.totalCents, 0));
    expect(c.margin).toBe(Math.round(((c.subtotalMaterials + c.subtotalLabor) * 12.5) / 100));
    expect(c.discount).toBe(Math.round(((c.subtotalMaterials + c.subtotalLabor + c.margin) * 7) / 100));
    expect(c.taxableBase).toBe(c.subtotalMaterials + c.subtotalLabor + c.margin - c.discount);
    expect(c.vat).toBe(Math.round((c.taxableBase * 21) / 100));
    expect(c.total).toBe(c.taxableBase + c.vat);
    expect(cents(q.total)).toBe(c.total);
    expect(q.laborLines.find((l) => l.key === 'labor:extra')).toMatchObject({ quantity: 1.5, totalCents: Math.round(1.5 * 3833) });
  });

  it('minutos fijos por dispositivo, precios propios y valores fuera de rango', () => {
    const p = base({ perDeviceInstallMinutes: 60, vatPct: 400, marginPct: -5 });
    const q = buildQuote({ ...p, settings: { ...p.settings!, prices: { 'tuya-wifi-plug': 12.345 } } }, catalog);
    expect(q.materialLines[0]).toMatchObject({ unitPriceCents: 1235, totalCents: 2470 });
    expect(q.laborLines.find((l) => l.key === 'install:plug')?.quantity).toBe(2);
    expect(q.vatPct).toBe(100);
    expect(q.marginPct).toBe(0);
  });

  it('incluye la infraestructura que falta y la configuración', () => {
    const p = project([dev('s', 'sonoff-snzb-03p')], {
      automations: [{ id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [] }],
      scenes: [{ id: 's', name: 'S', entities: {} }],
    });
    const q = buildQuote(p, catalog);
    expect(q.infrastructureLines.filter((l) => l.missing).map((l) => l.definitionId)).toEqual(['ha-green', 'sonoff-zbdongle-p']);
    expect(q.laborLines.find((l) => l.key === 'config:automations')).toMatchObject({ detail: `1 automatización × ${CONFIG_MINUTES.perAutomation} min` });
    expect(q.laborLines.find((l) => l.key === 'config:scenes')?.detail).toBe(`1 escena × ${CONFIG_MINUTES.perScene} min`);
  });

  it('la demo: presupuesto coherente con la lista de materiales y sin infraestructura pendiente', () => {
    const demo = createDemoProject();
    const q = buildQuote(demo, catalog);
    const bom = billOfMaterials(demo, catalog);
    expect(bom.requiredInfrastructure).toEqual([]);
    expect(q.infrastructureLines.some((l) => l.missing)).toBe(false);
    expect(q.unpriced).toEqual([]);
    expect(cents(q.subtotalMaterials)).toBe(cents(bom.total));
    const units = [...q.materialLines, ...q.infrastructureLines].reduce((s, l) => s + l.quantity, 0);
    expect(units).toBe(demo.devices.length);
    expect(q.laborLines.length).toBeGreaterThan(3);
    expect(q.total).toBeGreaterThan(q.taxableBase);
    expect(q.cents.total).toBe(q.cents.taxableBase + q.cents.vat);
  });
});

describe('margen y mano de obra (revisión final)', () => {
  it('por defecto el margen no sale como línea: va repartido en los precios', () => {
    const plain = buildQuote(base(), catalog);
    const q = buildQuote(base({ marginPct: 10 }), catalog);
    expect(q.showMargin).toBe(false);
    expect(q.margin).toBe(0);
    expect(q.cents.margin).toBe(0);
    expect(q.materialLines[0]?.unitPriceCents).toBe(Math.round(((plain.materialLines[0]?.unitPriceCents ?? 0) * 110) / 100));
    expect(q.laborRateEurH).toBe(49.5);
    expect(q.cents.taxableBase).toBe(q.cents.subtotalMaterials + q.cents.subtotalLabor - q.cents.discount);
    // El total con el margen repartido es prácticamente el mismo que mostrándolo aparte.
    const shown = buildQuote(base({ marginPct: 10, showMargin: true }), catalog);
    expect(shown.showMargin).toBe(true);
    expect(shown.margin).toBeGreaterThan(0);
    expect(Math.abs(shown.cents.taxableBase - q.cents.taxableBase)).toBeLessThanOrEqual(10);
  });

  it('cada línea de mano de obra: horas (a 0,25 h) × tarifa = importe', () => {
    const q = buildQuote(base({ laborRateEurH: 38.33, laborHours: 1.3, marginPct: 7 }), catalog);
    expect(q.laborLines.length).toBeGreaterThan(2);
    for (const l of q.laborLines) {
      expect(Number.isInteger(l.quantity * 4)).toBe(true);
      expect(l.totalCents).toBe(Math.round(l.quantity * l.unitPriceCents));
    }
    expect(q.laborLines.find((l) => l.key === 'labor:extra')?.quantity).toBe(1.25);
    // 2 enchufes × 5 min = 10 min → 0,25 h.
    expect(q.laborLines.find((l) => l.key === 'install:plug')?.quantity).toBe(0.25);
  });
});
