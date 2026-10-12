import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationEditor } from './AutomationEditor';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pickEntity } from '../test/pickEntity';
import type { Action, Automation } from '../types';
import { ActionListEditor } from './ActionEditor';

const base: Automation = {
  id: 'a1',
  name: 'Luz por movimiento',
  enabled: true,
  triggers: [],
  conditions: [],
  actions: [],
  mode: 'single',
};

let latest: Automation = base;

function Harness() {
  const [a, setA] = useState(base);
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

describe('AutomationEditor', () => {
  beforeEach(() => {
    latest = base;
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'), makeDevice('aqara-motion-p1', 'd2', 0, 0, 'Sensor')],
      }),
    );
  });

  it('añade un disparador de estado y elige la entidad', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Cambio de estado' }));
    expect(latest.triggers).toHaveLength(1);
    await pickEntity('Entidad', 'binary_sensor.sensor_motion');
    expect(latest.triggers[0]).toMatchObject({ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' });
  });

  it('añade una acción de servicio y propone el servicio del dominio', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Llamar a servicio' }));
    await pickEntity('Entidad', 'light.luz_salon');
    expect(latest.actions[0]).toMatchObject({ type: 'service', entityId: 'light.luz_salon', service: 'light.turn_on' });
  });

  it('muestra el YAML sincronizado y permite editarlo', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'YAML' }));
    const textarea = screen.getByLabelText('YAML de la automatización');
    expect((textarea as HTMLTextAreaElement).value).toContain('Luz por movimiento');
    fireEvent.change(textarea, {
      target: {
        value: 'alias: Nueva\nmode: single\ntriggers:\n  - trigger: time\n    at: "07:30:00"\nactions:\n  - delay:\n      seconds: 5\n',
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar YAML' }));
    expect(latest.name).toBe('Nueva');
    expect(latest.id).toBe('a1');
    expect(latest.triggers[0]).toMatchObject({ type: 'time' });
  });

  it('muestra los errores de parseo del YAML', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'YAML' }));
    const textarea = screen.getByLabelText('YAML de la automatización');
    fireEvent.change(textarea, { target: { value: 'esto: [no es valido' } });
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar YAML' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Error en el YAML');
    expect(latest.name).toBe('Luz por movimiento');
  });
});

describe('ActionListEditor', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón')] }));
  });

  it('al reordenar, los datos tipados siguen a su acción', async () => {
    let actions: Action[] = [
      { type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon', data: { brightness_pct: 10 } },
      { type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon', data: { brightness_pct: 80 } },
    ];
    function ListHarness() {
      const [list, setList] = useState(actions);
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
    render(<ListHarness />);
    const sliders = () => screen.getAllByLabelText('Brillo').map((el) => (el as HTMLInputElement).value);
    expect(sliders()).toEqual(['10', '80']);
    await userEvent.click(screen.getByRole('button', { name: 'Bajar elemento 1 de Acciones' }));
    expect(sliders()).toEqual(['80', '10']);
    expect(actions.map((a) => (a.type === 'service' ? a.data?.brightness_pct : null))).toEqual([80, 10]);
    // editar el primero modifica solo esa acción
    fireEvent.change(screen.getAllByLabelText('Brillo')[0] as HTMLElement, { target: { value: '50' } });
    expect(actions.map((a) => (a.type === 'service' ? a.data?.brightness_pct : null))).toEqual([50, 10]);
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar elemento 1 de Acciones' }));
    expect(sliders()).toEqual(['10']);
  });

  it('filtra los servicios por el dominio de la entidad y ofrece el modo avanzado', async () => {
    let actions: Action[] = [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon' }];
    render(<ActionListEditor actions={actions} onChange={(next) => (actions = next)} />);
    const select = screen.getByLabelText('Servicio') as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.startsWith('light.'))).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Incluir Brillo' }));
    expect(actions[0]).toMatchObject({ data: { brightness_pct: 100 } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Avanzado (texto libre)' }));
    expect(screen.getByLabelText('Datos (clave=valor)')).toBeInTheDocument();
  });
});

describe('ServiceDataFields', () => {
  it('marcar «Variar brillo» desmarca «Brillo» (grupo exclusivo)', async () => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón')] }));
    let actions: Action[] = [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon', data: { brightness_pct: 40 } }];
    function H() {
      const [list, setList] = useState(actions);
      return <ActionListEditor actions={list} onChange={(n) => { actions = n; setList(n); }} />;
    }
    render(<H />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Incluir Variar brillo' }));
    expect(screen.getByRole('checkbox', { name: 'Incluir Brillo' })).not.toBeChecked();
    expect(actions[0]).toMatchObject({ data: { brightness_step_pct: 0 } });
    expect(actions[0]?.type === 'service' ? actions[0].data : null).not.toHaveProperty('brightness_pct');
  });

  it('un campo obligatorio va incluido sin casilla y, si falta, muestra un error', async () => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('netatmo-thermostat', 't1', 0, 0, 'Termostato')] }));
    let actions: Action[] = [{ type: 'service', service: 'climate.set_hvac_mode', entityId: 'climate.termostato' }];
    function H() {
      const [list, setList] = useState(actions);
      return <ActionListEditor actions={list} onChange={(n) => { actions = n; setList(n); }} />;
    }
    render(<H />);
    expect(screen.queryByRole('checkbox', { name: 'Incluir Modo' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Obligatorio');
    await userEvent.click(screen.getByRole('button', { name: 'Rellenar Modo' }));
    expect(actions[0]).toMatchObject({ data: { hvac_mode: expect.any(String) } });
    expect(screen.queryByRole('alert')).toBeNull();
    // al elegir otro servicio con obligatorios, se rellenan solos
    await userEvent.selectOptions(screen.getByLabelText('Servicio'), 'climate.set_temperature');
    await userEvent.selectOptions(screen.getByLabelText('Servicio'), 'climate.set_hvac_mode');
    expect(actions[0]).toMatchObject({ service: 'climate.set_hvac_mode', data: { hvac_mode: expect.any(String) } });
  });
});

describe('acción de notificación', () => {
  it('se crea sin entidad y exige el mensaje', async () => {
    useProjectStore.getState().loadProject(makeProject());
    let actions: Action[] = [];
    function H() {
      const [list, setList] = useState(actions);
      return <ActionListEditor actions={list} onChange={(n) => { actions = n; setList(n); }} />;
    }
    render(<H />);
    await userEvent.click(screen.getByRole('button', { name: '+ Notificación' }));
    expect(actions[0]).toMatchObject({ type: 'service', service: 'notify.persistent_notification', entityId: '' });
    expect(screen.queryByRole('combobox', { name: 'Entidad' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Obligatorio');
    await userEvent.type(screen.getByLabelText(/^Mensaje/), 'Hola');
    expect(actions[0]).toMatchObject({ data: { message: 'Hola' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
