import '../test/flowMocks';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { App } from '../App';
import { Legend } from './Legend';
import { ZoomLevelClass } from './readability';
import { COMPACT_CLASS, isCompactZoom, visibleConnections } from './zoomLevel';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { PREF_KEYS, useViewStore } from '../store/viewStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('lienzo legible', () => {
  beforeEach(() => {
    localStorage.clear();
    useViewStore.getState().reset();
    useUiStore.getState().reset();
  });
  afterEach(() => stopSimulationLoop());

  it('la leyenda se pliega y se recuerda', async () => {
    const { unmount } = render(<Legend protocols={['zigbee', 'wifi']} />);
    const toggle = screen.getByRole('button', { name: /Protocolos/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Zigbee')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText('Zigbee')).toBeNull();
    expect(localStorage.getItem(PREF_KEYS.legend)).toBe('0');
    unmount();
    useViewStore.getState().reset();
    render(<Legend protocols={['zigbee']} />);
    expect(screen.getByRole('button', { name: /Protocolos/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('el minimapa se pliega desde el lienzo y se recuerda; la capa «Conexiones» tiene 3 opciones', async () => {
    const p = makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    render(<App autoLoad={false} />);
    await act(async () => {});
    const toggle = screen.getByRole('button', { name: /Minimapa/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(useViewStore.getState().showMinimap).toBe(false);
    expect(localStorage.getItem(PREF_KEYS.minimap)).toBe('0');

    await userEvent.click(screen.getByRole('button', { name: 'Capas' }));
    const radios = ['Todas', 'Solo del seleccionado', 'Ninguna'].map((name) => screen.getByRole('menuitemradio', { name }));
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(radios[2]!);
    expect(useViewStore.getState().connectionsLayer).toBe('none');
    expect(localStorage.getItem(PREF_KEYS.connections)).toBe('none');
  });

  it('visibleConnections filtra según la capa', () => {
    const p = makeProject({
      devices: [makeDevice('hue-white-e27', 'a'), makeDevice('hue-white-e27', 'b'), makeDevice('hue-white-e27', 'c')],
      connections: [
        { id: 'ab', sourceId: 'a', targetId: 'b', protocol: 'zigbee' },
        { id: 'bc', sourceId: 'b', targetId: 'c', protocol: 'zigbee' },
      ],
    });
    const none = { ids: new Set<string>(), kind: null };
    expect(visibleConnections(p, 'f1', 'all', none).map((c) => c.id)).toEqual(['ab', 'bc']);
    expect(visibleConnections(p, 'f1', 'none', none)).toEqual([]);
    expect(visibleConnections(p, 'f1', 'selected', none)).toEqual([]);
    expect(visibleConnections(p, 'f1', 'selected', { ids: new Set(['a']), kind: 'device' }).map((c) => c.id)).toEqual(['ab']);
  });

  it('zoom semántico: con poco zoom el contenedor lleva la clase compacta', () => {
    expect(isCompactZoom(0.4)).toBe(true);
    expect(isCompactZoom(1)).toBe(false);
    render(
      <div id="zoom-host" style={{ width: 400, height: 300 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={[]} edges={[]} defaultViewport={{ x: 0, y: 0, zoom: 0.3 }}>
            <ZoomLevelClass containerId="zoom-host" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>,
    );
    const host = document.getElementById('zoom-host');
    expect(host).toHaveClass(COMPACT_CLASS);
    expect(host?.dataset.zoom).toBe('compact');
  });
});
