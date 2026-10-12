import { countLabel, plural } from './plural';

describe('plural y countLabel', () => {
  it('elige singular o plural', () => {
    expect(plural(1, 'automatización', 'automatizaciones')).toBe('automatización');
    expect(plural(2, 'automatización', 'automatizaciones')).toBe('automatizaciones');
    expect(plural(0, 'entrada', 'entradas')).toBe('entradas');
    expect(plural(-1, 'grado', 'grados')).toBe('grado');
  });

  it('cuenta con número y concordancia', () => {
    expect(countLabel(1, 'automatización', 'automatizaciones')).toBe('1 automatización');
    expect(countLabel(2, 'automatización', 'automatizaciones')).toBe('2 automatizaciones');
    expect(countLabel(0, 'automatización', 'automatizaciones')).toBe('Ninguna automatización');
    expect(countLabel(0, 'dispositivo', 'dispositivos')).toBe('Ningún dispositivo');
    expect(countLabel(0, 'luz', 'luces')).toBe('Ninguna luz');
    expect(countLabel(0, 'problema', 'problemas')).toBe('Ningún problema');
    expect(countLabel(0, 'entrada', 'entradas', { zero: 'Sin entradas' })).toBe('Sin entradas');
    expect(countLabel(0, 'clip', 'clips', { feminine: true })).toBe('Ninguna clip');
    expect(countLabel(12345, 'entrada', 'entradas')).toBe('12.345 entradas');
  });
});
