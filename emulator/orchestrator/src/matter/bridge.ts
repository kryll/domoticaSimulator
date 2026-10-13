// Bridge Matter del laboratorio hecho con matter.js: un nodo (ServerNode) con un AggregatorEndpoint
// y un endpoint «bridged» (con BridgedDeviceBasicInformation) por cada dispositivo Matter/Thread del
// proyecto. Un solo comisionado para todos los dispositivos; añadir o quitar endpoints funciona en
// caliente. Parar un dispositivo = Reachable a false (HA lo muestra no disponible).
import { Endpoint, Environment, Logger, LogLevel, ServerNode, VendorId, type EndpointType, type MutableEndpoint } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { BooleanStateServer } from '@matter/main/behaviors/boolean-state';
import { OccupancySensingServer } from '@matter/main/behaviors/occupancy-sensing';
import { TemperatureMeasurementServer } from '@matter/main/behaviors/temperature-measurement';
import { RelativeHumidityMeasurementServer } from '@matter/main/behaviors/relative-humidity-measurement';
import { IlluminanceMeasurementServer } from '@matter/main/behaviors/illuminance-measurement';
import { PressureMeasurementServer } from '@matter/main/behaviors/pressure-measurement';
import { PowerSourceServer } from '@matter/main/behaviors/power-source';
import { ElectricalPowerMeasurementServer } from '@matter/main/behaviors/electrical-power-measurement';
import { ElectricalEnergyMeasurementServer } from '@matter/main/behaviors/electrical-energy-measurement';
import { OnOffLightDevice } from '@matter/main/devices/on-off-light';
import { DimmableLightDevice } from '@matter/main/devices/dimmable-light';
import { ColorTemperatureLightDevice } from '@matter/main/devices/color-temperature-light';
import { ExtendedColorLightDevice } from '@matter/main/devices/extended-color-light';
import { OnOffPlugInUnitDevice } from '@matter/main/devices/on-off-plug-in-unit';
import { ContactSensorDevice } from '@matter/main/devices/contact-sensor';
import { WaterLeakDetectorDevice } from '@matter/main/devices/water-leak-detector';
import { OccupancySensorDevice } from '@matter/main/devices/occupancy-sensor';
import { TemperatureSensorDevice } from '@matter/main/devices/temperature-sensor';
import { HumiditySensorDevice } from '@matter/main/devices/humidity-sensor';
import { LightSensorDevice } from '@matter/main/devices/light-sensor';
import { PressureSensorDevice } from '@matter/main/devices/pressure-sensor';
import { DoorLockDevice } from '@matter/main/devices/door-lock';
import { WindowCoveringDevice } from '@matter/main/devices/window-covering';
import type { Behavior } from '@matter/main';
import type { MatterCluster, MatterCommand, MatterDevicePlan, MatterState } from '../../../../src/bridge/matter/plan';
import { HasimColorControlServer, HasimColorTempServer, HasimDoorLockServer, HasimLevelControlServer, HasimLightOnOffServer, HasimOnOffServer, HasimWindowCoveringServer, setCommandSink } from './behaviors';

type Struct = Record<string, unknown>;

/** Movimiento de WindowCovering.OperationalStatus (0 parada, 1 abriendo, 2 cerrando). */
const MOVEMENT = { stopped: 0, opening: 1, closing: 2 } as const;

