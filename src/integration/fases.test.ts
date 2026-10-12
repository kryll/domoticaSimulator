// Tests de integración de la fusión de la Fase 2 y la Fase 3: lógica que comparten las dos fases.
import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { createDemoProject } from '../store/demoProject';
import type { Action, Automation, Project, Room, SimulationState } from '../types';
import { HOUR_MS, MINUTE_MS, sunTimesAt } from '../simulation/clock';
import { callService, createSimulationState, runActions, runAutomation, setEntityState, tick } from '../simulation/engine';
import { lastTrace } from '../simulation/trace';
import { failureImpact, scenarioFailures } from '../simulation/scenarios';
import { reconcileAvailability, setFailures } from '../simulation/availability';
import { movePerson } from '../simulation/people';
import { runTimeline } from '../simulation/timeline';
import { applyEnvironment, daylightFactor, projectSunProvider } from '../simulation/thermal';
import { budgetCost, compareVariants, snapshotOf } from '../variants/variants';
import { billOfMaterials } from '../export/bom';
import { automationsToYaml } from '../export/yaml';
import { projectToPackages } from '../export/packages';
import { deviceActionAsStateTrigger } from '../export/yamlLogic';
import { parseAutomationsYaml } from '../automations/yaml-parse';
import { validateProject } from '../network/validator';

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);
const at = (h: number, m = 0) => T0 + h * HOUR_MS + m * MINUTE_MS;

function demoWith(...automations: Automation[]): Project {
  const p = createDemoProject();
  return { ...p, automations: [...p.automations, ...automations] };
}

const auto = (id: string, actions: Automation['actions'], extra: Partial<Automation> = {}): Automation => ({
  id,
  name: id,
  enabled: true,
  mode: 'single',
  triggers: [{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'triple' }],
  conditions: [],
  actions,
  ...extra,
});

describe('notificaciones: servicio persistente (F2) y acción notify (F3) en la misma bandeja', () => {
  it('notify.persistent_notification llega al registro y a la bandeja', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, at(10));
    sim = callService(sim, p, '', 'notify.persistent_notification', { title: 'Aviso', message: 'Hola' });
    expect(sim.log.at(-1)).toMatchObject({ message: 'Notificación: Aviso — Hola', notification: { title: 'Aviso', message: 'Hola' } });
    expect(sim.notifications).toEqual([{ id: 'notif-1', at: at(10), title: 'Aviso', message: 'Hola', read: false }]);
  });

  it('la acción notify y el servicio comparten la vía: mismo registro y misma bandeja', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, at(10));
    sim = runActions(sim, p, [
      { type: 'variables', variables: { quien: 'Ana' } },
      { type: 'notify', message: 'Hola {{ quien }}' },
      { type: 'service', service: 'notify.persistent_notification', entityId: '', data: { message: 'Sin título' } },
    ]);
    expect(sim.notifications?.map((n) => [n.title, n.message])).toEqual([
      ['Home Assistant', 'Hola Ana'],
      ['Home Assistant', 'Sin título'],
    ]);
    expect(sim.log.filter((l) => l.notification).map((l) => l.message)).toEqual(['Notificación: Home Assistant — Hola Ana', 'Notificación: Sin título']);
  });

  it('la automatización de fugas de la demo avisa en la bandeja', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, at(10));
    sim = setEntityState(sim, p, 'binary_sensor.fuga_bano_leak', 'on');
    expect(sim.entities['switch.enchufe_bano_switch']?.state).toBe('off');
    expect(sim.notifications?.at(-1)).toMatchObject({ title: 'Fuga de agua', message: 'Se ha cortado el enchufe del baño' });
  });
});

