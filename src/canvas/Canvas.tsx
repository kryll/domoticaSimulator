import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel as FlowPanel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Connection as FlowConnection,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type OnDelete,
  type NodeMouseHandler,
  type OnNodeDrag,
  type EdgeMouseHandler,
} from '@xyflow/react';
import type { IssueSeverity, Project, SimulationState } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore, type Selection } from '../store/uiStore';
import { analyzeProject, definitionOf, entitiesOfDevice } from './analysis';
import { addDeviceFromDefinition, connectDevices } from './actions';
import { polygonBounds } from './geometry';
import { formatState, isActiveState } from './style';
import { DEVICE_DRAG_MIME, type AppNode, type DeviceNode, type ProtocolEdge, type RoomNode, type PlanNode } from './types';
import { DeviceNodeView } from './DeviceNodeView';
import { RoomNodeView } from './RoomNodeView';
import { PlanNodeView } from './PlanNodeView';
import { ProtocolEdgeView } from './ProtocolEdgeView';
import { CanvasToolbar } from './CanvasToolbar';
import { Legend } from './Legend';
import { CoverageLayer } from './CoverageLayer';
import { RoomDrawOverlay } from './RoomDrawOverlay';
import { PROTOCOL_COLORS } from './style';

const nodeTypes: NodeTypes = { device: DeviceNodeView, room: RoomNodeView, plan: PlanNodeView };
const edgeTypes: EdgeTypes = { protocol: ProtocolEdgeView };

const severityRank: Record<IssueSeverity, number> = { error: 3, warning: 2, info: 1 };

function isSelected(selection: Selection | null, kind: Selection['kind'], id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}

function buildNodes(
  project: Project,
  floorId: string,
  entities: SimulationState['entities'],
  selection: Selection | null,
  highlighted: string[],
  connectMode: boolean,
  roomsDraggable: boolean,
): AppNode[] {
  const floor = project.floors.find((f) => f.id === floorId);
  const analysis = analyzeProject(project);
  const highlightSet = new Set(highlighted);
  const nodes: AppNode[] = [];

  if (floor?.backgroundImage) {
    const plan: PlanNode = {
      id: `plan-${floor.id}`,
      type: 'plan',
      position: { x: 0, y: 0 },
      origin: [0, 0],
      data: { src: floor.backgroundImage },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -2,
      style: { pointerEvents: 'none' },
    };
    nodes.push(plan);
  }

  for (const room of project.rooms) {
    if (room.floorId !== floorId) continue;
    const b = polygonBounds(room.polygon);
    const node: RoomNode = {
      id: room.id,
      type: 'room',
      position: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      width: b.width,
      height: b.height,
      data: { room, deviceCount: project.devices.filter((d) => d.roomId === room.id).length },
      selected: isSelected(selection, 'room', room.id),
      draggable: roomsDraggable,
      connectable: false,
      zIndex: -1,
    };
    nodes.push(node);
  }

  for (const device of project.devices) {
    if (device.floorId !== floorId) continue;
    const refs = entitiesOfDevice(device);
    const states = refs.map((r) => entities[r.entityId]);
    const active = refs.some((r, i) => r.definition.domain !== 'sensor' && isActiveState(states[i]));
    const first = refs[0];
    const issues = analysis.issuesByDevice.get(device.id) ?? [];
    let severity: IssueSeverity | undefined;
    for (const issue of issues) {
      if (!severity || severityRank[issue.severity] > severityRank[severity]) severity = issue.severity;
    }
    const node: DeviceNode = {
      id: device.id,
      type: 'device',
      position: device.position,
      data: {
        device,
        definition: definitionOf(device),
        stateLabel: first ? formatState(states[0], first.definition.unit) : undefined,
        active,
        issueSeverity: severity,
        issueMessages: issues.map((i) => i.message),
        unreachable: analysis.unreachable.has(device.id),
        highlighted: highlightSet.has(device.id),
        connectMode,
      },
      selected: isSelected(selection, 'device', device.id),
      draggable: !connectMode,
      zIndex: 1,
    };
    nodes.push(node);
  }
  return nodes;
}

/** Fusiona los nodos derivados conservando medidas y posición durante el arrastre. */
function mergeNodes(prev: AppNode[], next: AppNode[]): AppNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const old = byId.get(n.id);
    if (!old) return n;
    return {
      ...n,
      measured: old.measured,
      dragging: old.dragging,
      position: old.dragging ? old.position : n.position,
    } as AppNode;
  });
}

