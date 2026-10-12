// Importación de YAML tal como lo escribe Home Assistant: escalares de bloque, errores aislados
// por automatización, disparadores con varias entidades, description, !input y mqtt.
import { blockScalar, parseAutomationsYamlDetailed, parseAutomationYamlDetailed, parseYaml } from './yaml-parse';
import { automationToYaml } from '../export/yaml';
import { parseProject } from '../store/projectSchema';
import { makeProject } from '../test/fixtures';

describe('escalares de bloque', () => {
  it('literal | conserva los saltos de línea y deja uno al final', () => {
    const v = parseYaml('message: |\n  Línea 1\n  Línea 2 # no es comentario\nnext: x\n');
    expect(v).toEqual({ message: 'Línea 1\nLínea 2 # no es comentario\n', next: 'x' });
  });

  it('|- quita el salto final y |+ conserva los finales', () => {
    expect(parseYaml('a: |-\n  uno\n  dos\n')).toEqual({ a: 'uno\ndos' });
    expect(blockScalar(['  uno', '', ''], '|', '+')).toBe('uno\n\n\n');
  });

  it('plegado > une las líneas con espacios y una línea vacía es un salto', () => {
    expect(parseYaml('a: >\n  hola\n  mundo\n\n  adiós\nb: 1\n')).toEqual({ a: 'hola mundo\nadiós\n', b: 1 });
    expect(parseYaml('a: >-\n  hola\n  mundo\n')).toEqual({ a: 'hola mundo' });
  });

  it('funciona dentro de listas y tras "- clave:"', () => {
    const v = parseYaml('- description: |\n    texto\n    largo\n  alias: X\n- >-\n  suelto\n  aquí\n');
    expect(v).toEqual([{ description: 'texto\nlargo\n', alias: 'X' }, 'suelto aquí']);
  });
});

const HA_FILE = `- id: '1700000000001'
  alias: Luces del pasillo
  description: >-
    Enciende las luces del pasillo
    cuando hay movimiento.
  triggers:
    - trigger: state
      entity_id:
        - binary_sensor.movimiento_pasillo
        - binary_sensor.movimiento_entrada
      to: 'on'
      id: movimiento
  conditions: []
  actions:
    - action: notify.persistent_notification
      data:
        message: |
          Movimiento detectado.
          Revisa el pasillo.
  mode: single
- id: '1700000000002'
  alias: Rota
  triggers:
    - trigger: state
  actions: []
- id: '1700000000003'
  alias: Con MQTT
  triggers:
    - trigger: mqtt
      topic: casa/timbre
    - trigger: time
      at: '07:30:00'
  actions:
    - action: light.turn_on
      target:
        entity_id: !input luz
  mode: single
`;

describe('automations.yaml real', () => {
  const result = parseAutomationsYamlDetailed(HA_FILE);

  it('una automatización mala no tumba el fichero: se omite y se avisa', () => {
    expect(result.automations.map((a) => a.name)).toEqual(['Luces del pasillo', 'Con MQTT']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ index: 1, name: 'Rota' });
    expect(result.warnings.some((w) => w.path === '[1]' && w.message.includes('Rota'))).toBe(true);
  });

  it('un disparador state con varias entidades se convierte en varios con el mismo id', () => {
    const a = result.automations[0];
    expect(a?.triggers).toEqual([
      { type: 'state', entityId: 'binary_sensor.movimiento_pasillo', to: 'on', id: 'movimiento' },
      { type: 'state', entityId: 'binary_sensor.movimiento_entrada', to: 'on', id: 'movimiento' },
    ]);
    expect(result.warnings.some((w) => w.path === '[0].triggers[0].entity_id' && w.message.includes('un disparador por entidad'))).toBe(true);
  });

  it('conserva description y los mensajes en bloque', () => {
    const a = result.automations[0];
    expect(a?.description).toBe('Enciende las luces del pasillo cuando hay movimiento.');
    expect(JSON.stringify(a?.actions[0])).toContain(JSON.stringify('Movimiento detectado.\nRevisa el pasillo.\n'));
  });

  it('avisa de los disparadores mqtt (se ignoran) y de !input', () => {
    const a = result.automations[1];
    expect(a?.triggers).toEqual([{ type: 'time', at: '07:30' }]);
    expect(result.warnings.some((w) => w.path === '[2].triggers[0]' && w.message.includes('mqtt'))).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('!input luz'))).toBe(true);
  });

  it('si ninguna se puede importar, lanza el error', () => {
    expect(() => parseAutomationsYamlDetailed('- alias: X\n  triggers:\n    - trigger: mqtt\n      topic: a\n')).toThrow(/disparador/);
  });
});

describe('description', () => {
  it('se exporta, se vuelve a importar y se guarda en el proyecto', () => {
    const { automation } = parseAutomationYamlDetailed('alias: A\ndescription: Hace algo\ntriggers:\n  - trigger: time\n    at: "08:00"\nactions: []\n');
    expect(automation.description).toBe('Hace algo');
    const yaml = automationToYaml(automation);
    expect(yaml).toContain('description: Hace algo');
    expect(parseAutomationYamlDetailed(yaml).automation.description).toBe('Hace algo');
    const project = parseProject(JSON.parse(JSON.stringify(makeProject({ automations: [automation] }))));
    expect(project.automations[0]?.description).toBe('Hace algo');
  });
});
