import '../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { PREF_KEYS, tourDone, useViewStore, welcomeDone } from '../store/viewStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { listProjects } from '../store/persistence';
import { loadInitialProject } from '../store/bootstrap';
import { makeDevice, makeProject } from '../test/fixtures';
import { catalog } from '../devices/catalog';
import { guideProgress } from './guide';

/** Montar la app entera es lento con la máquina cargada: estos tests tienen su propio margen. */
const APP_TIMEOUT = 20_000;

async function renderApp(project = makeProject()) {
  useUiStore.getState().reset();
  useViewStore.getState().reset();
  useProjectStore.getState().loadProject(project);
  useSimulationStore.getState().reset(project);
  useUiStore.getState().setActiveFloor(project.floors[0]?.id ?? null);
  render(<App autoLoad={false} />);
  await act(async () => {});
}

describe('primera experiencia', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => stopSimulationLoop());

  it('guideProgress detecta sala, servidor y dispositivos', () => {
    const empty = makeProject();
    expect(guideProgress(empty, catalog)).toEqual({ room: false, server: false, devices: false });
    const full = makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
      devices: [makeDevice('ha-green', 'ha'), makeDevice('hue-white-e27', 'l1')],
    });
    expect(guideProgress(full, catalog)).toEqual({ room: true, server: true, devices: true });
  });

  it('un proyecto vacío muestra el estado vacío con 3 pasos marcables y un botón por paso', async () => {
    await renderApp();
    const guide = screen.getByRole('region', { name: 'Empieza tu instalación' });
    expect(within(guide).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(guide).getByLabelText(/Dibuja una sala/)).not.toBeChecked();
    expect(within(guide).getByText('0 de 3 pasos hechos')).toBeInTheDocument();

    // Paso 1: dibujar sala activa el modo de dibujo.
    await userEvent.click(within(guide).getByRole('button', { name: 'Dibujar sala' }));
    expect(useUiStore.getState().canvasMode).toBe('room');
    act(() => useUiStore.getState().setCanvasMode('select'));

    // Paso 2: añade el servidor de Home Assistant y queda marcado.
    await userEvent.click(screen.getByRole('button', { name: 'Añadir servidor' }));
    const devices = useProjectStore.getState().project.devices;
    expect(devices).toHaveLength(1);
    expect(devices[0]?.definitionId).toBe('ha-green');
    const card = screen.getByRole('region', { name: 'Primeros pasos' });
    expect(within(card).getByLabelText(/Añade el servidor de Home Assistant/)).toBeChecked();
    expect(within(card).getByText('1 de 3 pasos hechos')).toBeInTheDocument();

    // Paso 3: lleva el foco al buscador del catálogo.
    await userEvent.click(within(card).getByRole('button', { name: 'Buscar en el catálogo' }));
    expect(screen.getByLabelText('Buscar dispositivo')).toHaveFocus();

    // Un paso se puede marcar a mano y la guía se puede cerrar.
    await userEvent.click(within(card).getByLabelText(/Dibuja una sala/));
    expect(within(card).getByText('2 de 3 pasos hechos')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Ocultar la guía' }));
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).toBeNull();
  }, APP_TIMEOUT);

  it('un proyecto con contenido no muestra la guía', async () => {
    await renderApp(makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] }));
    expect(screen.queryByRole('region', { name: 'Empieza tu instalación' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Primeros pasos' })).toBeNull();
  }, APP_TIMEOUT);

  it('el tour de 5 pasos se abre desde la ayuda, resalta cada zona, se puede saltar y se recuerda', async () => {
    await renderApp(makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] }));
    await userEvent.click(screen.getByRole('button', { name: 'Ayuda' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Visita guiada (5 pasos)' }));
    const dialog = screen.getByRole('dialog', { name: 'Catálogo' });
    expect(within(dialog).getByText('Paso 1 de 5')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Catálogo' })).toHaveFocus();
    const titles = ['Lienzo', 'Propiedades', 'Panel inferior', 'Simular'];
    for (const title of titles) {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      });
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    }
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    });
    expect(screen.getByRole('dialog', { name: 'Panel inferior' })).toBeInTheDocument();
    expect(tourDone()).toBe(false);
    // Escape lo salta y queda recordado.
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Panel inferior' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Panel inferior' })).toBeNull();
    expect(tourDone()).toBe(true);
    expect(localStorage.getItem(PREF_KEYS.tourDone)).toBe('1');
  }, APP_TIMEOUT);

  it('el tour funciona aunque localStorage falle', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    await renderApp(makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] }));
    act(() => useViewStore.getState().startTour());
    await userEvent.click(screen.getByRole('button', { name: 'Saltar tour' }));
    expect(useViewStore.getState().tourStep).toBeNull();
    spy.mockRestore();
  }, APP_TIMEOUT);

  it('la primera vez ofrece la demo o empezar en blanco y después el tour', async () => {
    await renderApp(makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] }));
    act(() => useViewStore.getState().setWelcomeOpen(true));
    const dialog = screen.getByRole('dialog', { name: 'Bienvenido a HA Simulator' });
    expect(within(dialog).getByRole('button', { name: 'Empezar en blanco' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Explorar la demo' }));
    expect(welcomeDone()).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Catálogo' })).toBeInTheDocument();
  }, APP_TIMEOUT);

  it('«Empezar en blanco» abre un proyecto vacío con la guía', async () => {
    await renderApp(makeProject({ id: 'demo-x', devices: [makeDevice('hue-white-e27', 'l1')] }));
    act(() => useViewStore.getState().setWelcomeOpen(true));
    await userEvent.click(screen.getByRole('button', { name: 'Empezar en blanco' }));
    await waitFor(() => expect(useProjectStore.getState().project.devices).toHaveLength(0));
    expect(useProjectStore.getState().project.name).toBe('Mi instalación');
    expect(await screen.findByRole('region', { name: 'Empieza tu instalación' })).toBeInTheDocument();
  }, APP_TIMEOUT);
});

describe('demo guardada al abrirse', () => {
  it('loadInitialProject guarda la demo en IndexedDB para que otra pestaña abra el mismo proyecto', async () => {
    localStorage.clear();
    const before = await listProjects();
    for (const p of before) await (await import('../store/persistence')).deleteProject(p.id);
    const first = await loadInitialProject();
    expect(first.firstRun).toBe(true);
    const demoId = useProjectStore.getState().project.id;
    expect((await listProjects()).map((p) => p.id)).toContain(demoId);
    // «Otra pestaña»: vuelve a cargar y abre el mismo proyecto.
    localStorage.clear();
    const second = await loadInitialProject();
    expect(second.firstRun).toBe(false);
    expect(useProjectStore.getState().project.id).toBe(demoId);
  });
});
