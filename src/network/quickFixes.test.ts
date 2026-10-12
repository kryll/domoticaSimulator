import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Device, Project, Room, ValidationIssue } from '../types';
import { createDemoProject } from '../store/demoProject';
import { suggestConnections } from './connections';
import { quickFixesFor, similarEntity } from './quickFixes';
import { validateProject } from './validator';

const ROOM: Room = { id: 'r1', floorId: 'f0', name: 'Salón', polygon: [{ x: -100, y: -100 }, { x: 900, y: -100 }, { x: 900, y: 600 }, { x: -100, y: 600 }] };

function connected(devices: Device[], extra: Partial<Project> = {}, withServer = true): Project {
  const infra = withServer ? [dev('srv', 'ha-green', { x: 0, y: 0 }), dev('ap', 'tplink-deco-x50', { x: 200, y: 0 })] : [dev('ap', 'tplink-deco-x50', { x: 200, y: 0 })];
  const all = [...infra, ...devices].map((d) => ({ ...d, roomId: d.roomId ?? 'r1' }));
  const p = project(all, { rooms: [ROOM], ...extra });
  return { ...p, connections: suggestConnections(p, catalog) };
}

const issueOf = (p: Project, code: string): ValidationIssue => {
  const i = validateProject(p, catalog).find((x) => x.code === code);
  if (!i) throw new Error(`No hay incidencia ${code}`);
  return i;
};

/** Aplica el arreglo cuyo id acaba en `suffix` y comprueba que la incidencia desaparece. */
function fix(p: Project, code: string, suffix: string): Project {
  const issue = issueOf(p, code);
  const before = JSON.stringify(p);
  const f = quickFixesFor(issue, p, catalog).find((x) => x.id.endsWith(suffix));
  expect(f, `arreglo ${suffix} para ${code}`).toBeDefined();
  const next = f!.apply(p);
  expect(JSON.stringify(p)).toBe(before); // inmutable
  expect(validateProject(next, catalog).some((i) => i.id === issue.id)).toBe(false);
  for (const id of f!.selectAfter ?? []) expect(next.devices.some((d) => d.id === id)).toBe(true);
  return next;
}

