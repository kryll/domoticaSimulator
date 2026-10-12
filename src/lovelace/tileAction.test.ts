import { tileAction, tileActive } from './tileAction';

describe('tileAction', () => {
  it('alterna luces e interruptores', () => {
    expect(tileAction('light.salon', { state: 'off' })).toEqual({ service: 'light.turn_on', label: 'Encender' });
    expect(tileAction('switch.grupo_x', { state: 'on' })).toEqual({ service: 'switch.turn_off', label: 'Apagar' });
  });
  it('abre o cierra persianas y cerraduras', () => {
    expect(tileAction('cover.estor', { state: 'closed' })?.service).toBe('cover.open_cover');
    expect(tileAction('lock.puerta', { state: 'locked' })?.service).toBe('lock.unlock');
  });
  it('no controla personas, sensores ni entidades no disponibles', () => {
    expect(tileAction('person.ana', { state: 'home' })).toBeNull();
    expect(tileAction('light.salon', { state: 'unavailable' })).toBeNull();
    expect(tileActive({ state: 'home' })).toBe(true);
  });
});
