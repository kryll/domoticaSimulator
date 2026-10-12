import { useUiStore } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('gestiona selección, modo y panel', () => {
    const ui = useUiStore.getState();
    ui.select({ kind: 'device', id: 'd1' });
    ui.setCanvasMode('room');
    ui.setBottomOpen(false);
    ui.setBottomTab('logbook');
    const s = useUiStore.getState();
    expect(s.selection).toEqual({ kind: 'device', id: 'd1' });
    expect(s.canvasMode).toBe('room');
    expect(s.bottomTab).toBe('logbook');
    expect(s.bottomOpen).toBe(true);
  });

  it('cambiar de planta limpia la selección', () => {
    useUiStore.getState().select({ kind: 'room', id: 'r1' });
    useUiStore.getState().setActiveFloor('f2');
    expect(useUiStore.getState().selection).toBeNull();
    expect(useUiStore.getState().activeFloorId).toBe('f2');
  });

  it('focusDevices resalta y genera una petición nueva cada vez', () => {
    useUiStore.getState().focusDevices(['a']);
    const first = useUiStore.getState().focusRequest;
    useUiStore.getState().focusDevices(['a']);
    expect(useUiStore.getState().focusRequest?.nonce).not.toBe(first?.nonce);
    expect(useUiStore.getState().highlightedDeviceIds).toEqual(['a']);
  });
});
