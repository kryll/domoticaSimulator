// Validador del proyecto: reglas de red y de dominio con códigos estables y mensajes en español.
import type { Brand, Device, Integration, DeviceDefinition, Id, IssueSeverity, Project, ValidationIssue } from '../types';
import { INTEGRATION_LABELS } from '../devices/labels';
import { isCloud } from '../devices/catalog';
import {
  effectiveIotClass,
  isBleProxy,
  isInfra,
  isRfBridge,
  isThreadBorderRouter,
  isZigbeeCoordinator,
  isZwaveController,
  requiredHubBrand,
  zigbeeNetworkOf,
} from '../devices/roles';
import { entityIdsForDevice, slugify } from '../devices/entities';
import { collectEntityRefs, type EntityReference } from '../devices/renaming';
import { findScene, findScript } from '../simulation/engine';
import { missingRequiredFields } from '../simulation/serviceCatalog';
import type { Action } from '../types';
import { canConnect } from './connections';
import { isInRange } from './coverage';
import { analyzeMesh } from './mesh';

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

interface Ctx {
  project: Project;
  defs: DeviceDefinition[];
  placed: Placed[];
}

function issue(severity: IssueSeverity, code: string, message: string, deviceIds: Id[], key = ''): ValidationIssue {
  const suffix = key || deviceIds.join(',');
  return { id: suffix ? `${code}:${suffix}` : code, severity, code, message, deviceIds };
}

function names(items: Placed[]): string {
  return items.map((p) => `«${p.device.name}»`).join(', ');
}

function ids(items: Placed[]): Id[] {
  return items.map((p) => p.device.id);
}

function endpoints(ctx: Ctx): Placed[] {
  return ctx.placed.filter((p) => !isInfra(p.def));
}

function unknownDefinitions(ctx: Ctx): ValidationIssue[] {
  return ctx.project.devices
    .filter((d) => !ctx.defs.some((def) => def.id === d.definitionId))
    .map((d) =>
      issue('error', 'definicion-desconocida', `«${d.name}» usa una definición que no está en el catálogo (${d.definitionId})`, [d.id]),
    );
}

function noServer(ctx: Ctx): ValidationIssue[] {
  if (ctx.placed.some((p) => p.def.role === 'ha_server')) return [];
  return [issue('error', 'sin-servidor-ha', 'No hay ningún servidor de Home Assistant en el proyecto', [])];
}

/** Regla genérica: dispositivos que necesitan una infraestructura que no existe. */
function missingInfra(
  ctx: Ctx,
  needs: (p: Placed) => boolean,
  provides: (def: DeviceDefinition) => boolean,
  code: string,
  message: (affected: Placed[]) => string,
  severity: IssueSeverity = 'error',
): ValidationIssue[] {
  const affected = endpoints(ctx).filter(needs);
  if (affected.length === 0 || ctx.placed.some((p) => provides(p.def))) return [];
  return [issue(severity, code, message(affected), ids(affected), code)];
}

function zigbeeRules(ctx: Ctx): ValidationIssue[] {
  const result = missingInfra(
    ctx,
    (p) => p.device.protocol === 'zigbee' && zigbeeNetworkOf(p.device, p.def) === 'coordinator',
    isZigbeeCoordinator,
    'zigbee-sin-coordinador',
    (a) => `Hay dispositivos Zigbee (${names(a)}) pero ningún coordinador Zigbee (p. ej. SONOFF ZBDongle-P)`,
  );
  const coordinators = ctx.placed.filter((p) => isZigbeeCoordinator(p.def));
  if (coordinators.length > 1) {
    result.push(
      issue('warning', 'varios-coordinadores-zigbee', `Hay ${coordinators.length} coordinadores Zigbee (${names(coordinators)}): cada uno crea una red independiente`, ids(coordinators)),
    );
  }
  return result;
}

function hubRules(ctx: Ctx): ValidationIssue[] {
  const byBrand = new Map<Brand, Placed[]>();
  for (const p of endpoints(ctx)) {
    const brand = requiredHubBrand(p.device, p.def);
    if (brand) byBrand.set(brand, [...(byBrand.get(brand) ?? []), p]);
  }
  const result: ValidationIssue[] = [];
  for (const [brand, affected] of byBrand) {
    if (ctx.placed.some((p) => p.def.role === 'hub' && p.def.brand === brand)) continue;
    result.push(
      issue('error', 'falta-hub-propietario', `${names(affected)} necesita${affected.length > 1 ? 'n' : ''} el hub de ${brand} con su integración actual (o cámbialo a ZHA/Zigbee2MQTT)`, ids(affected), brand),
    );
  }
  return result;
}

