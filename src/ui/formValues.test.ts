import {
  dataToInput,
  parseDataInput,
  parseNumberInput,
  parseStateInput,
  servicesForEntity,
  splitTopLevel,
  stateToInput,
} from './formValues';

describe('formValues', () => {
  it('parseStateInput convierte números y booleanos', () => {
    expect(parseStateInput('')).toBeUndefined();
    expect(parseStateInput(' on ')).toBe('on');
    expect(parseStateInput('21.5')).toBe(21.5);
    expect(parseStateInput('-3')).toBe(-3);
    expect(parseStateInput('true')).toBe(true);
    expect(parseStateInput('1e3')).toBe('1e3');
    expect(stateToInput(undefined)).toBe('');
    expect(stateToInput(false)).toBe('false');
  });

  it('parseNumberInput', () => {
    expect(parseNumberInput('')).toBeUndefined();
    expect(parseNumberInput('abc')).toBeUndefined();
    expect(parseNumberInput('7')).toBe(7);
  });

  it('parseDataInput respeta comas dentro de corchetes y comillas', () => {
    expect(parseDataInput('brightness=200, rgb_color=[255,0,0]')).toEqual({ brightness: 200, rgb_color: '[255,0,0]' });
    expect(parseDataInput('message="hola, mundo"\ntemperature=21')).toEqual({ message: '"hola, mundo"', temperature: 21 });
    expect(parseDataInput('url=a=b')).toEqual({ url: 'a=b' });
    expect(parseDataInput('  ,  ')).toBeUndefined();
    expect(splitTopLevel('a=[1,2],b={x,y}')).toEqual(['a=[1,2]', 'b={x,y}']);
  });

  it('dataToInput es inverso de parseDataInput', () => {
    const data = { brightness: 200, rgb_color: '[255,0,0]' };
    expect(parseDataInput(dataToInput(data))).toEqual(data);
    expect(dataToInput(undefined)).toBe('');
  });

  it('servicesForEntity según el dominio', () => {
    expect(servicesForEntity('light.salon')).toContain('light.turn_on');
    expect(servicesForEntity('cover.persiana')).toContain('cover.open_cover');
    expect(servicesForEntity('raro.x')).toEqual(['raro.turn_on', 'raro.turn_off']);
  });
});
