import { describe, expect, it } from 'vitest';
import { project } from '../devices/testUtils';
import type { Automation, Project } from '../types';
import { automationsToYaml, automationToYaml, formatScalar, scenesToYaml, scriptsToYaml, toYaml } from './yaml';

const automation: Automation = {
  id: 'a1',
  name: 'Luz al entrar',
  enabled: true,
  mode: 'restart',
  triggers: [
    { type: 'state', entityId: 'binary_sensor.puerta_door', from: 'off', to: 'on' },
    { type: 'numeric_state', entityId: 'sensor.salon_illuminance', below: 50 },
    { type: 'time', at: '07:30' },
    { type: 'sun', event: 'sunset', offsetMinutes: -30 },
  ],
  conditions: [
    { type: 'time', after: '20:00', before: '07:00' },
    { type: 'or', conditions: [{ type: 'state', entityId: 'light.salon', state: 'off' }, { type: 'numeric_state', entityId: 'sensor.t', above: 1.5 }] },
  ],
  actions: [
    { type: 'service', service: 'light.turn_on', entityId: 'light.salon', data: { brightness: 120, color_name: 'warm white' } },
    { type: 'delay', seconds: 90 },
    { type: 'scene', sceneId: 's1' },
    { type: 'script', scriptId: 'sc1' },
  ],
};

const withRefs: Project = project([], {
  automations: [automation, { ...automation, id: 'a2', name: 'Apagada', enabled: false, triggers: [{ type: 'time', at: '23:00' }], conditions: [], actions: [] }],
  scenes: [{ id: 's1', name: 'Noche tranquila', entities: { 'light.salon': { state: 'on', attributes: { brightness: 40 } }, 'switch.tv': { state: false } } }],
  scripts: [
    { id: 'sc1', name: 'Salir de casa', sequence: [{ type: 'service', service: 'lock.lock', entityId: 'lock.puerta' }] },
    { id: 'sc2', name: 'Salir de casa', sequence: [] },
  ],
});

describe('serializador YAML', () => {
  it.each([
    ['texto simple', 'texto simple'],
    ['on', '"on"'],
    ['OFF', '"OFF"'],
    ['yes', '"yes"'],
    ['', '""'],
    ['07:30', '"07:30"'],
    ['12', '"12"'],
    ['-1', '"-1"'],
    ['# no', '"# no"'],
    ['a: b', '"a: b"'],
    [' espacio', '" espacio"'],
    ['línea\nnueva', '"línea\\nnueva"'],
    ['comillas "x"', 'comillas "x"'],
  ])('escalar %j -> %s', (input, out) => {
    expect(formatScalar(input)).toBe(out);
  });

  it('números, booleanos y null', () => {
    expect(formatScalar(1.5)).toBe('1.5');
    expect(formatScalar(true)).toBe('true');
    expect(formatScalar(null)).toBe('null');
    expect(formatScalar(Number.POSITIVE_INFINITY)).toBe('.inf');
  });

  it('estructuras anidadas', () => {
    expect(toYaml({ a: [], b: {}, c: [1, [2, 3], { d: 'x', e: ['z'] }], f: { g: { h: null } } })).toMatchInlineSnapshot(`
      "a: []
      b: {}
      c:
        - 1
        -
          - 2
          - 3
        - d: x
          e:
            - z
      f:
        g:
          h: null
      "
    `);
    expect(toYaml([])).toBe('[]\n');
  });
});

describe('exportación a Home Assistant', () => {
  it('automationToYaml sin contexto', () => {
    expect(automationToYaml(automation)).toMatchInlineSnapshot(`
      "id: a1
      alias: Luz al entrar
      mode: restart
      trigger:
        - platform: state
          entity_id: binary_sensor.puerta_door
          from: "off"
          to: "on"
        - platform: numeric_state
          entity_id: sensor.salon_illuminance
          below: 50
        - platform: time
          at: "07:30"
        - platform: sun
          event: sunset
          offset: "-00:30:00"
      condition:
        - condition: time
          after: "20:00"
          before: "07:00"
        - condition: or
          conditions:
            - condition: state
              entity_id: light.salon
              state: "off"
            - condition: numeric_state
              entity_id: sensor.t
              above: 1.5
      action:
        - service: light.turn_on
          target:
            entity_id: light.salon
          data:
            brightness: 120
            color_name: warm white
        - delay:
            seconds: 90
        - service: scene.turn_on
          target:
            entity_id: scene.s1
        - service: script.turn_on
          target:
            entity_id: script.sc1
      "
    `);
  });

  it('automationsToYaml usa nombres de escenas/scripts y marca las desactivadas', () => {
    const yaml = automationsToYaml(withRefs);
    expect(yaml).toContain('entity_id: scene.noche_tranquila');
    expect(yaml).toContain('entity_id: script.salir_de_casa');
    expect(yaml).toContain('- id: a2\n  alias: Apagada\n  mode: restart\n  initial_state: false\n  trigger:\n    - platform: time\n      at: "23:00"\n  condition: []\n  action: []\n');
    expect(automationsToYaml(project([]))).toBe('[]\n');
  });

  it('scenesToYaml aplana atributos', () => {
    expect(scenesToYaml(withRefs)).toMatchInlineSnapshot(`
      "- id: s1
        name: Noche tranquila
        entities:
          light.salon:
            state: "on"
            brightness: 40
          switch.tv:
            state: "off"
      "
    `);
  });

  it('scriptsToYaml con claves únicas', () => {
    expect(scriptsToYaml(withRefs)).toMatchInlineSnapshot(`
      "salir_de_casa:
        alias: Salir de casa
        sequence:
          - service: lock.lock
            target:
              entity_id: lock.puerta
      salir_de_casa_2:
        alias: Salir de casa
        sequence: []
      "
    `);
  });

  it('los booleanos de estado se escriben como "on"/"off"', () => {
    const a: Automation = {
      ...automation,
      triggers: [{ type: 'state', entityId: 'light.x', from: false, to: true }],
      conditions: [{ type: 'state', entityId: 'light.y', state: true }],
      actions: [],
    };
    const yaml = automationToYaml(a);
    expect(yaml).toContain('from: "off"\n    to: "on"');
    expect(yaml).toContain('state: "on"');
    expect(yaml).not.toMatch(/true|false/);
  });
});