describe('arreglos rápidos del validador', () => {
  it('sin-servidor-ha: añade el HA Green colocado en una sala', () => {
    const p = connected([], {}, false);
    const next = fix(p, 'sin-servidor-ha', '#add-ha-green');
    const server = next.devices.find((d) => d.definitionId === 'ha-green');
    expect(server).toMatchObject({ name: 'Home Assistant', roomId: 'r1' });
    expect(next.devices.filter((d) => d.id !== server?.id).every((d) => Math.abs(d.position.x - (server?.position.x ?? 0)) >= 180 || Math.abs(d.position.y - (server?.position.y ?? 0)) >= 70)).toBe(true);
  });

  it('zigbee-sin-coordinador: añade el dongle SONOFF', () => {
    const next = fix(connected([dev('s', 'sonoff-snzb-03p', { x: 400, y: 200 })]), 'zigbee-sin-coordinador', '#add-sonoff-zbdongle-p');
    expect(next.devices.some((d) => d.definitionId === 'sonoff-zbdongle-p')).toBe(true);
    expect(validateProject(next, catalog).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('zigbee-sin-coordinador: o pasa a la integración del hub existente', () => {
    const p = connected([dev('h', 'hue-bridge-v2', { x: 0, y: 200 }), dev('l', 'hue-white-e27', { x: 200, y: 200 }, { integration: 'zha' })]);
    const next = fix(p, 'zigbee-sin-coordinador', '#use-hub');
    expect(next.devices.find((d) => d.id === 'l')?.integration).toBe('hue');
  });

  it('thread-sin-border-router', () => {
    const next = fix(connected([dev('t', 'aqara-door-p2', { x: 400, y: 200 })]), 'thread-sin-border-router', '#add-google-nest-hub-2');
    expect(next.devices.some((d) => d.definitionId === 'google-nest-hub-2')).toBe(true);
  });

  it('falta-hub-propietario: añade el hub de la marca', () => {
    const next = fix(connected([dev('i', 'ikea-tradfri-e27-ws', { x: 400, y: 200 })]), 'falta-hub-propietario', '#add-ikea-dirigera');
    expect(next.devices.some((d) => d.definitionId === 'ikea-dirigera')).toBe(true);
  });

  it('falta-hub-propietario: o pasa a ZHA si hay coordinador', () => {
    const p = connected([dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 200 }), dev('a', 'aqara-door-window', { x: 200, y: 200 })]);
    const next = fix(p, 'falta-hub-propietario', '#to-zha');
    expect(next.devices.find((d) => d.id === 'a')).toMatchObject({ integration: 'zha', protocol: 'zigbee' });
    expect(validateProject(next, catalog).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('infraestructura-sin-conexion: Autoconectar ese dispositivo', () => {
    const base = connected([]);
    const p: Project = { ...base, devices: [...base.devices, { ...dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 200 }), roomId: 'r1' }] };
    const issue = issueOf(p, 'infraestructura-sin-conexion');
    expect(quickFixesFor(issue, p, catalog)[0]?.label).toBe('Autoconectar «zc»');
    const next = fix(p, 'infraestructura-sin-conexion', '#autoconnect');
    expect(next.connections.some((c) => c.sourceId === 'zc')).toBe(true);
  });

  it('fuera-de-cobertura: acercar al equipo compatible más cercano', () => {
    const p = connected([dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 200 }), dev('s', 'sonoff-snzb-03p', { x: 8000, y: 8000 })]);
    const next = fix(p, 'fuera-de-cobertura', '#move-near');
    expect(next.devices.find((d) => d.id === 's')?.position.x).toBeLessThan(1000);
  });

  it('dispositivo-sin-sala: lo asigna a la sala que lo contiene', () => {
    const base = connected([]);
    const p: Project = { ...base, devices: [...base.devices, { ...dev('x', 'shelly-plug-s-gen3', { x: 400, y: 300 }) }] };
    const next = fix(p, 'dispositivo-sin-sala', '#assign-room');
    expect(next.devices.find((d) => d.id === 'x')?.roomId).toBe('r1');
  });

  it('dispositivo-sin-sala: lo mueve a la sala más cercana si no está en ninguna', () => {
    const base = connected([]);
    const p: Project = { ...base, devices: [...base.devices, { ...dev('x', 'shelly-plug-s-gen3', { x: 1500, y: 300 }) }] };
    const next = fix(p, 'dispositivo-sin-sala', '#move-room');
    expect(next.devices.find((d) => d.id === 'x')?.roomId).toBe('r1');
  });

  it('servicio-dominio-incompatible: cambia el servicio al dominio de la entidad', () => {
    const p = connected([dev('l', 'shelly-plug-s-gen3', { x: 0, y: 200 }, { name: 'Enchufe' })], {
      automations: [{ id: 'a1', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'time', at: '08:00' }], conditions: [], actions: [{ type: 'if', conditions: [], then: [{ type: 'service', service: 'light.turn_off', entityId: 'switch.enchufe_switch' }] }] }],
    });
    const issue = issueOf(p, 'servicio-dominio-incompatible');
    expect(quickFixesFor(issue, p, catalog)[0]?.label).toBe('Cambiar a switch.turn_off');
    const next = fix(p, 'servicio-dominio-incompatible', '#service');
    expect(JSON.stringify(next.automations[0]?.actions)).toContain('switch.turn_off');
  });

  it('entidad-desconocida: quita la referencia (disparador, condición, acción y escena)', () => {
    const p = connected([dev('l', 'hue-white-e27', { x: 0, y: 200 }, { name: 'Luz', integration: 'zha' }), dev('zc', 'sonoff-zbdongle-p', { x: 200, y: 200 })], {
      automations: [
        {
          id: 'a1',
          name: 'A',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'state', entityId: 'binary_sensor.no_existe', to: 'on' }, { type: 'time', at: '08:00' }],
          conditions: [{ type: 'and', conditions: [{ type: 'state', entityId: 'binary_sensor.no_existe', state: 'on' }] }],
          actions: [
            { type: 'service', service: 'light.turn_on', entityId: 'light.luz' },
            { type: 'service', service: 'switch.turn_on', entityId: 'binary_sensor.no_existe' },
          ],
        },
      ],
      scenes: [{ id: 's1', name: 'S', entities: { 'binary_sensor.no_existe': { state: 'on' }, 'light.luz': { state: 'on' } } }],
    });
    const next = fix(p, 'entidad-desconocida', '#remove-ref');
    expect(next.automations[0]?.triggers).toEqual([{ type: 'time', at: '08:00' }]);
    expect(next.automations[0]?.conditions).toEqual([]);
    expect(next.automations[0]?.actions).toHaveLength(1);
    // La de la escena es otra incidencia: también se arregla.
    const scene = fix(next, 'entidad-desconocida', '#remove-ref');
    expect(Object.keys(scene.scenes[0]?.entities ?? {})).toEqual(['light.luz']);
  });

  it('entidad-desconocida: propone la entidad parecida', () => {
    expect(similarEntity('light.luz_salom', ['light.luz_salon', 'switch.luz_salon'])).toBe('light.luz_salon');
    expect(similarEntity('light.cocina', ['light.luz_salon'])).toBeUndefined();
    const p = connected([dev('l', 'shelly-plug-s-gen3', { x: 0, y: 200 }, { name: 'Enchufe' })], {
      scripts: [{ id: 's1', name: 'S', sequence: [{ type: 'service', service: 'switch.turn_on', entityId: 'switch.enchufe_swich' }] }],
    });
    const next = fix(p, 'entidad-desconocida', '#use-similar');
    expect(next.scripts[0]?.sequence[0]).toMatchObject({ entityId: 'switch.enchufe_switch' });
  });

  it('nombre-script-duplicado: renombra', () => {
    const p = connected([], {
      scripts: [
        { id: 's1', name: 'Salir', sequence: [] },
        { id: 's2', name: 'salir', sequence: [] },
      ],
    });
    const next = fix(p, 'nombre-script-duplicado', '#rename');
    expect(next.scripts.map((s) => s.name)).toEqual(['Salir', 'salir 2']);
  });

  it('entity-id-duplicado y conexión rota', () => {
    const p = connected([dev('a', 'shelly-plug-s-gen3', { x: 0, y: 200 }, { name: 'Enchufe' }), dev('b', 'shelly-plug-s-gen3', { x: 200, y: 200 }, { name: 'Enchufe' })]);
    const next = fix(p, 'entity-id-duplicado', '#rename');
    expect(next.devices.find((d) => d.id === 'b')?.name).toBe('Enchufe 2');
    const broken: Project = { ...next, connections: [...next.connections, { id: 'c-rota', sourceId: 'a', targetId: 'nadie', protocol: 'wifi' }] };
    const fixed = fix(broken, 'conexion-invalida', '#remove');
    expect(fixed.connections.some((c) => c.id === 'c-rota')).toBe(false);
  });

  it('las incidencias sin arreglo devuelven una lista vacía y la demo no tiene errores', () => {
    const demo = createDemoProject();
    expect(validateProject(demo, catalog).filter((i) => i.severity === 'error')).toEqual([]);
    for (const issue of validateProject(demo, catalog)) {
      expect(issue.title).toBeTruthy();
      expect(issue.title).not.toMatch(/^[a-z0-9-]+$/);
      expect(Array.isArray(quickFixesFor(issue, demo, catalog))).toBe(true);
    }
  });
});

