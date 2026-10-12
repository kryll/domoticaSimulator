import { sceneTargetAfterService } from './sceneTarget';

describe('sceneTargetAfterService', () => {
  it('ajusta el brillo de una luz', () => {
    const next = sceneTargetAfterService('light.salon', { state: 'off' }, 'turn_on', { brightness_pct: 50 }, { colorModes: ['brightness'] });
    expect(next.state).toBe('on');
    expect(next.attributes?.brightness).toBe(128);
  });

  it('una persiana queda en su estado final con la posición pedida', () => {
    const next = sceneTargetAfterService('cover.persiana', { state: 'closed', attributes: { current_position: 0 } }, 'set_cover_position', {
      position: 40,
    });
    expect(next.state).toBe('open');
    expect(next.attributes?.current_position).toBe(40);
  });
});
