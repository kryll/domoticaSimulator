import { formatKwh, formatMoney, formatWatts, parseMoneyInput } from './money';

describe('parseMoneyInput', () => {
  it.each([
    ['12,50', 12.5],
    ['12.5', 12.5],
    ['1.299', 1299],
    ['1.234,56', 1234.56],
    ['12.345.678', 12345678],
    ['1234', 1234],
    [' 99,90 € ', 99.9],
    ['0,2', 0.2],
    ['1.5', 1.5],
  ])('«%s» → %s', (text, expected) => {
    expect(parseMoneyInput(text)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1,2,3', '12,5.3', '1.23.4', '1.2345,6'])('«%s» no es válido', (text) => {
    expect(parseMoneyInput(text)).toBeUndefined();
  });
});

describe('formatos es-ES', () => {
  it('moneda, vatios y energía', () => {
    expect(formatMoney(1234.5).replace(/\s/g, ' ')).toBe('1234,50 €');
    expect(formatMoney(12345.5).replace(/\s/g, ' ')).toBe('12.345,50 €');
    expect(formatWatts(60)).toBe('60 W');
    expect(formatWatts(1500)).toBe('1,5 kW');
    expect(formatKwh(0.012)).toBe('12 Wh');
    expect(formatKwh(2.345)).toBe('2,35 kWh');
  });
});