describe('trazas (F2) con acciones anidadas (F3)', () => {
  const chooseAuto = auto('a-choose', [
    {
      type: 'choose',
      choices: [
        {
          conditions: [{ type: 'state', entityId: 'light.luz_salon', state: 'off' }],
          sequence: [
            { type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon' },
            { type: 'delay', seconds: 60 },
            { type: 'service', service: 'light.turn_on', entityId: 'light.luz_pasillo' },
          ],
        },
      ],
      default: [{ type: 'notify', message: 'nada' }],
    },
    { type: 'service', service: 'light.turn_on', entityId: 'light.luz_dormitorio' },
  ]);

  it('choose con espera dentro: el paso queda esperando y después se completan los siguientes', () => {
    const p = demoWith(chooseAuto);
    let sim = runAutomation(createSimulationState(p, catalog, at(10)), p, 'a-choose');
    let trace = lastTrace(sim, 'a-choose');
    expect(trace?.actions.map((a) => a.description)).toEqual(['Elegir entre 1 opción (con opción por defecto)', 'Encender Luz dormitorio']);
    expect(trace?.actions[0]).toMatchObject({ status: 'waiting', detail: 'se cumple la opción 1' });
    expect(trace?.actions[1]?.status).toBe('skipped');
    expect(sim.entities['light.luz_salon']?.state).toBe('on');
    expect(sim.pending.find((x) => x.traceId === trace?.id)).toMatchObject({ traceOffset: 1, traceIndexes: [0, 1] });

    sim = tick(sim, p, 61_000);
    trace = lastTrace(sim, 'a-choose');
    expect(trace?.actions.map((a) => a.status)).toEqual(['done', 'done']);
    expect(sim.entities['light.luz_pasillo']?.state).toBe('on');
    expect(sim.entities['light.luz_dormitorio']?.state).toBe('on');
  });

  it('un error dentro de un if marca el paso de primer nivel; repeat y not con su descripción', () => {
    const p = demoWith(
      auto('a-if', [
        { type: 'if', conditions: [{ type: 'not', conditions: [{ type: 'state', entityId: 'light.luz_salon', state: 'on' }] }], then: [{ type: 'service', service: 'light.turn_on', entityId: 'light.no_existe' }] },
        { type: 'repeat', count: 2, sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_pasillo' }] },
      ]),
    );
    const sim = runAutomation(createSimulationState(p, catalog, at(10)), p, 'a-if');
    const trace = lastTrace(sim, 'a-if');
    expect(trace?.actions[0]).toMatchObject({ status: 'error', detail: 'entidad desconocida light.no_existe' });
    expect(trace?.actions[0]?.description).toMatch(/^Si Ninguna: Luz salón está Encendida: 1 acción/);
    expect(trace?.actions[1]).toMatchObject({ status: 'done', description: 'Repetir 2 veces: 1 acción' });
    expect(sim.entities['light.luz_pasillo']?.state).toBe('off'); // dos toggles
  });

  it('wait_for_trigger: espera en la traza y se completa cuando llega el disparador', () => {
    const p = demoWith(
      auto('a-wait', [
        { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: 'light.luz_salon', to: 'on' }], timeoutSeconds: 600 },
        { type: 'service', service: 'light.turn_on', entityId: 'light.luz_pasillo' },
      ]),
    );
    let sim = runAutomation(createSimulationState(p, catalog, at(10)), p, 'a-wait');
    expect(lastTrace(sim, 'a-wait')?.actions.map((a) => a.status)).toEqual(['waiting', 'skipped']);
    sim = callService(sim, p, 'light.luz_salon', 'light.turn_on');
    expect(lastTrace(sim, 'a-wait')?.actions.map((a) => a.status)).toEqual(['done', 'done']);
  });

  it('trazas de disparadores de zona con el nombre de la persona y de la zona', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, at(10));
    sim = movePerson(sim, p, 'demo-ana', 'demo-trabajo');
    const trace = lastTrace(sim, 'demo-auto-salir');
    expect(trace?.trigger).toMatchObject({ index: 0, description: 'Ana sale de Casa' });
    expect(trace?.actions[0]?.status).toBe('done');
    expect(sim.log.some((l) => l.message === 'Automatización «Al salir Ana: apagar luces si no queda nadie» disparada (cambio de Ana)')).toBe(true);
    expect(sim.log.some((l) => l.message.includes('demo-ana'))).toBe(false);
  });
});

