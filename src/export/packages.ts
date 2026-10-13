// Exportación a una instalación real de Home Assistant (B16): un paquete YAML por área con sus
// automatizaciones, escenas, scripts y grupos, areas.yaml y una guía de emparejamiento.
import { defaultSettings, type Automation, type Device, type DeviceDefinition, type Id, type Integration, type Project, type ZoneKind } from '../types';
import { entitiesForDevice, slugify } from '../devices/entities';
import { INTEGRATION_LABELS, ROLE_LABELS } from '../devices/labels';
import { allDefinitions, isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { areaId, automationRoom, entityRoomMap, groupRoom, sceneRoom, scriptRoom } from '../devices/areas';
import { groupEntityId, groupHaName } from '../simulation/logic';
import { helpersByDomain } from '../simulation/helpers';
import { automationToObject, scenesToYaml, scriptsToYaml, toYaml, type YamlMap, type YamlValue } from './yaml';
import { zipFiles, type ZipEntry } from './zip';
import { DEFAULT_ZONE_RADIUS, hasCoordinates, zoneConflicts, zoneGeo } from '../simulation/zones';

export interface ExportFile {
  path: string;
  content: string;
}

/** Nombre del paquete para lo que no pertenece a ninguna sala. */
export const GENERAL_PACKAGE = 'general';

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
    parts.push(section('automation', toYaml(bucket.automations.map((a) => automationToObject(a, project)))));
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
export function projectToPackages(project: Project, baseDefs: DeviceDefinition[]): ExportFile[] {
  const defs = allDefinitions(project, baseDefs);
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
    // HA crea el entity_id a partir de name: groupHaName garantiza que coincide con groupEntityId.
    const item: YamlMap = { platform: 'group', name: groupHaName(g), unique_id: groupEntityId(g).split('.')[1] ?? slugify(g.name), entities: g.entityIds };
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
  const extra = people.length > 0 ? [personsComment(people.map((p) => p.name))] : [];
  // Tanda 3: los helpers van en el paquete general (input_boolean:, timer:, counter:...).
  const helpers = helpersSection(project);
  if (helpers) extra.push(helpers);
  const zones = zonesSection(project);
  if (zones) extra.push(zones);
  const general = packageContent('Elementos sin área', buckets.get(GENERAL_PACKAGE) ?? emptyBucket(), project, extra);
  if (general) files.push({ path: `packages/${GENERAL_PACKAGE}.yaml`, content: general });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return [{ path: 'areas.yaml', content: areasYaml(project, defs) }, { path: 'GUIA_EMPAREJAMIENTO.md', content: pairingGuide(project, defs) }, ...files];
}

/** Tanda 3: configuración YAML de los helpers del proyecto, un bloque por dominio. */
export function helpersSection(project: Pick<Project, 'helpers'>): string | undefined {
  const byDomain = helpersByDomain(project.helpers ?? []);
  if (byDomain.size === 0) return undefined;
  const parts: string[] = [];
  for (const [domain, items] of byDomain) parts.push(section(domain, toYaml(items as YamlMap)));
  return parts.join('\n');
}

const ZONE_ICONS: Record<ZoneKind, string> = { home: 'mdi:home', work: 'mdi:briefcase', other: 'mdi:map-marker' };

/**
 * Zonas del proyecto para HA real. zone.home es la ubicación de Home Assistant (no se declara en
 * YAML): se indica en un comentario con sus coordenadas (las de la zona o las de los ajustes). Las
 * zonas con coordenadas se exportan activas; las que no tienen, con las de la casa como punto de
 * partida, `passive: true` y un TODO.
 */
export function zonesSection(project: Pick<Project, 'zones' | 'settings'>): string | undefined {
  const zones = project.zones ?? [];
  if (zones.length === 0) return undefined;
  const settings = { ...defaultSettings(), ...project.settings };
  const home = zones.find((z) => z.kind === 'home');
  const homeGeo = home ? zoneGeo(home, project) : undefined;
  const lat = homeGeo?.latitude ?? settings.latitude;
  const lon = homeGeo?.longitude ?? settings.longitude;
  const lines = [`# zone.home: ubicación de Home Assistant (Ajustes → Sistema → General): latitud ${lat}, longitud ${lon}${homeGeo && home?.radius !== undefined ? `, radio ${homeGeo.radius} m` : ''}.`];
  const others = zones.filter((z) => z.kind !== 'home');
  if (others.length === 0) return `${lines.join('\n')}\n`;
  const missing = others.filter((z) => !hasCoordinates(z));
  const items = others.map((z) => {
    const geo = zoneGeo(z, project);
    const item: YamlMap = { name: z.name, latitude: geo?.latitude ?? lat, longitude: geo?.longitude ?? lon, radius: z.radius ?? DEFAULT_ZONE_RADIUS, icon: ZONE_ICONS[z.kind] };
    // passive: no cambia el estado de las personas hasta que se ajusten las coordenadas.
    if (!geo) item.passive = true;
    return item;
  });
  if (missing.length > 0) {
    lines.push(`# TODO: coordenadas reales de ${missing.map((z) => `«${z.name}»`).join(', ')} (ahora tienen las de la casa); después quita «passive: true».`);
  }
  return `${lines.join('\n')}\n${section('zone', toYaml(items))}`;
}

/**
 * Personas como guía comentada: en HA se crean en Ajustes → Personas y se les asigna el
 * device_tracker de la app móvil (un `person:` en YAML no permite editarlas desde la interfaz).
 */
export function personsComment(names: string[]): string {
  const lines = [
    '# Personas: créalas en Ajustes → Personas y asigna a cada una el device_tracker de su app móvil.',
    '# Usa estos nombres para que person.<nombre> coincida con las automatizaciones:',
    ...names.map((n) => `#   - ${n} → person.${slugify(n)}`),
  ];
  return `${lines.join('\n')}\n`;
}

/** Marca y modelo sin repetir la marca («Home Assistant Green», no «Home Assistant Home Assistant Green»). */
export function modelLabel(def: Pick<DeviceDefinition, 'brand' | 'model'>): string {
  return def.model.toLowerCase().startsWith(def.brand.toLowerCase()) ? def.model : `${def.brand} ${def.model}`;
}

/** Pasos por papel de red para el servidor y la red (no dependen de la integración). */
export const ROLE_STEPS: Partial<Record<DeviceDefinition['role'], string[]>> = {
  ha_server: [
    'Conecta el servidor por cable al router y enciéndelo.',
    'Abre http://homeassistant.local:8123 y completa el asistente inicial (usuario, ubicación, unidades).',
    'Instala la app móvil de Home Assistant en el teléfono de cada persona.',
  ],
  access_point: [
    'Configura el router o punto de acceso con su app y crea la red Wi-Fi (los dispositivos domóticos suelen necesitar 2,4 GHz).',
    'Reserva una IP fija para el servidor de Home Assistant y, si puedes, para los dispositivos Wi-Fi.',
    'Comprueba que el servidor y los dispositivos están en la misma red local (sin aislamiento de clientes).',
  ],
};

/** areas.yaml: referencia de áreas con su planta, dispositivos y entidades (se crean en Ajustes → Áreas). */
export function areasYaml(project: Project, defs: DeviceDefinition[]): string {
  defs = allDefinitions(project, defs);
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
  esphome: [
    'Flashea el ESP32 con ESPHome (ESPHome Builder o web.esphome.io) y define sus sensores en el YAML del nodo.',
    'Home Assistant lo descubre en la red local: acepta la integración ESPHome e introduce la clave de cifrado de la API.',
  ],
  daikin_onecta: ['Configura el aire acondicionado con la app Daikin Onecta.', 'Instala la integración Daikin Onecta (HACS) e inicia sesión con tu cuenta de Daikin (depende de la nube).'],
  sensibo: ['Configura el mando Sensibo con su app y asígnale el aparato de aire.', 'Añade la integración Sensibo con la clave de API de tu cuenta (depende de la nube).'],
  meross_lan: ['Configura el dispositivo con la app Meross.', 'Instala Meross LAN (HACS): lo descubre en la red local y lo controla sin la nube.'],
  roborock: ['Configura el robot con la app Roborock.', 'Añade la integración Roborock e inicia sesión con tu cuenta (código por correo).'],
  ecovacs: ['Configura el robot con la app Ecovacs Home.', 'Añade la integración Ecovacs e inicia sesión con tu cuenta (depende de la nube).'],
  dreame_vacuum: [
    'Configura el robot con la app Dreamehome (o Mi Home si es un Xiaomi fabricado por Dreame).',
    'Instala Dreame Vacuum desde HACS (repositorio de la comunidad, no oficial) e inicia sesión con tu cuenta para obtener el token; después habla en local por miIO.',
  ],
  roomba: ['Configura el Roomba con la app iRobot Home.', 'Home Assistant lo descubre en la red local: acepta la integración iRobot Roomba y pulsa el botón Home del robot unos segundos para obtener la contraseña.'],
  eufy_robovac: ['Configura el robot con la app Eufy Clean.', 'Instala Eufy RoboVac desde HACS (no oficial) e inicia sesión una vez para obtener la clave local; después lo controla por la red local.'],
  wyoming: [
    'Instala wyoming-satellite en la Raspberry Pi con su micrófono y altavoz (o el complemento de openWakeWord, Whisper y Piper en el servidor).',
    'Home Assistant lo descubre: acepta la integración Wyoming Protocol y elige la canalización de Assist (STT y TTS locales o en la nube).',
  ],
  apple_tv: [
    'Configura el HomePod con la app Casa del iPhone.',
    'Home Assistant lo descubre: acepta la integración Apple TV (AirPlay) e introduce el PIN si lo pide. Solo da un reproductor: Siri no se controla desde HA (para usar Siri con HA, expón entidades con el puente HomeKit).',
  ],
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
  defs = allDefinitions(project, defs);
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
      const via = i <= 1 ? '' : ` con ${INTEGRATION_LABELS[device.integration]}`;
      lines.push(`- **${device.name}**${roomName(project, device)}: ${modelLabel(def)}, ${ROLE_LABELS[def.role].toLowerCase()}${via}.`);
    }
    if (i <= 1) {
      const role = i === 0 ? 'ha_server' : 'access_point';
      lines.push('', 'Pasos:', '');
      (ROLE_STEPS[role] ?? []).forEach((step, n) => lines.push(`${n + 1}. ${step}`));
      lines.push('');
      return;
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
        lines.push(`- [ ] **${device.name}**${roomName(project, device)}: ${modelLabel(def)}${def.power === 'battery' ? ' (pilas)' : ''} → ${ids}`);
      }
      lines.push('');
    }
  }
  const people = project.people ?? [];
  const zones = (project.zones ?? []).filter((z) => z.kind !== 'home');
  if (people.length > 0 || zones.length > 0) {
    lines.push('## 6. Personas y zonas', '');
    let n = 1;
    if (people.length > 0) {
      lines.push(`${n++}. Instala la app móvil de Home Assistant en el teléfono de cada persona e inicia sesión.`);
      lines.push(`${n++}. En Ajustes → Personas crea a ${people.map((p) => `**${p.name}** (\`person.${slugify(p.name)}\`)`).join(', ')} y asigna a cada una el device_tracker de su app.`);
    }
    const missing = zones.filter((z) => !hasCoordinates(z));
    const located = zones.filter((z) => hasCoordinates(z));
    if (located.length > 0) {
      lines.push(`${n++}. Las zonas ${located.map((z) => `**${z.name}**`).join(', ')} ya tienen coordenadas en \`packages/general.yaml\`: comprueba en el mapa de Ajustes → Áreas, etiquetas y zonas que el círculo es correcto.`);
    }
    if (missing.length > 0) {
      lines.push(`${n++}. Ajusta las coordenadas de ${missing.map((z) => `**${z.name}**`).join(', ')} en \`packages/general.yaml\` y quita \`passive: true\`, o créalas en Ajustes → Áreas, etiquetas y zonas.`);
    }
    const overlaps = zoneConflicts(project).filter((c) => c.kind === 'overlap');
    for (const c of overlaps) lines.push(`${n++}. Revisa: ${c.message}.`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** ZIP listo para descargar con todos los ficheros de projectToPackages. */
export function packagesZip(project: Project, defs: DeviceDefinition[]): Uint8Array {
  defs = allDefinitions(project, defs);
  const entries: ZipEntry[] = projectToPackages(project, defs).map((f) => ({ path: f.path, content: f.content }));
  return zipFiles(entries);
}
