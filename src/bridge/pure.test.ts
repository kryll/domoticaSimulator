import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../store/demoProject';
import { parseProject } from '../store/projectSchema';
import { defaultHaBridgeSettings, defaultRadioProfiles } from '../types';
import { parseHaBridge, parseRadioProfiles } from './schema';
import { encode, filterTraffic, parseClientMessage, parseServerMessage, pushRing, topicMatches, trafficPayload, type TrafficEntry } from './protocol';
import { diffEntities, projectForLab, projectPatch } from './sync';
import { viaInfo } from './via';
import { interferenceLossPct, radioProfileFor } from './radio';

describe('esquema del proyecto', () => {
  it('acepta y valida haBridge y radioProfiles', () => {
    const p = { ...createDemoProject(), haBridge: { ...defaultHaBridgeSettings(), enabled: true }, radioProfiles: { zigbee: { lossPct: 2, availability: { activeSeconds: 300 } } } };
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    expect(parsed.haBridge?.enabled).toBe(true);
    expect(parsed.radioProfiles?.zigbee?.lossPct).toBe(2);
  });

  it('rechaza valores no válidos y los secretos', () => {
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), orchestratorUrl: 'http://x' })).toThrow(/orchestratorUrl/);
    expect(() => parseHaBridge({ ...defaultHaBridgeSettings(), baseTopic: 'a/#' })).toThrow(/baseTopic/);
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
});

describe('protocolo', () => {
  it('versiona y valida los mensajes', () => {
    const text = encode({ type: 'node', action: 'start', deviceIds: 'all' });
    expect(parseClientMessage(text)).toEqual({ v: 1, type: 'node', action: 'start', deviceIds: 'all' });
    expect(() => parseClientMessage('{"v":2,"type":"hello"}')).toThrow(/Versión/);
    expect(() => parseClientMessage('{"v":1,"type":"lab","action":"borrar_todo","requestId":"x"}')).toThrow(/acción/);
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

describe('vía hacia HA', () => {
  it('marca los transportes pendientes y ZHA', () => {
    expect(viaInfo({ protocol: 'zwave', integration: 'zwave_js' }, { integrations: [], role: 'end_device' })).toMatchObject({ transport: 'zwave_js', pending: true });
    expect(viaInfo({ protocol: 'zwave', integration: 'zwave_js' }, { integrations: [], role: 'end_device' }).label).toMatch(/pendiente de E2/);
    expect(viaInfo({ protocol: 'zigbee', integration: 'zha' }, { integrations: [], role: 'end_device' }).note).toMatch(/ZHA/);
    expect(viaInfo({ protocol: 'zigbee', integration: 'zigbee2mqtt' }, { integrations: [], role: 'end_device' })).toMatchObject({ transport: 'z2m_mqtt', pending: false });
  });
});
