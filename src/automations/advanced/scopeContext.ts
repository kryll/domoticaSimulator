import { createContext, useContext } from 'react';
import { ROOT_SCOPE, type ActionScope } from './scopeVars';

/** Ámbito de variables del punto del editor de acciones en que se está. */
export const ActionScopeContext = createContext<ActionScope>(ROOT_SCOPE);

export function useActionScope(): ActionScope {
  return useContext(ActionScopeContext);
}
