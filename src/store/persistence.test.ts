import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { initialEntityStates } from '../devices/entities';
import { analyzeMesh } from '../network/mesh';
import { validateProject } from '../network/validator';
import { createSimulationState, runScript, setEntityState, tick } from '../simulation/engine';
import { DAY_MS } from '../simulation/clock';
import type { Action, Condition, Project, Trigger } from '../types';
import {
  createDemoProject,
  createEmptyProject,
  deleteProject,
  exportProjectJson,
  importProjectJson,
  listProjects,
  loadProject,
  saveProject,
} from './persistence';

function entityRefs(p: Project): string[] {
  const fromTrigger = (t: Trigger) => ('entityId' in t ? [t.entityId] : []);
  const fromCondition = (c: Condition): string[] =>
    c.type === 'and' || c.type === 'or' ? c.conditions.flatMap(fromCondition) : 'entityId' in c ? [c.entityId] : [];
  const fromAction = (a: Action) => (a.type === 'service' ? [a.entityId] : []);
  return [
    ...p.automations.flatMap((a) => [...a.triggers.flatMap(fromTrigger), ...a.conditions.flatMap(fromCondition), ...a.actions.flatMap(fromAction)]),
    ...p.scenes.flatMap((s) => Object.keys(s.entities)),
    ...p.scripts.flatMap((s) => s.sequence.flatMap(fromAction)),
  ];
}

describe('createEmptyProject', () => {
  it('crea un proyecto con la planta baja', () => {
    const p = createEmptyProject('Mi casa');
    expect(p).toMatchObject({ name: 'Mi casa', version: 1, devices: [], connections: [], automations: [], scenes: [], scripts: [] });
    expect(p.floors).toEqual([{ id: expect.any(String), name: 'Planta baja', level: 0, pixelsPerMeter: 50 }]);
    expect(createEmptyProject('x').id).not.toBe(p.id);
  });
});

describe('createDemoProject', () => {
  const demo = createDemoProject();

  it('tiene 2 plantas, salas, dispositivos conectados, 3 automatizaciones, 2 escenas y 1 script', () => {
    expect(demo.floors).toHaveLength(2);
    expect(demo.rooms.length).toBeGreaterThanOrEqual(6);
    expect(demo.devices.length).toBeGreaterThanOrEqual(15);
    expect(demo.connections.length).toBeGreaterThanOrEqual(demo.devices.length - 1);
    expect(demo.automations).toHaveLength(3);
    expect(demo.scenes).toHaveLength(2);
    expect(demo.scripts).toHaveLength(1);
  });

  it('usa definiciones reales del catálogo', () => {
    for (const d of demo.devices) expect(catalog.some((c) => c.id === d.definitionId), d.definitionId).toBe(true);
  });

  it('pasa el validador sin errores ni avisos y todo es alcanzable', () => {
    const issues = validateProject(demo, catalog);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(new Set(issues.map((i) => i.code))).toEqual(new Set(['integracion-cloud']));
    expect(analyzeMesh(demo, catalog).unreachable).toEqual([]);
  });

  it('todas las entidades referenciadas existen', () => {
    const states = initialEntityStates(demo, catalog);
    for (const id of entityRefs(demo)) expect(states[id], id).toBeDefined();
  });

  it('se puede simular: movimiento de noche, calor y script', () => {
    const night = Date.UTC(2026, 9, 12, 22, 0);
    let sim = createSimulationState(demo, catalog, night);
    sim = setEntityState(sim, demo, 'binary_sensor.movimiento_pasillo_motion', 'on');
    expect(sim.entities['light.luz_salon']?.state).toBe('on');
    sim = setEntityState(sim, demo, 'sensor.clima_dormitorio_temperature', 27);
    expect(sim.entities['switch.ventilador_dormitorio']?.state).toBe('on');
    sim = runScript(sim, demo, 'demo-script-salir');
    expect(sim.entities['lock.cerradura_entrada_lock']?.state).toBe('locked');
    sim = tick(sim, demo, DAY_MS);
    expect(sim.entities['climate.termostato_climate']?.attributes?.temperature).toBe(17);
    expect(sim.entities['cover.persiana_dormitorio_cover']?.state).toBe('closed');
    expect(sim.log.some((l) => l.level === 'error')).toBe(false);
  });

  it('cada llamada devuelve una copia independiente', () => {
    const other = createDemoProject();
    expect(other.id).not.toBe(demo.id);
    other.automations[0]!.name = 'cambiado';
    expect(createDemoProject().automations[0]?.name).not.toBe('cambiado');
  });
});

