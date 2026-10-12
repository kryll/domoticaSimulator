import { connectDevices, orientConnection } from './actions';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
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
