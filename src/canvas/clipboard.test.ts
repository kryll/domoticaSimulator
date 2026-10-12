import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project, Room } from '../types';
import {
  assignRoom,
  copyDevices,
  deviceReferences,
  duplicateDevices,
  moveDevices,
  parseClipboard,
  pasteDevices,
  referencesTo,
  removeDevices,
  removeDevicesDetailed,
  serializeClipboard,
} from './clipboard';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const SALON: Room = { id: 'salon', floorId: 'f0', name: 'Salón', polygon: square(0, 0, 300) };
const COCINA: Room = { id: 'cocina', floorId: 'f0', name: 'Cocina', polygon: square(400, 0, 300) };
const DORMITORIO: Room = { id: 'dormitorio', floorId: 'f1', name: 'Dormitorio', polygon: square(0, 0, 300) };
const MANUAL: Room = { id: 'manual', floorId: 'f1', name: 'Altillo', polygon: [] };

function home(): Project {
  return project(
    [
      dev('hub', 'sonoff-zbdongle-p', { x: 50, y: 50 }, { name: 'Coordinador', roomId: 'salon' }),
      dev('l1', 'aqara-bulb-t1', { x: 100, y: 100 }, { name: 'Luz salón', roomId: 'salon' }),
      dev('m', 'aqara-motion-p1', { x: 150, y: 100 }, { name: 'Movimiento', roomId: 'salon' }),
    ],
    {
      rooms: [SALON, COCINA, DORMITORIO, MANUAL],
      connections: [
        { id: 'c1', sourceId: 'l1', targetId: 'hub', protocol: 'zigbee' },
        { id: 'c2', sourceId: 'm', targetId: 'l1', protocol: 'zigbee' },
      ],
      automations: [
        {
          id: 'a1',
          name: 'Luz al entrar',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_motion', to: 'on' }],
          conditions: [],
          actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon' }],
        },
      ],
      scenes: [{ id: 's1', name: 'Cine', entities: { 'light.luz_salon': { state: 'off' } } }],
      groups: [{ id: 'g1', name: 'Luces', domain: 'light', entityIds: ['light.luz_salon'] }],
    },
  );
}

describe('copiar y pegar', () => {
  it('copyDevices copia los dispositivos y solo las conexiones internas', () => {
    const p = home();
    const payload = copyDevices(p, ['l1', 'm']);
    expect(payload.version).toBe(1);
    expect(payload.sourceFloorId).toBe('f0');
    expect(payload.devices.map((d) => d.id)).toEqual(['l1', 'm']);
    expect(payload.connections.map((c) => c.id)).toEqual(['c2']);
    // Copia profunda: cambiar el proyecto no cambia el portapapeles.
    expect(payload.devices[0]?.position).not.toBe(p.devices[1]?.position);
  });

  it('pasteDevices crea ids y nombres nuevos, recalcula la sala y remapea las conexiones', () => {
    const p = home();
    const payload = copyDevices(p, ['l1', 'm']);
    const { project: next, newIds } = pasteDevices(p, payload, { floorId: 'f0', offset: { x: 400, y: 0 }, defs: catalog });
    expect(newIds).toHaveLength(2);
    const pasted = next.devices.filter((d) => newIds.includes(d.id));
    expect(pasted.map((d) => d.name)).toEqual(['Luz salón 2', 'Movimiento 2']);
    expect(pasted.map((d) => d.roomId)).toEqual(['cocina', 'cocina']);
    expect(pasted[0]?.position).toEqual({ x: 500, y: 100 });
    const conn = next.connections.find((c) => newIds.includes(c.sourceId));
    expect(conn).toMatchObject({ sourceId: newIds[1], targetId: newIds[0], protocol: 'zigbee' });
    expect(conn?.id).not.toBe('c2');
    expect(next.connections).toHaveLength(3);
    // El original no cambia.
    expect(p.devices).toHaveLength(3);
  });

  it('en otra planta, la sala es la de esa planta (o ninguna)', () => {
    const p = home();
    const payload = copyDevices(p, ['l1']);
    const inRoom = pasteDevices(p, payload, { floorId: 'f1', offset: { x: 0, y: 0 }, defs: catalog });
    expect(inRoom.project.devices.at(-1)).toMatchObject({ floorId: 'f1', roomId: 'dormitorio' });
    const outside = pasteDevices(p, payload, { floorId: 'f1', offset: { x: 1000, y: 1000 }, defs: catalog });
    expect(outside.project.devices.at(-1)?.roomId).toBeUndefined();
  });

  it('dos pegados seguidos dan nombres distintos; los de definición desconocida se omiten', () => {
    const p = home();
    const payload = copyDevices(p, ['l1']);
    const once = pasteDevices(p, payload, { floorId: 'f0', offset: { x: 10, y: 10 }, defs: catalog }).project;
    const twice = pasteDevices(once, payload, { floorId: 'f0', offset: { x: 20, y: 20 }, defs: catalog }).project;
    expect(twice.devices.map((d) => d.name).slice(-2)).toEqual(['Luz salón 2', 'Luz salón 3']);
    const unknown = { ...payload, devices: payload.devices.map((d) => ({ ...d, definitionId: 'no-existe' })) };
    expect(pasteDevices(p, unknown, { floorId: 'f0', offset: { x: 0, y: 0 }, defs: catalog })).toEqual({ project: p, newIds: [] });
    expect(pasteDevices(p, payload, { floorId: 'planta-inexistente', offset: { x: 0, y: 0 }, defs: catalog }).newIds).toEqual([]);
  });

  it('serializeClipboard y parseClipboard hacen ida y vuelta; lo ajeno devuelve null', () => {
    const payload = copyDevices(home(), ['l1', 'm']);
    expect(parseClipboard(serializeClipboard(payload))).toEqual(payload);
    expect(parseClipboard('hola')).toBeNull();
    expect(parseClipboard('{"devices": []}')).toBeNull();
    expect(parseClipboard(JSON.stringify({ ...JSON.parse(serializeClipboard(payload)), version: 2 }))).toBeNull();
    const broken = JSON.parse(serializeClipboard(payload)) as { devices: { protocol: string }[] };
    broken.devices[0]!.protocol = 'pigeon';
    expect(parseClipboard(JSON.stringify(broken))).toBeNull();
  });
});

