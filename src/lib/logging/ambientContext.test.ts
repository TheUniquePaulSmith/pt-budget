import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INTERACTION_STAMP_WINDOW_MS,
  getAmbientLogContext,
  getLastInteraction,
  noteInteraction,
  pageIdFromNavTestId,
  resetAmbientLogContext,
  setAmbientOperation,
  setAmbientPage,
  subscribeAmbientPage,
} from './ambientContext';
import { logger, resetLogSink, setLogLevel, setLogSink } from './logger';
import { MemorySink } from './memorySink';

describe('ambient log context', () => {
  let sink: MemorySink;

  beforeEach(() => {
    resetAmbientLogContext();
    sink = new MemorySink(10);
    setLogSink(sink);
    setLogLevel('trace');
  });

  afterEach(() => {
    resetAmbientLogContext();
    resetLogSink();
    setLogLevel('info');
  });

  it('stamps the current page and recent interaction under every record', () => {
    setAmbientPage('budget');
    noteInteraction('save-budget-button');

    const log = logger.child({ component: 'BudgetPage' });
    log.info('Saved', { rows: 2 });

    expect(getAmbientLogContext()).toEqual({ page: 'budget', element: 'save-budget-button' });
    expect(sink.getRecords()[0].context).toMatchObject({
      page: 'budget',
      element: 'save-budget-button',
      component: 'BudgetPage',
      rows: 2,
    });
  });

  it('lets explicit context win over the ambient values', () => {
    setAmbientPage('dashboard');
    setAmbientOperation('AmbientComponent', 'ambientOp');
    logger.child({ component: 'Explicit' }).info('x', { page: 'settings' });

    expect(sink.getRecords()[0].context).toMatchObject({ page: 'settings', component: 'Explicit', operation: 'ambientOp' });
  });

  it('forgets the interaction after the stamp window', () => {
    noteInteraction('nav-dashboard', 10_000);
    expect(getLastInteraction(10_000 + INTERACTION_STAMP_WINDOW_MS)).toEqual({ element: 'nav-dashboard', at: 10_000 });
    expect(getLastInteraction(10_000 + INTERACTION_STAMP_WINDOW_MS + 1)).toBeUndefined();
    expect(getAmbientLogContext(10_000 + INTERACTION_STAMP_WINDOW_MS + 1)).toEqual({});
  });

  it('notifies page subscribers only on change', () => {
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeAmbientPage((page) => seen.push(page));
    setAmbientPage('trips');
    setAmbientPage('trips');
    setAmbientPage('projects');
    unsubscribe();
    setAmbientPage('budget');
    expect(seen).toEqual(['trips', 'projects']);
  });

  it('maps registry nav test ids to page ids', () => {
    expect(pageIdFromNavTestId('nav-sql-query')).toBe('sql-query');
    expect(pageIdFromNavTestId('nav-')).toBeUndefined();
    expect(pageIdFromNavTestId('nav-more')).toBeUndefined();
    expect(pageIdFromNavTestId('other')).toBeUndefined();
    expect(pageIdFromNavTestId(undefined)).toBeUndefined();
  });
});
