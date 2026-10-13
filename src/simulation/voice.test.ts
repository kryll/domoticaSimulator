import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import type { Device, Project, Room } from '../types';
import { callService, createSimulationState, runActions, tick } from './engine';
import { setFailures } from './availability';
import { alexaNotifyService, alexaNotifyTargets, cloudVoiceInUse, exposeRoom, speechSeconds, toggleExposure } from './voice';
import { validateProject } from '../network/validator';
import { buildQuote, NABU_CASA_YEAR_EUR } from '../report/quote';
import { automationsToYaml } from '../export/yaml';
import { parseAutomationsYaml } from '../automations/yaml-parse';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);
const room = (id: string, name: string): Room => ({ id, floorId: 'f0', name, polygon: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }] });
const inRoom = (d: Device, roomId: string, extra: Partial<Device> = {}): Device => ({ ...d, roomId, ...extra });

function home(): Project {
  return project(
    [
      inRoom(dev('srv', 'ha-green'), 'salon'),
      inRoom(dev('luz', 'hue-white-e27', undefined, { name: 'Luz salón', integration: 'zha', protocol: 'zigbee' }), 'salon'),
      inRoom(dev('voz', 'ha-voice-pe', undefined, { name: 'Voz cocina' }), 'salon'),
      inRoom(dev('echo', 'amazon-echo-dot-5', undefined, { name: 'Echo dormitorio' }), 'salon'),
      inRoom(dev('nest', 'google-nest-audio', undefined, { name: 'Nest' }), 'salon'),
    ],
    { rooms: [room('salon', 'Salón')] },
  );
}

describe('exposición a los asistentes', () => {
  it('Assist por defecto; alternar y exponer toda una sala', () => {
    expect(toggleExposure({}, 'alexa', true)).toEqual(['assist', 'alexa']);
    expect(toggleExposure({ exposedTo: ['assist', 'alexa'] }, 'assist', false)).toEqual(['alexa']);
    const p = home();
    expect(exposeRoom(p, catalog, 'salon', 'google')).toEqual([['luz', ['assist', 'google']]]);
  });

  it('Home Assistant Cloud: solo si hay un altavoz de la marca y algo expuesto; línea opcional del presupuesto', () => {
    const p = home();
    expect(cloudVoiceInUse(p, catalog)).toEqual([]);
    const exposed = { ...p, devices: p.devices.map((d) => (d.id === 'luz' ? { ...d, exposedTo: ['assist' as const, 'alexa' as const] } : d)) };
    expect(cloudVoiceInUse(exposed, catalog)).toEqual(['alexa']);
    const q = buildQuote(exposed, catalog);
    expect(q.optionalLines).toHaveLength(1);
    expect(q.optionalLines[0]).toMatchObject({ optional: true, total: NABU_CASA_YEAR_EUR });
    expect(q.total).toBe(buildQuote(p, catalog).total);
    expect(buildQuote({ ...exposed, voiceLinks: { alexa: 'manual' } }, catalog).optionalLines).toEqual([]);
  });
});

describe('anuncios desde HA', () => {
  it('notify.alexa_media_<echo> dice el mensaje en el Echo (burbuja y registro); sin Internet falla', () => {
    const p = home();
    expect(alexaNotifyService({ name: 'Echo dormitorio' })).toBe('notify.alexa_media_echo_dormitorio');
    expect(alexaNotifyTargets(p, catalog, 'notify.alexa_media', { target: 'media_player.echo_dormitorio_media' }).map((d) => d.id)).toEqual(['echo']);
    const sim = callService(createSimulationState(p, catalog, T0), p, '', 'notify.alexa_media_echo_dormitorio', { message: 'Hola' });
    expect(sim.speech?.echo).toMatchObject({ text: 'Hola', kind: 'announce' });
    const off = setFailures(createSimulationState(p, catalog, T0), p, catalog, { internet: true });
    const failed = callService(off, p, '', 'notify.alexa_media_echo_dormitorio', { message: 'Hola' });
    expect(failed.speech?.echo).toBeUndefined();
    expect(failed.log.at(-1)?.level).toBe('error');
  });

  it('tts.speak con Piper funciona sin Internet; Google Translate no', () => {
    const p = home();
    const off = setFailures(createSimulationState(p, catalog, T0), p, catalog, { internet: true });
    const local = callService(off, p, 'tts.piper', 'tts.speak', { media_player_entity_id: 'media_player.nest', message: 'Fuga' });
    expect(local.speech?.nest?.text).toBe('Fuga');
    const cloud = callService(off, p, 'tts.google_translate_es_es', 'tts.speak', { media_player_entity_id: 'media_player.nest', message: 'Fuga' });
    expect(cloud.speech?.nest).toBeUndefined();
  });

  it('assist_satellite.announce: responding y vuelve a idle; start_conversation queda escuchando', () => {
    const p = home();
    const id = 'assist_satellite.voz_cocina_satellite';
    let sim = callService(createSimulationState(p, catalog, T0), p, id, 'assist_satellite.announce', { message: 'La lavadora ha terminado' });
    expect(sim.entities[id]?.state).toBe('responding');
    expect(sim.speech?.voz?.text).toBe('La lavadora ha terminado');
    sim = tick(sim, p, (speechSeconds('La lavadora ha terminado') + 1) * 1000);
    expect(sim.entities[id]?.state).toBe('idle');
    sim = callService(sim, p, id, 'assist_satellite.start_conversation', { start_message: '¿Cierro la persiana?' });
    sim = tick(sim, p, 4000);
    expect(sim.entities[id]?.state).toBe('listening');
    sim = tick(sim, p, 10_000);
    expect(sim.entities[id]?.state).toBe('idle');
    expect(runActions(sim, p, [{ type: 'notify', service: 'notify.alexa_media_echo_dormitorio', message: 'Hola' }]).speech?.echo?.text).toBe('Hola');
  });
});

describe('validador y YAML', () => {
  it('robot sin sala, salas del mapa que no existen y asistentes de nube', () => {
    const p = project([dev('srv', 'ha-green'), dev('r', 'roborock-q7-max', undefined, { name: 'Robot' }), dev('e', 'amazon-echo-pop')], { rooms: [] });
    const withMap = { ...p, devices: p.devices.map((d) => (d.id === 'r' ? { ...d, vacuumRooms: ['nada'] } : d)) };
    const codes = validateProject(withMap, catalog).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(expect.arrayContaining(['warning:robot-sin-sala', 'error:segmento-sala-desconocida', 'info:asistente-voz-nube']));
  });

  it('el disparador conversation va y vuelve por YAML', () => {
    const p = project([], {
      automations: [{ id: 'a', name: 'Noche', enabled: true, mode: 'single', triggers: [{ type: 'conversation', command: ['[oye] buenas noches', '(me voy|salgo) a dormir'] }], conditions: [], actions: [] }],
    });
    const yaml = automationsToYaml(p);
    expect(yaml).toContain('trigger: conversation');
    expect(yaml).toContain('command:');
    expect(parseAutomationsYaml(yaml, p)[0]?.triggers[0]).toEqual({ type: 'conversation', command: ['[oye] buenas noches', '(me voy|salgo) a dormir'] });
  });
});
