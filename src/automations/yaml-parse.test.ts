import { describe, expect, it } from 'vitest';
import { automationsToYaml, automationToYaml, scriptsToYaml } from '../export/yaml';
import { notifyAction } from '../simulation/notify';
import { scriptKeys } from '../simulation/scriptKeys';
import { findScript, sameState } from '../simulation/engine';
import type { Automation, Scene, Script } from '../types';
import { parseAutomationsYaml, parseAutomationYaml, parseScalar, parseYaml } from './yaml-parse';

const full: Automation = {
  id: 'a1',
  name: 'Luz: entrada # noche',
  enabled: false,
  mode: 'queued',
  triggers: [
    { type: 'state', entityId: 'binary_sensor.puerta_door', from: 'off', to: 'on' },
    { type: 'state', entityId: 'sensor.x' },
    { type: 'numeric_state', entityId: 'sensor.lux', above: 1.5, below: 50 },
    { type: 'time', at: '07:30' },
    { type: 'sun', event: 'sunrise', offsetMinutes: 45 },
    { type: 'sun', event: 'sunset', offsetMinutes: -90 },
  ],
  conditions: [
    { type: 'state', entityId: 'light.salon', state: 'off' },
    { type: 'sun', after: 'sunset', afterOffsetMinutes: -30, before: 'sunrise' },
    { type: 'and', conditions: [{ type: 'time', after: '20:00' }, { type: 'or', conditions: [{ type: 'numeric_state', entityId: 'sensor.t', below: 3 }] }] },
  ],
  actions: [
    { type: 'service', service: 'light.turn_on', entityId: 'light.salon', data: { brightness: 120, transition: 2.5, color_name: 'on', flash: true } },
    { type: 'delay', seconds: 90 },
    { type: 'scene', sceneId: 's1' },
    { type: 'script', scriptId: 'sc1' },
  ],
};

const scenes: Scene[] = [{ id: 's1', name: 'Noche tranquila', entities: {} }];
const scripts: Script[] = [{ id: 'sc1', name: 'Salir de casa', sequence: [] }];

describe('parseYaml', () => {
  it('escalares', () => {
    expect(parseScalar('"on"')).toBe('on');
    expect(parseScalar("'it''s'")).toBe("it's");
    expect(parseScalar('on')).toBe('on');
    expect(parseScalar('true')).toBe(true);
    expect(parseScalar('-1.5e2')).toBe(-150);
    expect(parseScalar('~')).toBeNull();
    expect(parseScalar('[a, "b, c", 3]')).toEqual(['a', 'b, c', 3]);
    expect(parseScalar('{}')).toEqual({});
  });

  it('bloques, comentarios y listas al mismo nivel que la clave (estilo HA)', () => {
    const text = `# comentario
alias: Prueba  # al final
trigger:
- platform: state
  entity_id:
    - light.a
    - light.b
nested:
  deep:
    value: "x # no es comentario"
empty:
`;
    expect(parseYaml(text)).toEqual({
      alias: 'Prueba',
      trigger: [{ platform: 'state', entity_id: ['light.a', 'light.b'] }],
      nested: { deep: { value: 'x # no es comentario' } },
      empty: null,
    });
  });

  it('listas anidadas y documento vacío', () => {
    expect(parseYaml('- - 1\n  - 2\n- 3\n')).toEqual([[1, 2], 3]);
    expect(parseYaml('-\n  a: 1\n')).toEqual([{ a: 1 }]);
    expect(parseYaml('\n# nada\n')).toBeNull();
  });

  it.each([
    ['a: 1\n  b: 2\n', /línea 2.*sangría/],
    ['a: 1\na: 2\n', /clave repetida "a"/],
    ['a: "sin cerrar\n', /comillas dobles/],
    ['a: {b: 1\n', /mapa en línea sin cerrar/],
    ['a:\n\t- b\n', /tabuladores/],
  ])('errores en español (%#)', (text, msg) => {
    expect(() => parseYaml(text)).toThrow(msg);
  });
});

