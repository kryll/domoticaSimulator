import { HISTORY_LIMIT, useProjectStore } from './projectStore';
import { makeDevice, makeProject } from '../test/fixtures';

const store = () => useProjectStore.getState();

describe('projectStore', () => {
  beforeEach(() => {
    store().loadProject(makeProject());
  });

  it('añade dispositivos y actualiza updatedAt', () => {
    const before = store().project.updatedAt;
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    expect(store().project.devices).toHaveLength(1);
    expect(store().project.updatedAt).not.toBe(before);
    expect(store().dirty).toBe(true);
  });

  it('deshace y rehace cambios', () => {
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    store().addDevice(makeDevice('hue-white-e27', 'd2', 200, 200, 'Otra'));
    expect(store().project.devices).toHaveLength(2);
    store().undo();
    expect(store().project.devices.map((d) => d.id)).toEqual(['d1']);
    store().undo();
    expect(store().project.devices).toHaveLength(0);
    store().redo();
    expect(store().project.devices).toHaveLength(1);
  });

  it('guarda al menos 50 pasos de historial', () => {
    for (let i = 0; i < 60; i++) store().renameProject(`Nombre ${i}`);
    expect(store().past.length).toBeGreaterThanOrEqual(50);
    expect(store().past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    for (let i = 0; i < 50; i++) store().undo();
    expect(store().project.name).toBe('Nombre 9');
  });

  it('asigna la sala automáticamente al mover un dispositivo dentro de su rectángulo', () => {
    const room = store().addRoom({
      floorId: 'f1',
      name: 'Salón',
      polygon: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 0, y: 300 },
      ],
    });
    store().addDevice(makeDevice('hue-white-e27', 'd1', 500, 500));
    expect(store().project.devices[0]?.roomId).toBeUndefined();
    store().moveDevice('d1', { x: 100, y: 100 });
    expect(store().project.devices[0]?.roomId).toBe(room.id);
    store().moveDevice('d1', { x: 600, y: 600 });
    expect(store().project.devices[0]?.roomId).toBeUndefined();
  });

  it('al eliminar un dispositivo borra sus conexiones', () => {
    store().addDevice(makeDevice('sonoff-zbdongle-p', 'c1'));
    store().addDevice(makeDevice('hue-white-e27', 'd1'));
    expect(store().addConnection({ sourceId: 'c1', targetId: 'd1', protocol: 'zigbee' })).not.toBeNull();
    // no se duplican conexiones entre el mismo par
    expect(store().addConnection({ sourceId: 'd1', targetId: 'c1', protocol: 'zigbee' })).toBeNull();
    store().removeDevices(['d1']);
    expect(store().project.connections).toHaveLength(0);
  });

  it('agrupa en un paso las ediciones seguidas de una automatización', () => {
    const a = store().addAutomation();
    const pastAfterAdd = store().past.length;
    store().updateAutomation(a.id, { ...a, name: 'L' });
    store().updateAutomation(a.id, { ...a, name: 'Lu' });
    store().updateAutomation(a.id, { ...a, name: 'Luz' });
    expect(store().past.length).toBe(pastAfterAdd + 1);
    store().undo();
    expect(store().project.automations[0]?.name).toBe(a.name);
  });

  it('no elimina la última planta', () => {
    store().removeFloor('f1');
    expect(store().project.floors).toHaveLength(1);
    const f2 = store().addFloor('Primera');
    store().removeFloor(f2.id);
    expect(store().project.floors.map((f) => f.id)).toEqual(['f1']);
  });
});
