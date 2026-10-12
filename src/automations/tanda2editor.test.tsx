import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Automation, Condition, Trigger } from '../types';
import { AutomationEditor } from './AutomationEditor';
import { TriggerEditor } from './TriggerEditor';
import { ConditionEditor } from './ConditionEditor';
import { AutomationsWorkspace } from './AutomationsWorkspace';
import { BottomPanel } from '../ui/BottomPanel';
import { Toast } from '../ui/Toast';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { isPlaceholderName, suggestAutomationName } from './autoName';

function TriggerHarness({ initial, onValue }: { initial: Trigger; onValue: (t: Trigger) => void }) {
  const [t, setT] = useState(initial);
  return (
    <TriggerEditor
      value={t}
      onChange={(next) => {
        onValue(next);
        setT(next);
      }}
    />
  );
}

function ConditionHarness({ initial, onValue }: { initial: Condition; onValue: (c: Condition) => void }) {
  const [c, setC] = useState(initial);
  return (
    <ConditionEditor
      value={c}
      onChange={(next) => {
        onValue(next);
        setC(next);
      }}
    />
  );
}

function EditorHarness({ initial, onValue }: { initial: Automation; onValue: (a: Automation) => void }) {
  const [a, setA] = useState(initial);
  return (
    <AutomationEditor
      automation={a}
      onChange={(next) => {
        onValue(next);
        setA(next);
      }}
    />
  );
}

const auto = (patch: Partial<Automation> = {}): Automation => ({
  id: 'a1',
  name: 'Automatización 1',
  enabled: true,
  triggers: [],
  conditions: [],
  actions: [],
  mode: 'single',
  ...patch,
});

describe('editor de automatizaciones (Tanda 2)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useViewStore.getState().reset();
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [
          makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'),
          makeDevice('aqara-motion-p1', 'd2', 0, 0, 'Sensor'),
          makeDevice('aqara-door-window', 'd3', 0, 0, 'Puerta'),
        ],
      }),
    );
  });

  it('«Hasta» y «Desde» son selectores con los estados traducidos de la entidad y «Otro…»', async () => {
    let value: Trigger = { type: 'state', entityId: 'binary_sensor.sensor_motion' };
    render(<TriggerHarness initial={value} onValue={(t) => (value = t)} />);
    const to = screen.getByRole('combobox', { name: 'Hasta (opcional)' });
    expect(within(to).getAllByRole('option').map((o) => o.textContent)).toEqual(['Cualquiera', 'Detectado', 'Despejado', 'Otro…']);
    await userEvent.selectOptions(to, 'Detectado');
    expect(value).toMatchObject({ to: 'on' });
    // Desde: «Despejado» → off
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Desde (opcional)' }), 'Despejado');
    expect(value).toMatchObject({ from: 'off', to: 'on' });
    // Otro…: texto libre
    await userEvent.selectOptions(to, 'Otro…');
    const free = screen.getByRole('textbox', { name: 'Hasta (opcional): otro valor' });
    await userEvent.clear(free);
    await userEvent.type(free, 'unavailable');
    expect(value).toMatchObject({ to: 'unavailable' });
  });

  it('un valor desconocido se muestra en «Otro…» sin perderse', () => {
    render(<TriggerHarness initial={{ type: 'state', entityId: 'light.luz_salon', to: 'raro' }} onValue={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Hasta (opcional)' })).toHaveValue('__other__');
    expect(screen.getByRole('textbox', { name: 'Hasta (opcional): otro valor' })).toHaveValue('raro');
  });

  it('la condición de estado usa el selector traducido (puerta: Abierta / Cerrada)', async () => {
    let value: Condition = { type: 'state', entityId: 'binary_sensor.puerta_door', state: '' };
    render(<ConditionHarness initial={value} onValue={(c) => (value = c)} />);
    const state = screen.getByRole('combobox', { name: 'Estado' });
    const labels = within(state).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toContain('Abierta');
    expect(labels).toContain('Cerrada');
    await userEvent.selectOptions(state, 'Abierta');
    expect(value).toMatchObject({ state: 'on' });
  });

  it('muestra la descripción en lenguaje natural y propone el nombre (editable)', async () => {
    let value = auto({
      triggers: [{ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' }],
      actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon' }],
    });
    render(<EditorHarness initial={value} onValue={(a) => (value = a)} />);
    const description = screen.getByTestId('automation-description');
    expect(description.textContent).toMatch(/^Descripción: Cuando /);
    expect(description.textContent).toMatch(/Luz salón/);
    // Nombre provisional: se propone uno a partir de la descripción al editar.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Activada' }));
    expect(isPlaceholderName(value.name)).toBe(false);
    expect(value.name).toContain('→');
    // El usuario lo cambia: deja de ser automático y se ofrece volver al propuesto.
    const name = screen.getByLabelText('Nombre de la automatización');
    await userEvent.clear(name);
    await userEvent.type(name, 'Mi luz');
    expect(value.name).toBe('Mi luz');
    await userEvent.click(screen.getByRole('button', { name: /Usar el nombre propuesto/ }));
    expect(value.name).toContain('→');
  });

  it('suggestAutomationName resume y recorta', () => {
    expect(suggestAutomationName('Cuando Sensor detecta movimiento y es de noche, enciende Luz')).toBe('Sensor detecta movimiento → enciende Luz');
    expect(suggestAutomationName(`Cuando ${'a'.repeat(100)}, b`).length).toBeLessThanOrEqual(70);
  });

  it('se abre por defecto en el panel grande con la lista y el editor, y el aviso no tapa los campos', async () => {
    useProjectStore.getState().addAutomation({ name: 'Luz por la noche' });
    render(
      <>
        <BottomPanel />
        <AutomationsWorkspace />
        <Toast />
      </>,
    );
    act(() => {
      useUiStore.getState().setBottomTab('automations');
      // En la app, App abre el editor grande al entrar en la pestaña (aquí se simula).
      useViewStore.getState().setAutomationsModal(true);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Automatizaciones' });
    expect(within(dialog).getByRole('list', { name: 'Automatizaciones' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nombre de la automatización')).toHaveValue('Luz por la noche');
    expect(screen.getByText('El editor de automatizaciones está abierto en grande.')).toBeInTheDocument();
    act(() => useUiStore.getState().notify('Hola', 'info'));
    expect(document.querySelector('[data-position]')?.getAttribute('data-position')).toBe('bottom');
    // Acoplar al panel inferior (se recuerda).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Acoplar al panel inferior' }));
    expect(screen.queryByRole('dialog', { name: 'Automatizaciones' })).toBeNull();
    expect(useViewStore.getState().automationsDocked).toBe(true);
    expect(await screen.findByRole('button', { name: /Abrir en grande/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Abrir en grande/ }));
    expect(screen.getByRole('dialog', { name: 'Automatizaciones' })).toBeInTheDocument();
    // Al cambiar de pestaña se cierra.
    act(() => useUiStore.getState().setBottomTab('validation'));
    expect(screen.queryByRole('dialog', { name: 'Automatizaciones' })).toBeNull();
  });
});