/** Tipo de endpoint de matter.js para el plan de un dispositivo (tipo de dispositivo + clusters). */
export function endpointTypeFor(plan: MatterDevicePlan): EndpointType {
  const extras: Behavior.Type[] = [BridgedDeviceBasicInformationServer];
  const add = (cluster: MatterCluster, behavior: Behavior.Type): void => {
    if (plan.clusters.includes(cluster)) extras.push(behavior);
  };
  let base: MutableEndpoint;
  switch (plan.kind) {
    case 'on_off_light':
      base = OnOffLightDevice.with(HasimLightOnOffServer);
      break;
    case 'dimmable_light':
      base = DimmableLightDevice.with(HasimLightOnOffServer, HasimLevelControlServer);
      break;
    case 'color_temperature_light':
      base = ColorTemperatureLightDevice.with(HasimLightOnOffServer, HasimLevelControlServer, HasimColorTempServer);
      break;
    case 'extended_color_light':
      base = ExtendedColorLightDevice.with(HasimLightOnOffServer, HasimLevelControlServer, HasimColorControlServer);
      break;
    case 'on_off_plug':
      base = OnOffPlugInUnitDevice.with(HasimOnOffServer);
      break;
    case 'contact_sensor':
      base = ContactSensorDevice.with(BooleanStateServer);
      break;
    case 'water_leak_detector':
      base = WaterLeakDetectorDevice.with(BooleanStateServer);
      break;
    case 'occupancy_sensor':
      base = OccupancySensorDevice.with(OccupancySensingServer.with('PassiveInfrared'));
      break;
    case 'temperature_sensor':
      base = TemperatureSensorDevice.with(TemperatureMeasurementServer);
      break;
    case 'humidity_sensor':
      base = HumiditySensorDevice.with(RelativeHumidityMeasurementServer);
      break;
    case 'light_sensor':
      base = LightSensorDevice.with(IlluminanceMeasurementServer);
      break;
    case 'pressure_sensor':
      base = PressureSensorDevice.with(PressureMeasurementServer);
      break;
    case 'door_lock':
      base = DoorLockDevice.with(HasimDoorLockServer);
      break;
    case 'window_covering':
      base = WindowCoveringDevice.with(HasimWindowCoveringServer);
      break;
  }
  if (plan.kind !== 'temperature_sensor') add('temperatureMeasurement', TemperatureMeasurementServer);
  if (plan.kind !== 'humidity_sensor') add('relativeHumidityMeasurement', RelativeHumidityMeasurementServer);
  if (plan.kind !== 'light_sensor') add('illuminanceMeasurement', IlluminanceMeasurementServer);
  if (plan.kind !== 'pressure_sensor') add('pressureMeasurement', PressureMeasurementServer);
  add('powerSource', PowerSourceServer.with('Battery'));
  add('electricalPowerMeasurement', ElectricalPowerMeasurementServer.with('AlternatingCurrent'));
  add('electricalEnergyMeasurement', ElectricalEnergyMeasurementServer.with('ImportedEnergy', 'CumulativeEnergy'));
  return base.with(...extras);
}

const accuracyRange = (min: number, max: number): Struct => ({ rangeMin: min, rangeMax: max, percentMax: 100 });

/** Estado inicial de cada cluster (atributos obligatorios que no dependen del simulador). */
export function initialClusterState(plan: MatterDevicePlan): Record<string, Struct> {
  const out: Record<string, Struct> = {};
  const light = plan.light;
  if (plan.clusters.includes('levelControl')) out.levelControl = { currentLevel: 254, minLevel: 1, maxLevel: 254, onLevel: null };
  if (plan.clusters.includes('colorControl') && light) {
    const ct = Math.round((light.minMireds + light.maxMireds) / 2);
    out.colorControl = {
      colorMode: 2,
      enhancedColorMode: 2,
      colorTemperatureMireds: ct,
      colorTempPhysicalMinMireds: light.minMireds,
      colorTempPhysicalMaxMireds: light.maxMireds,
      coupleColorTempToLevelMinMireds: light.minMireds,
      startUpColorTemperatureMireds: null,
      ...(plan.kind === 'extended_color_light' ? { currentHue: 0, currentSaturation: 0, currentX: 24939, currentY: 24701 } : {}),
    };
  }
  if (plan.clusters.includes('occupancySensing')) out.occupancySensing = { occupancy: { occupied: false }, occupancySensorType: 0, occupancySensorTypeBitmap: { pir: true } };
  if (plan.clusters.includes('temperatureMeasurement')) out.temperatureMeasurement = { measuredValue: null, minMeasuredValue: -4000, maxMeasuredValue: 12500 };
  if (plan.clusters.includes('relativeHumidityMeasurement')) out.relativeHumidityMeasurement = { measuredValue: null, minMeasuredValue: 0, maxMeasuredValue: 10000 };
  if (plan.clusters.includes('illuminanceMeasurement')) out.illuminanceMeasurement = { measuredValue: null, minMeasuredValue: 1, maxMeasuredValue: 0xfffe };
  if (plan.clusters.includes('pressureMeasurement')) out.pressureMeasurement = { measuredValue: null, minMeasuredValue: 300, maxMeasuredValue: 1100 };
  if (plan.clusters.includes('powerSource')) {
    out.powerSource = { status: 1, order: 0, description: 'Batería', batChargeLevel: 0, batReplacementNeeded: false, batReplaceability: 1, batPercentRemaining: null };
  }
  if (plan.clusters.includes('electricalPowerMeasurement')) {
    out.electricalPowerMeasurement = {
      powerMode: 2,
      numberOfMeasurementTypes: 1,
      accuracy: [{ measurementType: 2, measured: true, minMeasuredValue: 0, maxMeasuredValue: 4_000_000, accuracyRanges: [accuracyRange(0, 4_000_000)] }],
      activePower: null,
    };
  }
  if (plan.clusters.includes('electricalEnergyMeasurement')) {
    out.electricalEnergyMeasurement = {
      accuracy: { measurementType: 14, measured: true, minMeasuredValue: 0, maxMeasuredValue: 1_000_000_000_000, accuracyRanges: [accuracyRange(0, 1_000_000_000_000)] },
      cumulativeEnergyImported: null,
    };
  }
  if (plan.clusters.includes('doorLock')) out.doorLock = { lockState: null, lockType: 0, actuatorEnabled: true, operatingMode: 0, wrongCodeEntryLimit: 5, userCodeTemporaryDisableTime: 60 };
  if (plan.clusters.includes('windowCovering')) {
    out.windowCovering = {
      type: 0,
      endProductType: 0,
      configStatus: { operational: true, onlineReserved: true, liftMovementReversed: false, liftPositionAware: true, tiltPositionAware: false, liftEncoderControlled: false, tiltEncoderControlled: false },
      operationalStatus: { global: 0, lift: 0, tilt: 0 },
      currentPositionLiftPercent100ths: null,
      targetPositionLiftPercent100ths: null,
      mode: { motorDirectionReversed: false, calibrationMode: false, maintenanceMode: false, ledFeedback: false },
    };
  }
  return out;
}

