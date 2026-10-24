/**
 * Ambient log context: what the user is doing right now, outside React.
 *
 * `LogContextProvider` keeps `page` current and the interaction tracer calls
 * `noteInteraction` on every click / key press. The logger merges this under
 * every record's explicit context, and the worker transport copies it into
 * each request's `meta`, so "which page, which control" travels with every
 * app and worker row without threading props through the tree.
 */

import type { LogContext } from './types';

/** How long the last UI interaction keeps being stamped onto new records. */
export const INTERACTION_STAMP_WINDOW_MS = 3000;

export interface AmbientInteraction {
  element: string;
  at: number;
}

interface AmbientState {
  page?: string;
  component?: string;
  operation?: string;
  interaction?: AmbientInteraction;
}

const state: AmbientState = {};
const pageListeners = new Set<(page: string | undefined) => void>();

export function setAmbientPage(page: string | undefined): void {
  if (state.page === page) return;
  state.page = page;
  for (const listener of pageListeners) {
    try {
      listener(page);
    } catch {
      // Listeners must never break the caller.
    }
  }
}

export function getAmbientPage(): string | undefined {
  return state.page;
}

export function subscribeAmbientPage(listener: (page: string | undefined) => void): () => void {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
}

/** Records the most recent user interaction; `element` is a data-testid, aria-label or trimmed text. */
export function noteInteraction(element: string, at: number = Date.now()): void {
  state.interaction = { element, at };
}

export function getLastInteraction(now: number = Date.now()): AmbientInteraction | undefined {
  const interaction = state.interaction;
  if (!interaction) return undefined;
  if (now - interaction.at > INTERACTION_STAMP_WINDOW_MS) return undefined;
  return interaction;
}

/**
 * Scoped component / operation hints for code that runs outside React (e.g.
 * a service method called from a click handler). Set them for the duration
 * of a synchronous call; async continuations should carry a child logger.
 */
export function setAmbientOperation(component?: string, operation?: string): void {
  state.component = component;
  state.operation = operation;
}

/** The context the logger stamps under every record; only defined fields are returned. */
export function getAmbientLogContext(now: number = Date.now()): LogContext {
  const context: LogContext = {};
  if (state.page) context.page = state.page;
  if (state.component) context.component = state.component;
  if (state.operation) context.operation = state.operation;
  const interaction = getLastInteraction(now);
  if (interaction) context.element = interaction.element;
  return context;
}

export const NAV_TEST_ID_PREFIX = 'nav-';

/** `nav-*` controls that open a menu rather than navigate to a registry page (the mobile "More" sheet). */
const NON_PAGE_NAV_IDS = new Set(['more', 'menu']);

/** Page id from a registry navigation control's test id (`nav-dashboard` → `dashboard`). */
export function pageIdFromNavTestId(testId: string | null | undefined): string | undefined {
  if (!testId || !testId.startsWith(NAV_TEST_ID_PREFIX)) return undefined;
  const id = testId.slice(NAV_TEST_ID_PREFIX.length);
  return id === '' || NON_PAGE_NAV_IDS.has(id) ? undefined : id;
}

/** Test helper. */
export function resetAmbientLogContext(): void {
  delete state.page;
  delete state.component;
  delete state.operation;
  delete state.interaction;
}
