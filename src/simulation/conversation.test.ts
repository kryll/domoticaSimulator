import { describe, expect, it } from 'vitest';
import { matchCommand, matchSentence, normalizeUtterance } from './conversation';

describe('frases personalizadas (trigger conversation)', () => {
  it('normaliza acentos, mayúsculas y signos', () => {
    expect(normalizeUtterance('¡Buenas  NOCHES, Nabu!')).toBe('buenas noches nabu');
  });

  it('admite [opcional], (a|b) y {comodín}', () => {
    expect(matchSentence('[Oye] buenas noches', 'buenas noches')).toBe(true);
    expect(matchSentence('[Oye] buenas noches', 'Oye, buenas noches')).toBe(true);
    expect(matchSentence('(me voy|salgo) de casa', 'Salgo de casa')).toBe(true);
    expect(matchSentence('(me voy|salgo) de casa', 'entro en casa')).toBe(false);
    expect(matchSentence('pon música de {artista}', 'Pon música de Rosalía')).toBe(true);
    expect(matchSentence('modo cine', 'activa el modo cine')).toBe(false);
  });

  it('devuelve la primera plantilla que encaja', () => {
    expect(matchCommand(['hola', 'modo [de] fiesta'], 'Modo fiesta')).toBe('modo [de] fiesta');
    expect(matchCommand(['hola'], 'adiós')).toBeUndefined();
  });
});
