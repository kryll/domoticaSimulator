import type { Edge, Node } from '@xyflow/react';
import type { Device, DeviceDefinition, IssueSeverity, Protocol, Room } from '../types';
import type { DeviceView } from '../devices/presentation';
import type { CanvasMode } from '../store/uiStore';

export type DeviceNodeData = {
  device: Device;
  definition?: DeviceDefinition;
  /** Presentación del estado en la simulación (null si falta la definición). */
  view: DeviceView | null;
  /** Etiqueta de la acción principal (clic en Uso, ⏻ en Edición), si la hay. */
  primaryLabel?: string;
  /** ¿La rueda y ↑/↓ ajustan algo? Si no, la rueda hace zoom. */
  steppable: boolean;
  /** Icono del dispositivo. */
  icon: string;
  mode: CanvasMode;
  /** Popover de control abierto. */
  popoverOpen: boolean;
  /** Cambia con cada nueva entrada del registro sobre el dispositivo (para el destello). */
  activityKey?: string;
  active: boolean;
  issueSeverity?: IssueSeverity;
  issueMessages: string[];
  unreachable: boolean;
  highlighted: boolean;
  connectMode: boolean;
  /** Potencia que consume ahora (W), solo si tiene carga activa. */
  watts?: number;
  /** Nivel de batería (%) de los dispositivos a pilas. */
  batteryPct?: number;
  /** Conexiones con dispositivos de otras plantas. */
  crossFloorLinks: Array<{ deviceName: string; floorName: string }>;
};

export type RoomNodeData = {
  room: Room;
  deviceCount: number;
};

export type RoomLabelNodeData = {
  name: string;
  deviceCount: number;
};

export type PlanNodeData = {
  src: string;
};

export type DeviceNode = Node<DeviceNodeData, 'device'>;
export type RoomNode = Node<RoomNodeData, 'room'>;
export type PlanNode = Node<PlanNodeData, 'plan'>;
export type RoomLabelNode = Node<RoomLabelNodeData, 'roomLabel'>;
export type AppNode = DeviceNode | RoomNode | PlanNode | RoomLabelNode;

export type ProtocolEdgeData = { protocol: Protocol };
export type ProtocolEdge = Edge<ProtocolEdgeData, 'protocol'>;

/** Tipo MIME para arrastrar definiciones del catálogo al lienzo. */
export const DEVICE_DRAG_MIME = 'application/x-ha-device';
