import { ClimateControl } from './ClimateControl';
import { CoverControl } from './CoverControl';
import { LightControl } from './LightControl';
import { LockControl } from './LockControl';
import { MediaControl } from './MediaControl';
import { ToggleControl } from './ToggleControl';
import { VacuumControl } from './VacuumControl';
import { AlarmControl } from './AlarmControl';
import { ValveControl } from './ValveControl';
import type { ControlProps, SensorEvents } from './types';
import { CtlButton } from './primitives';

/** Dominios con control por servicios (los que pueden ir en una escena). */
export const ACTUATOR_DOMAINS = new Set(['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'vacuum', 'camera', 'alarm_control_panel', 'valve']);

/** Control de una entidad actuadora, compartido por el popover, Propiedades y las escenas. */
export function ActuatorControl(props: ControlProps & { events?: SensorEvents }) {
  switch (props.definition.domain) {
    case 'light':
      return <LightControl {...props} />;
    case 'cover':
      return <CoverControl {...props} />;
    case 'climate':
      return <ClimateControl {...props} />;
    case 'media_player':
      return <MediaControl {...props} />;
    case 'vacuum':
      return <VacuumControl {...props} />;
    case 'lock':
      return <LockControl {...props} />;
    case 'alarm_control_panel':
      return <AlarmControl {...props} />;
    case 'valve':
      return <ValveControl {...props} />;
    case 'switch':
    case 'fan':
    case 'camera':
      return <ToggleControl {...props} />;
    case 'button':
      return props.target ? null : <CtlButton onClick={() => props.onService('press')}>Pulsar</CtlButton>;
    default:
      return null;
  }
}
