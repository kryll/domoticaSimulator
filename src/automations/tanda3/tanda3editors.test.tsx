import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Action, Condition, Trigger } from '../../types';
import { ActionEditor } from '../ActionEditor';
import { TriggerEditor } from '../TriggerEditor';
import { ConditionEditor } from '../ConditionEditor';
import { useProjectStore } from '../../store/projectStore';
import { makeProject } from '../../test/fixtures';
import { describeTimePattern } from './timePattern';
import { triggerFactories, actionFactories } from '../../ui/automationOptions';

let last: unknown = null;

function T({ initial }: { initial: Trigger }) {
  const [v, setV] = useState(initial);
  return <TriggerEditor value={v} onChange={(n) => ((last = n), setV(n))} />;
}
function C({ initial }: { initial: Condition }) {
  const [v, setV] = useState(initial);
  return <ConditionEditor value={v} onChange={(n) => ((last = n), setV(n))} />;
}
function A({ initial }: { initial: Action }) {
  const [v, setV] = useState(initial);
  return <ActionEditor value={v} onChange={(n) => ((last = n), setV(n))} />;
}

beforeEach(() => {
  last = null;
  useProjectStore.getState().loadProject(makeProject());
});

describe('Tanda 3: editores de disparadores', () => {
  it('ofrece los disparadores nuevos al añadir', () => {
    const labels = triggerFactories.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['Patrón de hora', 'Home Assistant (arranque/parada)', 'Evento']));
    expect(actionFactories.map((f) => f.label)).toEqual(expect.arrayContaining(['Detener', 'En paralelo']));
  });

  it('edita un patrón de hora y lo describe', async () => {
    render(<T initial={{ type: 'time_pattern', minutes: '/5' }} />);
    expect(screen.getByText(/Dispara cada 5 minutos/)).toBeInTheDocument();
    const hours = screen.getByLabelText('Horas');
    await userEvent.type(hours, '7');
    expect(last).toMatchObject({ type: 'time_pattern', hours: '7', minutes: '/5' });
    await userEvent.clear(screen.getByLabelText('Minutos'));
    expect(last).not.toHaveProperty('minutes');
    expect(describeTimePattern({ seconds: '/1' })).toBe('cada 1 segundo');
  });

  it('elige arranque o parada de Home Assistant', async () => {
    render(<T initial={{ type: 'homeassistant', event: 'start' }} />);
    await userEvent.selectOptions(screen.getByLabelText('Evento'), 'shutdown');
    expect(last).toMatchObject({ type: 'homeassistant', event: 'shutdown' });
  });

  it('edita un evento con sus datos', async () => {
    render(<T initial={{ type: 'event', eventType: '' }} />);
    await userEvent.type(screen.getByLabelText('Tipo de evento'), 'timer.finished');
    await userEvent.type(screen.getByLabelText('Datos del evento (clave=valor)'), 'entity_id=timer.lavadora');
    expect(last).toMatchObject({ type: 'event', eventType: 'timer.finished', eventData: { entity_id: 'timer.lavadora' } });
  });

  it('el valor numérico admite «Durante»', async () => {
    render(<T initial={{ type: 'numeric_state', entityId: 'sensor.x', above: 25 }} />);
    await userEvent.type(screen.getByLabelText('Durante (min:s)'), '2:00');
    expect(last).toMatchObject({ type: 'numeric_state', for: 120 });
  });

  it('el interruptor «Activado» guarda enabled: false y lo quita al volver a activarlo', async () => {
    render(<T initial={{ type: 'time', at: '07:00' }} />);
    const sw = screen.getByRole('switch', { name: 'Activado: disparador' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(sw);
    expect(last).toMatchObject({ enabled: false });
    expect(screen.getByText('Desactivado: se ignora')).toBeInTheDocument();
    await userEvent.click(sw);
    expect(last).not.toHaveProperty('enabled');
  });
});

describe('Tanda 3: condición de hora con días de la semana', () => {
  it('marca días con los chips L-M-X-J-V-S-D', async () => {
    render(<C initial={{ type: 'time', after: '08:00' }} />);
    const group = screen.getByRole('group', { name: /Días de la semana/ });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    await userEvent.click(within(group).getByRole('button', { name: 'sábado' }));
    await userEvent.click(within(group).getByRole('button', { name: 'lunes' }));
    expect(last).toMatchObject({ weekday: ['mon', 'sat'] });
    expect(within(group).getByRole('button', { name: 'lunes' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Laborables' }));
    expect(last).toMatchObject({ weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  });

  it('las condiciones también se pueden desactivar', async () => {
    render(<C initial={{ type: 'time', after: '08:00' }} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Activado: condición' }));
    expect(last).toMatchObject({ enabled: false });
  });
});

describe('Tanda 3: acciones detener, en paralelo y seguir si falla', () => {
  it('edita «Detener» con motivo y error', async () => {
    render(<A initial={{ type: 'stop', message: '' }} />);
    await userEvent.type(screen.getByLabelText('Motivo'), 'Nadie');
    await userEvent.click(screen.getByLabelText('Terminar con error'));
    expect(last).toMatchObject({ type: 'stop', message: 'Nadie', error: true });
  });

  it('añade ramas y acciones dentro de «En paralelo»', async () => {
    render(<A initial={{ type: 'parallel', branches: [[]] }} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Rama' }));
    expect(last).toMatchObject({ branches: [[], []] });
    const rama2 = screen.getByRole('group', { name: 'Rama 2' });
    await userEvent.click(within(rama2).getByRole('button', { name: '+ Esperar' }));
    expect(last).toMatchObject({ branches: [[], [{ type: 'delay', seconds: 5 }]] });
  });

  it('«Seguir si falla» guarda continueOnError', async () => {
    render(<A initial={{ type: 'delay', seconds: 5 }} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Seguir si falla esta acción' }));
    expect(last).toMatchObject({ type: 'delay', continueOnError: true });
    await userEvent.click(screen.getByRole('switch', { name: 'Activado: acción' }));
    expect(last).toMatchObject({ enabled: false, continueOnError: true });
  });
});
