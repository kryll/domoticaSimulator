import { useMemo } from 'react';
import { parseMarkdown, type MdInline } from './markdown';

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : p.kind === 'code' ? (
          <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em] text-slate-800">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Vista de un Markdown sencillo (títulos, listas, casillas y código). */
export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="flex flex-col gap-2 text-sm text-slate-700">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const cls = b.level === 1 ? 'text-lg font-bold text-slate-900' : b.level === 2 ? 'mt-2 text-base font-semibold text-slate-900' : 'mt-1 text-sm font-semibold text-slate-800';
            const Tag = b.level === 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5';
            return (
              <Tag key={i} className={cls}>
                <Inline parts={b.inline} />
              </Tag>
            );
          }
          case 'code':
            return (
              <pre key={i} className="overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-slate-100">
                {b.text}
              </pre>
            );
          case 'list': {
            const ListTag = b.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={i} className={b.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
                {b.items.map((item, j) => (
                  <li key={j} className={item.checkbox !== undefined ? 'list-none -ml-5' : undefined}>
                    {item.checkbox !== undefined && <input type="checkbox" defaultChecked={item.checkbox} className="mr-1.5 align-middle" aria-label="Hecho" />}
                    <Inline parts={item.inline} />
                  </li>
                ))}
              </ListTag>
            );
          }
          case 'paragraph':
            return (
              <p key={i}>
                <Inline parts={b.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
