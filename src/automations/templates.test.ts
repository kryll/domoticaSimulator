import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { createSimulationState, tick } from '../simulation/engine';
import { motionPulse, openDoor, setLeak } from '../simulation/events';
import { HOUR_MS } from '../simulation/clock';
import type { Automation, Project } from '../types';
import {
  AUTOMATION_TEMPLATES,
  buildTemplate,
  defaultTemplateValues,
  findTemplate,
  isTemplateApplicable,
  validateTemplate,
  missingTemplateInputs,
  suggestTemplates,
  templateCandidates,
  type AutomationTemplate,
  type EntityInput,
} from './templates';

const demo: Project = createDemoProject();
const T = (id: string): AutomationTemplate => {
  const t = findTemplate(id);
  if (!t) throw new Error(id);
  return t;
};
const withAutos = (autos: Omit<Automation, 'id'>[]): Project => ({ ...demo, automations: autos.map((a, i) => ({ ...a, id: `t${i}` })) });

describe('plantillas de automatización (B7)', () => {
  it('incluye las plantillas mínimas, con entradas tipadas y textos en español', () => {
    expect(AUTOMATION_TEMPLATES.map((t) => t.id)).toEqual([
      'motion_light',
      'door_left_open',
      'water_leak',
      'leave_home',
      'covers_sun',
      'thermostat_schedule',
      'presence_simulation',
      'night_light',
      'low_battery',
    ]);
    for (const t of AUTOMATION_TEMPLATES) {
      expect(t.name).not.toMatch(/[A-Z][a-z]+ [A-Z]/);
      for (const input of t.inputs) if (input.kind !== 'entity') expect(input.default).not.toBe('');
    }
  });

  it('candidatas por dominio y clase', () => {
    const motion = T('motion_light').inputs[0] as EntityInput;
    expect(templateCandidates(demo, catalog, motion).sort()).toEqual(['binary_sensor.camara_entrada_motion', 'binary_sensor.movimiento_pasillo_motion']);
    const remote = T('leave_home').inputs[0] as EntityInput;
    expect(templateCandidates(demo, catalog, remote)).toEqual(['sensor.mando_salon_action']);
  });

  it('luz por movimiento: restart, encender, esperar y apagar; funciona en la simulación', () => {
    const [a] = buildTemplate(T('motion_light'), { motion: 'binary_sensor.movimiento_pasillo_motion', light: 'light.luz_pasillo', off_after: 300 }, demo);
    expect(a).toMatchObject({
      name: 'Luz pasillo con movimiento',
      mode: 'restart',
      triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'on' }],
      actions: [{ service: 'light.turn_on' }, { type: 'delay', seconds: 300 }, { service: 'light.turn_off' }],
    });
    const p = withAutos([a!]);
    let sim = motionPulse(createSimulationState(p, catalog, Date.UTC(2026, 0, 1, 12)), p, 'binary_sensor.movimiento_pasillo_motion');
    expect(sim.entities['light.luz_pasillo']?.state).toBe('on');
    sim = tick(sim, p, 301_000);
    expect(sim.entities['light.luz_pasillo']?.state).toBe('off');
  });

  it('puerta abierta con for y aviso por altavoz', () => {
    const [a] = buildTemplate(T('door_left_open'), { door: 'binary_sensor.puerta_entrada_door', duration: 600, notifier: 'media_player.altavoz_salon' }, demo);
    expect(a?.triggers).toEqual([{ type: 'state', entityId: 'binary_sensor.puerta_entrada_door', to: 'on', for: 600 }]);
    expect(a?.actions[0]).toMatchObject({ service: 'notify.persistent_notification', entityId: '', data: { title: 'Puerta abierta' } });
    expect(a?.actions[1]).toMatchObject({ service: 'media_player.play_media', entityId: 'media_player.altavoz_salon' });
    const [plain] = buildTemplate(T('door_left_open'), { door: 'binary_sensor.puerta_entrada_door' }, demo);
    expect(plain?.actions).toHaveLength(1);
    const p = withAutos([plain!]);
    let sim = createSimulationState(p, catalog, 0);
    sim = tick(openDoor(sim, p, 'binary_sensor.puerta_entrada_door'), p, 301_000);
    const note = sim.log.find((l) => l.notification);
    expect(note).toMatchObject({ level: 'info', message: 'Notificación: Puerta abierta — Puerta entrada Puerta lleva tiempo abierta', notification: { title: 'Puerta abierta' } });
  });

  it('fuga de agua: corta el enchufe y avisa con una luz', () => {
    const [a] = buildTemplate(T('water_leak'), { leak: 'binary_sensor.fuga_bano_leak', shutoff: 'switch.enchufe_bano_switch', notifier: 'light.luz_pasillo' }, demo);
    const p = withAutos([a!]);
    let sim = createSimulationState(p, catalog, 0);
    sim = setLeak({ ...sim, entities: { ...sim.entities, 'switch.enchufe_bano_switch': { state: 'on' } } }, p, 'binary_sensor.fuga_bano_leak');
    expect(sim.entities['switch.enchufe_bano_switch']?.state).toBe('off');
    expect(sim.entities['light.luz_pasillo']?.state).toBe('on');
  });

  it('apagarlo todo: mando y hora; luces, multimedia, cerraduras y termostato', () => {
    const [a] = buildTemplate(T('leave_home'), { remote: 'sensor.mando_salon_action', time: '08:45' }, demo);
    expect(a?.triggers).toEqual([
      { type: 'state', entityId: 'sensor.mando_salon_action', to: 'single' },
      { type: 'time', at: '08:45' },
    ]);
    const services = a?.actions.map((x) => (x.type === 'service' ? `${x.service} ${x.entityId}` : x.type)) ?? [];
    expect(services).toContain('light.turn_off light.luz_salon');
    expect(services).toContain('media_player.turn_off media_player.televisor');
    expect(services).toContain('lock.lock lock.cerradura_entrada_lock');
    expect(services).toContain('switch.turn_off switch.luz_cocina_switch');
    expect(services).not.toContain('switch.turn_off switch.cafetera');
    expect(a?.actions.find((x) => x.type === 'service' && x.service === 'climate.set_temperature')).toMatchObject({ data: { temperature: 17 } });
    const [onlyTime] = buildTemplate(T('leave_home'), {}, demo);
    expect(onlyTime?.triggers).toEqual([{ type: 'time', at: '09:00' }]);
  });

  it('persianas al amanecer y al atardecer con desplazamiento', () => {
    const all = buildTemplate(T('covers_sun'), { cover: 'cover.persiana_dormitorio_cover', sunrise_offset: 30, sunset_offset: -15 }, demo);
    expect(all.map((a) => a.triggers[0])).toEqual([
      { type: 'sun', event: 'sunrise', offsetMinutes: 30 },
      { type: 'sun', event: 'sunset', offsetMinutes: -15 },
    ]);
    expect(all.map((a) => (a.actions[0]?.type === 'service' ? a.actions[0].service : ''))).toEqual(['cover.open_cover', 'cover.close_cover']);
    expect(T('covers_sun').build({ cover: 'cover.x', sunrise_offset: 0, sunset_offset: 0 }, demo).name).toBe('Bajar cover.x al atardecer');
  });

  it('termostato por horario: dos automatizaciones con su consigna', () => {
    const all = buildTemplate(T('thermostat_schedule'), { climate: 'climate.termostato_climate', comfort: 21.5 }, demo);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ triggers: [{ type: 'time', at: '07:00' }], actions: [{ data: { temperature: 21.5 } }] });
    expect(all[1]).toMatchObject({ triggers: [{ type: 'time', at: '23:00' }], actions: [{ data: { temperature: 17 } }] });
  });

  it('simulación de presencia y luz nocturna entre horas', () => {
    const [presence] = buildTemplate(T('presence_simulation'), { light: 'light.luz_salon' }, demo);
    expect(presence).toMatchObject({ triggers: [{ type: 'time', at: '20:30' }], actions: [{ service: 'light.turn_on' }, { type: 'delay', seconds: 9000 }, { service: 'light.turn_off' }] });
    const [night] = buildTemplate(T('night_light'), { motion: 'binary_sensor.movimiento_pasillo_motion', light: 'light.luz_pasillo', brightness: 5 }, demo);
    expect(night?.conditions).toEqual([{ type: 'time', after: '23:00', before: '07:00' }]);
    expect(night?.actions[0]).toMatchObject({ data: { brightness_pct: 5 } });
    const p = withAutos([night!]);
    const at2 = motionPulse(createSimulationState(p, catalog, Date.UTC(2026, 0, 1, 2)), p, 'binary_sensor.movimiento_pasillo_motion');
    expect(at2.entities['light.luz_pasillo']?.attributes?.brightness).toBe(13);
    const atNoon = motionPulse(createSimulationState(p, catalog, Date.UTC(2026, 0, 1, 12)), p, 'binary_sensor.movimiento_pasillo_motion');
    expect(atNoon.entities['light.luz_pasillo']?.state).toBe('off');
  });

  it('batería baja: una o todas las baterías', () => {
    const [one] = buildTemplate(T('low_battery'), { battery: 'sensor.fuga_bano_battery', threshold: 15 }, demo);
    expect(one?.triggers).toEqual([{ type: 'numeric_state', entityId: 'sensor.fuga_bano_battery', below: 15 }]);
    const [all] = buildTemplate(T('low_battery'), {}, demo);
    expect(all?.triggers.length).toBeGreaterThan(3);
    expect(all?.name).toBe('Batería baja en algún dispositivo');
    const p = withAutos([one!]);
    const sim = tick({ ...createSimulationState(p, catalog, 0), batteries: { 'demo-fuga-bano': 15.2 } }, p, HOUR_MS * 24 * 30);
    expect(sim.log.some((l) => l.message.startsWith('Automatización «Batería baja: Fuga baño Batería» disparada'))).toBe(true);
  });

  it('no deja crear automatizaciones sin disparadores; isTemplateApplicable y suggestTemplates solo las aplicables', () => {
    const noBatteries: Project = { ...demo, devices: demo.devices.filter((d) => d.id === 'demo-luz-salon' || d.id === 'demo-altavoz') };
    expect(missingTemplateInputs(T('low_battery'), {}, noBatteries)).toEqual(['La automatización no tendría ningún disparador (no hay entidades que encajen)']);
    expect(validateTemplate(T('low_battery'), {}, demo)).toEqual([]);
    expect(isTemplateApplicable(T('low_battery'), noBatteries, catalog)).toBe(false);
    expect(isTemplateApplicable(T('low_battery'), demo, catalog)).toBe(true);
    expect(isTemplateApplicable(T('motion_light'), noBatteries, catalog)).toBe(false);
    for (const s of suggestTemplates(noBatteries, catalog)) expect(isTemplateApplicable(T(s.templateId), noBatteries, catalog)).toBe(true);
    expect(suggestTemplates(noBatteries, catalog).map((s) => s.templateId)).toEqual(['leave_home', 'presence_simulation']);
  });

  it('entradas obligatorias y valores por defecto', () => {
    expect(missingTemplateInputs(T('motion_light'), defaultTemplateValues(T('motion_light')))).toEqual(['Falta «Sensor de movimiento»', 'Falta «Luz»']);
    expect(missingTemplateInputs(T('low_battery'), defaultTemplateValues(T('low_battery')))).toEqual([]);
  });

  it('suggestTemplates propone las que encajan con el proyecto, con entidades de la misma sala', () => {
    const suggestions = suggestTemplates(demo, catalog);
    expect(suggestions.map((s) => s.templateId)).toEqual(AUTOMATION_TEMPLATES.map((t) => t.id));
    const motion = suggestions.find((s) => s.templateId === 'motion_light');
    expect(motion?.values).toMatchObject({ motion: 'binary_sensor.movimiento_pasillo_motion', light: 'light.luz_pasillo' });
    expect(motion?.reason).toBe('Tienes Movimiento pasillo Movimiento y Luz pasillo en Pasillo');
    const empty: Project = { ...demo, devices: demo.devices.filter((d) => d.id === 'demo-luz-salon') };
    expect(suggestTemplates(empty, catalog).map((s) => s.templateId)).toEqual(['leave_home', 'presence_simulation']);
  });
});