describe('JSON', () => {
  it('exporta e importa sin pérdidas', () => {
    const demo = createDemoProject();
    expect(importProjectJson(exportProjectJson(demo))).toEqual(demo);
  });

  it('importa proyectos con campos opcionales', () => {
    const p = createEmptyProject('x');
    const withBg = { ...p, floors: [{ ...p.floors[0]!, backgroundImage: 'data:image/png;base64,AA' }] };
    expect(importProjectJson(JSON.stringify(withBg))).toEqual(withBg);
  });

  it.each([
    ['no es json', 'El archivo no es un JSON válido'],
    ['[]', 'el documento debe ser un objeto'],
    ['{"version": 2}', 'version no soportada'],
  ])('rechaza %s', (text, msg) => {
    expect(() => importProjectJson(text)).toThrow(msg);
  });

  it('valida estructura y referencias con mensajes en español', () => {
    const base = createDemoProject();
    const bad = (mutate: (p: Record<string, unknown>) => void) => {
      const copy = JSON.parse(exportProjectJson(base)) as Record<string, unknown>;
      mutate(copy);
      return () => importProjectJson(JSON.stringify(copy));
    };
    expect(bad((p) => delete p.devices)).toThrow('Proyecto no válido: devices debe ser una lista');
    expect(bad((p) => ((p.devices as Record<string, unknown>[])[0]!.protocol = 'lora'))).toThrow(/devices\[0\]\.protocol tiene un valor no válido/);
    expect(bad((p) => ((p.devices as Record<string, unknown>[])[0]!.floorId = 'nada'))).toThrow(/planta inexistente/);
    expect(bad((p) => ((p.connections as Record<string, unknown>[])[0]!.targetId = 'nada'))).toThrow(/dispositivo inexistente/);
    expect(bad((p) => (p.floors = []))).toThrow(/al menos una planta/);
    expect(bad((p) => ((p.devices as unknown[]).push((p.devices as unknown[])[0])))).toThrow(/id repetido/);
    expect(bad((p) => ((p.automations as Record<string, unknown>[])[0]!.enabled = 'sí'))).toThrow(/enabled debe ser verdadero o falso/);
    expect(bad((p) => ((p.automations as Record<string, unknown>[])[0]!.triggers = [{ type: 'webhook' }]))).toThrow(/triggers\[0\]\.type/);
    expect(bad((p) => ((p.scenes as Record<string, unknown>[])[0]!.entities = { 'light.x': { state: {} } }))).toThrow(/state debe ser texto, número o booleano/);
    expect(bad((p) => ((p.scripts as Record<string, unknown>[])[0]!.sequence = [{ type: 'delay', seconds: 'x' }]))).toThrow(/seconds debe ser un número/);
    expect(bad((p) => ((p.floors as Record<string, unknown>[])[0]!.pixelsPerMeter = 0))).toThrow(/mayor que 0/);
  });
});

describe('IndexedDB', () => {
  beforeEach(async () => {
    for (const p of await listProjects()) await deleteProject(p.id);
  });

  it('guarda, lista, carga y borra proyectos', async () => {
    const a = { ...createEmptyProject('A'), updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...createDemoProject(), updatedAt: '2026-02-01T00:00:00.000Z' };
    await saveProject(a);
    await saveProject(b);
    expect(await listProjects()).toEqual([
      { id: b.id, name: 'Casa de ejemplo', updatedAt: b.updatedAt },
      { id: a.id, name: 'A', updatedAt: a.updatedAt },
    ]);
    expect(await loadProject(b.id)).toEqual(b);
    await deleteProject(a.id);
    expect((await listProjects()).map((p) => p.id)).toEqual([b.id]);
    expect(await loadProject(a.id)).toBeUndefined();
  });

  it('saveProject sobrescribe por id', async () => {
    const p = createEmptyProject('Uno');
    await saveProject(p);
    await saveProject({ ...p, name: 'Dos' });
    expect((await listProjects()).map((x) => x.name)).toEqual(['Dos']);
  });
});
