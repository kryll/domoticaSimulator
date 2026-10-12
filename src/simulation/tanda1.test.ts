// Tanda 1: acciones con varios destinos (entity_id y area_id), id de disparador y condición trigger.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { areaEntityIds, resolveServiceTargets } from '../devices/areas';
import { collectEntityRefs, renameEntityRefs } from '../devices/renaming';
import { validateProject } from '../network/validator';
import { actionEntityIds, mapActionEntities, serviceEntityIds } from '../automations/walk';
import type { Action, Automation, Project, Room, ServiceAction } from '../types';
import { HOUR_MS, MINUTE_MS } from './clock';
import { createSimulationState, evaluateCondition, runActions, runAutomation, setEntityState, testTrigger, tick } from './engine';
import { describeAction } from './trace';
import { failureImpact } from './scenarios';

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);

const SALON: Room = { id: 'r-salon', floorId: 'f0', name: 'Salón', polygon: [] };
const COCINA: Room = { id: 'r-cocina', floorId: 'f0', name: 'Cocina', polygon: [] };

function auto(id: string, partial: Partial<Automation>): Automation {
  return { id, name: id, enabled: true, mode: 'parallel', triggers: [], conditions: [], actions: [], ...partial };
}

function home(automations: Automation[] = []): Project {
  return project(
    [
      dev('l1', 'hue-white-e27', undefined, { name: 'Luz uno', roomId: SALON.id }),
      dev('l2', 'hue-white-e27', undefined, { name: 'Luz dos', roomId: SALON.id }),
      dev('l3', 'hue-white-e27', undefined, { name: 'Luz tres', roomId: COCINA.id }),
      dev('p', 'sonoff-s26r2zb', undefined, { name: 'Enchufe', roomId: SALON.id }),
      dev('b', 'aqara-wireless-mini-switch', undefined, { name: 'Boton' }),
      dev('m', 'aqara-motion-p1', undefined, { name: 'Mov' }),
    ],
    { rooms: [SALON, COCINA], automations },
  );
}

const start = (p: Project) => createSimulationState(p, catalog, T0 + 12 * HOUR_MS);

