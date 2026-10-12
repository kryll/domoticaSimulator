import '../../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { useProjectStore } from '../../store/projectStore';
import { stopSimulationLoop, useSimulationStore } from '../../store/simulationStore';
import { useUiStore } from '../../store/uiStore';
import { useExtrasStore } from '../../store/extrasStore';
import { makeDevice, makeProject } from '../../test/fixtures';

function setup() {
  const project = makeProject({
    floors: [{ id: 'f1', name: 'Planta baja', level: 0, pixelsPerMeter: 40, walls: [{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, material: 'brick' }] }],
    rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }],
    devices: [
      { ...makeDevice('hue-white-e27', 'luz', 100, 100, 'Luz salón'), roomId: 'r1' },
      { ...makeDevice('sonoff-minir4', 'rele', 200, 100, 'Relé'), roomId: 'r1' },
    ],
  });
  useUiStore.getState().reset();
  useExtrasStore.getState().reset();
  useProjectStore.getState().loadProject(project);
  useSimulationStore.getState().reset(project);
  useUiStore.getState().setActiveFloor('f1');
  render(<App autoLoad={false} />);
}

describe('capas y menús de la Fase 3 en el lienzo', () => {
  beforeEach(setup);
  afterEach(() => stopSimulationLoop());

  it('dibuja las paredes de la planta y entra en el modo «Dibujar pared»', async () => {
    expect(screen.getByTestId('walls-layer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dibujar' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dibujar pared' }));
    expect(useUiStore.getState().canvasMode).toBe('wall');
    expect(screen.getByLabelText('Zona de dibujo de paredes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar última' }));
    expect(useProjectStore.getState().project.floors[0]?.walls).toEqual([]);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useUiStore.getState().canvasMode).toBe('select');
  });

  it('la capa Clima muestra la temperatura de cada sala', async () => {
    act(() => {
      useSimulationStore.setState((s) => ({ sim: { ...s.sim, environment: { outdoorTemperature: 9.5, rooms: { r1: { temperature: 22.34, illuminance: 100 } } } } }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Capas' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Clima' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Clima' })).toHaveAttribute('aria-checked', 'true');
    const layer = await screen.findByTestId('climate-layer');
    expect(layer).toHaveTextContent('22,3 °C');
    expect(screen.getByText(/Exterior:/)).toHaveTextContent('9,5 °C');
  });

  it('menú contextual de la planta: «Apagar todo en esta planta»', async () => {
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'light.turn_on'));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Planta baja' }));
    const menu = screen.getByRole('menu', { name: 'Acciones de la planta Planta baja' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Apagar todo en esta planta' }));
    await waitFor(() => expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('off'));
  });

  it('«Mostrar como luz» en las propiedades del relé', async () => {
    act(() => useUiStore.getState().select({ kind: 'device', id: 'rele' }));
    const props = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.click(within(props).getByRole('checkbox', { name: /Mostrar como luz/ }));
    expect(useProjectStore.getState().project.devices.find((d) => d.id === 'rele')?.showAs).toBe('light');
    expect(within(props).getByText('light.rele')).toBeInTheDocument();
  });

  it('Hogar y Pruebas en sus grupos y el Dashboard como vista del área central', { timeout: 20000 }, async () => {
    await userEvent.click(screen.getByRole('button', { name: /^Uso: grupo de pestañas/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Hogar' }));
    expect(await screen.findByRole('heading', { name: 'Personas' }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Variantes' }, { timeout: 5000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByRole('button', { name: 'Exportar YAML Lovelace' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Dashboard' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Plano' }));
    expect(screen.queryByRole('region', { name: 'Dashboard' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Lógica: grupo de pestañas/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Pruebas' }));
    expect(await screen.findByRole('button', { name: '+ Nueva prueba' }, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('«Mostrar como luz» con el proyecto de ejemplo', () => {
  afterEach(() => stopSimulationLoop());

  it('el enchufe pasa a ser luz y la automatización de fuga sigue funcionando', async () => {
    const { createDemoProject } = await import('../../store/demoProject');
    const project = createDemoProject();
    useUiStore.getState().reset();
    useExtrasStore.getState().reset();
    useProjectStore.getState().loadProject(project);
    useSimulationStore.getState().reset(project);
    render(<App autoLoad={false} />);
    // Espera al arranque de la app (fija la planta activa) antes de seleccionar.
    await act(async () => {});
    act(() => {
      useUiStore.getState().setActiveFloor(project.devices.find((d) => d.id === 'demo-enchufe-bano')?.floorId ?? null);
      useUiStore.getState().select({ kind: 'device', id: 'demo-enchufe-bano' });
    });
    const props = screen.getByRole('complementary', { name: 'Propiedades' });
    await userEvent.click(within(props).getByRole('checkbox', { name: /Mostrar como luz/ }));
    const auto = useProjectStore.getState().project.automations.find((a) => a.id === 'demo-auto-fuga');
    expect(auto?.actions[0]).toMatchObject({ service: 'light.turn_off', entityId: 'light.enchufe_bano_switch' });
    expect(within(props).getByText('light.enchufe_bano_switch')).toBeInTheDocument();

    act(() => useSimulationStore.getState().callService('light.enchufe_bano_switch', 'light.turn_on'));
    expect(useSimulationStore.getState().sim.entities['light.enchufe_bano_switch']?.state).toBe('on');
    act(() => useSimulationStore.getState().setBinary('binary_sensor.fuga_bano_leak', true));
    await waitFor(() => expect(useSimulationStore.getState().sim.entities['light.enchufe_bano_switch']?.state).toBe('off'));
    expect(useSimulationStore.getState().sim.entities['switch.enchufe_bano_switch']).toBeUndefined();
  });
});
