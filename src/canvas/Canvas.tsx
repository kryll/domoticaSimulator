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
import { useUiStore, type CanvasMode, type Selection } from '../store/uiStore';
import { deviceIcon } from '../devices/presentation';
import { devicePresentation } from './viewCache';
import { mergeNodes } from './mergeNodes';
import { useShallow } from 'zustand/react/shallow';
import { analyzeProject, definitionOf, entitiesOfDevice } from './analysis';
import { addDeviceFromDefinition, connectDevices } from './actions';
import { polygonBounds } from './geometry';
import { DeviceContextMenu } from './DeviceContextMenu';
import { setHoveredDevice, useCanvasKeyboard } from './useCanvasKeyboard';
import { DEVICE_DRAG_MIME, type AppNode, type DeviceNode, type ProtocolEdge, type RoomNode, type PlanNode, type RoomLabelNode } from './types';
import { DeviceNodeView } from './DeviceNodeView';
import { RoomLabelNodeView, RoomNodeView } from './RoomNodeView';
import { roomLabelPosition } from './roomLabel';
import { PlanNodeView } from './PlanNodeView';
import { ProtocolEdgeView } from './ProtocolEdgeView';
import { CanvasToolbar } from './CanvasToolbar';
import { Legend } from './Legend';
import { CoverageLayer } from './CoverageLayer';
import { RoomDrawOverlay } from './RoomDrawOverlay';
import { PROTOCOL_COLORS } from './style';
import { CanvasExtras } from './extras/CanvasExtras';
import { FloorContextMenu } from './extras/FloorContextMenu';
import { useExtrasStore } from '../store/extrasStore';

const nodeTypes: NodeTypes = { device: DeviceNodeView, room: RoomNodeView, plan: PlanNodeView, roomLabel: RoomLabelNodeView };
const edgeTypes: EdgeTypes = { protocol: ProtocolEdgeView };

const severityRank: Record<IssueSeverity, number> = { error: 3, warning: 2, info: 1 };

function isSelected(selection: Selection | null, kind: Selection['kind'], id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}

/** entity_id -> id de su última entrada en el registro. */
function lastLogByEntity(log: SimulationState['log']): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry?.entityId && !map.has(entry.entityId)) map.set(entry.entityId, entry.id);
  }
  return map;
}

interface BuildOptions {
  selection: Selection | null;
  highlighted: string[];
  mode: CanvasMode;
  popoverDeviceId: string | null;
}

function buildNodes(project: Project, floorId: string, sim: SimulationState, opts: BuildOptions): AppNode[] {
  const { selection, highlighted, mode, popoverDeviceId } = opts;
  const connectMode = mode === 'connect';
  const roomsDraggable = mode === 'select';
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

  const devicePoints = project.devices.filter((d) => d.floorId === floorId).map((d) => d.position);
  for (const room of project.rooms) {
    if (room.floorId !== floorId) continue;
    const b = polygonBounds(room.polygon);
    const deviceCount = project.devices.filter((d) => d.roomId === room.id).length;
    const label: RoomLabelNode = {
      id: `label-${room.id}`,
      type: 'roomLabel',
      position: roomLabelPosition(b, devicePoints, room.name.length * 8 + (deviceCount > 0 ? 64 : 34)),
      data: { name: room.name, deviceCount },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: 0,
      style: { pointerEvents: 'none' },
    };
    nodes.push(label);
    const node: RoomNode = {
      id: room.id,
      type: 'room',
      position: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      width: b.width,
      height: b.height,
      data: { room, deviceCount },
      selected: isSelected(selection, 'room', room.id),
      draggable: roomsDraggable,
      connectable: false,
      zIndex: -1,
    };
    nodes.push(node);
  }

  const devicesById = new Map(project.devices.map((d) => [d.id, d]));
  const floorNames = new Map(project.floors.map((f) => [f.id, f.name]));
  const crossLinks = new Map<string, Array<{ deviceName: string; floorName: string }>>();
  for (const c of project.connections) {
    const a = devicesById.get(c.sourceId);
    const b = devicesById.get(c.targetId);
    if (!a || !b || a.floorId === b.floorId) continue;
    for (const [here, there] of [
      [a, b],
      [b, a],
    ] as const) {
      if (here.floorId !== floorId) continue;
      const list = crossLinks.get(here.id) ?? [];
      list.push({ deviceName: there.name, floorName: floorNames.get(there.floorId) ?? '?' });
      crossLinks.set(here.id, list);
    }
  }

  const lastLog = lastLogByEntity(sim.log);
  for (const device of project.devices) {
    if (device.floorId !== floorId) continue;
    const definition = definitionOf(device);
    const presentation = definition ? devicePresentation(device, definition, sim) : null;
    const view = presentation?.view ?? null;
    const primary = presentation?.primary ?? null;
    const activity = entitiesOfDevice(device)
      .map((r) => lastLog.get(r.entityId))
      .filter((x): x is string => x !== undefined)
      .sort()
      .join('|');
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
        definition,
        view,
        steppable: presentation?.steppable ?? false,
        icon: definition ? deviceIcon(definition) : '❔',
        mode,
        popoverOpen: popoverDeviceId === device.id,
        ...(primary ? { primaryLabel: primary.label } : {}),
        activityKey: activity || undefined,
        active: view?.active ?? false,
        issueSeverity: severity,
        issueMessages: issues.map((i) => i.message),
        unreachable: analysis.unreachable.has(device.id),
        highlighted: highlightSet.has(device.id),
        connectMode,
        crossFloorLinks: crossLinks.get(device.id) ?? [],
      },
      selected: isSelected(selection, 'device', device.id),
      ariaLabel: `${device.name}: ${view?.unavailable ? 'no disponible' : [view?.summary, view?.secondary].filter(Boolean).join(', ')}`,
      draggable: mode === 'select' || mode === 'room',
      zIndex: popoverDeviceId === device.id ? 5 : 1,
    };
    nodes.push(node);
  }
  return nodes;
}

