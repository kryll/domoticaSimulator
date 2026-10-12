// Efecto de los servicios de Home Assistant sobre una entidad (función pura).
import type { EntityState, EntityStateValue } from '../types';

type Data = Record<string, EntityStateValue>;

function withState(current: EntityState, state: EntityStateValue, attrs: Data = {}): EntityState {
  return { state, attributes: { ...current.attributes, ...attrs } };
}

function isOff(state: EntityStateValue): boolean {
  return state === 'off' || state === false || state === 'closed' || state === 'idle' || state === 'docked';
}

function onOff(domain: string, service: string, current: EntityState, data: Data): EntityState | undefined {
  const onState = domain === 'climate' ? 'heat' : 'on';
  if (service === 'turn_on') return withState(current, onState, data);
  if (service === 'turn_off') return withState(current, 'off');
  if (service === 'toggle') return isOff(current.state) ? withState(current, onState, data) : withState(current, 'off');
  return undefined;
}

function coverService(service: string, current: EntityState, data: Data): EntityState | undefined {
  switch (service) {
    case 'open_cover':
    case 'open':
      return withState(current, 'open', { current_position: 100 });
    case 'close_cover':
    case 'close':
      return withState(current, 'closed', { current_position: 0 });
    case 'stop_cover':
      return withState(current, current.state);
    case 'toggle':
      return current.state === 'closed' ? coverService('open_cover', current, data) : coverService('close_cover', current, data);
    case 'set_cover_position': {
      const pos = Number(data.position ?? 0);
      return withState(current, pos > 0 ? 'open' : 'closed', { current_position: pos });
    }
    default:
      return undefined;
  }
}

function lockService(service: string, current: EntityState): EntityState | undefined {
  if (service === 'lock') return withState(current, 'locked');
  if (service === 'unlock') return withState(current, 'unlocked');
  if (service === 'open') return withState(current, 'open');
  return undefined;
}

function climateService(service: string, current: EntityState, data: Data): EntityState | undefined {
  if (service === 'set_temperature') {
    const attrs: Data = {};
    if (data.temperature !== undefined) attrs.temperature = data.temperature;
    return withState(current, data.hvac_mode ?? current.state, attrs);
  }
  if (service === 'set_hvac_mode') return withState(current, data.hvac_mode ?? current.state);
  return onOff('climate', service, current, {});
}

const MEDIA_STATES: Record<string, EntityStateValue> = {
  media_play: 'playing',
  media_pause: 'paused',
  media_stop: 'idle',
};

function mediaService(service: string, current: EntityState, data: Data): EntityState | undefined {
  const target = MEDIA_STATES[service];
  if (target !== undefined) return withState(current, target);
  if (service === 'media_play_pause') return withState(current, current.state === 'playing' ? 'paused' : 'playing');
  if (service === 'volume_set') return withState(current, current.state, { volume_level: data.volume_level ?? 0 });
  if (service === 'volume_mute') return withState(current, current.state, { is_volume_muted: data.is_volume_muted ?? true });
  if (service === 'play_media') return withState(current, 'playing', data);
  return onOff('media_player', service, current, data);
}

const VACUUM_STATES: Record<string, EntityStateValue> = {
  start: 'cleaning',
  pause: 'paused',
  stop: 'idle',
  return_to_base: 'docked',
};

function vacuumService(service: string, current: EntityState): EntityState | undefined {
  const target = VACUUM_STATES[service];
  return target === undefined ? undefined : withState(current, target);
}

/**
 * Nuevo estado tras llamar a `domain.service` sobre una entidad del dominio entityDomain,
 * o undefined si el servicio no está soportado.
 */
export function applyService(
  entityDomain: string,
  service: string,
  current: EntityState,
  data: Data = {},
  now = 0,
): EntityState | undefined {
  switch (entityDomain) {
    case 'light':
    case 'switch':
    case 'fan':
      return onOff(entityDomain, service, current, data);
    case 'cover':
      return coverService(service, current, data);
    case 'lock':
      return lockService(service, current);
    case 'climate':
      return climateService(service, current, data);
    case 'media_player':
      return mediaService(service, current, data);
    case 'vacuum':
      return vacuumService(service, current);
    case 'button':
      return service === 'press' ? withState(current, new Date(now).toISOString()) : undefined;
    default:
      return undefined;
  }
}
