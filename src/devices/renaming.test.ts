import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { collectEntityRefs, entityIdMappingForRename, renameEntityRefs } from './renaming';
import { def, dev, project } from './testUtils';

function sample(): Project {
  return project([dev('t', 'aqara-temp-hum', undefined, { name: 'Clima' }), dev('l', 'hue-white-e27', undefined, { name: 'Luz' })], {
    automations: [
      {
        id: 'a1',
        name: 'Calor',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'numeric_state', entityId: 'sensor.clima_temperature', above: 25 }, { type: 'time', at: '07:00' }],
        conditions: [
          { type: 'state', entityId: 'light.luz', state: 'off' },
          { type: 'and', conditions: [{ type: 'or', conditions: [{ type: 'numeric_state', entityId: 'sensor.clima_humidity', below: 40 }] }, { type: 'time', after: '08:00' }] },
        ],
        actions: [
          { type: 'service', service: 'light.turn_on', entityId: 'light.luz' },
          { type: 'delay', seconds: 5 },
          { type: 'scene', sceneId: 's1' },
        ],
      },
    ],
    scenes: [{ id: 's1', name: 'Noche', entities: { 'light.luz': { state: 'off' }, 'sensor.otro': { state: 1 } } }],
    scripts: [
      {
        id: 'sc1',
        name: 'Salir',
        sequence: [
          { type: 'service', service: 'light.turn_off', entityId: 'light.luz' },
          { type: 'service', service: 'script.otro', entityId: '' },
        ],
      },
    ],
  });
}

describe('entityIdMappingForRename', () => {
  it('mapea cada entidad del dispositivo a su nuevo id', () => {
    const d = dev('t', 'aqara-temp-hum', undefined, { name: 'Clima' });
    expect(entityIdMappingForRename(d, def('aqara-temp-hum'), 'Clima salón')).toEqual({
      'sensor.clima_temperature': 'sensor.clima_salon_temperature',
      'sensor.clima_humidity': 'sensor.clima_salon_humidity',
      'sensor.clima_pressure': 'sensor.clima_salon_pressure',
      'sensor.clima_battery': 'sensor.clima_salon_battery',
    });
  });

  it('entidad única sin sufijo y vacío si el slug no cambia', () => {
    const d = dev('l', 'hue-white-e27', undefined, { name: 'Luz' });
    expect(entityIdMappingForRename(d, def('hue-white-e27'), 'Lámpara')).toEqual({ 'light.luz': 'light.lampara' });
    expect(entityIdMappingForRename(d, def('hue-white-e27'), 'LUZ')).toEqual({});
  });
});

describe('renameEntityRefs', () => {
  it('reescribe triggers, condiciones anidadas, acciones, scripts y claves de escenas', () => {
    const p = sample();
    const out = renameEntityRefs(p, {
      'sensor.clima_temperature': 'sensor.dorm_temperature',
      'sensor.clima_humidity': 'sensor.dorm_humidity',
      'light.luz': 'light.lampara',
    });
    const a = out.automations[0];
    expect(a?.triggers).toEqual([{ type: 'numeric_state', entityId: 'sensor.dorm_temperature', above: 25 }, { type: 'time', at: '07:00' }]);
    expect(a?.conditions).toEqual([
      { type: 'state', entityId: 'light.lampara', state: 'off' },
      { type: 'and', conditions: [{ type: 'or', conditions: [{ type: 'numeric_state', entityId: 'sensor.dorm_humidity', below: 40 }] }, { type: 'time', after: '08:00' }] },
    ]);
    expect(a?.actions[0]).toEqual({ type: 'service', service: 'light.turn_on', entityId: 'light.lampara' });
    expect(a?.actions.slice(1)).toEqual(p.automations[0]?.actions.slice(1));
    expect(out.scripts[0]?.sequence[0]).toMatchObject({ entityId: 'light.lampara' });
    expect(out.scenes[0]?.entities).toEqual({ 'light.lampara': { state: 'off' }, 'sensor.otro': { state: 1 } });
  });

  it('es pura y no toca el resto', () => {
    const p = sample();
    const snapshot = JSON.stringify(p);
    const out = renameEntityRefs(p, { 'light.luz': 'light.x' });
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(out.devices).toBe(p.devices);
    expect(renameEntityRefs(p, {})).toBe(p);
  });

  it('un mapeo con claves heredadas de Object no rompe nada', () => {
    const p = sample();
    expect(renameEntityRefs(p, { toString: 'x' }).automations).toEqual(p.automations);
  });
});

describe('collectEntityRefs', () => {
  it('recoge referencias con su origen (script.<slug> incluido)', () => {
    const refs = collectEntityRefs(sample()).map((r) => `${r.kind}:${r.ownerId}:${r.entityId}`);
    expect(refs).toEqual([
      'automation:a1:sensor.clima_temperature',
      'automation:a1:light.luz',
      'automation:a1:sensor.clima_humidity',
      'automation:a1:light.luz',
      'scene:s1:light.luz',
      'scene:s1:sensor.otro',
      'script:sc1:light.luz',
      'script:sc1:script.otro',
    ]);
  });
});

describe('renameEntityRefs (Fase 3)', () => {
  it('renombra miembros de grupos, pasos de líneas de tiempo y acciones anidadas', () => {
    const p = project([], {
      groups: [{ id: 'g', name: 'G', domain: 'light', entityIds: ['light.a', 'light.b'] }],
      timelines: [{ id: 't', name: 'T', steps: [{ at: '08:00', kind: 'assert', entityId: 'light.a', expect: 'on' }, { at: '08:00', kind: 'event', event: 'person', personId: 'x' }] }],
      automations: [
        { id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'device_action', entityId: 'light.a', action: 'x' }], conditions: [{ type: 'not', conditions: [{ type: 'state', entityId: 'light.a', state: 'on' }] }], actions: [{ type: 'if', conditions: [], then: [{ type: 'service', service: 'light.turn_on', entityId: 'light.a' }] }] },
      ],
    });
    const r = renameEntityRefs(p, { 'light.a': 'light.z' });
    expect(r.groups?.[0]?.entityIds).toEqual(['light.z', 'light.b']);
    expect(r.timelines?.[0]?.steps[0]).toMatchObject({ entityId: 'light.z' });
    expect(JSON.stringify(r.automations)).not.toContain('light.a');
    expect(collectEntityRefs(r).map((x) => x.entityId)).toEqual(['light.z', 'light.z', 'light.z']);
  });
});

describe('entityIdMappingForShowAs', () => {
  it('switch ↔ light de la entidad principal', async () => {
    const { entityIdMappingForShowAs } = await import('./renaming');
    const relay = dev('r', 'shelly-1pm-gen3', undefined, { name: 'Rele' });
    expect(entityIdMappingForShowAs(relay, def('shelly-1pm-gen3'), 'light')).toEqual({ 'switch.rele_switch': 'light.rele_switch' });
    expect(entityIdMappingForShowAs({ ...relay, showAs: 'light' }, def('shelly-1pm-gen3'), undefined)).toEqual({ 'light.rele_switch': 'switch.rele_switch' });
  });
});
