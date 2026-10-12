// Rendimiento del lienzo: con el reloj en marcha y sin cambios de entidades, los datos de los
// nodos no cambian (no se repintan) y la potencia y la batería de cada nodo van por su propio
// selector, que solo cambia cuando cambia lo que se ve.
import { shallow } from 'zustand/shallow';
import { catalog } from '../devices/catalog';
import { createSimulationState, tick } from '../simulation/engine';
import { makeDevice, makeProject } from '../test/fixtures';
import { canvasSimSlice, nodePowerKey, parseNodePower } from './nodePower';

const project = makeProject({
  devices: [makeDevice('hue-white-e27', 'luz', 0, 0, 'Luz'), makeDevice('sonoff-snzb-03p', 'pir', 200, 0, 'Movimiento')],
});
const defOf = (id: string) => catalog.find((d) => d.id === project.devices.find((x) => x.id === id)?.definitionId);

describe('lienzo sin repintar en cada tick', () => {
  it.each([1, 600])('a %ix, 10 s de reloj sin cambios de entidades no cambian los datos del lienzo', (speed) => {
    let sim = { ...createSimulationState(project, catalog, Date.UTC(2026, 0, 15, 10, 0, 0)), speed, running: true };
    const before = canvasSimSlice(sim);
    const start = sim.now;
    for (let i = 0; i < 40; i++) sim = tick(sim, project, 250, { defs: catalog, sun: { sunrise: '07:00', sunset: '21:00' } });
    expect(sim.now).toBe(start + 10_000 * speed);
    expect(shallow(canvasSimSlice(sim), before)).toBe(true);
  });

  it('potencia y batería por nodo: clave primitiva estable mientras no cambia lo que se ve', () => {
    let sim = { ...createSimulationState(project, catalog, Date.UTC(2026, 0, 15, 10, 0, 0)), speed: 1, running: true };
    sim = { ...sim, entities: { ...sim.entities, 'light.luz': { state: 'on', attributes: { brightness: 255 } } } };
    const luz = project.devices[0]!;
    const pir = project.devices[1]!;
    const watts = nodePowerKey(luz, defOf('luz'), sim);
    expect(parseNodePower(watts).watts).toBeGreaterThan(0);
    const battery = nodePowerKey(pir, defOf('pir'), sim);
    expect(parseNodePower(battery).batteryPct).toBeGreaterThan(0);
    // La batería viva del motor (sim.batteries) manda sobre el sensor.
    expect(nodePowerKey(pir, defOf('pir'), { ...sim, batteries: { pir: 42.4 } })).toBe('b:42');
    for (let i = 0; i < 8; i++) sim = tick(sim, project, 250, { defs: catalog });
    expect(nodePowerKey(luz, defOf('luz'), sim)).toBe(watts);
    expect(parseNodePower('')).toEqual({});
  });
});