function simpleInfraRules(ctx: Ctx): ValidationIssue[] {
  return [
    ...missingInfra(ctx, (p) => p.device.protocol === 'thread', isThreadBorderRouter, 'thread-sin-border-router',
      (a) => `Hay dispositivos Thread (${names(a)}) pero ningún border router Thread (Nest Hub, Echo 4.ª gen., Aqara M3, DIRIGERA...)`),
    ...missingInfra(ctx, (p) => p.device.protocol === 'zwave', isZwaveController, 'zwave-sin-controlador',
      (a) => `Hay dispositivos Z-Wave (${names(a)}) pero ningún controlador Z-Wave`),
    ...missingInfra(ctx, (p) => p.device.protocol === 'rf433', isRfBridge, 'rf433-sin-puente',
      (a) => `Hay sensores RF 433 MHz (${names(a)}) pero ningún puente RF (p. ej. SONOFF RF Bridge)`),
  ];
}

/** Marcas cuyos border routers no comparten las credenciales Thread con Home Assistant. */
const CLOSED_THREAD_BRANDS: readonly Brand[] = ['Amazon'];

function threadCredentialsRule(ctx: Ctx): ValidationIssue[] {
  if (!endpoints(ctx).some((p) => p.device.protocol === 'thread')) return [];
  return ctx.placed
    .filter((p) => isThreadBorderRouter(p.def) && CLOSED_THREAD_BRANDS.includes(p.def.brand))
    .map((p) =>
      issue('warning', 'thread-border-router-sin-credenciales', `«${p.device.name}» es border router Thread, pero ${p.def.brand} no comparte las credenciales Thread con Home Assistant: los dispositivos Thread no podrán usar su red desde HA (añade un border router de Google, Aqara, IKEA o uno propio de HA)`, [p.device.id]),
    );
}

function bleWithoutProxy(ctx: Ctx): Placed[] {
  const proxies = ctx.placed.filter((p) => isBleProxy(p.def));
  return endpoints(ctx).filter(
    (p) => p.device.protocol === 'ble' && !proxies.some((x) => isInRange(p.device, x.device, ctx.defs, ctx.project.floors, 'ble')),
  );
}

function bleRule(ctx: Ctx): ValidationIssue[] {
  return bleWithoutProxy(ctx).map((p) =>
    issue('warning', 'ble-sin-proxy', `«${p.device.name}» es Bluetooth LE y no tiene ningún proxy Bluetooth cerca (p. ej. un Shelly Gen2/Gen3 o un ESPHome)`, [p.device.id]),
  );
}

function cloudRule(ctx: Ctx): ValidationIssue[] {
  const groups = new Map<Integration, Placed[]>();
  for (const p of ctx.placed) {
    if (isInfra(p.def) && p.def.role !== 'hub' && p.def.role !== 'border_router') continue;
    if (!isCloud(effectiveIotClass(p.device, p.def))) continue;
    groups.set(p.device.integration, [...(groups.get(p.device.integration) ?? []), p]);
  }
  return [...groups.entries()].map(([integration, items]) => {
    return issue('info', 'integracion-cloud', `La integración ${INTEGRATION_LABELS[integration]} depende de la nube: ${names(items)} dejará${items.length > 1 ? 'n' : ''} de funcionar sin Internet`, ids(items), integration);
  });
}

/** Ids ya señalados por falta de infraestructura (para no duplicar con fuera-de-cobertura). */
function flaggedIds(issues: ValidationIssue[]): Set<Id> {
  const codes = ['zigbee-sin-coordinador', 'falta-hub-propietario', 'thread-sin-border-router', 'zwave-sin-controlador', 'rf433-sin-puente', 'ble-sin-proxy', 'definicion-desconocida'];
  return new Set(issues.filter((i) => codes.includes(i.code)).flatMap((i) => i.deviceIds));
}

function coverageRule(ctx: Ctx, previous: ValidationIssue[]): ValidationIssue[] {
  const mesh = analyzeMesh(ctx.project, ctx.defs);
  const skip = flaggedIds(previous);
  return ctx.placed
    .filter((p) => !mesh.reachable.has(p.device.id) && !skip.has(p.device.id))
    .map((p) =>
      issue('error', 'fuera-de-cobertura', `«${p.device.name}» no alcanza ninguna red: acércalo a un hub, router o punto de acceso, añade un repetidor o conéctalo por cable`, [p.device.id]),
    );
}

function connectionRules(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  for (const c of ctx.project.connections) {
    const a = ctx.project.devices.find((d) => d.id === c.sourceId);
    const b = ctx.project.devices.find((d) => d.id === c.targetId);
    if (!a || !b) {
      result.push(issue('error', 'conexion-invalida', 'Hay una conexión con un dispositivo que ya no existe', [a?.id, b?.id].filter((x): x is Id => x !== undefined), c.id));
      continue;
    }
    const r = canConnect(a, b, ctx.defs);
    if (!r.ok) {
      result.push(issue('error', 'conexion-protocolo-incompatible', `Conexión «${a.name}» → «${b.name}» no válida: ${r.reason}`, [a.id, b.id], c.id));
    }
  }
  return result;
}

function isolatedInfraRule(ctx: Ctx): ValidationIssue[] {
  return ctx.placed
    .filter((p) => isInfra(p.def) && p.def.role !== 'ha_server')
    .filter((p) => !ctx.project.connections.some((c) => c.sourceId === p.device.id || c.targetId === p.device.id))
    .map((p) => issue('warning', 'infraestructura-sin-conexion', `«${p.device.name}» no está conectado a la red de casa ni al servidor`, [p.device.id]));
}