export function Canvas() {
  const project = useProjectStore((s) => s.project);
  const activeFloorId = useUiStore((s) => s.activeFloorId);
  const selection = useUiStore((s) => s.selection);
  const highlighted = useUiStore((s) => s.highlightedDeviceIds);
  const mode = useUiStore((s) => s.canvasMode);
  const showCoverage = useUiStore((s) => s.showCoverage);
  const focusRequest = useUiStore((s) => s.focusRequest);
  const entities = useSimulationStore((s) => s.sim.entities);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
  const floorId = floor?.id ?? '';
  const connectMode = mode === 'connect';

  const derived = useMemo(
    () => buildNodes(project, floorId, entities, selection, highlighted, connectMode, mode === 'select'),
    [project, floorId, entities, selection, highlighted, connectMode, mode],
  );
  const [nodes, setNodes] = useState<AppNode[]>(derived);
  useEffect(() => setNodes((prev) => mergeNodes(prev, derived)), [derived]);

  const edges = useMemo<ProtocolEdge[]>(() => {
    const onFloor = new Set(project.devices.filter((d) => d.floorId === floorId).map((d) => d.id));
    return project.connections
      .filter((c) => onFloor.has(c.sourceId) && onFloor.has(c.targetId))
      .map((c) => ({
        id: c.id,
        source: c.sourceId,
        target: c.targetId,
        type: 'protocol',
        data: { protocol: c.protocol },
        selected: isSelected(selection, 'connection', c.id),
      }));
  }, [project, floorId, selection]);

  const usedProtocols = useMemo(() => {
    const set = new Set(project.connections.map((c) => c.protocol));
    for (const d of project.devices) set.add(d.protocol);
    return (Object.keys(PROTOCOL_COLORS) as Array<keyof typeof PROTOCOL_COLORS>).filter((p) => set.has(p));
  }, [project]);

  const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
    const relevant = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
    if (relevant.length > 0) setNodes((nds) => applyNodeChanges(relevant, nds));
  }, []);

  const select = useUiStore((s) => s.select);
  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_e, node) => {
      if (node.type === 'device') select({ kind: 'device', id: node.id });
      else if (node.type === 'room') select({ kind: 'room', id: node.id });
    },
    [select],
  );
  const onEdgeClick: EdgeMouseHandler<ProtocolEdge> = useCallback(
    (_e, edge) => select({ kind: 'connection', id: edge.id }),
    [select],
  );

  const onNodeDragStop: OnNodeDrag<AppNode> = useCallback(
    (_e, node) => {
      const store = useProjectStore.getState();
      if (node.type === 'device') {
        store.moveDevice(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
        select({ kind: 'device', id: node.id });
      } else if (node.type === 'room') {
        const room = store.project.rooms.find((r) => r.id === node.id);
        if (!room) return;
        const b = polygonBounds(room.polygon);
        const dx = Math.round(node.position.x - (b.x + b.width / 2));
        const dy = Math.round(node.position.y - (b.y + b.height / 2));
        store.moveRoom(room.id, dx, dy);
        select({ kind: 'room', id: room.id });
      }
    },
    [select],
  );

  const onDelete: OnDelete<AppNode, ProtocolEdge> = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }) => {
      const store = useProjectStore.getState();
      const deviceIds = deletedNodes.filter((n) => n.type === 'device').map((n) => n.id);
      const roomIds = deletedNodes.filter((n) => n.type === 'room').map((n) => n.id);
      store.removeConnections(deletedEdges.map((e) => e.id));
      store.removeDevices(deviceIds);
      for (const id of roomIds) store.removeRoom(id);
      select(null);
    },
    [select],
  );

  const onConnect = useCallback((c: FlowConnection) => {
    connectDevices(c.source, c.target);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DEVICE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const defId = e.dataTransfer.getData(DEVICE_DRAG_MIME);
      if (!defId) return;
      e.preventDefault();
      addDeviceFromDefinition(defId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [screenToFlowPosition],
  );

  useEffect(() => {
    if (!focusRequest || focusRequest.deviceIds.length === 0) return;
    const t = setTimeout(() => {
      void fitView({ nodes: focusRequest.deviceIds.map((id) => ({ id })), duration: 400, padding: 0.6, maxZoom: 1.4 });
    }, 50);
    return () => clearTimeout(t);
  }, [focusRequest, fitView]);

  useEffect(() => {
    if (mode !== 'room') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().setCanvasMode('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const floorDevices = useMemo(() => project.devices.filter((d) => d.floorId === floorId), [project, floorId]);

  return (
    <div id="ha-canvas" className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop} aria-label="Lienzo del plano">
      <ReactFlow<AppNode, ProtocolEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0.5, 0.5]}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => select(null)}
        onNodeDragStop={onNodeDragStop}
        onDelete={onDelete}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        deleteKeyCode={['Delete', 'Backspace']}
        panOnDrag={mode !== 'room'}
        selectionOnDrag={false}
        fitView
        minZoom={0.1}
        maxZoom={3}
      >
        <Background gap={20} size={1} color="#cbd5e1" />
        {showCoverage && floor && <CoverageLayer devices={floorDevices} floor={floor} />}
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden md:!block" />
        <FlowPanel position="top-left">
          <CanvasToolbar />
        </FlowPanel>
        <FlowPanel position="bottom-center">
          <Legend protocols={usedProtocols.length > 0 ? usedProtocols : undefined} />
        </FlowPanel>
        {mode === 'room' && floorId && <RoomDrawOverlay floorId={floorId} />}
      </ReactFlow>
    </div>
  );
}
