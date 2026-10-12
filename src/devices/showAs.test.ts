import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { createDemoProject } from '../store/demoProject';
import { validateProject } from '../network/validator';
import { createSimulationState, setEntityState } from '../simulation/engine';
import { applyShowAs, renameEntityRefs, renameGroupMapping, renamePersonMapping } from './renaming';
import type { Project } from '../types';

describe('applyShowAs («Mostrar como luz»)', () => {
  it('el enchufe del baño como luz: la fuga lo sigue cortando y el validador no se queja', () => {
    const demo = createDemoProject();
    const p = applyShowAs(demo, 'demo-enchufe-bano', 'light', catalog);
    expect(p.devices.find((d) => d.id === 'demo-enchufe-bano')?.showAs).toBe('light');
    const fuga = p.automations.find((a) => a.id === 'demo-auto-fuga');
    expect(fuga?.actions[0]).toMatchObject({ type: 'service', service: 'light.turn_off', entityId: 'light.enchufe_bano_switch' });
    expect(validateProject(p, catalog).filter((i) => i.code === 'servicio-dominio-incompatible' || i.code === 'entidad-desconocida')).toEqual([]);
    let sim = createSimulationState(p, catalog, Date.UTC(2026, 0, 1, 12));
    sim = setEntityState(sim, p, 'light.enchufe_bano_switch', 'on');
    sim = setEntityState(sim, p, 'binary_sensor.fuga_bano_leak', 'on');
    expect(sim.entities['light.enchufe_bano_switch']?.state).toBe('off');
    // y de vuelta a interruptor
    const back = applyShowAs(p, 'demo-enchufe-bano', undefined, catalog);
    expect(back.automations.find((a) => a.id === 'demo-auto-fuga')?.actions[0]).toMatchObject({ service: 'switch.turn_off', entityId: 'switch.enchufe_bano_switch' });
    expect(applyShowAs(back, 'demo-enchufe-bano', undefined, catalog)).toBe(back);
  });

  it('reescribe acciones anidadas, plantillas, escenas (sin atributos de luz) y líneas de tiempo', () => {
    const demo = createDemoProject();
    const base: Project = {
      ...demo,
      automations: [
        {
          id: 'x', name: 'X', enabled: true, mode: 'single', triggers: [{ type: 'time', at: '10:00' }], conditions: [],
          actions: [{ type: 'if', conditions: [], then: [{ type: 'service', service: 'switch.toggle', entityId: 'switch.enchufe_bano_switch' }, { type: 'notify', message: "{{ states('switch.enchufe_bano_switch') }}" }] }],
        },
      ],
      scenes: [{ id: 's', name: 'S', entities: { 'switch.enchufe_bano_switch': { state: 'on' } } }],
      timelines: [{ id: 't', name: 'T', steps: [{ at: '10:00', kind: 'event', event: 'service', entityId: 'switch.enchufe_bano_switch', service: 'switch.turn_on' }] }],
    };
    const p = applyShowAs(base, 'demo-enchufe-bano', 'light', catalog);
    const json = JSON.stringify(p.automations);
    expect(json).toContain('light.toggle');
    expect(json).toContain("states('light.enchufe_bano_switch')");
    expect(p.scenes[0]?.entities['light.enchufe_bano_switch']).toEqual({ state: 'on' });
    expect(p.timelines?.[0]?.steps[0]).toMatchObject({ service: 'light.turn_on', entityId: 'light.enchufe_bano_switch' });
    const withBrightness = { ...p, scenes: [{ id: 's', name: 'S', entities: { 'light.enchufe_bano_switch': { state: 'on', attributes: { brightness: 10 } } } }] };
    expect(applyShowAs(withBrightness, 'demo-enchufe-bano', undefined, catalog).scenes[0]?.entities['switch.enchufe_bano_switch']).toEqual({ state: 'on' });
  });

  it('el validador marca servicios de otro dominio', () => {
    const demo = createDemoProject();
    const p = { ...demo, automations: [{ ...demo.automations[0]!, actions: [{ type: 'service' as const, service: 'switch.turn_on', entityId: 'light.luz_salon' }] }] };
    expect(validateProject(p, catalog).map((i) => i.code)).toContain('servicio-dominio-incompatible');
  });
});

describe('renombrar grupos y personas', () => {
  it('mapeos para renameEntityRefs', () => {
    const demo = createDemoProject();
    expect(renameGroupMapping(demo, 'demo-grupo-pb', 'Abajo')).toEqual({ 'light.grupo_planta_baja': 'light.grupo_abajo' });
    expect(renameGroupMapping(demo, 'demo-grupo-pb', 'Planta baja')).toEqual({});
    expect(renamePersonMapping(demo, 'demo-ana', 'Ana María')).toEqual({ 'person.ana': 'person.ana_maria' });
    expect(renamePersonMapping(demo, 'nadie', 'X')).toEqual({});
    const renamed = renameEntityRefs(demo, renameGroupMapping(demo, 'demo-grupo-pb', 'Abajo'));
    expect(JSON.stringify(renamed.automations)).toContain('light.grupo_abajo');
  });
});
