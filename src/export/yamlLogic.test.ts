import { describe, expect, it } from 'vitest';
import type { Automation, Project } from '../types';
import { automationToYaml } from './yaml';
import { parseAutomationYaml } from '../automations/yaml-parse';
import { parseProject } from '../store/projectSchema';
import { project } from '../devices/testUtils';
import { deviceActionAsStateTrigger, personRef, resolvePersonRef, resolveZoneRef, zoneRef } from './yamlLogic';

const ctx: Pick<Project, 'people' | 'zones' | 'scenes' | 'scripts'> = {
  people: [{ id: 'p1', name: 'Ana López' }],
  zones: [{ id: 'z1', name: 'Oficina', kind: 'work' }],
  scenes: [],
  scripts: [],
};

const logic: Automation = {
  id: 'a1',
  name: 'Lógica completa',
  enabled: true,
  mode: 'restart',
  triggers: [
    { type: 'zone', personId: 'p1', zoneId: 'home', event: 'leave' },
    { type: 'zone', personId: 'p1', zoneId: 'z1', event: 'enter' },
    { type: 'device_action', entityId: 'sensor.mando_action', action: 'double' },
  ],
  conditions: [
    { type: 'not', conditions: [{ type: 'state', entityId: 'light.a', state: 'on' }] },
    { type: 'zone', personId: 'p1', zoneId: 'z1' },
  ],
  actions: [
    { type: 'variables', variables: { nivel: 50, saludo: 'hola' } },
    {
      type: 'choose',
      choices: [{ conditions: [{ type: 'state', entityId: 'light.a', state: 'off' }], sequence: [{ type: 'service', service: 'light.turn_on', entityId: 'light.a' }] }],
      default: [{ type: 'delay', seconds: 5 }],
    },
    { type: 'if', conditions: [{ type: 'time', after: '20:00' }], then: [{ type: 'notify', title: 'Hola', message: 'Son las {{ hora }}' }], else: [{ type: 'notify', message: 'Sin título', service: 'notify.mobile_app_ana' }] },
    { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: 'binary_sensor.puerta', to: 'off' }], timeoutSeconds: 90, continueOnTimeout: false },
    { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: 'binary_sensor.puerta', to: 'on' }] },
    { type: 'repeat', count: 3, sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.a' }] },
    { type: 'repeat', while: [{ type: 'state', entityId: 'light.a', state: 'on' }], sequence: [{ type: 'delay', seconds: 1 }] },
    { type: 'repeat', until: [{ type: 'state', entityId: 'light.a', state: 'off' }], sequence: [{ type: 'delay', seconds: 1 }] },
  ],
};

describe('YAML de la Fase 3', () => {
  it('ida y vuelta de todos los tipos nuevos con contexto', () => {
    const text = automationToYaml(logic, ctx);
    expect(text).toContain('platform: zone');
    expect(text).toContain('entity_id: person.ana_lopez');
    expect(text).toContain('zone: zone.home');
    expect(text).toContain('zone: zone.oficina');
    expect(text).toContain('condition: not');
    expect(text).toContain('choose:');
    expect(text).toContain('wait_for_trigger:');
    expect(text).toContain('timeout: "00:01:30"');
    expect(text).toContain('continue_on_timeout: false');
    expect(text).toContain('service: notify.notify');
    expect(parseAutomationYaml(text, ctx)).toEqual(logic);
  });

  it('sin contexto usa los ids', () => {
    const text = automationToYaml(logic);
    expect(text).toContain('entity_id: person.p1');
    const parsed = parseAutomationYaml(text);
    expect(parsed.triggers[0]).toEqual({ type: 'zone', personId: 'p1', zoneId: 'home', event: 'leave' });
  });

  it('acepta la sintaxis nueva de HA (action:) y persistent_notification', () => {
    const parsed = parseAutomationYaml(`
alias: x
triggers:
  - trigger: device
    entity_id: sensor.m_action
    subtype: single
actions:
  - action: persistent_notification.create
    data:
      message: hola
`);
    expect(parsed.triggers[0]).toEqual({ type: 'device_action', entityId: 'sensor.m_action', action: 'single' });
    expect(parsed.actions[0]).toEqual({ type: 'notify', message: 'hola', service: 'persistent_notification.create' });
  });

  it('errores claros', () => {
    expect(() => parseAutomationYaml('trigger:\n  - platform: zone\n    entity_id: person.x\n    zone: zone.home\n    event: dentro\n')).toThrow(/Evento de zona/);
    expect(() => parseAutomationYaml('trigger:\n  - platform: time\n    at: "10:00"\naction:\n  - repeat:\n      sequence: []\n')).toThrow(/repeat necesita/);
    expect(() => resolvePersonRef('person.nadie', ctx)).toThrow(/Persona desconocida/);
    expect(() => resolveZoneRef('zone.marte', ctx)).toThrow(/Zona desconocida/);
  });

  it('referencias de personas y zonas', () => {
    expect(personRef('p1', ctx)).toBe('person.ana_lopez');
    expect(zoneRef('z1', ctx)).toBe('zone.oficina');
    expect(resolveZoneRef('zone.home', ctx)).toBe('home');
    expect(resolveZoneRef('zone.home', { zones: [{ id: 'casa', name: 'Casa', kind: 'home' }] })).toBe('casa');
    expect(deviceActionAsStateTrigger({ type: 'device_action', entityId: 's', action: 'hold' })).toEqual({ type: 'state', entityId: 's', to: 'hold' });
  });
});

describe('projectSchema con los campos de la Fase 3', () => {
  it('valida y conserva todo', () => {
    const p: Project = project([], {
      automations: [logic],
      people: ctx.people ?? [],
      zones: ctx.zones ?? [],
      environment: { enabled: true, outdoorMean: 10, outdoorAmplitude: 4, tauHours: 6 },
      timelines: [{ id: 't', name: 'Prueba', steps: [{ at: '08:00', kind: 'event', event: 'state', entityId: 'light.a', value: 'on' }, { at: '08:01', kind: 'assert', entityId: 'light.a', expect: 'on', op: 'eq' }] }],
      groups: [{ id: 'g', name: 'G', domain: 'light', entityIds: ['light.a'] }],
      reliability: { latency: true, failureRate: 0.1, seed: 3 },
    });
    p.floors = p.floors.map((f) => ({ ...f, walls: [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, material: 'brick' as const }] }));
    const withVariant: Project = { ...p, variants: [{ id: 'v', name: 'Variante', snapshot: { ...p } }] };
    expect(parseProject(JSON.parse(JSON.stringify(withVariant)))).toEqual(withVariant);
  });

  it('rechaza valores no válidos', () => {
    const base = project([]);
    expect(() => parseProject({ ...base, reliability: { latency: true, failureRate: 2 } })).toThrow(/entre 0 y 1/);
    expect(() => parseProject({ ...base, people: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })).toThrow(/repetido/);
    expect(() => parseProject({ ...base, timelines: [{ id: 't', name: 'T', steps: [{ at: 'ayer', kind: 'event', event: 'state' }] }] })).toThrow(/HH:MM/);
  });
});