/** Espera para distinguir clic de doble clic en modo Uso. */
export const DOUBLE_CLICK_MS = 220;
let pendingClick: ReturnType<typeof setTimeout> | undefined;
function cancelPendingClick() {
  if (pendingClick) clearTimeout(pendingClick);
  pendingClick = undefined;
}

export function Canvas() {
  const project = useProjectStore((s) => s.project);
  const activeFloorId = useUiStore((s) => s.activeFloorId);
  const selection = useUiStore((s) => s.selection);
  const highlighted = useUiStore((s) => s.highlightedDeviceIds);
  const mode = useUiStore((s) => s.canvasMode);
  const showCoverage = useUiStore((s) => s.showCoverage);
  const focusRequest = useUiStore((s) => s.focusRequest);
  // Sin `now`: el lienzo solo se recalcula cuando cambian estados, temporizadores o fallos.
  const simParts = useSimulationStore(
    useShallow((s) => ({ entities: s.sim.entities, pending: s.sim.pending, offline: s.sim.offline, log: s.sim.log })),
  );
  const popoverDeviceId = useUiStore((s) => s.popoverDeviceId);
  const connectFromId = useUiStore((s) => s.connectFromId);
  const { screenToFlowPosition, fitView } = useReactFlow();
  useCanvasKeyboard();

  const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
  const floorId = floor?.id ?? '';
  const interact = mode === 'interact';

  const derived = useMemo(
    () => buildNodes(project, floorId, { ...useSimulationStore.getState().sim, ...simParts }, { selection, highlighted, mode, popoverDeviceId }),
    [project, floorId, simParts, selection, highlighted, mode, popoverDeviceId],
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
    (e, node) => {
      const ui = useUiStore.getState();
      ui.openContextMenu(null);
      if (node.type === 'device') {
        if (ui.connectFromId) {
          if (ui.connectFromId !== node.id) {
            connectDevices(ui.connectFromId, node.id);
            ui.setConnectFrom(null);
            ui.setCanvasMode('select');
          }
          return;
        }
        const usar = ui.canvasMode === 'interact';
        if (usar && !e.shiftKey) {
          // Se espera un instante por si es un doble clic (que abre el control completo).
          if (e.detail > 1) return;
          cancelPendingClick();
          const id = node.id;
          pendingClick = setTimeout(() => {
            pendingClick = undefined;
            const done = useSimulationStore.getState().quickAction(id);
            if (!done) useUiStore.getState().openPopover(id);
          }, DOUBLE_CLICK_MS);
          return;
        }
        if (e.altKey && ui.canvasMode === 'select') {
          useSimulationStore.getState().quickAction(node.id);
          return;
        }
        select({ kind: 'device', id: node.id });
      } else if (node.type === 'room') {
        if (ui.canvasMode !== 'interact') select({ kind: 'room', id: node.id });
      }
    },
    [select],
  );
  const onNodeDoubleClick: NodeMouseHandler<AppNode> = useCallback((_e, node) => {
    cancelPendingClick();
    if (node.type !== 'device' || useUiStore.getState().canvasMode === 'connect') return;
    useUiStore.getState().openPopover(node.id);
  }, []);
  const onNodeContextMenu: NodeMouseHandler<AppNode> = useCallback((e, node) => {
    if (node.type !== 'device') return;
    e.preventDefault();
    useUiStore.getState().openContextMenu({ deviceId: node.id, x: e.clientX, y: e.clientY });
  }, []);
  const onNodeMouseEnter: NodeMouseHandler<AppNode> = useCallback((_e, node) => {
    if (node.type === 'device') setHoveredDevice(node.id);
  }, []);
  const onNodeMouseLeave: NodeMouseHandler<AppNode> = useCallback(() => setHoveredDevice(null), []);
  const onPaneClick = useCallback(() => {
    const ui = useUiStore.getState();
    ui.select(null);
    ui.openPopover(null);
    ui.openContextMenu(null);
    if (ui.connectFromId) ui.setConnectFrom(null);
  }, []);
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
      useProjectStore.getState().removeElements({
        deviceIds: deletedNodes.filter((n) => n.type === 'device').map((n) => n.id),
        roomIds: deletedNodes.filter((n) => n.type === 'room').map((n) => n.id),
        connectionIds: deletedEdges.map((e) => e.id),
      });
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

  const floorDevices = useMemo(() => project.devices.filter((d) => d.floorId === floorId), [project, floorId]);
  const floorRooms = useMemo(() => project.rooms.filter((r) => r.floorId === floorId), [project.rooms, floorId]);

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
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          useUiStore.getState().openContextMenu(null);
          if (floorId) useExtrasStore.getState().openFloorMenu({ floorId, x: e.clientX, y: e.clientY });
        }}
        nodesDraggable={!interact}
        nodeDragThreshold={4}
        zoomOnDoubleClick={false}
        onNodeDragStop={onNodeDragStop}
        onDelete={onDelete}
        onConnect={onConnect}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        deleteKeyCode={interact ? null : ['Delete', 'Backspace']}
        panOnDrag={mode !== 'room' && mode !== 'wall'}
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
        <CanvasExtras floor={floor} rooms={floorRooms} />
        {connectFromId && (
          <FlowPanel position="top-right">
            <p className="rounded-md bg-sky-700/95 px-2 py-1 text-xs font-medium text-white shadow" role="status">
              Elige el dispositivo de destino · Esc cancela
            </p>
          </FlowPanel>
        )}
      </ReactFlow>
      <DeviceContextMenu />
      <FloorContextMenu />
    </div>
  );
}
