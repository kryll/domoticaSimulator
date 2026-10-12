import { useId, type ReactNode } from 'react';
import type { Action } from '../../types';
import { ActionScopeContext, useActionScope } from './scopeContext';
import { availableVariables, scopeForItem, type ActionScope } from './scopeVars';

/** Ámbito de la acción `index` de una secuencia (para sus editores anidados). */
export function ScopeItem({ actions, index, children }: { actions: Action[]; index: number; children: ReactNode }) {
  const parent = useActionScope();
  return <ActionScopeContext.Provider value={scopeForItem(parent, actions, index)}>{children}</ActionScopeContext.Provider>;
}

/** Secuencia anidada (choose, if, repeat...): un nivel más; `repeat` añade repeat.index. */
export function NestedScope({ repeat, children }: { repeat?: boolean; children: ReactNode }) {
  const parent = useActionScope();
  const scope: ActionScope = { ...parent, depth: parent.depth + 1, inRepeat: parent.inRepeat || repeat === true };
  return <ActionScopeContext.Provider value={scope}>{children}</ActionScopeContext.Provider>;
}

/** Ámbito raíz de una automatización: conoce sus disparadores (trigger.*). */
export function AutomationScope({ triggerTypes, children }: { triggerTypes: ActionScope['triggerTypes']; children: ReactNode }) {
  return <ActionScopeContext.Provider value={{ topLevel: [], local: [], inRepeat: false, depth: 0, triggerTypes }}>{children}</ActionScopeContext.Provider>;
}

/**
 * Ayuda breve con las variables disponibles en este punto y un desplegable para insertarlas
 * como {{ nombre }}.
 */
export function VariableHelp({ onInsert }: { onInsert: (token: string) => void }) {
  const vars = availableVariables(useActionScope());
  const id = useId();
  if (vars.length === 0) {
    return <p className="text-[11px] text-slate-500">Sin variables aquí. Añade antes una acción «Variables» para usar {'{{ nombre }}'}.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
      <span>
        Variables: {vars.map((v) => v.name).join(', ')}
      </span>
      <label htmlFor={id} className="sr-only">
        Insertar variable
      </label>
      <select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value) onInsert(`{{ ${e.target.value} }}`);
        }}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <option value="">+ Insertar variable…</option>
        {vars.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name} — {v.hint}
          </option>
        ))}
      </select>
    </div>
  );
}
