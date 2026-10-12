import { parseInline, parseMarkdown } from './markdown';

describe('markdown mínimo', () => {
  it('analiza negrita y código en línea', () => {
    expect(parseInline('Copia **packages/** en `config`.')).toEqual([
      { kind: 'text', text: 'Copia ' },
      { kind: 'bold', text: 'packages/' },
      { kind: 'text', text: ' en ' },
      { kind: 'code', text: 'config' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('analiza títulos, listas, casillas y bloques de código', () => {
    const blocks = parseMarkdown('# Guía\n\n1. Uno\n2. Dos\n\n```yaml\na: 1\n```\n- [ ] **Luz**\n- [x] Hecho\nTexto');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'code', 'list', 'paragraph']);
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[2]).toEqual({ kind: 'code', text: 'a: 1' });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: false, items: [{ checkbox: false }, { checkbox: true }] });
  });
});
