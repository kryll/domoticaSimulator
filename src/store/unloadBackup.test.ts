import { backupKey, newerBackup, parseBackup, readBackup, serializeBackup, writeBackup } from './unloadBackup';
import { makeProject } from '../test/fixtures';

describe('respaldo de cierre (funciones puras)', () => {
  const stored = makeProject({ id: 'p', name: 'Casa', revision: 2, updatedAt: '2026-01-01T10:00:00.000Z' });
  const edited = { ...stored, name: 'Casa 2' };
  const at = Date.parse('2026-01-01T10:00:01.000Z');

  it('serializa con revisión y hora, y respeta el límite de tamaño', () => {
    const text = serializeBackup(edited, 2, at);
    expect(parseBackup(text ?? null)).toMatchObject({ projectId: 'p', revision: 2, savedAt: at });
    expect(serializeBackup(edited, 2, at, 50)).toBeUndefined();
    expect(parseBackup('{roto')).toBeUndefined();
  });

  it('se aplica solo si es más reciente, sobre la misma revisión y con cambios', () => {
    const backup = parseBackup(serializeBackup(edited, 2, at) ?? null);
    expect(newerBackup(backup, stored)?.name).toBe('Casa 2');
    expect(newerBackup(backup, { ...stored, revision: 3 })).toBeUndefined();
    expect(newerBackup(backup, { ...stored, updatedAt: '2026-01-01T11:00:00.000Z' })).toBeUndefined();
    expect(newerBackup(parseBackup(serializeBackup(stored, 2, at) ?? null), stored)).toBeUndefined();
  });

  it('el almacenamiento que falla no rompe nada', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('lleno');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(writeBackup(broken, edited, 2, at)).toBe(false);
    expect(readBackup(broken, 'p')).toBeUndefined();
    expect(writeBackup(undefined, edited, 2, at)).toBe(false);
  });

  it('demasiado grande: borra el respaldo viejo', () => {
    localStorage.setItem(backupKey('p'), 'viejo');
    expect(writeBackup(localStorage, edited, 2, at, 10)).toBe(false);
    expect(localStorage.getItem(backupKey('p'))).toBeNull();
  });
});
