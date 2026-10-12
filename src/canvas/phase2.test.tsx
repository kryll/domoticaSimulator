import './../test/flowMocks';
import { act, render, screen, within } from '@testing-library/react';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

const node = (id: string) => screen.getByTestId(`device-node-${id}`);

describe('lienzo: energía, batería y fallos', () => {
  beforeEach(() => {
    const project = makeProject({
      devices: [makeDevice('hue-white-e27', 'luz', 100, 100, 'Luz salón'), makeDevice('aqara-motion-p1', 'mov', 400, 100, 'Movimiento')],
    });
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(project);
    useSimulationStore.getState().reset(project);
    useUiStore.getState().setActiveFloor('f1');
    render(<App autoLoad={false} />);
  });
  afterEach(() => stopSimulationLoop());

  it('muestra la potencia cuando consume y la batería con aviso por debajo del 20 %', () => {
    expect(within(node('luz')).queryByTestId('node-watts')).toBeNull();
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'turn_on'));
    expect(within(node('luz')).getByTestId('node-watts')).toHaveTextContent(/· \d+ W/);

    const battery = within(node('mov')).getByTestId('node-battery');
    expect(battery).not.toHaveTextContent('batería baja');
    act(() => useSimulationStore.getState().setSensorValue('sensor.movimiento_battery', 12));
    expect(within(node('mov')).getByTestId('node-battery')).toHaveTextContent(/12 %.*batería baja/);
  });

  it('el nodo no se vuelve a pintar con un tick que solo avanza el reloj', () => {
    const before = node('luz');
    const html = before.outerHTML;
    act(() => useSimulationStore.getState().advance(1000));
    expect(node('luz')).toBe(before);
    expect(node('luz').outerHTML).toBe(html);
  });

  it('activar un fallo muestra la banda del modo fallo', () => {
    expect(screen.queryByRole('status', { name: 'Modo fallo' })).toBeNull();
    act(() => useSimulationStore.getState().setFailures({ powerOutage: true }));
    expect(screen.getByRole('status', { name: 'Modo fallo' })).toHaveTextContent('Corte de luz');
    expect(within(node('luz')).getByTestId('node-summary')).toHaveTextContent('no disponible');
  });
});
