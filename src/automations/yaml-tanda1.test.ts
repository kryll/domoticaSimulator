// Tanda 1: YAML sin pérdida de datos (varios destinos, area_id, id del disparador, condición
// trigger) y avisos de claves ignoradas.
import { describe, expect, it } from 'vitest';
import type { Automation, Room } from '../types';
import { automationToYaml, automationsToYaml } from '../export/yaml';
import { parseAutomationYaml, parseAutomationYamlDetailed, parseAutomationsYamlDetailed } from './yaml-parse';
import { project } from '../devices/testUtils';

const SALON: Room = { id: 'r-salon', floorId: 'f0', name: 'Salón', polygon: [] };
const COCINA: Room = { id: 'r-cocina', floorId: 'f0', name: 'Cocina comedor', polygon: [] };
const ctx = { rooms: [SALON, COCINA], scenes: [], scripts: [] };

const automation: Automation = {
  id: 'a1',
  name: 'Entrada',
  enabled: true,
  mode: 'single',
  triggers: [
    { type: 'state', entityId: 'binary_sensor.puerta', to: 'on', id: 'puerta' },
    { type: 'time', at: '07:30', id: 'manana' },
    { type: 'sun', event: 'sunset' },
  ],
  conditions: [{ type: 'or', conditions: [{ type: 'trigger', ids: ['puerta'] }, { type: 'trigger', ids: ['manana', '2'] }] }],
  actions: [
    { type: 'service', service: 'light.turn_on', entityId: 'light.a', targets: { entityIds: ['light.b', 'light.c'] }, data: { brightness_pct: 50 } },
    { type: 'service', service: 'light.turn_off', entityId: '', targets: { areaIds: [SALON.id, COCINA.id] } },
    { type: 'service', service: 'switch.turn_on', entityId: 'switch.x', targets: { areaIds: [COCINA.id] } },
    { type: 'if', conditions: [{ type: 'trigger', ids: ['manana'] }], then: [{ type: 'service', service: 'cover.open_cover', entityId: 'cover.p' }] },
  ],
};

describe('YAML de varios destinos, area_id, id y condición trigger', () => {
  it('se exporta con la sintaxis de HA', () => {
    const yaml = automationToYaml(automation, ctx);
    expect(yaml).toContain('  - trigger: state\n    id: puerta\n    entity_id: binary_sensor.puerta');
    expect(yaml).toContain('      - condition: trigger\n        id: puerta');
    expect(yaml).toContain('        id:\n          - manana\n          - "2"');
    expect(yaml).toContain('    target:\n      entity_id:\n        - light.a\n        - light.b\n        - light.c');
    expect(yaml).toContain('    target:\n      area_id:\n        - salon\n        - cocina_comedor');
    expect(yaml).toContain('    target:\n      entity_id: switch.x\n      area_id: cocina_comedor');
  });

  it('ida y vuelta sin pérdida (con salas en el contexto)', () => {
    const back = parseAutomationYaml(automationToYaml(automation, ctx), ctx);
    expect(back).toEqual(automation);
  });

  it('sin salas en el contexto, area_id se queda con el slug', () => {
    const back = parseAutomationYaml(automationToYaml(automation, ctx));
    expect(back.actions[1]).toEqual({ type: 'service', service: 'light.turn_off', entityId: '', targets: { areaIds: ['salon', 'cocina_comedor'] } });
  });

  it('automationsToYaml usa las salas del proyecto', () => {
    const yaml = automationsToYaml(project([], { rooms: [SALON, COCINA], automations: [automation] }));
    expect(yaml).toContain('area_id: cocina_comedor');
  });

  it('lee entity_id directo, en lista y area_id suelto', () => {
    const a = parseAutomationYaml(`
trigger:
  - platform: state
    entity_id: binary_sensor.x
    id: abre
action:
  - service: light.turn_on
    entity_id: [light.a, light.b]
  - action: light.turn_off
    target:
      area_id: salon
condition:
  - condition: trigger
    id: abre
`, ctx);
    expect(a.triggers[0]).toEqual({ type: 'state', entityId: 'binary_sensor.x', id: 'abre' });
    expect(a.actions[0]).toEqual({ type: 'service', service: 'light.turn_on', entityId: 'light.a', targets: { entityIds: ['light.b'] } });
    expect(a.actions[1]).toEqual({ type: 'service', service: 'light.turn_off', entityId: '', targets: { areaIds: [SALON.id] } });
    expect(a.conditions[0]).toEqual({ type: 'trigger', ids: ['abre'] });
  });

  it('sin entity_id ni area_id sigue siendo un error', () => {
    expect(() => parseAutomationYaml('triggers:\n  - trigger: time\n    at: "07:00"\nactions:\n  - action: light.turn_on\n')).toThrow('Falta "entity_id"');
  });
});

describe('avisos de claves ignoradas', () => {
  it('lo exportado por el simulador no tiene avisos', () => {
    expect(parseAutomationYamlDetailed(automationToYaml(automation, ctx), ctx).warnings).toEqual([]);
  });

  it('avisa de cada clave ignorada o valor no soportado con su ruta', () => {
    const { automation: a, warnings } = parseAutomationYamlDetailed(`
alias: Prueba
description: Una descripción
triggers:
  - trigger: state
    entity_id: [binary_sensor.a, binary_sensor.b]
    attribute: battery
    to: [on, off]
conditions:
  - condition: time
    after: "08:00"
    weekday: [mon, tue]
actions:
  - action: light.turn_on
    target:
      entity_id: light.a
      device_id: abc123
      area_id: garaje
    response_variable: r
    enabled: false
  - choose:
      - conditions: []
        sequence:
          - delay: 5
            continue_on_error: true
`, ctx);
    expect(a.name).toBe('Prueba');
    expect(warnings.map((w) => w.path)).toEqual([
      'description',
      'triggers[0].attribute',
      'triggers[0].entity_id',
      'triggers[0].to',
      // Tanda 3: weekday, enabled y continue_on_error ya se admiten.
      'actions[0].response_variable',
      'actions[0].target.device_id',
      'actions[0].target.area_id',
    ]);
    expect(a.conditions[0]).toMatchObject({ type: 'time', weekday: ['mon', 'tue'] });
    expect(a.actions[0]?.enabled).toBe(false);
    expect(warnings[0]?.message).toBe('Clave «description» ignorada: el simulador no la admite');
    expect(warnings.find((w) => w.path === 'triggers[0].entity_id')?.message).toContain('solo se usa la primera');
    expect(warnings.find((w) => w.path === 'actions[0].target.area_id')?.message).toContain('garaje');
  });

  it('en una lista, la ruta empieza por el índice de la automatización', () => {
    const { automations, warnings } = parseAutomationsYamlDetailed(`
- alias: Uno
  trigger:
    - platform: time
      at: "07:00"
  action: []
- alias: Dos
  icon: mdi:lamp
  trigger:
    - platform: sun
      event: sunset
      offset: "-00:10:00"
      foo: 1
  action: []
`);
    expect(automations).toHaveLength(2);
    expect(warnings.map((w) => w.path)).toEqual(['[1].icon', '[1].trigger[0].foo']);
  });
});
