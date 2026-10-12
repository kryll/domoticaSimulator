import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildSearchIndex, search, type SearchEntry, type SearchKind } from './search';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore } from '../store/layoutStore';
import { knownDefinitions } from '../canvas/analysis';
import { runSearchEntry } from '../ui/paletteActions';
import { trapTab } from '../ui/focusTrap';
import { cx } from '../ui/cx';

const KIND_ICONS: Record<SearchKind, string> = {
  action: '⚡',
  device: '📟',
  entity: '🔹',
  automation: '🤖',
  scene: '🎬',
  script: '📜',
  helper: '🧩',
  room: '🏠',
};

/**
 * Búsqueda global (Ctrl/Cmd+K): paleta de comandos con el patrón combobox de ARIA. Resultados
 * agrupados (acciones, dispositivos, entidades, automatizaciones...), flechas para moverse e Intro
 * para elegir.
 */
export function CommandPalette() {
  const close = () => useLayoutStore.getState().setPaletteOpen(false);
  const project = useProjectStore((s) => s.project);
  const index = useMemo(() => buildSearchIndex(project, knownDefinitions()), [project]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => search(index, query), [index, query]);
  const flat = useMemo<SearchEntry[]>(() => results.groups.flatMap((g) => g.results.map((r) => r.entry)), [results]);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.scrollIntoView?.({ block: 'nearest' });
    // optionId depende solo de baseId, que no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    close();
    runSearchEntry(entry);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    else if (e.key === 'ArrowUp') setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    else if (e.key === 'Home' && e.ctrlKey) setActive(0);
    else if (e.key === 'End' && e.ctrlKey) setActive(Math.max(0, flat.length - 1));
    else if (e.key === 'Enter') choose(flat[active]);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let n = -1;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-3 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda global"
        onKeyDown={(e) => trapTab(e, dialogRef.current)}
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <span aria-hidden="true" className="text-slate-500">
            🔍
          </span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
            aria-label="Buscar dispositivos, automatizaciones y acciones"
            placeholder="Busca un dispositivo, una automatización o una acción…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-[3rem] w-full bg-transparent text-base text-slate-800 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="hidden rounded border border-slate-300 px-1.5 font-mono text-[11px] text-slate-500 sm:inline">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label="Resultados de la búsqueda" className="min-h-0 flex-1 overflow-auto py-1">
          {flat.length === 0 && (
            <p role="presentation" className="px-4 py-6 text-center text-sm text-slate-600">
              Nada coincide con «{query}».
            </p>
          )}
          {results.groups.map((g) => (
            <div key={g.kind} role="group" aria-labelledby={`${baseId}-g-${g.kind}`}>
              <div id={`${baseId}-g-${g.kind}`} role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {g.label}
              </div>
              {g.results.map(({ entry }) => {
                n++;
                const i = n;
                return (
                  <div
                    key={`${entry.kind}:${entry.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(entry)}
                    className={cx('flex min-h-[2.75rem] cursor-pointer items-center gap-2 px-3 py-1.5', i === active ? 'bg-sky-50' : 'hover:bg-slate-50')}
                  >
                    <span aria-hidden="true" className="shrink-0">
                      {KIND_ICONS[entry.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">{entry.title}</span>
                      {entry.subtitle && <span className="block truncate text-xs text-slate-500">{entry.subtitle}</span>}
                    </span>
                    {i === active && (
                      <kbd aria-hidden="true" className="shrink-0 font-mono text-[11px] text-slate-500">
                        ↵
                      </kbd>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-600" aria-live="polite">
          {query.trim() === '' ? 'Escribe para buscar · ↑↓ para moverte · Intro para elegir' : `${results.total} ${results.total === 1 ? 'resultado' : 'resultados'}`}
        </p>
      </div>
    </div>
  );
}