describe('acciones en lote', () => {
  it('duplicateDevices duplica en su planta, desplazado, con sus conexiones internas', () => {
    const p = home();
    const { project: next, newIds } = duplicateDevices(p, ['l1', 'm'], catalog);
    expect(newIds).toHaveLength(2);
    const copies = next.devices.filter((d) => newIds.includes(d.id));
    expect(copies.map((d) => d.position)).toEqual([{ x: 140, y: 140 }, { x: 190, y: 140 }]);
    expect(next.connections).toHaveLength(3);
    const custom = duplicateDevices(p, ['l1'], { defs: catalog, offset: { x: 500, y: 0 } });
    expect(custom.project.devices.at(-1)).toMatchObject({ position: { x: 600, y: 100 }, roomId: 'cocina' });
  });

  it('moveDevices mueve y reasigna la sala', () => {
    const p = home();
    const next = moveDevices(p, ['l1', 'm'], { x: 400, y: 0 });
    expect(next.devices.filter((d) => d.id !== 'hub').map((d) => d.roomId)).toEqual(['cocina', 'cocina']);
    expect(next.devices[0]).toBe(p.devices[0]);
    expect(moveDevices(p, ['l1'], { x: 0, y: 0 })).toBe(p);
  });

  it('assignRoom asigna o quita la sala solo en la planta de la sala', () => {
    const p = home();
    const next = assignRoom(p, ['l1', 'm'], 'cocina');
    expect(next.devices.map((d) => d.roomId)).toEqual(['salon', 'cocina', 'cocina']);
    expect(assignRoom(p, ['l1'], 'manual')).toBe(p); // el Altillo está en otra planta
    expect(assignRoom(p, ['l1'], 'no-existe')).toBe(p);
    expect(assignRoom(p, ['l1'], undefined).devices[1]).not.toHaveProperty('roomId');
  });

  it('referencesTo lista automatizaciones, escenas, scripts y grupos que usan sus entidades', () => {
    const p = home();
    expect(referencesTo(p, ['l1'])).toEqual([
      'Automatización «Luz al entrar» (light.luz_salon)',
      'Escena «Cine» (light.luz_salon)',
      'Grupo «Luces» (light.luz_salon)',
    ]);
    expect(deviceReferences(p, ['m'])).toEqual([{ kind: 'automation', id: 'a1', name: 'Luz al entrar', entityIds: ['binary_sensor.movimiento_motion'] }]);
    expect(referencesTo(p, ['hub'])).toEqual([]);
  });

  it('removeDevices quita los dispositivos y sus conexiones y avisa de las referencias', () => {
    const p = home();
    const { project: next, warnings } = removeDevicesDetailed(p, ['l1']);
    expect(next.devices.map((d) => d.id)).toEqual(['hub', 'm']);
    expect(next.connections).toEqual([]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toBe('Automatización «Luz al entrar» (light.luz_salon) usa un dispositivo eliminado');
    // Las referencias no se tocan (se puede deshacer).
    expect(next.automations).toBe(p.automations);
    expect(removeDevices(p, ['no-existe'])).toBe(p);
    expect(removeDevices(p, ['hub', 'l1', 'm']).devices).toEqual([]);
  });
});
