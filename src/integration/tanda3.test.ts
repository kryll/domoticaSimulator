// Tanda 3: YAML de ida y vuelta, esquema del proyecto, validador, packages, dashboard,
// dispositivos personalizados, alarma y válvulas.
import { describe, expect, it } from 'vitest';
import { allDefinitions, catalog, cloneDefinition, getDefinition, validateDefinition } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { automationToYaml } from '../export/yaml';
import { parseAutomationYamlDetailed } from '../automations/yaml-parse';
import { parseProject } from '../store/projectSchema';
import { validateProject } from '../network/validator';
import { projectToPackages } from '../export/packages';
import { generateDashboard } from '../dashboard/lovelace';
import { collectEntityRefs, renameEntityRefs, renameHelperMapping } from '../devices/renaming';
import { createDemoProject } from '../store/demoProject';
import { createSimulationState, callService } from '../simulation/engine';
import { deviceView, primaryAction } from '../devices/presentation';
import { servicesForDomain, isKnownService } from '../simulation/serviceCatalog';
import { createFromTemplate, HOUSE_TEMPLATES } from '../store/houseTemplates';
import type { Automation, DeviceDefinition, Project } from '../types';

const T0 = Date.UTC(2026, 9, 12, 12);

const complete: Automation = {
  id: 'a1',
  name: 'Todo lo nuevo',
  enabled: true,
  mode: 'parallel',
  triggers: [
    { type: 'time_pattern', minutes: '/5' },
    { type: 'time_pattern', hours: '7', minutes: '30', id: 'manana' },
    { type: 'homeassistant', event: 'start' },
    { type: 'event', eventType: 'timer.finished', eventData: { entity_id: 'timer.riego' } },
    { type: 'numeric_state', entityId: 'sensor.t', above: 26, for: 600 },
    { type: 'state', entityId: 'light.a', to: 'on', enabled: false },
  ],
  conditions: [
    { type: 'time', after: '08:00', weekday: ['sat', 'sun'] },
    { type: 'time', weekday: ['mon'], enabled: false },
  ],
  actions: [
    { type: 'parallel', branches: [[{ type: 'service', service: 'light.turn_on', entityId: 'light.a' }], [{ type: 'delay', seconds: 5 }, { type: 'service', service: 'light.turn_off', entityId: 'light.b' }]] },
    { type: 'service', service: 'climate.turn_off', entityId: 'climate.x', continueOnError: true },
    { type: 'service', service: 'light.toggle', entityId: 'light.c', enabled: false },
    { type: 'stop', message: 'Fin', error: true },
  ],
};

describe('YAML de HA de ida y vuelta (Tanda 3)', () => {
  it('exporta con la sintaxis de HA y vuelve igual, sin avisos', () => {
    const yaml = automationToYaml(complete);
    expect(yaml).toContain('trigger: time_pattern\n    minutes: /5');
    expect(yaml).toContain('hours: 7');
    expect(yaml).toContain('trigger: homeassistant\n    event: start');
    expect(yaml).toContain('event_type: timer.finished');
    expect(yaml).toContain('for: "00:10:00"');
    expect(yaml).toContain('weekday:\n      - sat\n      - sun');
    expect(yaml).toContain('parallel:');
    expect(yaml).toContain('continue_on_error: true');
    expect(yaml).toContain('stop: Fin\n    error: true');
    expect(yaml).toContain('enabled: false');
    const back = parseAutomationYamlDetailed(yaml);
    expect(back.warnings).toEqual([]);
    expect(back.automation).toEqual(complete);
  });

  it('una rama de parallel con varias acciones usa sequence', () => {
    const yaml = automationToYaml(complete);
    expect(yaml).toContain('- sequence:');
  });

  it('errores en español para valores no válidos', () => {
    expect(() => parseAutomationYamlDetailed('triggers:\n  - trigger: time_pattern\n    minutes: cada5\nactions: []\n')).toThrow('usa un número, * o /5');
    expect(() => parseAutomationYamlDetailed('triggers:\n  - trigger: homeassistant\n    event: reboot\nactions: []\n')).toThrow('start o shutdown');
    expect(() => parseAutomationYamlDetailed('triggers:\n  - trigger: time\n    at: "07:00"\nconditions:\n  - condition: time\n    weekday: lunes\nactions: []\n')).toThrow('Día no válido');
  });
});

