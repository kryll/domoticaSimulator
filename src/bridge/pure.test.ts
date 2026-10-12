import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../store/demoProject';
import { parseProject } from '../store/projectSchema';
import { defaultHaBridgeSettings, defaultRadioProfiles } from '../types';
import { bridgeSettings, parseHaBridge, parseRadioProfiles, topicError, withoutLocalLabFields } from './schema';
import { shareableProject } from '../share/share';
import { exportProjectJson } from '../store/persistence';
import { latencyFor } from '../simulation/latency';
import { catalog } from '../devices/catalog';
import { parseLocalLab, LOCAL_LAB_KEY } from './localLab';
import { acquireTabLock, type ChannelLike, type LockManagerLike } from './tabLock';
import { mergeRestoredProject } from './sync';
import type { Project } from '../types';
import { encode, filterTraffic, parseClientMessage, parseServerMessage, pushRing, topicMatches, trafficPayload, type TrafficEntry } from './protocol';
import { diffEntities, projectForLab, projectPatch } from './sync';
import { viaInfo } from './via';
import { interferenceLossPct, radioLatencyMs, radioProfileFor } from './radio';

describe('esquema del proyecto', () => {
  it('acepta y valida haBridge y radioProfiles', () => {
    const p = { ...createDemoProject(), haBridge: { ...defaultHaBridgeSettings(), automationsRunIn: 'simulator' }, radioProfiles: { zigbee: { lossPct: 2, availability: { activeSeconds: 300 } } } };
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    expect(parsed.haBridge?.automationsRunIn).toBe('simulator');
    expect(parsed.radioProfiles?.zigbee?.lossPct).toBe(2);
  });

  it('un proyecto antiguo con enabled y orchestratorUrl: se ignoran al cargarlo', () => {
    const old = { ...createDemoProject(), haBridge: { ...defaultHaBridgeSettings(), enabled: true, orchestratorUrl: 'ws://atacante:8080/orchestrator', baseTopic: 'mio' } };
    const parsed = parseProject(JSON.parse(JSON.stringify(old)));
    expect(parsed.haBridge).toEqual({ ...defaultHaBridgeSettings(), baseTopic: 'mio' });
    expect(JSON.stringify(parsed)).not.toContain('atacante');
  });

  it('el enlace compartido y la exportación quitan los ajustes locales del lab', () => {
    const old = { ...createDemoProject(), haBridge: { ...defaultHaBridgeSettings(), enabled: true, orchestratorUrl: 'ws://atacante:8080/orchestrator' } } as unknown as Project;
    expect(JSON.stringify(shareableProject(old))).not.toContain('atacante');
    expect(exportProjectJson(old)).not.toContain('atacante');
    expect((JSON.parse(exportProjectJson(old)) as { haBridge: object }).haBridge).not.toHaveProperty('enabled');
    expect(withoutLocalLabFields(old).haBridge).toEqual(defaultHaBridgeSettings());
    expect(bridgeSettings(old)).toEqual(defaultHaBridgeSettings());
  });

  it('topics: la misma regla en la interfaz y en el proyecto (barra final, comodines, vacíos)', () => {
    expect(topicError('hasim')).toBeUndefined();
    expect(topicError('lab/hasim')).toBeUndefined();
    expect(topicError('hasim/')).toMatch(/terminar/);
    expect(topicError('/hasim')).toMatch(/empezar/);
    expect(topicError('a//b')).toMatch(/vacíos/);
    expect(topicError('a b')).toMatch(/espacios/);
    expect(topicError('')).toMatch(/vacío/);
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), baseTopic: 'hasim/' })).toThrow(/terminar/);
  });

  it('rechaza valores no válidos y los secretos', () => {
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), automationsRunIn: 'nube' })).toThrow(/automationsRunIn/);
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), baseTopic: 'a/#' })).toThrow(/baseTopic/);
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), labToken: 'x' })).toThrow(/secretos/);
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), password: 'x' })).toThrow(/secretos/);
    expect(() => parseRadioProfiles({ lora: {} })).toThrow(/protocolo/);
    expect(() => parseRadioProfiles({ zigbee: { lossPct: 150 } })).toThrow(/lossPct/);
  });
});

