import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Action, Automation, Condition, Trigger } from '../types';
import { AutomationEditor } from './AutomationEditor';
import { ActionEditor } from './ActionEditor';
import { ImportAutomationsDialog } from './ImportAutomationsDialog';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pickEntity } from '../test/pickEntity';

const YAML_WITH_IGNORED = [
  'alias: Con extras',
  'mode: single',
  'triggers:',
  '  - trigger: state',
  '    entity_id: binary_sensor.sensor_motion',
  '    to: "on"',
  '    attribute: battery',
  'actions:',
  '  - delay:',
  '      seconds: 5',
  '',
].join('\n');

const base: Automation = { id: 'a1', name: 'Prueba', enabled: true, triggers: [], conditions: [], actions: [], mode: 'single' };
let latest: Automation = base;

function Harness({ initial = base }: { initial?: Automation }) {
  const [a, setA] = useState(initial);
  latest = a;
  return (
    <AutomationEditor
      automation={a}
      onChange={(next) => {
        latest = next;
        setA(next);
      }}
    />
  );
}

function ActionHarness({ initial }: { initial: Action }) {
  const [a, setA] = useState(initial);
  return (
    <ActionEditor
      value={a}
      onChange={(next) => {
        lastAction = next;
        setA(next);
      }}
    />
  );
}
let lastAction: Action | null = null;

beforeEach(() => {
  latest = base;
  lastAction = null;
  useUiStore.getState().reset();
  useProjectStore.getState().loadProject(
    makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [] }],
      devices: [
        makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'),
        makeDevice('hue-white-e27', 'd3', 0, 0, 'Luz cocina'),
        makeDevice('aqara-motion-p1', 'd2', 0, 0, 'Sensor'),
      ],
    }),
  );
});

describe('YAML con avisos', () => {
  it('el editor YAML avisa de lo que se ignorará y deja aplicar igualmente', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'YAML' }));
    fireEvent.change(screen.getByLabelText('YAML de la automatización'), { target: { value: YAML_WITH_IGNORED } });
    const warning = screen.getByText(/Se ignorarán/).closest('div') as HTMLElement;
    expect(warning).toHaveTextContent('triggers[0].attribute');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar igualmente' }));
    expect(latest.name).toBe('Con extras');
    expect(screen.queryByText(/Se ignorarán/)).not.toBeInTheDocument();
  });

  it('al importar automatizaciones muestra los avisos y las añade en un solo paso de deshacer', async () => {
    const onClose = vi.fn();
    render(<ImportAutomationsDialog onClose={onClose} />);
    const text = `- id: uno\n${YAML_WITH_IGNORED.replace(/^/gm, '  ').replace(/^ {2}id/, 'id').trimEnd()}\n- alias: Otra\n  triggers:\n    - trigger: time\n      at: "07:00:00"\n  actions: []\n`;
    fireEvent.change(screen.getByLabelText('YAML'), { target: { value: text } });
    expect(screen.getByText(/Se importarán 2 automatizaciones/)).toBeInTheDocument();
    expect(screen.getByText(/Se ignorarán/).closest('div')).toHaveTextContent('[0].triggers[0].attribute');
    await userEvent.click(screen.getByRole('button', { name: 'Importar igualmente' }));
    expect(useProjectStore.getState().project.automations.map((a) => a.name)).toEqual(['Con extras', 'Otra']);
    expect(onClose).toHaveBeenCalled();
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.automations).toHaveLength(0);
  });
});

describe('varios destinos y disparadores con id', () => {
  it('una acción admite más entidades del mismo dominio (chips) y salas', async () => {
    render(<ActionHarness initial={{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon' }} />);
    await pickEntity('Añadir entidad', 'light.luz_cocina');
    expect(lastAction).toMatchObject({ targets: { entityIds: ['light.luz_cocina'] } });
    // solo ofrece entidades del dominio light
    await userEvent.click(screen.getByRole('combobox', { name: 'Añadir entidad' }));
    const options = within(screen.getByRole('listbox', { name: 'Opciones: Añadir entidad' })).queryAllByRole('option');
    expect(options.every((o) => (o.getAttribute('title') ?? '').startsWith('light.'))).toBe(true);
    await userEvent.keyboard('{Escape}');

    await userEvent.selectOptions(screen.getByLabelText('Sala/área'), 'r1');
    expect(lastAction).toMatchObject({ targets: { entityIds: ['light.luz_cocina'], areaIds: ['r1'] } });
    expect(within(screen.getByRole('list', { name: 'Salas de destino' })).getByText(/Salón/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar light.luz_cocina' }));
    expect(lastAction).toMatchObject({ targets: { areaIds: ['r1'] } });
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la sala Salón' }));
    expect(lastAction && 'targets' in lastAction ? lastAction.targets : undefined).toBeUndefined();
  });

  it('el disparador tiene «ID del disparador» y la condición «Disparado por» lo ofrece', async () => {
    const trigger: Trigger = { type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' };
    render(<Harness initial={{ ...base, triggers: [trigger, { type: 'time', at: '07:00' }] }} />);
    const [idField] = screen.getAllByLabelText('ID del disparador (opcional)');
    await userEvent.type(idField as HTMLElement, 'llegada');
    expect(latest.triggers[0]).toMatchObject({ id: 'llegada' });

    await userEvent.click(screen.getByRole('button', { name: '+ Disparado por' }));
    expect(latest.conditions[0]).toEqual({ type: 'trigger', ids: [] } satisfies Condition);
    await userEvent.click(screen.getByRole('checkbox', { name: 'llegada' }));
    expect(latest.conditions[0]).toEqual({ type: 'trigger', ids: ['llegada'] });
    await userEvent.type(screen.getByLabelText('Otro ID'), 'manual{Enter}');
    expect(latest.conditions[0]).toEqual({ type: 'trigger', ids: ['llegada', 'manual'] });
    expect(screen.getByText('(no existe)')).toBeInTheDocument();

    // borrar el ID lo quita del disparador
    await userEvent.clear(screen.getAllByLabelText('ID del disparador (opcional)')[0] as HTMLElement);
    expect(latest.triggers[0]).not.toHaveProperty('id');
  });
});