describe('esquema del proyecto', () => {
  it('admite helpers, definiciones personalizadas y los tipos nuevos', () => {
    const custom = cloneDefinition(getDefinition('shelly-plug-s-gen3') as DeviceDefinition, { name: 'Mi enchufe' });
    const p = project([dev('x', 'shelly-plug-s-gen3')], {
      automations: [complete],
      helpers: [
        { id: 'h', type: 'timer', name: 'Riego', duration: 60 },
        { id: 'n', type: 'input_number', name: 'N', min: 0, max: 10, step: 1, mode: 'box', icon: 'mdi:numeric' },
      ],
      customDefinitions: [custom],
    });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back.automations[0]).toEqual(complete);
    expect(back.helpers).toEqual(p.helpers);
    expect(back.customDefinitions?.[0]?.id).toBe('custom:shelly-plug-s-gen3-copia');
    expect(() => parseProject({ ...JSON.parse(JSON.stringify(p)), customDefinitions: [{ ...custom, id: 'sin-prefijo' }] })).toThrow('custom:');
    expect(() => parseProject({ ...JSON.parse(JSON.stringify(p)), helpers: [{ id: 'z', type: 'input_number', name: 'N', min: 5, max: 1, step: 1, mode: 'box' }] })).toThrow('menor que max');
  });
});

describe('dispositivos personalizados', () => {
  const base = getDefinition('aqara-temp-hum') as DeviceDefinition;

  it('cloneDefinition y validateDefinition', () => {
    const c = cloneDefinition(base, { id: 'Mi sensor', name: 'Sensor propio' });
    expect(c.id).toBe('custom:mi-sensor');
    expect(c.entities).toEqual(base.entities);
    expect(c.entities).not.toBe(base.entities);
    expect(validateDefinition(c)).toEqual([]);
    expect(validateDefinition({ ...c, id: 'aqara-temp-hum' })).toEqual(expect.arrayContaining(['El id «aqara-temp-hum» debe empezar por «custom:»', 'El id «aqara-temp-hum» ya existe en el catálogo']));
    expect(validateDefinition({ ...c, entities: [] })).toContain('El dispositivo necesita al menos una entidad');
    expect(validateDefinition({ ...c, entities: [{ key: 'X Y', domain: 'sensor', name: 'Mal', initialState: 1 }] })[0]).toMatch(/^Definición no válida/);
  });

  it('allDefinitions suma los personalizados y todo el proyecto los usa', () => {
    const c = cloneDefinition(base, { name: 'Sensor propio' });
    const p: Project = project([dev('srv', 'ha-green'), dev('r', 'tplink-deco-x50'), dev('z', 'sonoff-zbdongle-p'), { ...dev('s', 'aqara-temp-hum', undefined, { name: 'Propio', integration: 'zha' }), definitionId: c.id }], {
      customDefinitions: [c],
      automations: [{ id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'numeric_state', entityId: 'sensor.propio_temperature', above: 30 }], conditions: [], actions: [] }],
    });
    expect(allDefinitions(p)).toHaveLength(catalog.length + 1);
    expect(allDefinitions(p)).toBe(allDefinitions(p));
    expect(allDefinitions({})).toBe(catalog);
    const issues = validateProject(p, catalog);
    expect(issues.filter((i) => i.code === 'definicion-desconocida' || i.code === 'entidad-desconocida')).toEqual([]);
    expect(createSimulationState(p, catalog, T0).entities['sensor.propio_temperature']?.state).toBe(21.5);
    expect(generateDashboard(p, catalog).views[0]?.sections.flatMap((s) => s.cards).some((c2) => c2.type === 'entities')).toBe(true);
  });
});

describe('validador, renombrado, packages y dashboard con helpers', () => {
  it('la demo y las plantillas de casa pasan el validador sin errores', () => {
    const demo = createDemoProject();
    expect(validateProject(demo, catalog).filter((i) => i.severity === 'error')).toEqual([]);
    for (const t of HOUSE_TEMPLATES) {
      const p = createFromTemplate(t.id);
      expect(validateProject(p, catalog).filter((i) => i.severity === 'error'), t.name).toEqual([]);
    }
  });

  it('avisa de helpers mal configurados, duplicados, patrones y opciones que no existen', () => {
    const p = project([], {
      helpers: [
        { id: 'a', type: 'input_select', name: 'Modo', options: ['A', 'B'] },
        { id: 'b', type: 'input_boolean', name: 'Modo' },
        { id: 'c', type: 'input_boolean', name: 'modo!' },
        { id: 'd', type: 'counter', name: 'Mal', initial: 5, step: 1, maximum: 2 },
      ],
      automations: [
        {
          id: 'x',
          name: 'X',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'time_pattern', minutes: '/75' }],
          conditions: [],
          actions: [{ type: 'service', service: 'input_select.select_option', entityId: 'input_select.modo', data: { option: 'C' } }],
        },
      ],
    });
    const codes = validateProject(p, catalog).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['helper-no-valido', 'helper-duplicado', 'patron-hora-no-valido', 'opcion-no-valida']));
    expect(codes).not.toContain('entidad-desconocida');
  });

  it('renombrar un helper actualiza las referencias (también las de event_data)', () => {
    const demo = createDemoProject();
    const mapping = renameHelperMapping(demo, 'demo-helper-cafetera', 'Café');
    expect(mapping).toEqual({ 'timer.cafetera': 'timer.cafe' });
    const renamed = renameEntityRefs(demo, mapping);
    const refs = collectEntityRefs(renamed).map((r) => r.entityId);
    expect(refs).toContain('timer.cafe');
    expect(refs).not.toContain('timer.cafetera');
  });

  it('packages exporta la configuración de los helpers y el dashboard sus tarjetas', () => {
    const demo = createDemoProject();
    const general = projectToPackages(demo, catalog).find((f) => f.path === 'packages/general.yaml')?.content ?? '';
    expect(general).toContain('input_boolean:\n  modo_vacaciones:\n    name: Modo vacaciones\n    icon: "mdi:palm-tree"');
    expect(general).toContain('timer:\n  cafetera:\n    name: Cafetera');
    expect(general).toContain('duration: "0:20:00"');
    const cards = generateDashboard(demo, catalog).views[0]?.sections.find((s) => s.cards[0]?.type === 'heading' && s.cards[0].heading === 'Ayudantes')?.cards;
    expect(cards).toEqual([
      { type: 'heading', heading: 'Ayudantes' },
      { type: 'tile', entity: 'input_boolean.modo_vacaciones' },
      { type: 'tile', entity: 'timer.cafetera' },
    ]);
  });
});

