import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistorySparkline } from './HistorySparkline';
import { useSimulationStore } from '../store/simulationStore';

describe('HistorySparkline', () => {
  it('dibuja la serie numérica con mínimo y máximo y cambia de ventana', async () => {
    const now = useSimulationStore.getState().sim.now;
    act(() => {
      useSimulationStore.setState((s) => ({
        sim: {
          ...s.sim,
          history: {
            'sensor.temp': [
              { t: now - 30 * 60_000, v: 20 },
              { t: now - 10 * 60_000, v: 22.5 },
            ],
          },
        },
      }));
    });
    render(<HistorySparkline entityId="sensor.temp" unit="°C" />);
    expect(screen.getByRole('img', { name: /mínimo 20 °C, máximo 22,5 °C/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '24 h' }));
    expect(screen.getByRole('button', { name: '24 h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /Historial de 24 h/ })).toBeInTheDocument();
  });

  it('no se muestra sin historial', () => {
    const { container } = render(<HistorySparkline entityId="sensor.nada" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HistorySparkline: series de atributos', () => {
  it('elige entre el estado y los atributos, con etiquetas y unidades en español', async () => {
    const now = useSimulationStore.getState().sim.now;
    act(() => {
      useSimulationStore.setState((s) => ({
        sim: {
          ...s.sim,
          history: {
            'light.luz': [{ t: now - 30 * 60_000, v: 'on' }],
            'light.luz#brightness': [
              { t: now - 30 * 60_000, v: 255 },
              { t: now - 10 * 60_000, v: 127.5 },
            ],
          },
        },
      }));
    });
    render(<HistorySparkline entityId="light.luz" stateMode="binary" />);
    const select = screen.getByLabelText('Serie del historial');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Estado', 'Brillo (%)']);
    await userEvent.selectOptions(select, 'brightness');
    expect(screen.getByRole('img', { name: /mínimo 50 %, máximo 100 %/ })).toBeInTheDocument();
  });

  it('una persiana muestra directamente su posición', () => {
    const now = useSimulationStore.getState().sim.now;
    act(() => {
      useSimulationStore.setState((s) => ({ sim: { ...s.sim, history: { 'cover.p#current_position': [{ t: now - 60_000, v: 40 }] } } }));
    });
    render(<HistorySparkline entityId="cover.p" stateMode="none" />);
    expect(screen.getByText(/Historial · Posición/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /máximo 40 %/ })).toBeInTheDocument();
  });
});
