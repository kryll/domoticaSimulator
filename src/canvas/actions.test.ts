import { connectDevices, createAutomationForDevice, duplicateDevice, orientConnection } from './actions';
import { useProjectStore } from '../store/projectStore';
import { primarySelection, useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('canvas/actions', () => {
  it('orientConnection pone el dispositivo final como origen y la infraestructura como destino', () => {
    const coord = makeDevice('sonoff-zbdongle-p', 'c1');
    const bulb = makeDevice('hue-white-e27', 'b1');
    const sensor = makeDevice('aqara-motion-p1', 's1');
    expect(orientConnection(coord, bulb)).toEqual({ sourceId: 'b1', targetId: 'c1' });
    expect(orientConnection(bulb, coord)).toEqual({ sourceId: 'b1', targetId: 'c1' });
    // un sensor final cuelga de un router (bombilla)
    expect(orientConnection(bulb, sensor)).toEqual({ sourceId: 's1', targetId: 'b1' });
  });

  it('connectDevices guarda la conexión normalizada aunque se arrastre desde el padre', () => {
    useUiStore.getState().reset();
    useProjectStore
      .getState()
      .loadProject(makeProject({ devices: [makeDevice('sonoff-zbdongle-p', 'c1'), makeDevice('sonoff-s26r2zb', 'b1', 300, 0)] }));
    expect(connectDevices('c1', 'b1')).toBe(true);
    const [conn] = useProjectStore.getState().project.connections;
    expect(conn).toMatchObject({ sourceId: 'b1', targetId: 'c1', protocol: 'zigbee' });
  });

  it('connectDevices avisa si no pueden conectarse', () => {
    useUiStore.getState().reset();
    useProjectStore
      .getState()
      .loadProject(makeProject({ devices: [makeDevice('sonoff-s26r2', 'w1'), makeDevice('hue-white-e27', 'b1', 300, 0)] }));
    expect(connectDevices('w1', 'b1')).toBe(false);
    expect(useUiStore.getState().notice?.kind).toBe('error');
  });
});

describe('canvas/actions · dispositivo', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('aqara-u200', 'lock', 0, 0, 'Cerradura'), makeDevice('shelly-1pm-gen3', 'rele', 300, 0, 'Luz cocina')],
      }),
    );
  });

  it('createAutomationForDevice usa la cerradura y no la batería', () => {
    const id = createAutomationForDevice('lock');
    const auto = useProjectStore.getState().project.automations.find((a) => a.id === id);
    expect(auto?.triggers[0]).toEqual({ type: 'state', entityId: 'lock.cerradura_lock', to: 'unlocked' });
    expect(useUiStore.getState().selectedAutomationId).toBe(id);
    expect(useUiStore.getState().bottomTab).toBe('automations');
  });

  it('createAutomationForDevice usa el relé del Shelly 1PM y no la potencia ni la energía', () => {
    const id = createAutomationForDevice('rele');
    const auto = useProjectStore.getState().project.automations.find((a) => a.id === id);
    expect(auto?.triggers[0]).toEqual({ type: 'state', entityId: 'switch.luz_cocina_switch', to: 'on' });
  });

  it('duplicateDevice copia la configuración con nombre e id nuevos y la selecciona', () => {
    const copy = duplicateDevice('rele');
    const { devices } = useProjectStore.getState().project;
    expect(devices).toHaveLength(3);
    const original = devices.find((d) => d.id === 'rele');
    expect(copy).toMatchObject({ name: 'Luz cocina 2', definitionId: original?.definitionId, protocol: original?.protocol, integration: original?.integration });
    expect(copy?.id).not.toBe('rele');
    expect(primarySelection(useUiStore.getState())).toEqual({ kind: 'device', id: copy?.id });
  });
});
