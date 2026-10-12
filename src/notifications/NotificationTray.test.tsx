import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { NotificationTray } from './NotificationTray';
import { useSimulationStore } from '../store/simulationStore';
import { useExtrasStore } from '../store/extrasStore';
import { addNotification } from '../simulation/logic';

describe('NotificationTray', () => {
  beforeEach(() => {
    useExtrasStore.getState().reset();
    useSimulationStore.setState((s) => ({ sim: { ...s.sim, notifications: [] } }));
  });

  it('muestra el contador de no leídas y los mensajes; al abrir quedan leídas', async () => {
    render(<NotificationTray />);
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument();
    act(() => {
      useSimulationStore.setState((s) => ({ sim: addNotification(addNotification(s.sim, 'Casa', 'Puerta abierta'), 'Alarma', 'Humo en la cocina') }));
    });
    expect(screen.getByTestId('notification-count')).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones (2 sin leer)' }));
    const panel = screen.getByRole('dialog', { name: 'Notificaciones del móvil' });
    const items = within(panel).getAllByRole('listitem');
    // la más reciente primero
    expect(items[0]).toHaveTextContent('Humo en la cocina');
    expect(items[1]).toHaveTextContent('Puerta abierta');
    expect(screen.queryByTestId('notification-count')).toBeNull();
    expect(useSimulationStore.getState().sim.notifications?.every((n) => n.read)).toBe(true);
    await userEvent.click(within(panel).getByRole('button', { name: 'Borrar todas' }));
    expect(useSimulationStore.getState().sim.notifications).toEqual([]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
