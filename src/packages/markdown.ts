// Analizador de Markdown mínimo para previsualizar la guía de emparejamiento (solo interfaz).

export type MdInline = { kind: 'text' | 'bold' | 'code'; text: string };

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: Array<{ checkbox?: boolean; inline: MdInline[] }> }
  | { kind: 'code'; text: string }
  | { kind: 'paragraph'; inline: MdInline[] };

/** **negrita** y `código` en línea. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: text.slice(last, i) });
    const tok = m[0];
    out.push(tok.startsWith('**') ? { kind: 'bold', text: tok.slice(2, -2) } : { kind: 'code', text: tok.slice(1, -1) });
    last = i + tok.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: (h[1]?.length ?? 1) as 1 | 2 | 3, inline: parseInline(h[2] ?? '') });
      i++;
      continue;
    }
    const item = /^\s*(?:(-)|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const items: Array<{ checkbox?: boolean; inline: MdInline[] }> = [];
      while (i < lines.length) {
        const m = /^\s*(?:(-)|(\d+)\.)\s+(.*)$/.exec(lines[i] ?? '');
        if (!m || (m[2] !== undefined) !== ordered) break;
        let text = m[3] ?? '';
        let checkbox: boolean | undefined;
        const cb = /^\[( |x)\]\s+(.*)$/.exec(text);
        if (cb) {
          checkbox = cb[1] === 'x';
          text = cb[2] ?? '';
        }
        items.push({ ...(checkbox !== undefined ? { checkbox } : {}), inline: parseInline(text) });
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(line) });
    i++;
  }
  return blocks;
}