describe('parseAutomationYaml', () => {
  it('ida y vuelta sin contexto', () => {
    expect(parseAutomationYaml(automationToYaml(full))).toEqual(full);
  });

  it('ida y vuelta con contexto de escenas y scripts', () => {
    const yaml = automationToYaml(full, { scenes, scripts });
    expect(yaml).toContain('scene.noche_tranquila');
    expect(parseAutomationYaml(yaml, { scenes, scripts })).toEqual(full);
  });

  it('ida y vuelta de automations.yaml completo', () => {
    const list = [full, { ...full, id: 'a2', enabled: true, mode: 'single' as const }];
    const text = automationsToYaml({ automations: list, scenes, scripts } as never);
    expect(parseAutomationsYaml(text, { scenes, scripts })).toEqual(list);
  });

  it('acepta variantes habituales de HA', () => {
    const a = parseAutomationYaml(`
- alias: Variantes
  triggers:
    - trigger: time
      at: "07:30:00"
  actions:
    - action: light.turn_off
      entity_id: light.a
    - delay: "00:01:30"
    - delay: 5
    - scene: scene.noche
`);
    expect(a.name).toBe('Variantes');
    expect(a.mode).toBe('single');
    expect(a.enabled).toBe(true);
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(a.triggers).toEqual([{ type: 'time', at: '07:30' }]);
    expect(a.actions).toEqual([
      { type: 'service', service: 'light.turn_off', entityId: 'light.a' },
      { type: 'delay', seconds: 90 },
      { type: 'delay', seconds: 5 },
      { type: 'scene', sceneId: 'noche' },
    ]);
  });

  it.each([
    ['', /vacío/],
    ['- alias: a\n- alias: b\n', /única automatización y hay 2/],
    ['alias: x\naction: []\n', /al menos un disparador/],
    ['trigger:\n  - platform: webhook\n', /disparador no soportado.*webhook/],
    ['trigger:\n  - platform: time\n    at: "25:00"\n', /Hora no válida/],
    ['trigger:\n  - platform: state\n', /Falta "entity_id"/],
    ['mode: loco\ntrigger:\n  - platform: time\n    at: "07:00"\n', /Modo no válido/],
    ['trigger:\n  - platform: time\n    at: "07:00"\ncondition:\n  - condition: template\n', /condición no soportado/],
    ['trigger:\n  - platform: time\n    at: "07:00"\naction:\n  - service: "no válido"\n    entity_id: x\n', /Servicio no válido/],
  ])('errores en español (%#)', (text, msg) => {
    expect(() => parseAutomationYaml(text)).toThrow(msg);
  });

  it('con contexto, escenas o scripts desconocidos son error', () => {
    const yaml = 'trigger:\n  - platform: time\n    at: "07:00"\naction:\n  - service: scene.turn_on\n    target:\n      entity_id: scene.no_existe\n';
    expect(() => parseAutomationYaml(yaml, { scenes, scripts })).toThrow(/Escena desconocida/);
    expect(() => parseAutomationYaml(yaml.replace(/scene/g, 'script'), { scenes, scripts })).toThrow(/Script desconocido/);
  });

  it('ida y vuelta de un trigger con to: true conserva la semántica', () => {
    const a: Automation = {
      ...full,
      enabled: true,
      triggers: [{ type: 'state', entityId: 'light.x', from: false, to: true }],
      conditions: [{ type: 'state', entityId: 'light.x', state: true }],
    };
    const back = parseAutomationYaml(automationToYaml(a));
    const t = back.triggers[0];
    const c = back.conditions[0];
    expect(t).toEqual({ type: 'state', entityId: 'light.x', from: 'off', to: 'on' });
    expect(c).toEqual({ type: 'state', entityId: 'light.x', state: 'on' });
    expect(t?.type === 'state' && sameState(t.to ?? '', true) && sameState(t.from ?? '', false)).toBe(true);
    expect(c?.type === 'state' && sameState(c.state, true)).toBe(true);
  });
});

describe('for: y datos de luz (fase 1)', () => {
  const withFor: Automation = {
    id: 'f1',
    name: 'Apagar la luz del pasillo tras 2 min sin movimiento',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'binary_sensor.mov_motion', to: 'off', for: 120 }],
    conditions: [{ type: 'state', entityId: 'light.pasillo', state: 'on', for: 3725 }],
    actions: [
      { type: 'service', service: 'light.turn_on', entityId: 'light.pasillo', data: { brightness_pct: 60, color_temp_kelvin: 2700 } },
      { type: 'service', service: 'light.turn_on', entityId: 'light.salon', data: { rgb_color: '[255, 120, 40]', brightness_step_pct: -10 } },
    ],
  };

  it('exporta for en formato HH:MM:SS y rgb_color como lista', () => {
    const yaml = automationToYaml(withFor);
    expect(yaml).toContain('for: "00:02:00"');
    expect(yaml).toContain('for: "01:02:05"');
    expect(yaml).toMatch(/rgb_color:\n\s+- 255\n\s+- 120\n\s+- 40/);
    expect(yaml).toContain('brightness_step_pct: -10');
  });

  it('ida y vuelta', () => {
    expect(parseAutomationYaml(automationToYaml(withFor))).toEqual(withFor);
  });

  it('lee for como texto, segundos o mapa (también en línea) y rgb_color en línea', () => {
    const text = [
      'trigger:',
      '  - platform: state',
      '    entity_id: binary_sensor.a',
      '    to: "off"',
      '    for: {minutes: 5}',
      '  - platform: state',
      '    entity_id: binary_sensor.b',
      '    for:',
      '      hours: 1',
      '      seconds: 30',
      '  - platform: state',
      '    entity_id: binary_sensor.c',
      '    for: 45',
      '  - platform: state',
      '    entity_id: binary_sensor.d',
      '    for: "00:10"',
      'action:',
      '  - service: light.turn_on',
      '    target:',
      '      entity_id: light.a',
      '    data:',
      '      rgb_color: [255, 0, 0]',
      '',
    ].join('\n');
    const a = parseAutomationYaml(text);
    expect(a.triggers.map((t) => (t.type === 'state' ? t.for : undefined))).toEqual([300, 3630, 45, 600]);
    expect(a.actions[0]).toMatchObject({ data: { rgb_color: '[255, 0, 0]' } });
  });

  it('parseScalar admite mapas en línea simples', () => {
    expect(parseScalar('{minutes: 5, seconds: "10"}')).toEqual({ minutes: 5, seconds: '10' });
  });
});

