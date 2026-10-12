import { devicePresentation, presentationComputations } from './viewCache';
import { mergeNodes } from './mergeNodes';
import { createSimulationState } from '../simulation/engine';
import { catalog, getDefinition } from '../devices/catalog';
import { makeDevice, makeProject } from '../test/fixtures';
import type { AppNode } from './types';

describe('viewCache', () => {
  it('reutiliza la vista si solo cambia la hora y recalcula si cambia una entidad', () => {
    const device = makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz');
    const def = getDefinition(device.definitionId, catalog);
    if (!def) throw new Error('sin definición');
    const sim = createSimulationState(makeProject({ devices: [device] }), catalog, 0);
    const a = devicePresentation(device, def, sim);
    const n = presentationComputations;
    const b = devicePresentation(device, def, { ...sim, now: sim.now + 60_000 });
    expect(b.view).toBe(a.view);
    expect(presentationComputations).toBe(n);
    const changed = { ...sim, entities: { ...sim.entities, 'light.luz': { state: 'on' } } };
    expect(devicePresentation(device, def, changed).view).not.toBe(a.view);
  });
});

describe('mergeNodes', () => {
  const node = (id: string, data: Record<string, unknown>): AppNode =>
    ({ id, type: 'roomLabel', position: { x: 0, y: 0 }, data }) as unknown as AppNode;

  it('devuelve los mismos objetos si nada cambia', () => {
    const prev = [node('a', { name: 'Salón', deviceCount: 1, list: ['x'] })];
    const next = [node('a', { name: 'Salón', deviceCount: 1, list: ['x'] })];
    expect(mergeNodes(prev, next)).toBe(prev);
  });

  it('sustituye solo el nodo que cambia', () => {
    const prev = [node('a', { name: 'A', deviceCount: 0 }), node('b', { name: 'B', deviceCount: 0 })];
    const out = mergeNodes(prev, [node('a', { name: 'A', deviceCount: 0 }), node('b', { name: 'B', deviceCount: 2 })]);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).not.toBe(prev[1]);
  });
});