describe('destinos múltiples de una acción de servicio', () => {
  const multi: ServiceAction = { type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno', targets: { entityIds: ['light.luz_tres'] } };

  it('serviceEntityIds y actionEntityIds incluyen los destinos adicionales', () => {
    expect(serviceEntityIds(multi)).toEqual(['light.luz_uno', 'light.luz_tres']);
    expect(actionEntityIds([multi])).toEqual(['light.luz_uno', 'light.luz_tres']);
    expect(serviceEntityIds({ type: 'service', service: 'light.turn_on', entityId: '', targets: { areaIds: ['x'] } })).toEqual([]);
  });

  it('area_id se resuelve a las entidades del dominio del servicio en esa sala', () => {
    const p = home();
    expect(areaEntityIds(p, catalog, SALON.id, 'light')).toEqual(['light.luz_uno', 'light.luz_dos']);
    expect(areaEntityIds(p, catalog, SALON.id, 'switch')).toEqual(['switch.enchufe']);
    expect(areaEntityIds(p, catalog, SALON.id, 'homeassistant')).toEqual(['light.luz_uno', 'light.luz_dos', 'switch.enchufe']);
    const area: ServiceAction = { type: 'service', service: 'light.turn_on', entityId: 'light.luz_tres', targets: { areaIds: [SALON.id] } };
    expect(resolveServiceTargets(p, catalog, area)).toEqual(['light.luz_tres', 'light.luz_uno', 'light.luz_dos']);
  });

  it('el motor aplica el servicio a cada entidad y a las de cada área', () => {
    const p = home();
    let sim = runActions(start(p), p, [multi]);
    expect(sim.entities['light.luz_uno']?.state).toBe('on');
    expect(sim.entities['light.luz_tres']?.state).toBe('on');
    expect(sim.entities['light.luz_dos']?.state).toBe('off');
    const area: Action = { type: 'service', service: 'light.turn_on', entityId: '', targets: { areaIds: [SALON.id] } };
    sim = runActions(start(p), p, [area]);
    expect(sim.entities['light.luz_uno']?.state).toBe('on');
    expect(sim.entities['light.luz_dos']?.state).toBe('on');
    expect(sim.entities['light.luz_tres']?.state).toBe('off');
    expect(sim.entities['switch.enchufe']?.state).toBe('off');
  });

  it('la traza marca error si falla algún destino y describe todos los destinos', () => {
    const bad: ServiceAction = { type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno', targets: { entityIds: ['light.no_existe'], areaIds: [COCINA.id] } };
    const p = home([auto('a', { triggers: [{ type: 'state', entityId: 'binary_sensor.mov_motion', to: 'on' }], actions: [bad] })]);
    const sim = runAutomation(start(p), p, 'a');
    const step = sim.traces?.[0]?.actions[0];
    expect(step?.status).toBe('error');
    expect(step?.detail).toContain('1 de 3 destinos falló');
    expect(sim.entities['light.luz_tres']?.state).toBe('on');
    expect(describeAction(bad, sim, p)).toBe('Encender Luz uno, light.no_existe y área Cocina');
  });

  it('renombrado, referencias, validador e impacto de fallos recorren targets', () => {
    const p = home([auto('a', { actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno', targets: { entityIds: ['light.luz_dos'], areaIds: ['sala-borrada', COCINA.id] } }] })]);
    const renamed = renameEntityRefs(p, { 'light.luz_dos': 'light.luz_2' });
    const action = renamed.automations[0]?.actions[0];
    expect(action?.type === 'service' && action.targets?.entityIds).toEqual(['light.luz_2']);
    expect(mapActionEntities(multi, (id) => id.toUpperCase())).toMatchObject({ targets: { entityIds: ['LIGHT.LUZ_TRES'] } });
    expect(collectEntityRefs(p).map((r) => r.entityId)).toEqual(['light.luz_uno', 'light.luz_dos']);
    // light.luz_2 no existe: el validador lo marca, y también el área inexistente.
    const codes = validateProject(renamed, catalog).map((i) => `${i.code}:${i.message}`);
    expect(codes.some((c) => c.startsWith('entidad-desconocida') && c.includes('light.luz_2'))).toBe(true);
    expect(codes.some((c) => c.startsWith('area-desconocida') && c.includes('un área que ya no existe'))).toBe(true);
    // La luz de la cocina (por área) cae: la automatización queda degradada.
    const impact = failureImpact(p, catalog, { internet: false, powerOutage: false, haRestarting: false, devicesDown: ['l3'] });
    expect(impact.automations[0]?.reasons.join(' ')).toContain('light.luz_tres');
  });

  it('el validador avisa si el área no tiene entidades del dominio y si el servicio no es del dominio', () => {
    const p = home([
      auto('a', {
        actions: [
          { type: 'service', service: 'switch.turn_on', entityId: '', targets: { areaIds: [COCINA.id] } },
          { type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno', targets: { entityIds: ['switch.enchufe'] } },
        ],
      }),
    ]);
    const codes = validateProject(p, catalog).map((i) => i.code);
    expect(codes).toContain('area-sin-entidades');
    expect(codes).toContain('servicio-dominio-incompatible');
  });
});

describe('id del disparador y condición trigger', () => {
  const triggers: Automation['triggers'] = [
    { type: 'state', entityId: 'binary_sensor.mov_motion', to: 'on', id: 'movimiento' },
    { type: 'device_action', entityId: 'sensor.boton_action', action: 'single' },
  ];
  const actions: Action[] = [
    {
      type: 'choose',
      choices: [{ conditions: [{ type: 'trigger', ids: ['movimiento'] }], sequence: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno' }] }],
      default: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_dos' }],
    },
  ];

  it('el disparo lleva trigger.id (el propio o la posición) y choose lo usa', () => {
    const p = home([auto('a', { triggers, actions })]);
    let sim = setEntityState(start(p), p, 'binary_sensor.mov_motion', 'on');
    expect(sim.entities['light.luz_uno']?.state).toBe('on');
    expect(sim.entities['light.luz_dos']?.state).toBe('off');
    expect(sim.traces?.[0]?.trigger).toEqual({ index: 0, description: expect.any(String), id: 'movimiento' });
    sim = setEntityState(start(p), p, 'sensor.boton_action', 'single');
    expect(sim.entities['light.luz_uno']?.state).toBe('off');
    expect(sim.entities['light.luz_dos']?.state).toBe('on');
  });

  it('la condición trigger de la automatización filtra por id, también al probar el disparador', () => {
    const p = home([
      auto('a', {
        triggers,
        conditions: [{ type: 'trigger', ids: ['1'] }],
        actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_tres' }],
      }),
    ]);
    let sim = setEntityState(start(p), p, 'binary_sensor.mov_motion', 'on');
    expect(sim.entities['light.luz_tres']?.state).toBe('off');
    const failed = sim.traces?.[0];
    expect(failed?.result).toBe('conditions_failed');
    expect(failed?.conditions[0]).toMatchObject({ result: false, detail: 'disparó «movimiento»' });
    sim = testTrigger(start(p), p, 'a', 1);
    expect(sim.entities['light.luz_tres']?.state).toBe('on');
    // Ejecución manual sin disparo: la condición no se cumple.
    sim = runAutomation(start(p), p, 'a');
    expect(sim.traces?.[0]?.conditions[0]).toMatchObject({ result: false, detail: 'sin disparo (ejecución manual)' });
  });

  it('los disparadores de hora llevan su id y evaluateCondition acepta las variables', () => {
    const p = home([
      auto('a', {
        triggers: [{ type: 'time', at: '13:00', id: 'mediodia' }],
        conditions: [{ type: 'trigger', ids: ['mediodia'] }],
        actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_uno' }],
      }),
    ]);
    const sim = tick(start(p), p, HOUR_MS + MINUTE_MS);
    expect(sim.entities['light.luz_uno']?.state).toBe('on');
    expect(evaluateCondition({ type: 'trigger', ids: ['x', 'y'] }, sim, p, { 'trigger.id': 'y' })).toBe(true);
    expect(evaluateCondition({ type: 'not', conditions: [{ type: 'trigger', ids: ['x'] }] }, sim, p, { 'trigger.id': 'y' })).toBe(true);
  });
});
