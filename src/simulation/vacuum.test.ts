import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Project, Room, SimulationState } from '../types';
import { callService, createSimulationState, fireEvent, setVacuumError, tick } from './engine';
import { devicePowerWatts } from './energy';
import { def } from '../devices/testUtils';
import {
  estimateMinutes,
  parseSegments,
  polygonAreaM2,
  vacuumContext,
  vacuumRooms,
  vacuumService,
  vacuumStep,
  VACUUM_FINISHED_EVENT,
  VACUUM_LOW_BATTERY,
} from './vacuum';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);
const MIN = 60_000;

const rect = (id: string, name: string, x1: number, y1: number, x2: number, y2: number): Room => ({
  id,
  floorId: 'f0',
  name,
  polygon: [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ],
});

// Salón 5 × 4 m (16 m² útiles) y cocina 4 × 2,5 m (8 m² útiles) a 50 px/m.
const ROOMS = [rect('salon', 'Salón', 0, 0, 250, 200), rect('cocina', 'Cocina', 250, 0, 450, 125)];
const ROBOT = 'vacuum.robot_vacuum';

function home(extra: Partial<Project> = {}): Project {
  return project([{ ...dev('r', 'roborock-qrevo-curv', { x: 10, y: 10 }, { name: 'Robot', roomId: 'salon' }) }], { rooms: ROOMS, ...extra });
}

const st = (sim: SimulationState, id = ROBOT) => sim.entities[id];
const run = (sim: SimulationState, p: Project, minutes: number) => tick(sim, p, minutes * MIN);

describe('salas y segmentos', () => {
  it('calcula la superficie útil de cada sala y numera los segmentos desde 16', () => {
    expect(polygonAreaM2(ROOMS[0] as Room, 50)).toBe(20);
    const rooms = vacuumRooms(home(), { floorId: 'f0' });
    expect(rooms.map((r) => [r.id, r.areaM2, r.segment])).toEqual([
      ['salon', 16, 16],
      ['cocina', 8, 17],
    ]);
    expect(estimateMinutes(rooms, { cleaningRateM2Min: 1 })).toBe(24);
    expect(vacuumRooms(home(), { floorId: 'f0', vacuumRooms: ['cocina', 'nada'] }).map((r) => r.segment)).toEqual([16]);
  });

  it('lee los segmentos de app_segment_clean en varios formatos', () => {
    expect(parseSegments([16, 17])).toEqual([16, 17]);
    expect(parseSegments('[16, 17]')).toEqual([16, 17]);
    expect(parseSegments('[{"segments": [18], "repeat": 1}]')).toEqual([18]);
  });
});

describe('servicios del robot', () => {
  const ctx = () => vacuumContext(home(), catalog, createSimulationState(home(), catalog, T0).entities, ROBOT);

  it('start limpia todas las salas; clean_area y app_segment_clean, solo las pedidas', () => {
    const c = ctx();
    const all = vacuumService('start', { state: 'docked' }, {}, {}, c);
    expect(all?.state.state).toBe('cleaning');
    expect(all?.state.attributes).toMatchObject({ rooms_queue: 'salon, cocina', current_room: 'salon', job_area: 24 });
    const area = vacuumService('clean_area', { state: 'docked' }, { cleaning_area_id: 'cocina' }, {}, c);
    expect(area?.state.attributes?.rooms_queue).toBe('cocina');
    const seg = vacuumService('send_command', { state: 'docked' }, { command: 'app_segment_clean', params: '[17, 99]' }, {}, c);
    expect(seg?.state.attributes?.rooms_queue).toBe('cocina');
    expect(seg?.warnings.join(' ')).toMatch(/segmento 99/);
  });

  it('pause, stop, return_to_base, locate y set_fan_speed', () => {
    const c = ctx();
    const caps = { fanSpeeds: ['quiet', 'turbo'] };
    const cleaning = vacuumService('start', { state: 'docked' }, {}, caps, c)?.state ?? { state: '' };
    expect(vacuumService('pause', cleaning, {}, caps, c)?.state.state).toBe('paused');
    expect(vacuumService('stop', cleaning, {}, caps, c)?.state.state).toBe('idle');
    expect(vacuumService('return_to_base', cleaning, {}, caps, c)).toMatchObject({ state: { state: 'returning' }, next: 30 });
    expect(vacuumService('locate', cleaning, {}, caps, c)?.notice).toMatch(/Estoy aquí/);
    expect(vacuumService('set_fan_speed', cleaning, { fan_speed: 'turbo' }, caps, c)?.state.attributes?.fan_speed).toBe('turbo');
    expect(vacuumService('set_fan_speed', cleaning, { fan_speed: 'x' }, caps, c)?.warnings[0]).toMatch(/no admitida/);
  });

  it('no empieza con poca batería', () => {
    const c = { ...(ctx() ?? { rooms: [], caps: {}, battery: 0, hasMop: false, siblings: {} }), battery: 10 };
    const r = vacuumService('start', { state: 'docked' }, {}, {}, c);
    expect(r?.state.state).toBe('docked');
    expect(r?.warnings[0]).toMatch(/Batería baja/);
  });
});

