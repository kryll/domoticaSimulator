// Tanda 3: búsqueda global.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { buildSearchIndex, normalizeSearch, scoreEntry, search } from './search';

describe('búsqueda global', () => {
  const index = buildSearchIndex(createDemoProject(), catalog);

  it('normaliza sin acentos ni mayúsculas', () => {
    expect(normalizeSearch('  Salón — Cocina!! ')).toBe('salon cocina');
  });

  it('agrupa dispositivos, entidades, salas y automatizaciones sin acentos', () => {
    const r = search(index, 'salon');
    const kinds = r.groups.map((g) => g.kind);
    expect(kinds).toEqual(expect.arrayContaining(['device', 'entity', 'room', 'automation']));
    expect(r.groups.find((g) => g.kind === 'room')?.results[0]?.entry.title).toBe('Salón');
    expect(r.groups.find((g) => g.kind === 'device')?.results[0]?.entry.title).toBe('Luz salón');
    expect(r.total).toBeGreaterThan(5);
  });

  it('acciones de la app, entity_id y búsqueda difusa', () => {
    expect(search(index, 'exportar paquetes').groups[0]?.results[0]?.entry.id).toBe('export-packages');
    expect(search(index, 'packages').groups[0]?.results[0]?.entry.title).toBe('Exportar packages');
    expect(search(index, 'light.luz_pasillo').groups[0]?.results[0]?.entry).toMatchObject({ kind: 'entity', id: 'light.luz_pasillo' });
    expect(search(index, 'vacaciones').groups.some((g) => g.kind === 'helper')).toBe(true);
    expect(search(index, 'trmsto').groups[0]?.results[0]?.entry.title).toBe('Termostato');
    expect(search(index, 'zzzz qqq').total).toBe(0);
    expect(search(index, '').groups.map((g) => g.kind)).toEqual(['action']);
  });

  it('puntúa más una coincidencia exacta que una parcial', () => {
    const exact = index.entries.find((e) => e.kind === 'room' && e.title === 'Cocina');
    const partial = index.entries.find((e) => e.kind === 'device' && e.title === 'Luz cocina');
    expect(exact && partial && scoreEntry('cocina', exact) > scoreEntry('cocina', partial)).toBe(true);
  });
});