/** Cambios de atributos (por behavior) que corresponden a un estado del simulador. */
export function patchesFor(plan: MatterDevicePlan, s: MatterState): Array<[string, Struct]> {
  const out: Array<[string, Struct]> = [];
  const has = (c: MatterCluster): boolean => plan.clusters.includes(c);
  if (has('onOff') && s.onOff !== undefined) out.push(['onOff', { onOff: s.onOff }]);
  if (has('levelControl') && s.level !== undefined && s.level !== null) out.push(['levelControl', { currentLevel: s.level }]);
  if (has('colorControl') && s.color && plan.light) {
    const c = s.color;
    if (c.mode === 2 && c.mireds !== undefined) out.push(['colorControl', { colorMode: 2, enhancedColorMode: 2, colorTemperatureMireds: c.mireds }]);
    else if (c.mode !== 2 && plan.kind === 'extended_color_light') {
      out.push(['colorControl', { colorMode: c.mode, enhancedColorMode: c.mode, ...(c.hue !== undefined ? { currentHue: c.hue } : {}), ...(c.saturation !== undefined ? { currentSaturation: c.saturation } : {}), ...(c.x !== undefined ? { currentX: c.x } : {}), ...(c.y !== undefined ? { currentY: c.y } : {}) }]);
    }
  }
  if (has('booleanState') && s.stateValue !== undefined) out.push(['booleanState', { stateValue: s.stateValue }]);
  if (has('occupancySensing') && s.occupied !== undefined) out.push(['occupancySensing', { occupancy: { occupied: s.occupied } }]);
  if (has('temperatureMeasurement') && s.temperature !== undefined) out.push(['temperatureMeasurement', { measuredValue: s.temperature }]);
  if (has('relativeHumidityMeasurement') && s.humidity !== undefined) out.push(['relativeHumidityMeasurement', { measuredValue: s.humidity }]);
  if (has('illuminanceMeasurement') && s.illuminance !== undefined) out.push(['illuminanceMeasurement', { measuredValue: s.illuminance }]);
  if (has('pressureMeasurement') && s.pressure !== undefined) out.push(['pressureMeasurement', { measuredValue: s.pressure }]);
  if (has('powerSource') && s.battery !== undefined) {
    out.push(['powerSource', { batPercentRemaining: s.battery, batChargeLevel: s.battery === null ? 0 : s.battery < 20 ? 2 : s.battery < 40 ? 1 : 0 }]);
  }
  if (has('electricalPowerMeasurement') && s.activePowerMw !== undefined) out.push(['electricalPowerMeasurement', { activePower: s.activePowerMw }]);
  if (has('electricalEnergyMeasurement') && s.energyMwh !== undefined) out.push(['electricalEnergyMeasurement', { cumulativeEnergyImported: s.energyMwh === null ? null : { energy: s.energyMwh } }]);
  if (has('doorLock') && s.lockState !== undefined) out.push(['doorLock', { lockState: s.lockState }]);
  if (has('windowCovering') && s.cover) {
    const m = MOVEMENT[s.cover.moving];
    out.push(['windowCovering', { currentPositionLiftPercent100ths: s.cover.closed100ths, operationalStatus: { global: m, lift: m, tilt: 0 }, ...(s.cover.moving === 'stopped' ? { targetPositionLiftPercent100ths: s.cover.closed100ths } : {}) }]);
  }
  return out;
}

