// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InteractionTracer, { describeElement } from '@/components/common/Console/InteractionTracer';
import {
  MemorySink,
  getAmbientPage,
  resetAmbientLogContext,
  resetLogSink,
  setLogLevel,
  setLogSink,
} from '@/lib/logging';

import { LogContextProvider, useLogContext, useLogger } from './LoggingContext';

function PageProbe() {
  const { page } = useLogContext();
  return <span data-testid="page-probe">{page ?? 'none'}</span>;
}

function LoggerProbe() {
  const log = useLogger('Probe');
  return (
    <button type="button" onClick={() => log.info('clicked probe', { extra: 1 })}>
      Log it
    </button>
  );
}

describe('LogContextProvider / useLogger / InteractionTracer', () => {
  let sink: MemorySink;

  beforeEach(() => {
    resetAmbientLogContext();
    sink = new MemorySink(100);
    setLogSink(sink);
    setLogLevel('trace');
  });

  afterEach(() => {
    resetAmbientLogContext();
    resetLogSink();
    setLogLevel('info');
  });

  it('tracks the current page from aria-current nav controls and stamps it on records', async () => {
    const { rerender } = render(
      <LogContextProvider>
        <nav>
          <button type="button" data-testid="nav-dashboard" aria-current="page">
            Dashboard
          </button>
          <button type="button" data-testid="nav-budget">
            Budget
          </button>
        </nav>
        <PageProbe />
        <LoggerProbe />
      </LogContextProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('page-probe')).toHaveTextContent('dashboard');

    rerender(
      <LogContextProvider>
        <nav>
          <button type="button" data-testid="nav-dashboard">
            Dashboard
          </button>
          <button type="button" data-testid="nav-budget" aria-current="page">
            Budget
          </button>
        </nav>
        <PageProbe />
        <LoggerProbe />
      </LogContextProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('page-probe')).toHaveTextContent('budget');
    expect(getAmbientPage()).toBe('budget');

    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    const record = sink.getRecords().find((entry) => entry.message === 'clicked probe');
    expect(record?.context).toMatchObject({ component: 'Probe', page: 'budget', extra: 1 });
  });

  it('records ui.interaction entries with the element name and stamps the element onto later logs', () => {
    render(
      <LogContextProvider>
        <InteractionTracer />
        <button type="button" data-testid="nav-trips">
          Trips
        </button>
        <button type="button" aria-label="Close dialog">
          ×
        </button>
        <button type="button">Save changes</button>
        <LoggerProbe />
      </LogContextProvider>
    );

    fireEvent.click(screen.getByText('Trips'));
    fireEvent.click(screen.getByLabelText('Close dialog'));
    fireEvent.click(screen.getByText('Save changes'));
    fireEvent.keyDown(screen.getByText('Save changes'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByText('Save changes'), { key: 'a' }); // typing is not recorded
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    const interactions = sink.getRecords().filter((entry) => entry.message === 'ui.interaction');
    expect(interactions.map((entry) => [entry.context.interaction, entry.context.element])).toEqual([
      ['click', 'nav-trips'],
      ['click', 'Close dialog'],
      ['click', 'Save changes'],
      ['key', 'Save changes'],
      ['click', 'Log it'],
    ]);
    expect(interactions[3].context.key).toBe('Enter');
    expect(interactions.every((entry) => entry.level === 'debug')).toBe(true);

    // Clicking a nav control names the page the user is going to.
    expect(getAmbientPage()).toBe('trips');
    expect(interactions[1].context.page).toBe('trips');

    const probe = sink.getRecords().find((entry) => entry.message === 'clicked probe');
    expect(probe?.context).toMatchObject({ element: 'Log it', page: 'trips' });
  });

  it('describes elements by data-testid, aria-label, text, then tag', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button data-testid="save-button"><span>Save</span></button>
      <input aria-label="Amount" />
      <a href="#">A very long link label that goes on and on and on and on</a>
      <input name="email" />
      <div id="plain"></div>
    `;
    const [withTestId, withAria, link, named, plain] = [
      container.querySelector('span'),
      container.querySelector('input[aria-label]'),
      container.querySelector('a'),
      container.querySelector('input[name]'),
      container.querySelector('#plain'),
    ];
    expect(describeElement(withTestId)).toBe('save-button');
    expect(describeElement(withAria)).toBe('Amount');
    expect(describeElement(link)).toBe('A very long link label that goes on and…');
    expect(describeElement(named)).toBe('input#email');
    expect(describeElement(plain)).toBe('div#plain');
    expect(describeElement(null)).toBeUndefined();
  });

  it('useLogContext works without a provider by falling back to the ambient page', () => {
    render(<PageProbe />);
    expect(screen.getByTestId('page-probe')).toHaveTextContent('none');
  });
});