describe('perfiles de radio', () => {
  it('valores por defecto de docs/EMULACION.md', () => {
    const d = defaultRadioProfiles();
    expect(d.zigbee).toMatchObject({ latencyMs: 15, retryLatencyMs: 40, lossPct: 1, maxHops: 5, channel: 11 });
    expect(d.zwave.availability.deadAfterFailures).toBe(3);
    expect(d.rf433.noAck).toBe(true);
  });
  it('mezcla los ajustes del proyecto e interferencia Wi-Fi', () => {
    expect(radioProfileFor({ radioProfiles: { zigbee: { lossPct: 4 } } }, 'zigbee')).toMatchObject({ lossPct: 4, latencyMs: 15 });
    expect(interferenceLossPct(11, [1])).toBe(3);
    expect(interferenceLossPct(15, [1, 6, 11])).toBe(0);
  });

  it('el motor usa la latencia del perfil de radio si el proyecto la ajusta', () => {
    expect(radioLatencyMs({}, 'zigbee', 40)).toBe(40);
    expect(radioLatencyMs({ radioProfiles: { zigbee: { latencyMs: 200 } } }, 'zigbee', 40)).toBe(200);
    const p = createDemoProject();
    const base = latencyFor(p, catalog, 'light.luz_salon');
    const tuned = latencyFor({ ...p, radioProfiles: { [p.devices.find((d) => d.id === 'demo-luz-salon')!.protocol]: { latencyMs: 500 } } }, catalog, 'light.luz_salon');
    expect(tuned.ms).toBeGreaterThan(base.ms);
  });
});

describe('ajustes locales del laboratorio', () => {
  it('lee y valida localStorage; un token o una URL raros no se aceptan', () => {
    expect(LOCAL_LAB_KEY).toBe('hasim.lab.local');
    expect(parseLocalLab(null)).toEqual({ enabled: false, orchestratorUrl: 'ws://localhost:8080/orchestrator', token: '' });
    expect(parseLocalLab('no json').enabled).toBe(false);
    const ok = parseLocalLab(JSON.stringify({ enabled: true, orchestratorUrl: 'ws://127.0.0.1:8080/orchestrator', token: 'a'.repeat(32) }));
    expect(ok).toEqual({ enabled: true, orchestratorUrl: 'ws://127.0.0.1:8080/orchestrator', token: 'a'.repeat(32) });
    const bad = parseLocalLab(JSON.stringify({ enabled: 'sí', orchestratorUrl: 'http://x', token: 'corto' }));
    expect(bad).toEqual({ enabled: false, orchestratorUrl: 'ws://localhost:8080/orchestrator', token: '' });
  });
});

describe('candado entre pestañas', () => {
  /** LockManager falso con la semántica de Web Locks (exclusivo, en cola, ifAvailable). */
  function fakeLocks(): LockManagerLike {
    let holder = false;
    const queue: Array<() => void> = [];
    const run = async (cb: (lock: unknown) => Promise<void> | void): Promise<void> => {
      holder = true;
      try {
        await cb({});
      } finally {
        holder = false;
        queue.shift()?.();
      }
    };
    return {
      request: (_name, options, cb) => {
        if (options.ifAvailable && holder) return Promise.resolve(cb(null));
        if (!holder) return run(cb);
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('abort')));
          queue.push(() => {
            if (options.signal?.aborted) return queue.shift()?.();
            resolve(run(cb));
          });
        });
      },
    };
  }

  it('Web Locks: la segunda pestaña espera y toma el control al soltarlo la primera', async () => {
    const locks = fakeLocks();
    const a: string[] = [];
    const b: string[] = [];
    const releaseA = acquireTabLock('lab', (s) => a.push(s), { locks });
    const releaseB = acquireTabLock('lab', (s) => b.push(s), { locks });
    await Promise.resolve();
    expect(a).toEqual(['held']);
    expect(b).toEqual(['waiting']);
    releaseA();
    await new Promise((r) => setTimeout(r, 0));
    expect(b).toEqual(['waiting', 'held']);
    releaseB();
  });

  it('BroadcastChannel como alternativa', async () => {
    const channels: ChannelLike[] = [];
    const channel = (): ChannelLike => {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage: (msg) => {
          for (const other of channels) if (other !== ch) setTimeout(() => other.onmessage?.({ data: msg }), 0);
        },
        close: () => channels.splice(channels.indexOf(ch), 1),
      };
      channels.push(ch);
      return ch;
    };
    const a: string[] = [];
    const b: string[] = [];
    const releaseA = acquireTabLock('lab', (s) => a.push(s), { locks: null, channel, probeMs: 20 });
    await new Promise((r) => setTimeout(r, 40));
    const releaseB = acquireTabLock('lab', (s) => b.push(s), { locks: null, channel, probeMs: 20 });
    await new Promise((r) => setTimeout(r, 40));
    expect(a).toEqual(['held']);
    expect(b).toEqual(['waiting']);
    releaseA();
    await new Promise((r) => setTimeout(r, 60));
    expect(b).toEqual(['waiting', 'held']);
    releaseB();
  });

  it('sin Web Locks ni BroadcastChannel controla directamente', () => {
    const a: string[] = [];
    acquireTabLock('lab', (s) => a.push(s), { locks: null, channel: null })();
    expect(a).toEqual(['held']);
  });
});

