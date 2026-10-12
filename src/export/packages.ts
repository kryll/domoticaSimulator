// Exportación a una instalación real de Home Assistant (B16): un paquete YAML por área con sus
// automatizaciones, escenas, scripts y grupos, areas.yaml y una guía de emparejamiento.
import type { Automation, Device, DeviceDefinition, Id, Integration, Project, Trigger } from '../types';
import { entitiesForDevice, slugify } from '../devices/entities';
import { INTEGRATION_LABELS, ROLE_LABELS } from '../devices/labels';
import { isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { areaId, automationRoom, entityRoomMap, groupRoom, sceneRoom, scriptRoom } from '../devices/areas';
import { automationToObject, scenesToYaml, scriptsToYaml, toYaml, type YamlMap, type YamlValue } from './yaml';
import { deviceActionAsStateTrigger } from './yamlLogic';
import { zipFiles, type ZipEntry } from './zip';

export interface ExportFile {
  path: string;
  content: string;
}

/** Nombre del paquete para lo que no pertenece a ninguna sala. */
export const GENERAL_PACKAGE = 'general';

/** Disparadores compatibles con HA real (device_action pasa a disparador de estado). */
function realHaTrigger(t: Trigger): Trigger {
  return t.type === 'device_action' ? deviceActionAsStateTrigger(t) : t;
}

function realHaAutomation(a: Automation): Automation {
  return { ...a, triggers: a.triggers.map(realHaTrigger) };
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}

function section(key: string, yaml: string): string {
  return `${key}:\n${indent(yaml)}\n`;
}

interface Bucket {
  automations: Automation[];
  sceneIds: Set<Id>;
  scriptIds: Set<Id>;
  groupDomains: Map<string, YamlMap[]>;
}

function emptyBucket(): Bucket {
  return { automations: [], sceneIds: new Set(), scriptIds: new Set(), groupDomains: new Map() };
}

function packageContent(title: string, bucket: Bucket, project: Project, extra: string[] = []): string | undefined {
  const parts: string[] = [];
  if (bucket.automations.length > 0) {
    parts.push(section('automation', toYaml(bucket.automations.map((a) => automationToObject(realHaAutomation(a), project)))));
  }
  if (bucket.scriptIds.size > 0) {
    parts.push(section('script', scriptsToYaml({ ...project, scripts: project.scripts.filter((s) => bucket.scriptIds.has(s.id)) })));
  }
  if (bucket.sceneIds.size > 0) {
    parts.push(section('scene', scenesToYaml({ ...project, scenes: project.scenes.filter((s) => bucket.sceneIds.has(s.id)) })));
  }
  for (const [domain, items] of bucket.groupDomains) parts.push(section(domain, toYaml(items)));
  parts.push(...extra);
  if (parts.length === 0) return undefined;
  return [`# ${title}`, '# Generado por HA Simulator. Se carga con «homeassistant: packages: !include_dir_named packages».', '', parts.join('\n')].join('\n');
}

/**
 * Ficheros para una instalación real: packages/<área>.yaml (automatizaciones, scripts, escenas y
 * grupos de cada sala; lo que no es de ninguna sala va a packages/general.yaml), areas.yaml y
 * GUIA_EMPAREJAMIENTO.md. Las salas sin nada que exportar no generan paquete.
 */
export function projectToPackages(project: Project, defs: DeviceDefinition[]): ExportFile[] {
  const map = entityRoomMap(project, defs);
  const buckets = new Map<string, Bucket>();
  const bucketFor = (roomId: Id | undefined): Bucket => {
    const key = roomId ?? GENERAL_PACKAGE;
    const existing = buckets.get(key);
    if (existing) return existing;
    const b = emptyBucket();
    buckets.set(key, b);
    return b;
  };
  for (const a of project.automations) bucketFor(automationRoom(a, map, project.rooms)).automations.push(a);
  for (const s of project.scenes) bucketFor(sceneRoom(s, map, project.rooms)).sceneIds.add(s.id);
  for (const s of project.scripts) bucketFor(scriptRoom(s, map, project.rooms)).scriptIds.add(s.id);
  for (const g of project.groups ?? []) {
    const b = bucketFor(groupRoom(g, map, project.rooms));
    const item: YamlMap = { platform: 'group', name: g.name, unique_id: `grupo_${slugify(g.name)}`, entities: g.entityIds };
    b.groupDomains.set(g.domain, [...(b.groupDomains.get(g.domain) ?? []), item]);
  }
  const files: ExportFile[] = [];
  const usedNames = new Set<string>([GENERAL_PACKAGE]);
  for (const room of project.rooms) {
    const bucket = buckets.get(room.id);
    if (!bucket) continue;
    const floor = project.floors.find((f) => f.id === room.floorId);
    let name = areaId(room);
    for (let n = 2; usedNames.has(name); n++) name = `${areaId(room)}_${n}`;
    usedNames.add(name);
    const content = packageContent(`Área «${room.name}»${floor ? ` (${floor.name})` : ''}`, bucket, project);
    if (content) files.push({ path: `packages/${name}.yaml`, content });
  }
  const people = project.people ?? [];
  const extra = people.length > 0 ? [section('person', toYaml(people.map((p) => ({ name: p.name, id: slugify(p.name) }))))] : [];
  const general = packageContent('Elementos sin área', buckets.get(GENERAL_PACKAGE) ?? emptyBucket(), project, extra);
  if (general) files.push({ path: `packages/${GENERAL_PACKAGE}.yaml`, content: general });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return [{ path: 'areas.yaml', content: areasYaml(project, defs) }, { path: 'GUIA_EMPAREJAMIENTO.md', content: pairingGuide(project, defs) }, ...files];
}

/** areas.yaml: referencia de áreas con su planta, dispositivos y entidades (se crean en Ajustes → Áreas). */
export function areasYaml(project: Project, defs: DeviceDefinition[]): string {
  const areas: YamlValue[] = project.rooms.map((room) => {
    const floor = project.floors.find((f) => f.id === room.floorId);
    const devices = project.devices.filter((d) => d.roomId === room.id);
    const entities = devices.flatMap((d) => {
      const def = defs.find((x) => x.id === d.definitionId);
      return def ? entitiesForDevice(d, def).map((e) => e.entityId) : [];
    });
    const m: YamlMap = { area_id: areaId(room), name: room.name };
    if (floor) m.floor = floor.name;
    m.devices = devices.map((d) => d.name);
    m.entities = entities;
    return m;
  });
  const header = '# Áreas del proyecto. Home Assistant no crea áreas desde YAML: créalas en Ajustes → Áreas, etiquetas y zonas\n# y asigna cada dispositivo a su área al darlo de alta.\n';
  return header + toYaml({ areas });
}

// ---------- Guía de emparejamiento ----------

/** Pasos genéricos para dar de alta un dispositivo con cada integración. */
export const PAIRING_STEPS: Record<Integration, string[]> = {
  homeassistant: ['Instala Home Assistant OS y completa el asistente inicial (usuario, ubicación, unidades).'],
  zha: [
    'Ajustes → Dispositivos y servicios → Añadir integración → ZHA, y elige el puerto del coordinador.',
    'Pulsa «Añadir dispositivo» en ZHA y pon el dispositivo en modo emparejamiento (normalmente, mantener el botón 5-10 s hasta que parpadee).',
    'Empareja primero los routers (enchufes y luces) y después los dispositivos a pilas, cerca de su ubicación final.',
  ],
  zigbee2mqtt: [
    'Instala el broker MQTT (Mosquitto) y el complemento Zigbee2MQTT apuntando al coordinador.',
    'En el panel de Zigbee2MQTT pulsa «Permit join» y pon el dispositivo en modo emparejamiento.',
    'Comprueba que aparece en la integración MQTT de Home Assistant y renómbralo.',
  ],
  matter: [
    'Instala el complemento Matter Server y añade la integración Matter.',
    'En la app Home Assistant del móvil: Ajustes → Dispositivos → Añadir dispositivo Matter y escanea el código QR.',
    'Para dispositivos Thread, asegúrate de que el móvil tiene las credenciales Thread del border router.',
  ],
  homekit_device: [
    'Pon el dispositivo en modo emparejamiento HomeKit (o sácalo de Casa de Apple si ya estaba).',
    'Home Assistant lo descubre: Ajustes → Dispositivos y servicios → Configurar, e introduce el código HomeKit de 8 dígitos.',
  ],
  xiaomi_miio: [
    'Añade el dispositivo en la app Mi Home para conectarlo al Wi-Fi.',
    'Añade la integración Xiaomi Miio con tu cuenta de Xiaomi (o IP y token) para controlarlo en local.',
  ],
  tuya: ['Añade el dispositivo en la app Smart Life / Tuya.', 'Añade la integración Tuya y vincula la cuenta escaneando el código QR desde la app (depende de la nube).'],
  ewelink: [
    'Añade el dispositivo en la app eWeLink.',
    'Instala la integración eWeLink (SonoffLAN, desde HACS) e inicia sesión con tu cuenta; si es posible, actívala en modo local.',
  ],
  shelly: ['Conecta el Shelly al Wi-Fi desde su punto de acceso o la app Shelly.', 'Home Assistant lo descubre automáticamente: pulsa «Configurar» en la integración Shelly.'],
  hue: ['Conecta el puente Hue por cable y pulsa su botón cuando Home Assistant lo descubra.', 'Añade las luces y accesorios en la app Hue; aparecen solos en Home Assistant.'],
  google_cast: ['Configura el dispositivo con la app Google Home.', 'Home Assistant lo descubre en la red local: acepta la integración Google Cast.'],
  alexa_media_player: ['Configura el Echo con la app Alexa.', 'Instala Alexa Media Player desde HACS e inicia sesión con tu cuenta de Amazon (depende de la nube).'],
  zwave_js: [
    'Añade la integración Z-Wave JS (con el complemento Z-Wave JS) apuntando al controlador.',
    'Pulsa «Añadir dispositivo», elige la inclusión segura (S2) y escanea el código DSK o pulsa el botón de inclusión del dispositivo.',
  ],
  xiaomi_ble: ['Coloca el sensor al alcance de un proxy Bluetooth o del adaptador BLE del servidor.', 'Home Assistant lo descubre: acepta la integración Xiaomi BLE (los modelos cifrados piden la bindkey).'],
  netatmo: ['Configura el equipo con la app Netatmo.', 'Añade la integración Netatmo e inicia sesión con tu cuenta (depende de la nube).'],
  reolink: ['Conecta la cámara (PoE o Wi-Fi) y configúrala con la app Reolink.', 'Añade la integración Reolink con la IP, el usuario y la contraseña de la cámara.'],
  sonos: ['Configura el altavoz con la app Sonos.', 'Home Assistant lo descubre en la red local: acepta la integración Sonos.'],
  samsungtv: ['Enciende el televisor en la misma red.', 'Acepta la integración Samsung Smart TV y autoriza la conexión en la pantalla del televisor.'],
  webostv: ['Enciende el televisor en la misma red.', 'Acepta la integración LG webOS TV y autoriza la conexión en la pantalla del televisor.'],
  tplink: ['Configura el enchufe con la app Tapo / Kasa.', 'Añade la integración TP-Link Smart Home con la IP del enchufe y tus credenciales de TP-Link.'],
};

function phase(def: DeviceDefinition): number {
  switch (def.role) {
    case 'ha_server':
      return 0;
    case 'access_point':
      return 1;
    case 'coordinator':
      return 2;
    case 'hub':
    case 'border_router':
      return 3;
    default:
      return 4;
  }
}

function roomName(project: Project, d: Device): string {
  const room = project.rooms.find((r) => r.id === d.roomId);
  return room ? ` (${room.name})` : '';
}

/** Guía en Markdown con el orden de alta: servidor, red, coordinadores, hubs y dispositivos por integración. */
export function pairingGuide(project: Project, defs: DeviceDefinition[]): string {
  const placed = project.devices
    .map((device) => ({ device, def: defs.find((d) => d.id === device.definitionId) }))
    .filter((p): p is { device: Device; def: DeviceDefinition } => p.def !== undefined);
  const lines: string[] = [
    `# Guía de emparejamiento: ${project.name}`,
    '',
    'Orden recomendado de alta en Home Assistant. Sigue los pasos en este orden: cada fase depende de la anterior.',
    '',
    '## Antes de empezar',
    '',
    '1. Copia la carpeta `packages/` junto a `configuration.yaml` y añade:',
    '',
    '```yaml',
    'homeassistant:',
    '  packages: !include_dir_named packages',
    '```',
    '',
    '2. Crea las áreas de `areas.yaml` en Ajustes → Áreas, etiquetas y zonas.',
    '3. Da de alta los dispositivos con los nombres del proyecto para que los entity_id coincidan con las automatizaciones.',
    '',
  ];
  const titles = ['1. Servidor Home Assistant', '2. Red', '3. Coordinadores y controladores', '4. Hubs, puentes y border routers'];
  titles.forEach((title, i) => {
    const items = placed.filter((p) => phase(p.def) === i);
    if (items.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const { device, def } of items) {
      lines.push(`- **${device.name}**${roomName(project, device)}: ${def.brand} ${def.model}, ${ROLE_LABELS[def.role].toLowerCase()} con ${INTEGRATION_LABELS[device.integration]}.`);
    }
    const integrations = [...new Set(items.map((p) => p.device.integration))];
    for (const integration of integrations) {
      lines.push('', `Pasos (${INTEGRATION_LABELS[integration]}):`, '');
      PAIRING_STEPS[integration].forEach((step, n) => lines.push(`${n + 1}. ${step}`));
    }
    lines.push('');
  });
  const endpoints = placed.filter((p) => phase(p.def) === 4);
  if (endpoints.length > 0) {
    lines.push('## 5. Dispositivos por integración', '');
    const byIntegration = new Map<Integration, typeof endpoints>();
    for (const p of endpoints) byIntegration.set(p.device.integration, [...(byIntegration.get(p.device.integration) ?? []), p]);
    for (const [integration, items] of byIntegration) {
      const cloud = items.some((p) => isCloud(effectiveIotClass(p.device, p.def)));
      lines.push(`### ${INTEGRATION_LABELS[integration]}${cloud ? ' (nube)' : ' (local)'}`, '');
      PAIRING_STEPS[integration].forEach((step, n) => lines.push(`${n + 1}. ${step}`));
      lines.push('', 'Dispositivos:', '');
      // Primero los alimentados (routers de la malla), después los de pilas.
      const sorted = [...items].sort((a, b) => Number(a.def.power === 'battery') - Number(b.def.power === 'battery'));
      for (const { device, def } of sorted) {
        const ids = entitiesForDevice(device, def).map((e) => `\`${e.entityId}\``).join(', ');
        lines.push(`- [ ] **${device.name}**${roomName(project, device)}: ${def.brand} ${def.model}${def.power === 'battery' ? ' (pilas)' : ''} → ${ids}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** ZIP listo para descargar con todos los ficheros de projectToPackages. */
export function packagesZip(project: Project, defs: DeviceDefinition[]): Uint8Array {
  const entries: ZipEntry[] = projectToPackages(project, defs).map((f) => ({ path: f.path, content: f.content }));
  return zipFiles(entries);
}
