import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition } from '../../types';
import { AlarmControl } from './AlarmControl';
import { ValveControl } from './ValveControl';
import { ActuatorControl, ACTUATOR_DOMAINS } from './ActuatorControl';
import { domainIcon, tileAction } from '../../lovelace/tileAction';

const alarm: EntityDefinition = { key: 'alarm', domain: 'alarm_control_panel', name: 'Alarma', initialState: 'disarmed', capabilities: { alarmModes: ['armed_home', 'armed_away', 'armed_night'] } };
const valve: EntityDefinition = { key: 'valve', domain: 'valve', name: 'Válvula', initialState: 'closed' };

describe('alarma', () => {
  it('teclea el código en el teclado y lo manda al armar y desarmar', async () => {
    const onService = vi.fn();
    render(<AlarmControl entityId="alarm_control_panel.casa" definition={alarm} state={{ state: 'disarmed' }} onService={onService} />);
    const pad = screen.getByRole('group', { name: 'Teclado de la alarma' });
    for (const d of ['1', '2', '3', '4']) await userEvent.click(within(pad).getByRole('button', { name: `Dígito ${d}` }));
    expect(screen.getByLabelText('Código introducido')).toHaveTextContent('••••');
    await userEvent.click(screen.getByRole('button', { name: '🚪 Armar ausente' }));
    expect(onService).toHaveBeenLastCalledWith('alarm_arm_away', { code: '1234' });
    // el código se borra tras usarlo
    expect(screen.getByLabelText('Código introducido')).toHaveTextContent('Código');
    await userEvent.click(within(pad).getByRole('button', { name: 'Dígito 9' }));
    await userEvent.click(within(pad).getByRole('button', { name: 'Borrar último dígito' }));
    await userEvent.click(within(pad).getByRole('button', { name: 'Dígito 0' }));
    await userEvent.click(screen.getByRole('button', { name: '🔓 Desarmar' }));
    expect(onService).toHaveBeenLastCalledWith('alarm_disarm', { code: '0' });
    await userEvent.click(screen.getByRole('button', { name: '🏠 Armar en casa' }));
    expect(onService).toHaveBeenLastCalledWith('alarm_arm_home', undefined);
  });

  it('muestra el estado traducido y solo los modos que admite', () => {
    render(<AlarmControl entityId="a" definition={{ ...alarm, capabilities: { alarmModes: ['armed_away'] } }} state={{ state: 'triggered' }} onService={vi.fn()} />);
    expect(screen.getByText('Disparada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '🏠 Armar en casa' })).toBeNull();
  });
});

describe('válvula', () => {
  it('abre y cierra', async () => {
    const onService = vi.fn();
    render(<ValveControl entityId="valve.riego" definition={valve} state={{ state: 'closed' }} onService={onService} />);
    expect(screen.getByText('Cerrada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '🚰 Abrir' }));
    expect(onService).toHaveBeenCalledWith('open_valve');
    await userEvent.click(screen.getByRole('button', { name: '⛔ Cerrar' }));
    expect(onService).toHaveBeenCalledWith('close_valve');
  });

  it('el control general, las escenas y el dashboard conocen los dominios nuevos', () => {
    render(<ActuatorControl entityId="valve.riego" definition={valve} state={{ state: 'open' }} onService={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Válvula' })).toBeInTheDocument();
    expect(ACTUATOR_DOMAINS.has('alarm_control_panel')).toBe(true);
    expect(tileAction('valve.riego', { state: 'open' })).toEqual({ service: 'valve.close_valve', label: 'Cerrar' });
    expect(domainIcon('alarm_control_panel.casa')).toBe('🚨');
  });
});