describe('protocolo', () => {
  it('versiona y valida los mensajes', () => {
    const text = encode({ type: 'node', action: 'start', deviceIds: 'all' });
    expect(parseClientMessage(text)).toEqual({ v: 1, type: 'node', action: 'start', deviceIds: 'all' });
    expect(() => parseClientMessage('{"v":2,"type":"hello"}')).toThrow(/Versión/);
    expect(() => parseClientMessage('{"v":1,"type":"lab","action":"borrar_todo","requestId":"x"}')).toThrow(/acción/);
    expect(() => parseClientMessage('{"v":1,"type":"hello","role":"app","client":"x"}')).toThrow(/token/);
    expect(() => parseClientMessage('{"v":1,"type":"lab","action":"delete_snapshot","requestId":"x","id":5}')).toThrow(/id/);
    expect(parseServerMessage('{"v":1,"type":"hello","server":"hasim-orchestrator","version":"1","protocol":1}')).toBeNull();
    expect(parseServerMessage('{"v":1,"type":"command","id":"1","entityId":"light.x","service":"light.turn_on","data":{}}')?.type).toBe('command');
    expect(parseServerMessage('no json')).toBeNull();
  });

  it('filtros del tráfico, patrones MQTT y búfer circular', () => {
    const e = (seq: number, topic: string, dir: 'in' | 'out', deviceId?: string): TrafficEntry => ({ seq, t: 0, topic, dir, payload: '', retain: false, ...(deviceId ? { deviceId } : {}) });
    const entries = [e(1, 'hasim-z2m/Luz/set', 'in', 'a'), e(2, 'hasim/b/light', 'out', 'b'), e(3, 'homeassistant/status', 'in')];
    expect(filterTraffic(entries, { dir: 'in' }).map((x) => x.seq)).toEqual([1, 3]);
    expect(filterTraffic(entries, { deviceId: 'b' }).map((x) => x.seq)).toEqual([2]);
    expect(filterTraffic(entries, { topic: 'hasim-z2m/+/set' }).map((x) => x.seq)).toEqual([1]);
    expect(filterTraffic(entries, { topic: 'STATUS' }).map((x) => x.seq)).toEqual([3]);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+', 'a/b/c')).toBe(false);
    expect(pushRing([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]);
    expect(trafficPayload('x'.repeat(5000))).toMatch(/5000 bytes/);
  });
});

describe('sincronización', () => {
  it('diferencias de estado y parches del proyecto', () => {
    const a = { state: 'on' };
    expect(diffEntities({ x: a, y: a }, { x: a, z: { state: 'off' } })).toEqual({ changed: { z: { state: 'off' } }, removed: ['y'] });
    const p = createDemoProject();
    const q = { ...p, name: 'Otro' };
    expect(projectPatch(p, q)?.changes).toEqual({ name: 'Otro' });
    expect(projectPatch(p, { ...q, id: 'nuevo' })).toBeNull();
  });

  it('no manda al lab imágenes del plano ni variantes', () => {
    const p = createDemoProject();
    const withImage = { ...p, floors: p.floors.map((f) => ({ ...f, backgroundImage: 'data:image/png;base64,xx' })), variants: [] };
    const lab = projectForLab(withImage);
    expect(lab.floors.every((f) => f.backgroundImage === undefined)).toBe(true);
    expect(lab.variants).toBeUndefined();
    expect(withImage.floors[0]?.backgroundImage).toBeDefined();
  });
});

describe('restaurar un snapshot', () => {
  it('fusiona el proyecto conservando id, variantes e imágenes del plano', () => {
    const current = { ...createDemoProject(), id: 'actual', variants: [], floors: createDemoProject().floors.map((f) => ({ ...f, backgroundImage: 'data:image/png;base64,yy' })) };
    const restored = { ...createDemoProject(), id: 'otro', name: 'Del snapshot' };
    const merged = mergeRestoredProject(current, restored);
    expect(merged.id).toBe('actual');
    expect(merged.name).toBe('Del snapshot');
    expect(merged.variants).toBe(current.variants);
    expect(merged.floors.every((f) => f.backgroundImage === 'data:image/png;base64,yy')).toBe(true);
  });
});

describe('vía hacia HA', () => {
  it('marca los transportes pendientes y ZHA', () => {
    expect(viaInfo({ protocol: 'zwave', integration: 'zwave_js' }, { integrations: [], role: 'end_device' })).toMatchObject({ transport: 'zwave_js', pending: true });
    expect(viaInfo({ protocol: 'zwave', integration: 'zwave_js' }, { integrations: [], role: 'end_device' }).label).toMatch(/pendiente de E2/);
    expect(viaInfo({ protocol: 'zigbee', integration: 'zha' }, { integrations: [], role: 'end_device' }).note).toMatch(/ZHA/);
    expect(viaInfo({ protocol: 'zigbee', integration: 'zigbee2mqtt' }, { integrations: [], role: 'end_device' })).toMatchObject({ transport: 'z2m_mqtt', pending: false });
  });
});
