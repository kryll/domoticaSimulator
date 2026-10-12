import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Action, Condition, Trigger } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { makeDevice, makeProject } from '../../test/fixtures';
import { pickEntity } from '../../test/pickEntity';
import { ActionListEditor } from '../ActionEditor';
import { ConditionEditor } from '../ConditionEditor';
import { TriggerEditor } from '../TriggerEditor';

let actions: Action[] = [];

function ActionsHarness({ initial = [] as Action[] }) {
  const [list, setList] = useState(initial);
  return (
    <ActionListEditor
      actions={list}
      onChange={(next) => {
        actions = next;
        setList(next);
      }}
    />
  );
}

function ConditionHarness({ initial, onChange }: { initial: Condition; onChange: (c: Condition) => void }) {
  const [c, setC] = useState(initial);
  return (
    <ConditionEditor
      value={c}
      onChange={(next) => {
        onChange(next);
        setC(next);
      }}
    />
  );
}

function TriggerHarness({ initial, onChange }: { initial: Trigger; onChange: (t: Trigger) => void }) {
  const [t, setT] = useState(initial);
  return (
    <TriggerEditor
      value={t}
      onChange={(next) => {
        onChange(next);
        setT(next);
      }}
    />
  );
}

describe('editores de lógica (B11)', () => {
  beforeEach(() => {
    actions = [];
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'), makeDevice('aqara-wireless-mini-switch', 'd2', 0, 0, 'Mando')],
        people: [{ id: 'ana', name: 'Ana' }],
        zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }],
      }),
    );
  });

  it('anida acciones dentro de choose y conserva la estructura', async () => {
    render(<ActionsHarness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Elegir (choose)' }));
    expect(actions[0]).toEqual({ type: 'choose', choices: [{ conditions: [], sequence: [] }] });
    const option = screen.getByRole('group', { name: 'Opción 1: entonces' });
    await userEvent.click(within(option).getByRole('button', { name: '+ Llamar a servicio' }));
    await pickEntity('Entidad', 'light.luz_salon');
    const conds = screen.getByRole('group', { name: 'Opción 1: si se cumple' });
    await userEvent.click(within(conds).getByRole('button', { name: '+ Ninguna (NO)' }));
    expect(actions[0]).toMatchObject({
      type: 'choose',
      choices: [{ conditions: [{ type: 'not', conditions: [] }], sequence: [{ type: 'service', entityId: 'light.luz_salon', service: 'light.turn_on' }] }],
    });
    await userEvent.click(screen.getByRole('button', { name: '+ Opción' }));
    expect(actions[0]?.type === 'choose' && actions[0].choices).toHaveLength(2);
  });

  it('if/entonces/si no: «si no» vacío no se guarda', async () => {
    render(<ActionsHarness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Si / entonces / si no' }));
    const elseList = screen.getByRole('group', { name: 'Si no' });
    await userEvent.click(within(elseList).getByRole('button', { name: '+ Esperar' }));
    expect(actions[0]).toEqual({ type: 'if', conditions: [], then: [], else: [{ type: 'delay', seconds: 5 }] });
    await userEvent.click(within(elseList).getByRole('button', { name: 'Eliminar elemento 1 de Si no' }));
    expect(actions[0]).toEqual({ type: 'if', conditions: [], then: [] });
  });

  it('repeat cambia entre veces, mientras y hasta', async () => {
    render(<ActionsHarness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Repetir' }));
    expect(actions[0]).toMatchObject({ type: 'repeat', count: 2 });
    await userEvent.selectOptions(screen.getByLabelText('Tipo de repetición'), 'until');
    expect(actions[0]).toEqual({ type: 'repeat', sequence: [], until: [] });
    expect(screen.getByRole('group', { name: 'Hasta que' })).toBeInTheDocument();
  });

  it('wait_for_trigger con tiempo máximo y disparador anidado', async () => {
    render(<ActionsHarness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Esperar a un disparador' }));
    const waitFor = screen.getByRole('group', { name: 'Esperar a' });
    await userEvent.click(within(waitFor).getByRole('button', { name: '+ Hora' }));
    await userEvent.click(screen.getByLabelText('Seguir si se agota el tiempo'));
    expect(actions[0]).toMatchObject({ type: 'wait_for_trigger', timeoutSeconds: 60, continueOnTimeout: false, triggers: [{ type: 'time' }] });
  });

  it('notify edita título y mensaje', async () => {
    render(<ActionsHarness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Notificación' }));
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Puerta abierta' } });
    expect(actions[0]).toMatchObject({ type: 'notify', title: 'Casa', message: 'Puerta abierta' });
  });

  it('las claves son estables al reordenar acciones anidadas', async () => {
    render(
      <ActionsHarness
        initial={[
          { type: 'notify', message: 'uno' },
          { type: 'notify', message: 'dos' },
        ]}
      />,
    );
    const messages = () => screen.getAllByLabelText('Mensaje').map((el) => (el as HTMLTextAreaElement).value);
    expect(messages()).toEqual(['uno', 'dos']);
    await userEvent.click(screen.getByRole('button', { name: 'Bajar elemento 1 de Acciones' }));
    expect(messages()).toEqual(['dos', 'uno']);
  });
});

describe('editores de personas y zonas (B9)', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('aqara-wireless-mini-switch', 'd2', 0, 0, 'Mando')],
        people: [{ id: 'ana', name: 'Ana' }],
        zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }],
      }),
    );
  });

  it('condición not con condiciones anidadas', async () => {
    let value: Condition = { type: 'not', conditions: [] };
    render(<ConditionHarness initial={value} onChange={(c) => (value = c)} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Persona en zona' }));
    expect(value).toEqual({ type: 'not', conditions: [{ type: 'zone', personId: '', zoneId: 'home' }] });
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'ana');
    expect(value).toEqual({ type: 'not', conditions: [{ type: 'zone', personId: 'ana', zoneId: 'home' }] });
  });

  it('disparador de zona: persona, evento y zona', async () => {
    let value: Trigger = { type: 'zone', personId: '', zoneId: 'home', event: 'enter' };
    render(<TriggerHarness initial={value} onChange={(t) => (value = t)} />);
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'ana');
    await userEvent.selectOptions(screen.getByLabelText('Evento'), 'leave');
    await userEvent.selectOptions(screen.getByLabelText('Zona'), 'trabajo');
    expect(value).toEqual({ type: 'zone', personId: 'ana', zoneId: 'trabajo', event: 'leave' });
    expect(screen.getByRole('option', { name: 'Casa' })).toBeInTheDocument();
  });

  it('disparador «Acción de mando» ofrece las acciones del mando', async () => {
    let value: Trigger = { type: 'device_action', entityId: '', action: 'single' };
    render(<TriggerHarness initial={value} onChange={(t) => (value = t)} />);
    // «Mando» es el EntityPicker (combobox con búsqueda) limitado a los sensores de acción.
    await userEvent.click(screen.getByRole('combobox', { name: 'Mando' }));
    const options = within(screen.getByRole('listbox', { name: 'Opciones: Mando' })).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => (o.getAttribute('title') ?? '').endsWith('_action'))).toBe(true);
    await userEvent.click(options[0] as HTMLElement);
    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'double');
    expect(value).toMatchObject({ type: 'device_action', action: 'double' });
    expect((value as { entityId: string }).entityId).toMatch(/^sensor\..*_action$/);
  });
});