function bridgedInfo(plan: MatterDevicePlan, reachable: boolean): Struct {
  return {
    nodeLabel: plan.name,
    vendorName: plan.vendorName,
    productName: plan.productName,
    productLabel: plan.productName,
    serialNumber: plan.serialNumber,
    uniqueId: plan.uniqueId,
    softwareVersionString: 'simulado',
    hardwareVersionString: 'Radio: modelada, no real',
    reachable,
  };
}

/** Firma del tipo de endpoint: si cambia (otro tipo o clusters), se recrea el endpoint. */
const shapeOf = (plan: MatterDevicePlan): string => JSON.stringify([plan.kind, plan.clusters, plan.light ?? null]);

interface Bridged {
  plan: MatterDevicePlan;
  endpoint: Endpoint;
  shape: string;
  info: string;
}

export interface MatterBridgeOptions {
  /** Entorno de matter.js (los tests usan una red simulada). Por defecto, el de Node con red real. */
  environment?: Environment;
  /** Carpeta de datos de matter.js (solo con el entorno por defecto). */
  storagePath?: string;
  /** Puerto UDP de Matter (matterjs-server ya usa el 5540 en la misma máquina). */
  port: number;
  passcode: number;
  discriminator: number;
  uniqueId: string;
  /** Id del nodo en el almacenamiento de matter.js. */
  id?: string;
  log?: (msg: string) => void;
}

export class MatterBridge {
  private node: ServerNode | undefined;
  private aggregator: Endpoint | undefined;
  private readonly bridged = new Map<string, Bridged>();

  constructor(private readonly opts: MatterBridgeOptions) {}

  get running(): boolean {
    return this.node?.lifecycle.isOnline === true;
  }

  get commissioned(): boolean {
    return this.node?.state.commissioning.commissioned === true;
  }

  /** Código de emparejamiento manual (11 dígitos) para comisionar el bridge. */
  get manualPairingCode(): string {
    return this.node?.state.commissioning.pairingCodes.manualPairingCode ?? '';
  }

  /** Número de endpoint de un dispositivo (estable: matter.js lo guarda por id). */
  endpointNumber(endpointId: string): number | undefined {
    const b = this.bridged.get(endpointId);
    return b ? b.endpoint.number : undefined;
  }

  /** Crea el nodo (aún sin conectar a la red). */
  async create(): Promise<void> {
    if (this.node) return;
    let environment = this.opts.environment;
    if (!environment) {
      environment = Environment.default;
      if (this.opts.storagePath) environment.vars.set('storage.path', this.opts.storagePath);
      // Las señales las gestiona el orquestador (cierra el lab y sale).
      environment.vars.set('runtime.signals', false);
      environment.vars.set('runtime.exitcode', false);
    }
    this.node = await ServerNode.create({
      id: this.opts.id ?? 'hasim-bridge',
      environment,
      network: { port: this.opts.port },
      commissioning: { passcode: this.opts.passcode, discriminator: this.opts.discriminator },
      productDescription: { name: 'HA Simulator Bridge', deviceType: AggregatorEndpoint.deviceType },
      basicInformation: {
        vendorName: 'HA Simulator',
        vendorId: VendorId(0xfff1),
        productName: 'Bridge del laboratorio',
        productLabel: 'Bridge del laboratorio',
        productId: 0x8000,
        nodeLabel: 'HA Simulator',
        serialNumber: this.opts.uniqueId.slice(-12),
        uniqueId: this.opts.uniqueId,
        hardwareVersion: 1,
        hardwareVersionString: 'simulado',
        softwareVersion: 1,
        softwareVersionString: 'simulado',
      },
    });
    this.aggregator = new Endpoint(AggregatorEndpoint, { id: 'aggregator' });
    await this.node.add(this.aggregator);
  }

