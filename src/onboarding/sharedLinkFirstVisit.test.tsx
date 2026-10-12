// Primera visita con un enlace compartido (#p=...): manda «Proyecto compartido»; ni la
// bienvenida ni la visita guiada se abren encima.
import '../test/flowMocks';
import { act, render } from '@testing-library/react';
import { clear, createStore } from 'idb-keyval';
import { App } from '../App';
import { useViewStore } from '../store/viewStore';
import { useProjectStore } from '../store/projectStore';
import { stopSimulationLoop } from '../store/simulationStore';

async function firstVisit(hash: string, expectWelcome: boolean): Promise<void> {
  // Sin proyectos guardados ni preferencias: es la primera visita.
  await clear(createStore('ha-simulator', 'projects')).catch(() => undefined);
  localStorage.clear();
  window.history.replaceState(null, '', `/${hash}`);
  useViewStore.setState({ welcomeOpen: false, tourStep: null });
  const before = useProjectStore.getState().project;
  const view = render(<App />);
  // Espera a que termine el arranque (abre la demo nueva) y a la decisión de la bienvenida.
  await vi.waitFor(() => expect(useProjectStore.getState().project).not.toBe(before), { timeout: 5000 });
  if (expectWelcome) await vi.waitFor(() => expect(useViewStore.getState().welcomeOpen).toBe(true), { timeout: 5000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  view.unmount();
  stopSimulationLoop();
}

describe('enlace compartido en la primera visita', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('sin enlace se abre la bienvenida', async () => {
    await firstVisit('', true);
    expect(useViewStore.getState().welcomeOpen).toBe(true);
  });

  it('con #p= no se abren la bienvenida ni la visita guiada', async () => {
    await firstVisit('#p=abc', false);
    expect(useViewStore.getState().welcomeOpen).toBe(false);
    expect(useViewStore.getState().tourStep).toBeNull();
  });
});
