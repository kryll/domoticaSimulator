// Guía de primeros pasos: qué pasos están hechos según el proyecto (lógica pura).
import type { DeviceDefinition, Project } from '../types';

export type GuideStep = 'room' | 'server' | 'devices';

export interface GuideStepInfo {
  key: GuideStep;
  title: string;
  hint: string;
  action: string;
}

export const GUIDE_STEPS: GuideStepInfo[] = [
  { key: 'room', title: 'Dibuja una sala', hint: 'Arrastra en el lienzo para trazar un rectángulo.', action: 'Dibujar sala' },
  {
    key: 'server',
    title: 'Añade el servidor de Home Assistant',
    hint: 'Es el cerebro de la instalación: todo se conecta a él.',
    action: 'Añadir servidor',
  },
  { key: 'devices', title: 'Añade dispositivos', hint: 'Búscalos en el catálogo y pulsa «+» o arrástralos.', action: 'Buscar en el catálogo' },
];

/** Pasos completados según el contenido del proyecto. */
export function guideProgress(project: Project, defs: DeviceDefinition[]): Record<GuideStep, boolean> {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const roleOf = (definitionId: string) => byId.get(definitionId)?.role;
  return {
    room: project.rooms.length > 0,
    server: project.devices.some((d) => roleOf(d.definitionId) === 'ha_server'),
    devices: project.devices.some((d) => roleOf(d.definitionId) !== 'ha_server'),
  };
}

/** ¿El proyecto está vacío (sin salas ni dispositivos)? */
export function isEmptyProject(project: Project): boolean {
  return project.rooms.length === 0 && project.devices.length === 0;
}

/** Definición del servidor de Home Assistant que se propone por defecto. */
export function defaultServerDefinition(defs: DeviceDefinition[]): DeviceDefinition | undefined {
  return defs.find((d) => d.id === 'ha-green') ?? defs.find((d) => d.role === 'ha_server');
}