const KIND_LABELS: Record<EntityReference['kind'], string> = {
  automation: 'La automatización',
  scene: 'La escena',
  script: 'El script',
};

function knownEntityIds(ctx: Ctx): Set<string> {
  return new Set(ctx.placed.flatMap((p) => entityIdsForDevice(p.device, p.def)));
}

function refExists(entityId: string, known: Set<string>, project: Project): boolean {
  if (known.has(entityId)) return true;
  if (entityId.startsWith('scene.')) return findScene(project, entityId) !== undefined;
  if (entityId.startsWith('script.')) return findScript(project, entityId) !== undefined;
  return false;
}

function unknownEntityRule(ctx: Ctx): ValidationIssue[] {
  const known = knownEntityIds(ctx);
  const seen = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const ref of collectEntityRefs(ctx.project)) {
    const key = `${ref.kind}:${ref.ownerId}:${ref.entityId}`;
    if (seen.has(key) || refExists(ref.entityId, known, ctx.project)) continue;
    seen.add(key);
    const shown = ref.entityId === '' ? '(vacía)' : ref.entityId;
    result.push(issue('error', 'entidad-desconocida', `${KIND_LABELS[ref.kind]} «${ref.ownerName}» usa la entidad ${shown}, que no existe`, [], key));
  }
  return result;
}

function duplicateEntityRule(ctx: Ctx): ValidationIssue[] {
  const owners = new Map<string, Id[]>();
  for (const p of ctx.placed) {
    for (const id of new Set(entityIdsForDevice(p.device, p.def))) owners.set(id, [...(owners.get(id) ?? []), p.device.id]);
  }
  const groups = new Map<string, { deviceIds: Id[]; entityIds: string[] }>();
  for (const [entityId, deviceIds] of owners) {
    if (deviceIds.length < 2) continue;
    const key = deviceIds.join(',');
    const group = groups.get(key) ?? { deviceIds, entityIds: [] };
    group.entityIds.push(entityId);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => {
    const devices = g.deviceIds.map((id) => `«${ctx.project.devices.find((d) => d.id === id)?.name ?? id}»`).join(', ');
    return issue('error', 'entity-id-duplicado', `${devices} generan los mismos entity_id (${g.entityIds.join(', ')}); cambia el nombre de alguno`, g.deviceIds);
  });
}

function roomRule(ctx: Ctx): ValidationIssue[] {
  return ctx.project.devices
    .filter((d) => !d.roomId || !ctx.project.rooms.some((r) => r.id === d.roomId))
    .map((d) => issue('info', 'dispositivo-sin-sala', `«${d.name}» no está asignado a ninguna sala`, [d.id]));
}

function missingFieldRule(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const check = (kind: EntityReference['kind'], ownerId: string, ownerName: string, actions: Action[]): void => {
    actions.forEach((a, i) => {
      if (a.type !== 'service') return;
      for (const f of missingRequiredFields(a.service, a.data)) {
        result.push(
          issue('error', 'servicio-falta-campo', `${KIND_LABELS[kind]} «${ownerName}» llama a ${a.service} (acción ${i + 1}) sin el campo obligatorio «${f.label}» (${f.key})`, [], `${kind}:${ownerId}:${i}:${f.key}`),
        );
      }
    });
  };
  for (const a of ctx.project.automations) check('automation', a.id, a.name, a.actions);
  for (const s of ctx.project.scripts) check('script', s.id, s.name, s.sequence);
  return result;
}

function duplicateScriptNameRule(ctx: Ctx): ValidationIssue[] {
  const groups = new Map<string, string[]>();
  for (const s of ctx.project.scripts) {
    const slug = slugify(s.name);
    groups.set(slug, [...(groups.get(slug) ?? []), s.name]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([slug, list]) =>
      issue('warning', 'nombre-script-duplicado', `Hay ${list.length} scripts con el mismo nombre (${list.map((n) => `«${n}»`).join(', ')}): sus entity_id serán script.${slug}, script.${slug}_2...; cámbiales el nombre para distinguirlos`, [], slug),
    );
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Valida el proyecto. Devuelve los problemas ordenados por gravedad (errores primero). */
export function validateProject(project: Project, defs: DeviceDefinition[]): ValidationIssue[] {
  const placed: Placed[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) placed.push({ device, def });
  }
  const ctx: Ctx = { project, defs, placed };
  const issues = [
    ...unknownDefinitions(ctx),
    ...noServer(ctx),
    ...zigbeeRules(ctx),
    ...hubRules(ctx),
    ...simpleInfraRules(ctx),
    ...bleRule(ctx),
    ...threadCredentialsRule(ctx),
  ];
  issues.push(...coverageRule(ctx, issues));
  issues.push(
    ...connectionRules(ctx),
    ...duplicateEntityRule(ctx),
    ...unknownEntityRule(ctx),
    ...missingFieldRule(ctx),
    ...duplicateScriptNameRule(ctx),
    ...isolatedInfraRule(ctx),
    ...cloudRule(ctx),
    ...roomRule(ctx),
  );
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
