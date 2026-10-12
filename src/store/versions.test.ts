import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project } from '../types';
import {
  contentHash,
  deleteProjectVersions,
  deleteVersion,
  diffProjects,
  listVersions,
  loadVersion,
  pruneAutoVersions,
  saveVersion,
  versionsToPrune,
  type VersionMeta,
} from './versions';

function base(id: string): Project {
  return project([dev('l1', 'hue-white-e27', undefined, { name: 'Luz salón' })], { id, name: 'Casa' });
}

const day = (d: number, h = 12): Date => new Date(Date.UTC(2026, 9, d, h, 0, 0));

describe('copias y versiones', () => {
  it('guarda, lista (más reciente primero), carga y borra', async () => {
    const p = base('v-1');
    const first = await saveVersion(p, { auto: false, label: '  Antes de la reforma ', now: day(1) });
    const p2 = { ...p, devices: [...p.devices, dev('l2', 'hue-white-e27', undefined, { name: 'Luz cocina' })] };
    const second = await saveVersion(p2, { auto: true, now: day(2) });
    expect(first).toEqual({ id: expect.any(String), projectId: 'v-1', createdAt: day(1).toISOString(), label: 'Antes de la reforma', auto: false, summary: '1 dispositivo, 0 automatizaciones, 0 escenas, 0 scripts' });
    expect(second.summary).toBe('2 dispositivos, 0 automatizaciones, 0 escenas, 0 scripts');
    const list = await listVersions('v-1');
    expect(list.map((v) => v.id)).toEqual([second.id, first.id]);
    expect(list[0]).not.toHaveProperty('hash');
    expect(await loadVersion(first.id)).toEqual(p);
    await deleteVersion(first.id);
    expect((await listVersions('v-1')).map((v) => v.id)).toEqual([second.id]);
    expect(await loadVersion(first.id)).toBeUndefined();
    expect(await listVersions('otro')).toEqual([]);
  });

  it('una copia automática igual a la última no se repite', async () => {
    const p = base('v-2');
    const a = await saveVersion(p, { auto: true, now: day(1) });
    const b = await saveVersion({ ...p, updatedAt: '2030-01-01T00:00:00.000Z', revision: 9 }, { auto: true, now: day(2) });
    expect(b.id).toBe(a.id);
    const manual = await saveVersion(p, { auto: false, now: day(3) });
    expect(manual.id).not.toBe(a.id);
    expect(await listVersions('v-2')).toHaveLength(2);
    await deleteProjectVersions('v-2');
    expect(await listVersions('v-2')).toEqual([]);
  });

  it('la huella no depende del orden de las claves', () => {
    const p = base('x');
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as unknown as Project;
    expect(contentHash(reordered)).toBe(contentHash(p));
    expect(contentHash({ ...p, name: 'Otra' })).not.toBe(contentHash(p));
  });

  it('versionsToPrune conserva las últimas, una por día y las manuales', () => {
    const v = (id: string, d: number, h: number, auto = true): VersionMeta => ({ id, projectId: 'p', createdAt: day(d, h).toISOString(), auto, summary: '' });
    const versions = [v('a', 1, 9), v('b', 1, 18), v('c', 2, 9), v('d', 3, 9), v('e', 3, 10), v('f', 3, 11), v('m', 1, 1, false)];
    // Las 2 últimas (f, e) y la última de los 2 días más recientes (f del día 3, c del día 2).
    expect(versionsToPrune(versions, { keepLast: 2, keepDaily: 2 }).sort()).toEqual(['a', 'b', 'd']);
    expect(versionsToPrune(versions, { keepLast: 0, keepDaily: 0 }).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(versionsToPrune(versions, { keepLast: 20, keepDaily: 7 })).toEqual([]);
  });

  it('pruneAutoVersions borra las automáticas sobrantes', async () => {
    const p = base('v-3');
    for (let i = 1; i <= 5; i++) await saveVersion({ ...p, name: `Casa ${i}` }, { auto: true, now: day(1, i) });
    const manual = await saveVersion(p, { auto: false, now: day(1, 0) });
    const deleted = await pruneAutoVersions('v-3', { keepLast: 2, keepDaily: 7 });
    expect(deleted).toHaveLength(3);
    const left = await listVersions('v-3');
    expect(left.map((x) => x.id)).toContain(manual.id);
    expect(left).toHaveLength(3);
    for (const id of deleted) expect(await loadVersion(id)).toBeUndefined();
  });
});

describe('diffProjects', () => {
  it('resume lo añadido, quitado y modificado con nombres', () => {
    const a = project(
      [dev('l1', 'hue-white-e27', undefined, { name: 'Luz salón' }), dev('l2', 'hue-white-e27', undefined, { name: 'Luz pasillo' })],
      {
        rooms: [{ id: 'r1', floorId: 'f0', name: 'Salón', polygon: [] }],
        automations: [{ id: 'a1', name: 'Noche', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [] }],
        scenes: [{ id: 's1', name: 'Cine', entities: {} }],
      },
    );
    const b: Project = {
      ...a,
      devices: [{ ...a.devices[0]!, name: 'Luz sofá' }, dev('l3', 'hue-white-e27', undefined, { name: 'Luz cocina' })],
      automations: [],
      scripts: [{ id: 'x1', name: 'Salir', sequence: [] }],
    };
    const d = diffProjects(a, b, catalog);
    expect(d.devices).toEqual({ added: [{ id: 'l3', name: 'Luz cocina' }], removed: [{ id: 'l2', name: 'Luz pasillo' }], modified: [{ id: 'l1', name: 'Luz sofá' }] });
    expect(d.automations.removed).toEqual([{ id: 'a1', name: 'Noche' }]);
    expect(d.scripts.added).toEqual([{ id: 'x1', name: 'Salir' }]);
    expect(d.scenes).toEqual({ added: [], removed: [], modified: [] });
    expect(d.identical).toBe(false);
    expect(d.summary).toEqual([
      'Dispositivos: 1 añadido (Luz cocina), 1 quitado (Luz pasillo), 1 modificado (Luz sofá)',
      'Automatizaciones: 1 quitada (Noche)',
      'Scripts: 1 añadido (Salir)',
    ]);
    expect(d.comparison?.diff.automations).toBe(-1);
  });

  it('sin cambios (aunque cambie el orden de las claves) es idéntico', () => {
    const a = base('x');
    const b: Project = { ...a, devices: a.devices.map((d) => Object.fromEntries(Object.entries(d).reverse()) as unknown as Project['devices'][number]) };
    const d = diffProjects(a, b);
    expect(d.identical).toBe(true);
    expect(d.summary).toEqual([]);
    expect(d.comparison).toBeUndefined();
  });
});