describe('paso de limpieza', () => {
  it('limpia por salas, baja la batería y vuelve con poca batería para seguir después', () => {
    const c = { rooms: vacuumRooms(home(), { floorId: 'f0' }), caps: { cleaningRateM2Min: 1, runtimeMinutes: 100 }, battery: 17, hasMop: false, siblings: {} };
    const cleaning = vacuumService('start', { state: 'docked' }, {}, c.caps, { ...c, battery: 50 })?.state ?? { state: '' };
    const r = vacuumStep(cleaning, c, 120);
    expect(r.battery).toBeLessThanOrEqual(VACUUM_LOW_BATTERY);
    expect(r.vacuum.state).toBe('returning');
    expect(r.vacuum.attributes?.resume_after_charge).toBe(true);
  });
});

describe('robot en el motor', () => {
  it('limpia salón y cocina, gasta consumibles, vuelve, vacía la base y carga', () => {
    const p = home();
    let sim = createSimulationState(p, catalog, T0);
    sim = { ...sim, running: true };
    sim = callService(sim, p, ROBOT, 'vacuum.start');
    expect(st(sim)?.state).toBe('cleaning');
    sim = run(sim, p, 10);
    expect(st(sim)?.attributes?.current_room).toBe('salon');
    expect(Number(sim.entities['sensor.robot_battery']?.state)).toBeLessThan(100);
    expect(Number(sim.entities['sensor.robot_cleaned_area']?.state)).toBeGreaterThan(5);
    sim = run(sim, p, 12);
    expect(st(sim)?.attributes?.current_room).toBe('cocina');
    sim = run(sim, p, 10);
    expect(sim.log.some((l) => /ha terminado de limpiar/.test(l.message))).toBe(true);
    expect(sim.log.some((l) => l.message.includes(VACUUM_FINISHED_EVENT))).toBe(true);
    sim = run(sim, p, 1);
    expect(st(sim)?.state).toBe('docked');
    expect(sim.entities['sensor.robot_dock_status']?.state).not.toBe('idle');
    // La base consume (vaciado, lavado o secado) y el robot carga.
    const device = p.devices[0];
    if (device) expect(devicePowerWatts(device, def('roborock-qrevo-curv'), sim)).toBeGreaterThan(10);
    sim = run(sim, p, 180);
    expect(Number(sim.entities['sensor.robot_battery']?.state)).toBe(100);
    expect(sim.entities['sensor.robot_dock_status']?.state).toBe('idle');
    expect(Number(sim.entities['sensor.robot_main_brush_left']?.state)).toBeLessThanOrEqual(100);
    expect(Number(sim.entities['sensor.robot_dust_bag']?.state)).toBeGreaterThan(10);
  });

  it('dispara el evento de fin de limpieza y el error con su atributo', () => {
    const p = home({
      automations: [
        { id: 'a', name: 'Fin', enabled: true, mode: 'single', triggers: [{ type: 'event', eventType: VACUUM_FINISHED_EVENT }], conditions: [], actions: [{ type: 'notify', message: 'Robot terminado' }] },
        { id: 'b', name: 'Error', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: ROBOT, to: 'error' }], conditions: [], actions: [{ type: 'notify', message: 'Error' }] },
      ],
    });
    let sim = createSimulationState(p, catalog, T0);
    sim = callService(sim, p, ROBOT, 'vacuum.clean_area', { cleaning_area_id: 'cocina' });
    sim = run(sim, p, 12);
    expect(sim.notifications?.some((n) => n.message === 'Robot terminado')).toBe(true);
    sim = callService(sim, p, ROBOT, 'vacuum.start');
    sim = setVacuumError(sim, p, ROBOT, 'main_brush_jammed');
    expect(st(sim)).toMatchObject({ state: 'error', attributes: { error: 'Cepillo principal atascado' } });
    expect(sim.notifications?.some((n) => n.message === 'Error')).toBe(true);
    // Sin pasos pendientes mientras está en error; start lo reanuda.
    const frozen = run(sim, p, 5);
    expect(st(frozen)?.attributes?.cleaned_area).toBe(st(sim)?.attributes?.cleaned_area);
    expect(st(callService(frozen, p, ROBOT, 'vacuum.start'))?.state).toBe('cleaning');
    expect(fireEvent(sim, p, 'otro').log.length).toBeGreaterThan(0);
  });

  it('en la base cargada no consume más que el reposo y limpiando no tira de la red', () => {
    const p = home();
    const sim = createSimulationState(p, catalog, T0);
    const device = p.devices[0];
    if (!device) throw new Error('sin robot');
    const standby = devicePowerWatts(device, def('roborock-qrevo-curv'), sim);
    expect(standby).toBeLessThan(5);
    const cleaning = callService(sim, p, ROBOT, 'vacuum.start');
    expect(devicePowerWatts(device, def('roborock-qrevo-curv'), cleaning)).toBe(standby);
  });
});
