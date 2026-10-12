import { repairProject } from './repair';
import { parseProject } from './projectSchema';
import { makeDevice, makeProject } from '../test/fixtures';

const valid = () => JSON.parse(JSON.stringify(makeProject({ id: 'p1', name: 'Casa', devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz'), makeDevice('hue-white-e27', 'd2', 100, 0, 'Luz 2')] }))) as Record<string, unknown>;

describe('repairProject', () => {
  it('un proyecto válido queda igual', () => {
    const raw = valid();
    const { project, notes } = repairProject(raw);
    expect(project).toEqual(parseProject(raw));
    expect(notes).toEqual([]);
  });

  it('descarta solo los elementos no válidos y conserva el resto', () => {
    const raw = valid();
    const devices = raw.devices as Record<string, unknown>[];
    raw.devices = [...devices, { id: 'roto', name: 3 }, devices[0]];
    raw.connections = [{ id: 'c1', sourceId: 'd1', targetId: 'no-existe', protocol: 'zigbee' }];
    raw.automations = [{ id: 'a1', name: 'Buena', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [] }, { id: 'a2', name: 'Mala', enabled: 'sí' }];
    expect(() => parseProject(raw)).toThrow();
    const { project, notes } = repairProject(raw);
    expect(project.devices.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(project.connections).toEqual([]);
    expect(project.automations.map((a) => a.name)).toEqual(['Buena']);
    expect(notes.join(' ')).toMatch(/Dispositivos: se descartan 2/);
    expect(notes.join(' ')).toMatch(/conexiones/);
  });

  it('rellena lo imprescindible, conserva los ajustes válidos y descarta los que no', () => {
    const raw = valid();
    delete raw.name;
    raw.floors = 'roto';
    raw.settings = { latitude: 37.4, longitude: -6, electricityPriceEurKwh: 0.2, quote: { vatPct: 500 } };
    raw.reliability = { latency: 'mucho' };
    const { project, notes } = repairProject(raw);
    expect(project.name).toBe('Proyecto recuperado');
    expect(project.floors).toHaveLength(1);
    // Los dispositivos de una planta que ya no existe pasan a la primera.
    expect(project.devices.every((d) => d.floorId === project.floors[0]?.id)).toBe(true);
    expect(project.settings).toMatchObject({ latitude: 37.4, longitude: -6, electricityPriceEurKwh: 0.2 });
    expect(project.settings?.quote).toBeUndefined();
    expect(project.reliability).toBeUndefined();
    expect(notes.some((n) => n.includes('settings') && n.includes('quote'))).toBe(true);
    expect(notes.some((n) => n.includes('reliability'))).toBe(true);
  });

  it('no es un objeto: lanza un error en español', () => {
    expect(() => repairProject('hola')).toThrow(/no es un proyecto/);
  });
});
