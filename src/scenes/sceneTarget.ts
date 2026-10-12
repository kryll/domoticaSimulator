// Edición del estado objetivo de una entidad dentro de una escena (función pura).
import type { EntityCapabilities, EntityState, ServiceData } from '../types';
import { applyService } from '../simulation/services';
import { entityDomain } from '../devices/entities';
import { sceneEntityState } from '../simulation/scenes';

/**
 * Nuevo estado objetivo de la escena tras usar un control: aplica el servicio al objetivo actual
 * y lo lleva a su estado final (una persiana que «abre» queda abierta en la posición pedida).
 */
export function sceneTargetAfterService(
  entityId: string,
  current: EntityState,
  service: string,
  data: ServiceData = {},
  capabilities?: EntityCapabilities,
): EntityState {
  const domain = entityDomain(entityId);
  const short = service.includes('.') ? service.slice(service.indexOf('.') + 1) : service;
  const res = applyService(domain, short, current, data, { now: 0, ...(capabilities ? { capabilities } : {}) });
  if (!res) return current;
  let { state } = res.state;
  const attributes = { ...res.state.attributes };
  if (res.coverTarget !== undefined) {
    attributes.current_position = res.coverTarget;
    state = res.coverTarget > 0 ? 'open' : 'closed';
  }
  // Solo el estado final y los atributos que una escena restaura.
  return sceneEntityState(entityId, { state, attributes });
}
