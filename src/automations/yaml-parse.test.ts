import { describe, expect, it } from 'vitest';
import { automationsToYaml, automationToYaml } from '../export/yaml';
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
    ['a: {b: 1}\n', /mapas en línea/],
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
});
