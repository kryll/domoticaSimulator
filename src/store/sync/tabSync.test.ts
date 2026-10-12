import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, loadProject, saveProject } from '../persistence';
import { parseProject } from '../projectSchema';
import { createTabChannel, getTabId, isTabMessage, revisionOf, saveProjectChecked, tabId, type TabMessage } from './tabSync';

describe('saveProjectChecked', () => {
  it('guarda un proyecto nuevo con la revisión siguiente', async () => {
    const p = createEmptyProject('Casa');
    expect(await saveProjectChecked(p, 0)).toEqual({ ok: true, revision: 1 });
    expect((await loadProject(p.id))?.revision).toBe(1);
  });

  it('sube la revisión en cada guardado y detecta el conflicto con otra pestaña', async () => {
    const p = createEmptyProject('Casa');
    expect(await saveProjectChecked(p, 0)).toEqual({ ok: true, revision: 1 });
    // Pestaña A guarda sobre la revisión 1.
    const a = { ...p, name: 'Casa A', revision: 1 };
    expect(await saveProjectChecked(a, 1)).toEqual({ ok: true, revision: 2 });
    // Pestaña B tenía la revisión 1: conflicto, con lo que guardó A.
    const b = { ...p, name: 'Casa B', revision: 1 };
    const result = await saveProjectChecked(b, 1);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'conflict') throw new Error('se esperaba un conflicto');
    expect(result.current.name).toBe('Casa A');
    expect(result.current.revision).toBe(2);
    // No se ha pisado lo de A.
    expect((await loadProject(p.id))?.name).toBe('Casa A');
  });

  it('dos guardados simultáneos sobre la misma revisión: solo gana uno', async () => {
    const p = createEmptyProject('Casa');
    await saveProjectChecked(p, 0);
    const results = await Promise.all([saveProjectChecked({ ...p, name: 'X' }, 1), saveProjectChecked({ ...p, name: 'Y' }, 1)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'conflict')).toHaveLength(1);
  });

  it('un proyecto guardado sin revisión cuenta como revisión 0', async () => {
    const p = createEmptyProject('Antiguo');
    await saveProject(p);
    expect(revisionOf(p)).toBe(0);
    expect(await saveProjectChecked(p, 3)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await saveProjectChecked(p, 0)).toEqual({ ok: true, revision: 1 });
  });

  it('error si lo guardado por otra pestaña está dañado', async () => {
    const p = createEmptyProject('Casa');
    await saveProject({ ...p, revision: 5, floors: [] });
    const result = await saveProjectChecked(p, 4);
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('projectSchema acepta proyectos sin revisión y valida la que haya', () => {
    const p = createEmptyProject('Casa');
    expect(parseProject(p).revision).toBeUndefined();
    expect(parseProject({ ...p, revision: 7 }).revision).toBe(7);
    expect(() => parseProject({ ...p, revision: -1 })).toThrow('revision');
  });
});

/** BroadcastChannel en memoria: entrega a los demás canales con el mismo nombre. */
class MockChannel {
  static all: MockChannel[] = [];
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    MockChannel.all.push(this);
  }
  postMessage(data: unknown): void {
    if (this.closed) throw new Error('cerrado');
    for (const c of MockChannel.all) {
      if (c !== this && !c.closed && c.name === this.name) c.onmessage?.({ data } as MessageEvent<unknown>);
    }
  }
  close(): void {
    this.closed = true;
  }
}

describe('createTabChannel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockChannel.all = [];
  });

  it('entrega los mensajes válidos de otras pestañas del mismo proyecto', () => {
    vi.stubGlobal('BroadcastChannel', MockChannel);
    const mine = createTabChannel('p1');
    const received: TabMessage[] = [];
    const unsubscribe = mine.subscribe((m) => received.push(m));
    // Otra pestaña: un canal «crudo» con el mismo nombre.
    const other = new MockChannel(MockChannel.all[0]?.name ?? '');
    other.postMessage({ type: 'saved', projectId: 'p1', revision: 4, tabId: 'otra' });
    other.postMessage({ type: 'opened', projectId: 'p1', tabId: 'otra' });
    other.postMessage({ type: 'saved', projectId: 'p1', tabId: 'otra' }); // sin revisión: no válido
    other.postMessage({ type: 'opened', projectId: 'p2', tabId: 'otra' }); // otro proyecto
    other.postMessage({ type: 'opened', projectId: 'p1', tabId }); // esta misma pestaña
    other.postMessage('basura');
    expect(received).toEqual([
      { type: 'saved', projectId: 'p1', revision: 4, tabId: 'otra' },
      { type: 'opened', projectId: 'p1', tabId: 'otra' },
    ]);
    unsubscribe();
    other.postMessage({ type: 'opened', projectId: 'p1', tabId: 'otra' });
    expect(received).toHaveLength(2);
    mine.close();
    expect(MockChannel.all[0]?.closed).toBe(true);
    expect(() => mine.post({ type: 'opened', projectId: 'p1', tabId })).not.toThrow();
  });

  it('entre dos canales del mismo proyecto (dos pestañas)', () => {
    vi.stubGlobal('BroadcastChannel', MockChannel);
    const a = createTabChannel('p1');
    const b = createTabChannel('p1');
    const c = createTabChannel('p2');
    const got = vi.fn();
    const gotC = vi.fn();
    b.subscribe(got);
    c.subscribe(gotC);
    // Con el mismo tabId (mismo módulo) se filtra: simula otra pestaña con otro id.
    a.post({ type: 'saved', projectId: 'p1', revision: 2, tabId: 'pestaña-a' });
    expect(got).toHaveBeenCalledWith({ type: 'saved', projectId: 'p1', revision: 2, tabId: 'pestaña-a' });
    expect(gotC).not.toHaveBeenCalled();
  });

  it('sin BroadcastChannel no hace nada', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const ch = createTabChannel('p1');
    const fn = vi.fn();
    const off = ch.subscribe(fn);
    ch.post({ type: 'opened', projectId: 'p1', tabId });
    off();
    ch.close();
    expect(fn).not.toHaveBeenCalled();
  });

  it('tabId es estable y válido', () => {
    expect(getTabId()).toBe(tabId);
    expect(tabId.length).toBeGreaterThan(8);
    expect(isTabMessage({ type: 'opened', projectId: 'p', tabId })).toBe(true);
    expect(isTabMessage({ type: 'saved', projectId: 'p', tabId, revision: Number.NaN })).toBe(false);
    expect(isTabMessage(null)).toBe(false);
  });
});