describe('impacto de los fallos (F2) con lógica de la F3', () => {
  it('recorre choose/if/repeat y los disparadores device_action', () => {
    const nested = auto(
      'a-nested',
      [
        {
          type: 'choose',
          choices: [{ conditions: [], sequence: [{ type: 'repeat', count: 2, sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_pasillo' }] }] }],
        },
      ],
      { triggers: [{ type: 'time', at: '08:00' }] },
    );
    const button = auto('a-button', [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_salon' }], {
      triggers: [{ type: 'device_action', entityId: 'sensor.mando_salon_action', action: 'double' }],
    });
    const waits = auto('a-wait', [{ type: 'if', conditions: [{ type: 'state', entityId: 'light.luz_pasillo', state: 'on' }], then: [] }], {
      triggers: [{ type: 'time', at: '09:00' }],
    });
    const p = demoWith(nested, button, waits);
    const report = failureImpact(p, catalog, scenarioFailures('coordinator', p, catalog));
    const item = (id: string) => report.automations.find((a) => a.automationId === id);
    expect(item('a-nested')).toMatchObject({ status: 'degraded' });
    expect(item('a-nested')?.reasons[0]).toMatch(/^Acción: .*light\.luz_pasillo/);
    expect(item('a-button')).toMatchObject({ status: 'broken' });
    expect(item('a-button')?.reasons[0]).toMatch(/^Disparador 1: .*sensor\.mando_salon_action/);
    expect(item('a-wait')?.status).toBe('degraded');
    // La automatización de zona de la demo: su grupo depende de la luz del pasillo.
    expect(item('demo-auto-salir')?.status).toBe('degraded');
  });
});

describe('disponibilidad (F2) con personas, zonas y grupos (F3)', () => {
  it('los fallos y la reconciliación no borran person.*, zone.* ni los grupos', () => {
    const p = createDemoProject();
    let sim = createSimulationState(p, catalog, at(10));
    const keep = ['person.ana', 'person.luis', 'zone.home', 'zone.trabajo', 'light.grupo_planta_baja'];
    for (const id of keep) expect(sim.entities[id], id).toBeDefined();
    sim = setFailures(sim, p, catalog, { devicesDown: ['demo-coordinador', 'demo-puente-hue'] });
    for (const id of keep) expect(sim.entities[id], id).toBeDefined();
    expect(sim.entities['light.luz_pasillo']?.state).toBe('unavailable');
    expect(sim.entities['light.grupo_planta_baja']?.state).toBe('unavailable');
    sim = reconcileAvailability(sim, { ...p, devices: [...p.devices] }, catalog);
    sim = setFailures(sim, p, catalog, { devicesDown: [] });
    for (const id of keep) expect(sim.entities[id], id).toBeDefined();
    expect(sim.entities['light.grupo_planta_baja']?.state).toBe('off');
    expect(sim.entities['person.ana']?.state).toBe('home');
    // Los cambios de disponibilidad no son eventos del usuario (no se graban en las pruebas).
    expect(sim.log.filter((l) => l.event && l.entityId === 'light.luz_pasillo')).toEqual([]);
  });

  it('las pruebas muestran el nombre de la persona y de la zona', () => {
    const p = createDemoProject();
    const run = runTimeline(p, catalog, { id: 't', name: 't', steps: [{ at: '08:00', kind: 'event', event: 'person', personId: 'demo-ana', zoneId: 'demo-trabajo' }] }, T0);
    expect(run.results[0]?.message).toBe('Evento: Ana → Trabajo');
  });
});

describe('modelo térmico (F3) con el sol real (F2)', () => {
  const room = (id: string): Room => ({ id, floorId: 'f0', name: id, polygon: [] });
  const house = (settings: Project['settings']): Project => {
    const p = project([dev('m', 'aqara-motion-p1', undefined, { name: 'Mov', roomId: 'dormitorio' })], {
      rooms: [room('dormitorio')],
      environment: { enabled: true, outdoorMean: 5, outdoorAmplitude: 0 },
    });
    return settings ? { ...p, settings } : p;
  };
  const madrid = house({ latitude: 40.4168, longitude: -3.7038, timeZone: 'Europe/Madrid', electricityPriceEurKwh: 0.15 });
  const tromso = house({ latitude: 69.6492, longitude: 18.9553, timeZone: 'Europe/Oslo', electricityPriceEurKwh: 0.15 });
  const noon = Date.UTC(2026, 11, 15, 12, 0);

  it('la luz natural sigue el amanecer y el atardecer de la ubicación del proyecto', () => {
    const sun = sunTimesAt(noon, { latitude: 40.4168, longitude: -3.7038, timeZone: 'Europe/Madrid' });
    const provider = projectSunProvider(madrid);
    expect(provider(noon)).toEqual(sun);
    expect(daylightFactor(sun.sunrise - MINUTE_MS, provider)).toBe(0);
    expect(daylightFactor(sun.sunrise + HOUR_MS, provider)).toBeGreaterThan(0);
    // En Tromsø, en diciembre, es noche polar: ni a mediodía hay luz natural.
    expect(daylightFactor(noon, projectSunProvider(tromso))).toBe(0);
  });

  it('tick y applyEnvironment usan el sol del proyecto (Madrid frente a Tromsø en diciembre)', () => {
    const lux = (s: SimulationState) => Number(s.entities['sensor.mov_illuminance']?.state);
    const m = tick(createSimulationState(madrid, catalog, noon), madrid, MINUTE_MS);
    const t = tick(createSimulationState(tromso, catalog, noon), tromso, MINUTE_MS);
    expect(lux(m)).toBeGreaterThan(0);
    expect(lux(t)).toBe(0);
    const direct = applyEnvironment({ ...createSimulationState(tromso, catalog, noon), now: noon + MINUTE_MS }, tromso, catalog, MINUTE_MS);
    expect(lux(direct)).toBe(0);
  });
});

describe('variantes (F3) con el presupuesto (F2)', () => {
  it('compareVariants recibe el coste del presupuesto', () => {
    const a = createDemoProject();
    const b = { ...a, devices: a.devices.filter((d) => d.id !== 'demo-cafetera') };
    const cmp = compareVariants(snapshotOf(a), snapshotOf(b), catalog, budgetCost(catalog));
    expect(cmp.a.cost).toBe(billOfMaterials(a, catalog).total);
    expect(cmp.b.cost).toBe(billOfMaterials(b, catalog).total);
    expect(cmp.diff.cost).toBeLessThan(0);
    // Los precios propios de los ajustes de cada variante cuentan.
    const cheap = { ...b, settings: { ...b.settings!, prices: { 'ha-green': 1 } } };
    expect(compareVariants(snapshotOf(b), snapshotOf(cheap), catalog, budgetCost(catalog)).diff.cost).toBeLessThan(0);
  });
});

/** Aplica f a las acciones de primer nivel de una automatización. */
function mapActionTree(a: Automation, f: (x: Action) => Action): Automation {
  return { ...a, actions: a.actions.map(f) };
}

describe('exportación con la sintaxis nueva de HA', () => {
  it('automations.yaml de ida y vuelta con lógica avanzada', () => {
    const p = demoWith(
      auto('a-logic', [
        { type: 'variables', variables: { nivel: 40 } },
        {
          type: 'choose',
          choices: [{ conditions: [{ type: 'zone', personId: 'demo-ana', zoneId: 'demo-trabajo' }], sequence: [{ type: 'notify', title: 'Hola', message: 'En el trabajo' }] }],
          default: [{ type: 'service', service: 'notify.persistent_notification', entityId: '', data: { message: 'En casa' } }],
        },
        { type: 'if', conditions: [{ type: 'sun', after: 'sunset', before: 'sunrise' }], then: [{ type: 'service', service: 'light.turn_on', entityId: 'light.grupo_planta_baja' }], else: [{ type: 'delay', seconds: 5 }] },
        { type: 'wait_for_trigger', triggers: [{ type: 'device_action', entityId: 'sensor.mando_salon_action', action: 'hold' }], timeoutSeconds: 30, continueOnTimeout: false },
        { type: 'repeat', until: [{ type: 'not', conditions: [{ type: 'state', entityId: 'light.luz_salon', state: 'on' }] }], sequence: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_salon' }] },
      ]),
    );
    const text = automationsToYaml(p);
    expect(text).not.toMatch(/\bplatform:/);
    expect(text).not.toMatch(/\bservice:/);
    expect(text).toMatch(/^ {2}triggers:$/m);
    expect(text).toMatch(/^ {2}actions:$/m);
    expect(text).toContain('- trigger: zone');
    // device_action se exporta como disparador de estado (HA real exige device_id en trigger: device).
    expect(text).not.toContain('trigger: device');
    expect(text).toContain('to: hold');
    expect(text).toContain('- action: notify.notify');
    expect(text).toContain('- action: notify.persistent_notification');
    expect(text).toContain('- condition: sun');
    const expected = p.automations.map((a) => mapActionTree(a, (x) => (x.type === 'wait_for_trigger' ? { ...x, triggers: x.triggers.map((t) => (t.type === 'device_action' ? deviceActionAsStateTrigger(t) : t)) } : x)));
    expect(parseAutomationsYaml(text, p)).toEqual(expected);
  });

  it('packages: zonas con la ubicación de los ajustes', () => {
    const p = createDemoProject();
    const general = projectToPackages({ ...p, settings: { ...p.settings!, latitude: 37.3891, longitude: -5.9845 } }, catalog).find((f) => f.path === 'packages/general.yaml');
    expect(general?.content).toContain('zone.home: ubicación de Home Assistant (Ajustes → Sistema → General): latitud 37.3891, longitud -5.9845.');
    expect(general?.content).toContain('zone:\n  - name: Trabajo\n    latitude: 37.3891\n    longitude: -5.9845\n    radius: 100\n    icon: "mdi:briefcase"');
    expect(general?.content).not.toMatch(/\bplatform: (state|zone)\b/);
  });
});

describe('proyecto de ejemplo', () => {
  it('incluye lo de las dos fases y pasa el validador sin errores', () => {
    const p = createDemoProject();
    expect(p.settings).toBeDefined();
    expect(p.devices.some((d) => d.ups)).toBe(true);
    expect(p.devices.some((d) => d.loadWatts !== undefined)).toBe(true);
    expect(p.people?.length).toBe(2);
    expect(p.groups?.length).toBe(1);
    expect(p.automations.some((a) => a.actions.some((x) => x.type === 'choose'))).toBe(true);
    expect(p.automations.some((a) => a.actions.some((x) => x.type === 'service' && x.service === 'notify.persistent_notification'))).toBe(true);
    expect(validateProject(p, catalog).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
