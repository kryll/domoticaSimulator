import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { parseYaml } from '../automations/yaml-parse';
import { isYamlMap } from './yaml';
import { packagesZip, projectToPackages } from './packages';
import { crc32, readStoredZip, zipFiles } from './zip';

describe('zip', () => {
  it('CRC32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('ida y vuelta, determinista y con UTF-8', () => {
    const files = [
      { path: 'a.txt', content: 'hola' },
      { path: 'carpeta/ñandú.yaml', content: 'clave: valor\n' },
      { path: 'bin.dat', content: new Uint8Array([0, 1, 2, 255]) },
    ];
    const zip = zipFiles(files);
    expect(zipFiles(files)).toEqual(zip);
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const back = readStoredZip(zip);
    expect(back.map((f) => f.path)).toEqual(['a.txt', 'carpeta/ñandú.yaml', 'bin.dat']);
    expect(new TextDecoder().decode(back[1]?.content)).toBe('clave: valor\n');
    expect([...(back[2]?.content ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('rechaza rutas repetidas o vacías y ZIP corrupto', () => {
    expect(() => zipFiles([{ path: 'a', content: '' }, { path: 'a', content: '' }])).toThrow(/repetida/);
    expect(() => zipFiles([{ path: '', content: '' }])).toThrow(/vacía/);
    expect(() => readStoredZip(new Uint8Array(30))).toThrow(/no válido/);
  });
});

describe('projectToPackages', () => {
  const demo = createDemoProject();
  const files = projectToPackages(demo, catalog);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it('genera areas.yaml, la guía y un paquete por área con contenido', () => {
    expect(files[0]?.path).toBe('areas.yaml');
    expect(files[1]?.path).toBe('GUIA_EMPAREJAMIENTO.md');
    expect([...byPath.keys()].filter((p) => p.startsWith('packages/'))).toEqual(
      expect.arrayContaining(['packages/salon.yaml', 'packages/pasillo.yaml', 'packages/bano.yaml', 'packages/dormitorio.yaml']),
    );
  });

  it('los paquetes son YAML válido y reparten todo una sola vez', () => {
    let automations = 0;
    let scenes = 0;
    let scripts = 0;
    for (const [path, content] of byPath) {
      if (!path.startsWith('packages/')) continue;
      const root = parseYaml(content);
      expect(isYamlMap(root)).toBe(true);
      if (!isYamlMap(root)) continue;
      automations += Array.isArray(root.automation) ? root.automation.length : 0;
      scenes += Array.isArray(root.scene) ? root.scene.length : 0;
      scripts += isYamlMap(root.script ?? null) ? Object.keys(root.script as object).length : 0;
    }
    expect(automations).toBe(demo.automations.length);
    expect(scenes).toBe(demo.scenes.length);
    expect(scripts).toBe(demo.scripts.length);
  });

  it('areas.yaml lista salas, plantas y entidades', () => {
    const root = parseYaml(byPath.get('areas.yaml') ?? '');
    const areas = isYamlMap(root) && Array.isArray(root.areas) ? root.areas : [];
    expect(areas).toHaveLength(demo.rooms.length);
    expect(areas[0]).toMatchObject({ area_id: 'salon', name: 'Salón', floor: 'Planta baja' });
  });

  it('la guía sigue el orden servidor → red → coordinadores → hubs → dispositivos', () => {
    const guide = byPath.get('GUIA_EMPAREJAMIENTO.md') ?? '';
    const order = ['1. Servidor', '2. Red', '3. Coordinadores', '4. Hubs', '5. Dispositivos'].map((t) => guide.indexOf(`## ${t}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(guide).toContain('### ZHA (local)');
    expect(guide).toContain('### eWeLink (nube)');
    expect(guide).toContain('!include_dir_named packages');
  });

  it('device_action se exporta como disparador de estado, grupos y personas', () => {
    const p = {
      ...demo,
      automations: [
        { id: 'x', name: 'Mando', enabled: true, mode: 'single' as const, triggers: [{ type: 'device_action' as const, entityId: 'sensor.mando_salon_action', action: 'hold' }], conditions: [], actions: [{ type: 'service' as const, service: 'light.turn_on', entityId: 'light.luz_salon' }] },
      ],
      groups: [{ id: 'g', name: 'Luces salón', domain: 'light' as const, entityIds: ['light.luz_salon'] }],
      people: [{ id: 'ana', name: 'Ana' }],
    };
    const out = new Map(projectToPackages(p, catalog).map((f) => [f.path, f.content]));
    const salon = out.get('packages/salon.yaml') ?? '';
    expect(salon).toContain('trigger: state');
    expect(salon).toContain('to: hold');
    expect(salon).toContain('platform: group');
    const general = out.get('packages/general.yaml') ?? '';
    expect(general).toContain('# Personas: créalas en Ajustes → Personas');
    expect(general).not.toMatch(/^person:/m);
  });

  it('packagesZip contiene todos los ficheros', () => {
    expect(readStoredZip(packagesZip(demo, catalog)).map((f) => f.path)).toEqual(files.map((f) => f.path));
  });
});

describe('guía y paquete general (revisión)', () => {
  const demo = createDemoProject();
  const out = new Map(projectToPackages(demo, catalog).map((f) => [f.path, f.content]));
  const guide = out.get('GUIA_EMPAREJAMIENTO.md') ?? '';
  const general = out.get('packages/general.yaml') ?? '';

  it('no repite la marca y usa pasos por papel en servidor y red', () => {
    expect(guide).not.toContain('Home Assistant Home Assistant');
    const red = guide.slice(guide.indexOf('## 2. Red'), guide.indexOf('## 3.'));
    expect(red).toContain('Reserva una IP fija');
    expect(red).not.toMatch(/Tapo/);
    const servidor = guide.slice(guide.indexOf('## 1.'), guide.indexOf('## 2.'));
    expect(servidor).toContain('homeassistant.local:8123');
  });

  it('personas comentadas, zonas pasivas y sección en la guía', () => {
    expect(general).toMatch(/^# Personas: créalas en Ajustes → Personas/m);
    expect(general).toContain('person.ana');
    expect(general).toContain('passive: true');
    expect(general).toContain('TODO');
    expect(guide).toContain('## 6. Personas y zonas');
    const root = parseYaml(general);
    expect(isYamlMap(root) && root.person === undefined).toBe(true);
  });
});