  /** Conecta el nodo a la red (anuncia por mDNS y acepta el comisionado o las sesiones). */
  async start(): Promise<void> {
    if (!this.node) await this.create();
    if (this.node && !this.node.lifecycle.isOnline) await this.node.start();
  }

  /** Añade o actualiza el endpoint de un dispositivo y aplica su estado. */
  async upsert(plan: MatterDevicePlan, state: MatterState, onCommand: (command: MatterCommand) => void): Promise<void> {
    if (!this.aggregator) await this.create();
    const aggregator = this.aggregator;
    if (!aggregator) return;
    const shape = shapeOf(plan);
    let b = this.bridged.get(plan.endpointId);
    if (b && b.shape !== shape) {
      await this.remove(plan.endpointId);
      b = undefined;
    }
    if (!b) {
      const type = endpointTypeFor(plan);
      const init: Record<string, Struct> = initialClusterState(plan);
      for (const [id, patch] of patchesFor(plan, state)) init[id] = { ...(init[id] ?? {}), ...patch };
      init.bridgedDeviceBasicInformation = bridgedInfo(plan, state.reachable);
      const endpoint = new Endpoint(type, { id: plan.endpointId, ...init });
      setCommandSink(endpoint, onCommand);
      await aggregator.add(endpoint);
      this.bridged.set(plan.endpointId, { plan, endpoint, shape, info: JSON.stringify(bridgedInfo(plan, true)) });
      return;
    }
    b.plan = plan;
    setCommandSink(b.endpoint, onCommand);
    const info = JSON.stringify(bridgedInfo(plan, true));
    if (info !== b.info) {
      b.info = info;
      await b.endpoint.setStateOf('bridgedDeviceBasicInformation', bridgedInfo(plan, state.reachable));
    }
    await this.apply(plan.endpointId, state);
  }

  /** Aplica un estado (solo los atributos presentes) al endpoint de un dispositivo. */
  async apply(endpointId: string, state: MatterState): Promise<void> {
    const b = this.bridged.get(endpointId);
    if (!b) return;
    for (const [id, patch] of patchesFor(b.plan, state)) await b.endpoint.setStateOf(id, patch);
    if (b.endpoint.stateOf('bridgedDeviceBasicInformation').reachable !== state.reachable) {
      await b.endpoint.setStateOf('bridgedDeviceBasicInformation', { reachable: state.reachable });
    }
  }

  /** Quita el endpoint de un dispositivo (HA borra su dispositivo). */
  async remove(endpointId: string): Promise<void> {
    const b = this.bridged.get(endpointId);
    if (!b) return;
    this.bridged.delete(endpointId);
    setCommandSink(b.endpoint, undefined);
    await b.endpoint.delete();
  }

  ids(): string[] {
    return [...this.bridged.keys()];
  }

  /**
   * Restablece el bridge de fábrica (borra sus fabrics): para volver a comisionarlo cuando el
   * servidor Matter ya no lo conoce (p. ej. se borraron sus datos).
   */
  async factoryReset(): Promise<void> {
    if (!this.node) return;
    await this.node.erase();
    if (!this.node.lifecycle.isOnline) await this.node.start();
  }

  async close(): Promise<void> {
    const node = this.node;
    this.node = undefined;
    this.aggregator = undefined;
    for (const b of this.bridged.values()) setCommandSink(b.endpoint, undefined);
    this.bridged.clear();
    if (node) await node.close();
  }
}

/** Menos ruido de matter.js en los logs del orquestador (avisos y errores). */
export function quietMatterLogs(level: 'notice' | 'warn' | 'error' = 'warn'): void {
  Logger.level = level === 'notice' ? LogLevel.NOTICE : level === 'warn' ? LogLevel.WARN : LogLevel.ERROR;
}
