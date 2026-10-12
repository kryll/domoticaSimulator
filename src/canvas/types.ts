import type { Edge, Node } from '@xyflow/react';
import type { Device, DeviceDefinition, IssueSeverity, Protocol, Room } from '../types';

export type DeviceNodeData = {
  device: Device;
  definition?: DeviceDefinition;
  /** Texto del estado principal en la simulación. */
  stateLabel?: string;
  active: boolean;
  issueSeverity?: IssueSeverity;
  issueMessages: string[];
  unreachable: boolean;
  highlighted: boolean;
  connectMode: boolean;
};

export type RoomNodeData = {
  room: Room;
  deviceCount: number;
};

export type PlanNodeData = {
  src: string;
};

export type DeviceNode = Node<DeviceNodeData, 'device'>;
export type RoomNode = Node<RoomNodeData, 'room'>;
export type PlanNode = Node<PlanNodeData, 'plan'>;
export type AppNode = DeviceNode | RoomNode | PlanNode;

export type ProtocolEdgeData = { protocol: Protocol };
export type ProtocolEdge = Edge<ProtocolEdgeData, 'protocol'>;

/** Tipo MIME para arrastrar definiciones del catálogo al lienzo. */
export const DEVICE_DRAG_MIME = 'application/x-ha-device';
