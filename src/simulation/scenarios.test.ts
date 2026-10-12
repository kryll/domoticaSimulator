import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import type { Project } from '../types';
import { FAILURE_SCENARIOS, failureImpact, scenarioFailures, scenarioImpact, type ImpactReport } from './scenarios';
import { NO_FAILURES } from './connectivity';

const demo: Project = createDemoProject();
const status = (r: ImpactReport, id: string) => r.automations.find((a) => a.automationId === id)?.status;
const down = (r: ImpactReport) => r.unavailableDevices.map((d) => d.deviceId).sort();

describe('escenarios de fallo (B2) con la casa de ejemplo', () => {
  it('lista los cinco escenarios con nombre y descripción en español', () => {
    expect(FAILURE_SCENARIOS.map((s) => s.id)).toEqual(['internet', 'coordinator', 'power', 'ha_restart', 'hub']);
    for (const s of FAILURE_SCENARIOS) {
      expect(s.name.length).toBeGreaterThan(5);
      expect(s.description.length).toBeGreaterThan(20);
    }
  });

  it('sin fallos no hay impacto', () => {
    const r = failureImpact(demo, catalog, NO_FAILURES);
    expect(r.unavailableDevices).toEqual([]);
    expect(r.automations.every((a) => a.status === 'ok')).toBe(true);
    expect(r.summary).toMatch(/^0 dispositivos sin servicio/);
  });

  it('Internet: caen las integraciones en la nube (termostato Netatmo y cafetera eWeLink)', () => {
    const r = scenarioImpact(demo, catalog, 'internet');
    expect(down(r)).toEqual(['demo-cafetera', 'demo-termostato']);
    expect(r.unavailableDevices[0]?.reason).toMatch(/nube sin Internet/);
    expect(r.automations.every((a) => a.status === 'ok')).toBe(true);
    expect(r.scripts[0]).toMatchObject({ scriptId: 'demo-script-salir', status: 'degraded' });
    expect(r.scripts[0]?.reasons[0]).toMatch(/Termostato/);
  });

  it('coordinador: caen sus hijos Zigbee y se rompen las automatizaciones que disparan con ellos', () => {
    const failures = scenarioFailures('coordinator', demo, catalog);
    expect(failures.devicesDown).toEqual(['demo-coordinador']);
    const r = failureImpact(demo, catalog, failures);
    expect(down(r)).toEqual(
      ['demo-clima-dormitorio', 'demo-coordinador', 'demo-enchufe-dormitorio', 'demo-fuga-bano', 'demo-luz-pasillo', 'demo-mando', 'demo-movimiento', 'demo-puerta'].sort(),
    );
    expect(r.unavailableDevices.find((d) => d.deviceId === 'demo-mando')?.reason).toBe('depende de «Coordinador Zigbee», que no está disponible');
    expect(status(r, 'demo-auto-fuga')).toBe('broken');
    expect(status(r, 'demo-auto-mando')).toBe('broken');
    expect(status(r, 'demo-auto-atardecer')).toBe('ok');
    expect(r.automations.find((a) => a.automationId === 'demo-auto-fuga')?.reasons[0]).toMatch(/^Disparador 1: Fuga baño/);
    expect(r.scenes.find((s) => s.sceneId === 'demo-escena-noche')?.status).toBe('degraded');
  });

  it('corte de luz: cae lo enchufado sin SAI; el coordinador sigue en el servidor con SAI y los sensores a pilas también', () => {
    const r = scenarioImpact(demo, catalog, 'power');
    const ids = down(r);
    expect(ids).toContain('demo-router');
    expect(ids).toContain('demo-luz-salon');
    expect(ids).not.toContain('demo-servidor');
    expect(ids).not.toContain('demo-coordinador');
    expect(ids).not.toContain('demo-fuga-bano');
    expect(ids).toContain('demo-cerradura'); // a pilas, pero su border router está sin corriente
    expect(r.unavailableDevices.find((d) => d.deviceId === 'demo-cerradura')?.reason).toMatch(/Nest Hub cocina/);
    expect(status(r, 'demo-auto-fuga')).toBe('degraded'); // detecta la fuga, pero el enchufe no responde
    expect(r.scenes.find((s) => s.sceneId === 'demo-escena-cine')?.status).toBe('broken');
  });

  it('corte de luz sin SAI en el servidor: cae todo lo que depende de él', () => {
    const noUps: Project = { ...demo, devices: demo.devices.map((d) => ({ ...d, ups: false })) };
    const r = scenarioImpact(noUps, catalog, 'power');
    expect(down(r)).toContain('demo-servidor');
    expect(down(r)).toContain('demo-fuga-bano');
    expect(status(r, 'demo-auto-fuga')).toBe('broken');
  });

  it('HA reiniciando: todas las automatizaciones quedan rotas, sin dispositivos caídos', () => {
    const r = scenarioImpact(demo, catalog, 'ha_restart');
    expect(r.unavailableDevices).toEqual([]);
    expect(r.automations.every((a) => a.status === 'broken' && /reiniciando/.test(a.reasons[0] ?? ''))).toBe(true);
    expect(r.scenes.every((s) => s.status === 'broken')).toBe(true);
    expect(r.scripts.every((s) => s.status === 'broken' && /reiniciando/.test(s.reasons[0] ?? ''))).toBe(true);
  });

  it('hubs: caen el puente Hue, el Nest Hub y lo que cuelga de ellos', () => {
    const r = scenarioImpact(demo, catalog, 'hub');
    expect(down(r)).toEqual(['demo-cerradura', 'demo-luz-dormitorio', 'demo-luz-salon', 'demo-nest-hub', 'demo-puente-hue']);
    expect(status(r, 'demo-auto-atardecer')).toBe('degraded');
    expect(status(r, 'demo-auto-fuga')).toBe('ok');
    expect(r.scenes.find((s) => s.sceneId === 'demo-escena-cine')?.status).toBe('degraded');
  });
});
