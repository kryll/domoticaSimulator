// Behaviors de matter.js para los endpoints del bridge: los comandos de HA (OnOff, LevelControl,
// ColorControl, DoorLock, WindowCovering) no cambian el estado aquí, se mandan al simulador (el
// mundo físico) y el estado vuelve desde la app, como con ESPHome y Z-Wave. Así HA ve lo que de
// verdad ha pasado en el simulador (si la app no responde, no cambia nada).
import { OnOffServer } from '@matter/main/behaviors/on-off';
import { LevelControlServer } from '@matter/main/behaviors/level-control';
import { ColorControlServer } from '@matter/main/behaviors/color-control';
import { DoorLockServer } from '@matter/main/behaviors/door-lock';
import { WindowCoveringServer } from '@matter/main/behaviors/window-covering';
import type { LevelControl } from '@matter/main/clusters/level-control';
import type { ColorControl } from '@matter/main/clusters/color-control';
import type { WindowCovering } from '@matter/main/clusters/window-covering';
import type { MatterCommand } from '../../../../src/bridge/matter/plan';

type Sink = (command: MatterCommand) => void;

/** Destino de los comandos de cada endpoint (por objeto Endpoint: no choca entre bridges). */
const sinks = new WeakMap<object, Sink>();

export function setCommandSink(endpoint: object, sink: Sink | undefined): void {
  if (sink) sinks.set(endpoint, sink);
  else sinks.delete(endpoint);
}

function emit(endpoint: object, command: MatterCommand): void {
  sinks.get(endpoint)?.(command);
}

export class HasimOnOffServer extends OnOffServer {
  override on(): void {
    emit(this.endpoint, { type: 'onOff', action: 'on' });
  }

  override off(): void {
    emit(this.endpoint, { type: 'onOff', action: 'off' });
  }

  override toggle(): void {
    emit(this.endpoint, { type: 'onOff', action: 'toggle' });
  }
}

/** OnOff de una luz (feature Lighting, obligatoria en los tipos de luz). */
export const HasimLightOnOffServer = HasimOnOffServer.with('Lighting');

export class HasimLevelControlServer extends LevelControlServer.with('OnOff', 'Lighting') {
  override moveToLevel({ level }: LevelControl.MoveToLevelRequest): void {
    emit(this.endpoint, { type: 'level', level, withOnOff: false });
  }

  override moveToLevelWithOnOff({ level }: LevelControl.MoveToLevelRequest): void {
    emit(this.endpoint, { type: 'level', level, withOnOff: true });
  }
}

/** ColorControl con tono/saturación, CIE xy y temperatura de color (luz de color extendida). */
export class HasimColorControlServer extends ColorControlServer.with('HueSaturation', 'Xy', 'ColorTemperature') {
  override moveToHueAndSaturation({ hue, saturation }: ColorControl.MoveToHueAndSaturationRequest): void {
    emit(this.endpoint, { type: 'hueSaturation', hue, saturation });
  }

  override moveToHue({ hue }: ColorControl.MoveToHueRequest): void {
    emit(this.endpoint, { type: 'hueSaturation', hue, saturation: this.state.currentSaturation });
  }

  override moveToSaturation({ saturation }: ColorControl.MoveToSaturationRequest): void {
    emit(this.endpoint, { type: 'hueSaturation', hue: this.state.currentHue, saturation });
  }

  override moveToColor({ colorX, colorY }: ColorControl.MoveToColorRequest): void {
    emit(this.endpoint, { type: 'xy', x: colorX, y: colorY });
  }

  override moveToColorTemperature({ colorTemperatureMireds }: ColorControl.MoveToColorTemperatureRequest): void {
    emit(this.endpoint, { type: 'colorTemperature', mireds: colorTemperatureMireds });
  }
}

/** ColorControl solo con temperatura de color (luz de blanco regulable). */
export class HasimColorTempServer extends ColorControlServer.with('ColorTemperature') {
  override moveToColorTemperature({ colorTemperatureMireds }: ColorControl.MoveToColorTemperatureRequest): void {
    emit(this.endpoint, { type: 'colorTemperature', mireds: colorTemperatureMireds });
  }
}

export class HasimDoorLockServer extends DoorLockServer {
  override lockDoor(): void {
    emit(this.endpoint, { type: 'lock', action: 'lock' });
  }

  override unlockDoor(): void {
    emit(this.endpoint, { type: 'lock', action: 'unlock' });
  }

  override unlockWithTimeout(): void {
    emit(this.endpoint, { type: 'lock', action: 'unlock' });
  }
}

/** Persiana con posición (Lift + PositionAwareLift). */
export class HasimWindowCoveringServer extends WindowCoveringServer.with('Lift', 'PositionAwareLift') {
  override upOrOpen(): void {
    emit(this.endpoint, { type: 'cover', action: 'open' });
  }

  override downOrClose(): void {
    emit(this.endpoint, { type: 'cover', action: 'close' });
  }

  override stopMotion(): void {
    emit(this.endpoint, { type: 'cover', action: 'stop' });
  }

  override goToLiftPercentage({ liftPercent100thsValue }: WindowCovering.GoToLiftPercentageRequest): void {
    emit(this.endpoint, { type: 'coverPosition', closed100ths: liftPercent100thsValue });
  }
}