describe('sintaxis de HA (C13)', () => {
  it('exporta la sintaxis actual: triggers/trigger, conditions/condition, actions/action', () => {
    const yaml = automationToYaml(full, { scenes, scripts });
    expect(yaml).toContain('triggers:\n  - trigger: state\n');
    expect(yaml).toContain('conditions:\n  - condition: state\n');
    expect(yaml).toContain('actions:\n  - action: light.turn_on\n    target:\n      entity_id: light.salon\n    data:\n');
    expect(yaml).toContain('  - condition: sun\n    after: sunset\n    after_offset: "-00:30:00"\n    before: sunrise\n');
    expect(yaml).not.toMatch(/platform:|service:|^trigger:|^condition:|^action:/m);
  });

  it('el parser acepta la sintaxis antigua y la nueva con el mismo resultado', () => {
    const old = `
alias: Antigua
trigger:
  - platform: state
    entity_id: binary_sensor.puerta_door
    to: "on"
  - platform: sun
    event: sunset
    offset: "-00:15:00"
condition:
  - condition: sun
    before: sunrise
    before_offset: "01:00:00"
action:
  - service: light.turn_on
    target:
      entity_id: light.salon
    data:
      brightness_pct: 50
`;
    const modern = `
alias: Antigua
triggers:
  - trigger: state
    entity_id: binary_sensor.puerta_door
    to: "on"
  - trigger: sun
    event: sunset
    offset: "-00:15:00"
conditions:
  - condition: sun
    before: sunrise
    before_offset: "01:00:00"
actions:
  - action: light.turn_on
    target:
      entity_id: light.salon
    data:
      brightness_pct: 50
`;
    const a = parseAutomationYaml(old);
    const b = parseAutomationYaml(modern);
    expect({ ...a, id: 'x' }).toEqual({ ...b, id: 'x' });
    expect(b.triggers[1]).toEqual({ type: 'sun', event: 'sunset', offsetMinutes: -15 });
    expect(b.conditions[0]).toEqual({ type: 'sun', before: 'sunrise', beforeOffsetMinutes: 60 });
    expect(b.actions[0]).toEqual({ type: 'service', service: 'light.turn_on', entityId: 'light.salon', data: { brightness_pct: 50 } });
  });

  it('una condición de sol sin after ni before es un error', () => {
    expect(() => parseAutomationYaml('triggers:\n  - trigger: time\n    at: "07:00"\nconditions:\n  - condition: sun\n')).toThrow(/after.*before/);
  });
});

describe('revisión de la fase 2 (YAML)', () => {
  it('conserva estados numéricos en to/from/state', () => {
    const a: Automation = {
      ...full,
      triggers: [{ type: 'state', entityId: 'sensor.t', from: 20, to: 21.5 }],
      conditions: [{ type: 'state', entityId: 'sensor.t', state: 21.5 }],
      actions: [],
    };
    const yaml = automationToYaml(a);
    expect(yaml).toContain('from: 20\n    to: 21.5');
    const back = parseAutomationYaml(yaml);
    expect(back.triggers[0]).toEqual({ type: 'state', entityId: 'sensor.t', from: 20, to: 21.5 });
    expect(back.conditions[0]).toEqual({ type: 'state', entityId: 'sensor.t', state: 21.5 });
  });

  it('notify.persistent_notification sin target, ida y vuelta', () => {
    const a: Automation = { ...full, conditions: [], actions: [notifyAction('Fuga en el baño', 'Aviso')] };
    const yaml = automationToYaml(a);
    expect(yaml).toContain('  - action: notify.persistent_notification\n    data:\n      message: Fuga en el baño\n      title: Aviso\n');
    expect(yaml).not.toContain('entity_id: ""');
    expect(parseAutomationYaml(yaml).actions).toEqual(a.actions);
  });

  it('scripts con el mismo nombre: claves iguales en scripts.yaml, acciones y findScript', () => {
    const dup: Script[] = [
      { id: 'x1', name: 'Salir', sequence: [] },
      { id: 'x2', name: 'Salir', sequence: [] },
    ];
    expect(scriptKeys(dup)).toEqual({ x1: 'salir', x2: 'salir_2' });
    const text = scriptsToYaml({ scripts: dup } as never);
    expect(text).toContain('salir:\n');
    expect(text).toContain('salir_2:\n');
    const a: Automation = { ...full, conditions: [], actions: [{ type: 'script', scriptId: 'x2' }] };
    const yaml = automationToYaml(a, { scenes, scripts: dup });
    expect(yaml).toContain('entity_id: script.salir_2');
    expect(parseAutomationYaml(yaml, { scenes, scripts: dup }).actions).toEqual([{ type: 'script', scriptId: 'x2' }]);
    expect(findScript({ scripts: dup }, 'script.salir_2')?.id).toBe('x2');
    expect(findScript({ scripts: dup }, 'script.salir')?.id).toBe('x1');
  });
});