describe('arreglos rápidos (revisión final)', () => {
  const twoFloors = (devices: Device[]): Project => {
    const p = project([dev('srv', 'ha-green', { x: 0, y: 0 }), dev('ap', 'tplink-deco-x50', { x: 200, y: 0 }), ...devices], {
      floors: [
        { id: 'f0', name: 'Planta baja', level: 0, pixelsPerMeter: 50 },
        { id: 'f1', name: 'Primera', level: 1, pixelsPerMeter: 50 },
      ],
      rooms: [{ ...ROOM, id: 'r2', floorId: 'f1', name: 'Dormitorio' }],
    });
    return { ...p, connections: suggestConnections(p, catalog) };
  };

  it('fuera-de-cobertura: añade un repetidor del protocolo cerca y le da cobertura', () => {
    const p = connected([dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 200 }), dev('s', 'sonoff-snzb-03p', { x: 2000, y: 200 })]);
    const issue = issueOf(p, 'fuera-de-cobertura');
    const f = quickFixesFor(issue, p, catalog).find((x) => x.id.endsWith('#add-repeater'));
    expect(f?.label).toMatch(/^Añadir (un repetidor|\d+ repetidores) Zigbee cerca/);
    const next = fix(p, 'fuera-de-cobertura', '#add-repeater');
    expect(next.devices.filter((d) => d.definitionId === 'sonoff-s26r2zb').length).toBeGreaterThan(0);
    expect(validateProject(next, catalog).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('fuera-de-cobertura: «Conectar a…» por cable con el router', () => {
    const base = connected([]);
    const cam = { ...dev('cam', 'reolink-rlc-810a', { x: 600, y: 300 }), roomId: 'r1' };
    const p: Project = { ...base, devices: [...base.devices, cam] };
    const issue = validateProject(p, catalog).find((i) => i.code === 'fuera-de-cobertura' && i.deviceIds.includes('cam'));
    if (!issue) throw new Error('sin incidencia');
    const f = quickFixesFor(issue, p, catalog).find((x) => x.id.includes('#connect-'));
    expect(f?.label).toMatch(/^Conectar (al router|al servidor|a) «/);
    const next = f!.apply(p);
    expect(validateProject(next, catalog).some((i) => i.id === issue.id)).toBe(false);
  });

  it('infraestructura-sin-conexion: «Conectar al router/servidor»', () => {
    const base = connected([]);
    const p: Project = { ...base, devices: [...base.devices, { ...dev('hub', 'hue-bridge-v2', { x: 300, y: 300 }), roomId: 'r1' }] };
    const issue = issueOf(p, 'infraestructura-sin-conexion');
    const labels = quickFixesFor(issue, p, catalog).map((x) => x.label);
    expect(labels.some((l) => /^Conectar (al router|al servidor) «/.test(l))).toBe(true);
    const id = quickFixesFor(issue, p, catalog).find((x) => x.label.startsWith('Conectar al'))!.id.split('#')[1]!;
    fix(p, 'infraestructura-sin-conexion', `#${id}`);
  });

  it('añadir el hub de Hue o el controlador Z-Wave lo deja conectado y en una sala aunque el servidor no esté en ninguna', () => {
    const p = twoFloors([dev('l', 'hue-white-e27', { x: 400, y: 200 }, { floorId: 'f1' }), dev('z', 'aeotec-multisensor-7', { x: 400, y: 300 }, { floorId: 'f1' })].map((d) => ({ ...d, roomId: 'r2' })));
    const before = new Set(validateProject(p, catalog).map((i) => i.id));
    for (const [code, suffix, defId] of [
      ['falta-hub-propietario', '#add-hue-bridge-v2', 'hue-bridge-v2'],
      ['zwave-sin-controlador', '#add-ha-connect-zwa-2', 'ha-connect-zwa-2'],
    ] as const) {
      const next = fix(p, code, suffix);
      const added = next.devices.find((d) => d.definitionId === defId);
      expect(added?.roomId).toBeDefined();
      expect(next.connections.some((c) => c.sourceId === added?.id || c.targetId === added?.id)).toBe(true);
      const fresh = validateProject(next, catalog).filter((i) => !before.has(i.id));
      expect(fresh).toEqual([]);
    }
  });

  it('aplicar todos los arreglos sobre los casos típicos no deja errores', () => {
    const cases: Project[] = [
      connected([], {}, false),
      connected([dev('s', 'sonoff-snzb-03p', { x: 400, y: 200 })]),
      connected([dev('t', 'aqara-door-p2', { x: 400, y: 200 })]),
      connected([dev('i', 'ikea-tradfri-e27-ws', { x: 400, y: 200 })]),
      connected([dev('l', 'hue-white-e27', { x: 400, y: 200 })]),
      connected([dev('z', 'aeotec-multisensor-7', { x: 400, y: 200 })]),
      connected([dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 200 }), dev('s', 'sonoff-snzb-03p', { x: 2000, y: 200 })]),
      twoFloors([dev('l', 'hue-white-e27', { x: 400, y: 200 }, { floorId: 'f1' })].map((d) => ({ ...d, roomId: 'r2' }))),
    ];
    for (const start of cases) {
      let p = start;
      // Se aplica el primer arreglo de cada error hasta que no queden (como mucho 10 rondas).
      for (let round = 0; round < 10; round++) {
        const errors = validateProject(p, catalog).filter((i) => i.severity === 'error');
        const issue = errors.find((i) => quickFixesFor(i, p, catalog).length > 0);
        if (!issue) break;
        p = quickFixesFor(issue, p, catalog)[0]!.apply(p);
      }
      expect(validateProject(p, catalog).filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    }
  });
});