describe('alarma (alarm_control_panel), válvulas y sirenas', () => {
  const p = project([
    { ...dev('m3', 'aqara-hub-m3', undefined, { name: 'Hub' }), alarmCode: '0000' },
    dev('v', 'sonoff-swv', undefined, { name: 'Valvula' }),
    dev('g', 'shelly-1-garage', undefined, { name: 'Garaje' }),
    dev('ac', 'daikin-onecta-perfera', undefined, { name: 'Aire' }),
  ]);

  it('arma y desarma con su código; disparar pasa a triggered', () => {
    let sim = createSimulationState(p, catalog, T0);
    expect(sim.entities['alarm_control_panel.hub_alarm']?.state).toBe('disarmed');
    sim = callService(sim, p, 'alarm_control_panel.hub_alarm', 'alarm_control_panel.alarm_arm_away');
    expect(sim.entities['alarm_control_panel.hub_alarm']?.state).toBe('armed_away');
    sim = callService(sim, p, 'alarm_control_panel.hub_alarm', 'alarm_control_panel.alarm_disarm', { code: '1234' });
    expect(sim.entities['alarm_control_panel.hub_alarm']?.state).toBe('armed_away');
    expect(sim.log.some((l) => l.message.includes('Código incorrecto'))).toBe(true);
    sim = callService(sim, p, 'alarm_control_panel.hub_alarm', 'alarm_control_panel.alarm_trigger');
    expect(sim.entities['alarm_control_panel.hub_alarm']?.state).toBe('triggered');
    const device = p.devices[0];
    const def = getDefinition('aqara-hub-m3') as DeviceDefinition;
    expect(device && deviceView(device, def, sim)).toMatchObject({ kind: 'alarm', active: true, summary: 'Disparada' });
    const action = device ? primaryAction(device, def, sim) : null;
    expect(action).toMatchObject({ service: 'alarm_control_panel.alarm_disarm', data: { code: '0000' } });
    sim = callService(sim, p, 'alarm_control_panel.hub_alarm', 'alarm_control_panel.alarm_disarm', { code: '0000' });
    expect(sim.entities['alarm_control_panel.hub_alarm']?.state).toBe('disarmed');
    sim = callService(sim, p, 'siren.hub_siren', 'siren.turn_on');
    expect(sim.entities['siren.hub_siren']?.state).toBe('on');
  });

  it('válvula, garaje y aire acondicionado', () => {
    let sim = createSimulationState(p, catalog, T0);
    sim = callService(sim, p, 'valve.valvula_valve', 'valve.close_valve');
    expect(sim.entities['valve.valvula_valve']?.state).toBe('closed');
    sim = callService(sim, p, 'valve.valvula_valve', 'homeassistant.turn_on');
    expect(sim.entities['valve.valvula_valve']?.state).toBe('open');
    expect(sim.entities['cover.garaje_garage']?.attributes?.device_class).toBe('garage');
    sim = callService(sim, p, 'climate.aire_climate', 'climate.set_hvac_mode', { hvac_mode: 'dry' });
    expect(sim.entities['climate.aire_climate']?.attributes?.hvac_action).toBe('drying');
    sim = callService(sim, p, 'climate.aire_climate', 'climate.set_fan_mode', { fan_mode: 'high' });
    expect(sim.entities['climate.aire_climate']?.attributes?.fan_mode).toBe('high');
    expect(servicesForDomain('alarm_control_panel').map((s) => s.service)).toEqual([
      'alarm_control_panel.alarm_arm_home',
      'alarm_control_panel.alarm_arm_away',
      'alarm_control_panel.alarm_arm_night',
      'alarm_control_panel.alarm_disarm',
      'alarm_control_panel.alarm_trigger',
    ]);
    expect(isKnownService('valve.open_valve')).toBe(true);
    expect(isKnownService('timer.start')).toBe(true);
    expect(isKnownService('counter.increment')).toBe(true);
  });
});
