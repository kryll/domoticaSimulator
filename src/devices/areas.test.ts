import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { createDemoProject } from '../store/demoProject';
import { areaId, automationEntityIds, automationRoom, entityRoomMap, groupRoom, majorityRoom, sceneRoom, scriptRoom } from './areas';

describe('áreas', () => {
  const demo = createDemoProject();
  const map = entityRoomMap(demo, catalog);

  it('areaId y entity_id → sala (incluidos los grupos)', () => {
    expect(areaId({ name: 'Baño principal' })).toBe('bano_principal');
    expect(map['light.luz_salon']).toBe('demo-salon');
    expect(map['switch.enchufe_bano_switch']).toBe('demo-bano');
    expect(map['light.grupo_planta_baja']).toBe('demo-salon');
  });

  it('majorityRoom: mayoría y empate por orden del proyecto', () => {
    expect(majorityRoom(['light.luz_pasillo', 'light.luz_salon', 'light.luz_salon'], map, demo.rooms)).toBe('demo-salon');
    expect(majorityRoom(['light.luz_pasillo', 'light.luz_salon'], map, demo.rooms)).toBe('demo-salon');
    expect(majorityRoom(['x.y'], map, demo.rooms)).toBeUndefined();
  });

  it('salas de automatizaciones, escenas, scripts y grupos', () => {
    const fuga = demo.automations.find((a) => a.id === 'demo-auto-fuga')!;
    expect(automationEntityIds(fuga)).toEqual(expect.arrayContaining(['binary_sensor.fuga_bano_leak', 'switch.enchufe_bano_switch']));
    expect(automationRoom(fuga, map, demo.rooms)).toBe('demo-bano');
    expect(sceneRoom(demo.scenes[0]!, map, demo.rooms)).toBe('demo-salon');
    expect(scriptRoom(demo.scripts[0]!, map, demo.rooms)).toBeDefined();
    expect(groupRoom(demo.groups![0]!, map, demo.rooms)).toBe('demo-salon');
  });
});
