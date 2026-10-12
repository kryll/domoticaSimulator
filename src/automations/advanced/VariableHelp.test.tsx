import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Automation } from '../../types';
import { AutomationEditor } from '../AutomationEditor';
import { ActionListEditor } from '../ActionEditor';
import { useProjectStore } from '../../store/projectStore';
import { makeDevice, makeProject } from '../../test/fixtures';

let latest: Automation;

function Harness({ initial }: { initial: Automation }) {
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

const base: Automation = {
  id: 'a1',
  name: 'Aviso',
  enabled: true,
  mode: 'single',
  triggers: [{ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' }],
  conditions: [],
  actions: [
    { type: 'variables', variables: { minutos: 10 } },
    { type: 'repeat', count: 2, sequence: [{ type: 'variables', variables: { local: 1 } }, { type: 'notify', message: 'Vuelta' }] },
  ],
};

describe('ayuda de variables', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor')] }));
  });

  it('dentro de un repeat lista nivel superior, locales, repeat.index y trigger.* e inserta en el mensaje', async () => {
    render(<Harness initial={base} />);
    const repeat = screen.getByRole('group', { name: 'Repetir' });
    const select = within(repeat).getByLabelText('Insertar variable');
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(expect.arrayContaining(['minutos', 'local', 'repeat.index', 'trigger.to_state.state']));
    const message = within(repeat).getByLabelText('Mensaje') as HTMLTextAreaElement;
    message.setSelectionRange(6, 6);
    fireEvent.select(message);
    await userEvent.selectOptions(select, 'repeat.index');
    const notify = latest.actions[1]?.type === 'repeat' ? latest.actions[1].sequence[1] : undefined;
    expect(notify).toMatchObject({ type: 'notify', message: 'Vuelta {{ repeat.index }}' });
  });

  it('en el nivel superior no ofrece repeat.index ni variables definidas después', () => {
    render(<Harness initial={{ ...base, actions: [{ type: 'notify', message: '' }, { type: 'variables', variables: { tarde: 1 } }] }} />);
    const names = within(screen.getByLabelText('Insertar variable')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(names).toContain('trigger.entity_id');
    expect(names).not.toContain('repeat.index');
    expect(names).not.toContain('tarde');
  });

  it('en un script (sin disparadores) indica cómo crear variables', () => {
    render(<ActionListEditor actions={[{ type: 'notify', message: '' }]} onChange={() => undefined} />);
    expect(screen.getByText(/Sin variables aquí/)).toBeInTheDocument();
  });
});
