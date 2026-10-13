import { describe, expect, it } from 'vitest';
import { catalog, getDefinition } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { callService, createSimulationState, tick } from '../simulation/engine';
import { robotMarkers } from './robotOverlay';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);
const defOf = (id: string) => getDefinition(id, catalog);

describe('robot en el plano', () => {
  it('solo se dibuja fuera de la base, en la sala que limpia y con su progreso', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, T0);
    expect(robotMarkers(p, 'demo-planta-baja', sim, defOf)).toEqual([]);
    sim = callService(sim, p, 'vacuum.robot_aspirador_vacuum', 'vacuum.start');
    sim = tick(sim, p, 5 * 60_000);
    const [m] = robotMarkers(p, 'demo-planta-baja', sim, defOf);
    expect(m).toMatchObject({ deviceId: 'demo-robot', roomId: 'demo-salon', state: 'cleaning' });
    expect(m?.progress).toBeGreaterThan(0);
    expect(m?.battery).toBeLessThan(100);
    expect(robotMarkers(p, 'demo-primera-planta', sim, defOf)).toEqual([]);
    // Datos estables entre pasos (el lienzo no se repinta en cada tick, solo al cambiar el paso).
    expect(robotMarkers(p, 'demo-planta-baja', tick(sim, p, 1000), defOf)).toEqual([m]);
  });
});
