import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

export interface ListEditorProps<T> {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, update: (next: T) => void, index: number) => ReactNode;
  /** Opciones del botón "añadir": etiqueta y fábrica del elemento. */
  addOptions: Array<{ label: string; create: () => T }>;
  emptyText: string;
}

/** Lista editable genérica con añadir, reordenar y eliminar. */
export function ListEditor<T>({ title, items, onChange, renderItem, addOptions, emptyText }: ListEditorProps<T>) {
  const replace = (i: number, next: T) => onChange(items.map((it, j) => (j === i ? next : it)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const copy = [...items];
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) return;
    copy[i] = b;
    copy[j] = a;
    onChange(copy);
  };

  return (
    <fieldset className="rounded-md border border-slate-200 p-2">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {items.length === 0 && <p className="px-1 py-1 text-xs text-slate-500">{emptyText}</p>}
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{renderItem(item, (next) => replace(i, next), i)}</div>
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button size="sm" variant="ghost" aria-label={`Subir elemento ${i + 1} de ${title}`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Bajar elemento ${i + 1} de ${title}`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Eliminar elemento ${i + 1} de ${title}`} onClick={() => remove(i)}>
                  ✕
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap gap-1">
        {addOptions.map((opt) => (
          <Button key={opt.label} size="sm" onClick={() => onChange([...items, opt.create()])}>
            + {opt.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
