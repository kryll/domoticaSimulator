import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { parseProject } from '../store/projectSchema';
import { applyVariant, compareVariants, createVariant, deleteVariant, renameVariant, snapshotOf, summarizeProject, updateVariant } from './variants';

describe('variantes', () => {
  const demo = createDemoProject();

  it('crea, aplica, renombra, actualiza y borra', () => {
    let p = createVariant(demo, 'Original', 'v1');
    expect(p.variants?.[0]?.snapshot.devices).toHaveLength(demo.devices.length);
    expect(p.variants?.[0]?.snapshot).not.toHaveProperty('variants');
    const removed = p.devices[0]?.id;
    const changed = { ...p, name: 'Reducida', devices: p.devices.slice(1), connections: p.connections.filter((c) => c.sourceId !== removed && c.targetId !== removed) };
    p = createVariant(changed, 'Reducida', 'v2');
    const back = applyVariant(p, 'v1');
    expect(back.devices).toHaveLength(demo.devices.length);
    expect(back.name).toBe(demo.name);
    expect(back.id).toBe(demo.id);
    expect(back.variants?.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(renameVariant(p, 'v1', 'A').variants?.[0]?.name).toBe('A');
    expect(updateVariant(back, 'v2').variants?.[1]?.snapshot.devices).toHaveLength(demo.devices.length);
    expect(deleteVariant(p, 'v1').variants?.map((v) => v.id)).toEqual(['v2']);
    expect(() => applyVariant(p, 'nada')).toThrow(/desconocida/);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('las instantáneas son copias independientes', () => {
    const p = createVariant(demo, 'X', 'v');
    p.devices[0]!.name = 'cambiado';
    expect(p.variants?.[0]?.snapshot.devices[0]?.name).not.toBe('cambiado');
  });

  it('resume y compara', () => {
    const s = summarizeProject(snapshotOf(demo), catalog);
    expect(s.devices).toBe(demo.devices.length);
    expect(s.cloud).toBeGreaterThan(0);
    expect(s.hubs).toEqual(expect.arrayContaining(['Coordinador Zigbee', 'Puente Hue']));
    expect(s.batteries).toBeGreaterThan(0);
    const local = { ...snapshotOf(demo), devices: demo.devices.filter((d) => d.id !== 'demo-termostato' && d.id !== 'demo-cafetera') };
    const cmp = compareVariants(snapshotOf(demo), local, catalog, (p) => p.devices.length * 10);
    expect(cmp.diff.devices).toBe(-2);
    expect(cmp.diff.cloud).toBeLessThan(0);
    expect(cmp.diff.cost).toBe(-20);
    expect(cmp.a.cloudDependencies.map((d) => d.automationId)).toEqual(cmp.a.cloudDependencies.map((d) => d.automationId));
  });

  it('detecta las automatizaciones que dependen de la nube', () => {
    const p = {
      ...snapshotOf(demo),
      automations: [
        { id: 'c', name: 'Café', enabled: true, mode: 'single' as const, triggers: [{ type: 'time' as const, at: '07:00' }], conditions: [], actions: [{ type: 'service' as const, service: 'switch.turn_on', entityId: 'switch.cafetera' }] },
      ],
    };
    expect(summarizeProject(p, catalog).cloudDependencies).toEqual([{ automationId: 'c', name: 'Café', entityIds: ['switch.cafetera'] }]);
  });
});
