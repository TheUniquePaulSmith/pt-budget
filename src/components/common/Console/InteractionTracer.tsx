'use client';

/**
 * Records what the user does, for traceability in the Developer Console.
 *
 * A capture-phase click / keydown listener on the document writes a
 * `ui.interaction` record (debug level) naming the element — its
 * `data-testid`, else `aria-label`, else trimmed text — and the page, and
 * notes the interaction in the ambient context so every record logged in the
 * next few seconds (including the worker rows caused by it) carries
 * `element`. Typed characters are never recorded: only Enter, Escape and
 * modifier shortcuts count as key interactions.
 *
 * Mounted by LoggingProvider, so it needs nothing from the shell.
 */

import { useEffect } from 'react';

import { getAmbientPage, logger, noteInteraction, pageIdFromNavTestId, setAmbientPage } from '@/lib/logging';

const MAX_TEXT_LENGTH = 40;
const TRACKED_KEYS = new Set(['Enter', 'Escape']);
const INTERACTIVE_SELECTOR =
  '[data-testid], [aria-label], button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="gridcell"], input, select, textarea, label, summary';

const log = logger.child({ component: 'InteractionTracer' });

/** The element name the console shows: data-testid → aria-label → trimmed text → tag#id. */
export function describeElement(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const element = target.closest<HTMLElement>(INTERACTIVE_SELECTOR) ?? (target as HTMLElement);
  const testId = element.getAttribute('data-testid');
  if (testId) return testId;
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy && element.ownerDocument) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return truncate(text);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const name = element.getAttribute('name') ?? element.id;
    if (name) return `${element.tagName.toLowerCase()}#${name}`;
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
  }
  const text = element.textContent?.replace(/\s+/g, ' ').trim();
  if (text) return truncate(text);
  const title = element.getAttribute('title');
  if (title) return title.trim();
  return element.id ? `${element.tagName.toLowerCase()}#${element.id}` : element.tagName.toLowerCase();
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

function navTargetPage(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const navControl = target.closest<HTMLElement>('[data-testid^="nav-"]');
  return pageIdFromNavTestId(navControl?.dataset.testid);
}

function keyLabel(event: KeyboardEvent): string | undefined {
  const modifiers = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
  const hasShortcutModifier = event.ctrlKey || event.metaKey || event.altKey;
  if (!TRACKED_KEYS.has(event.key) && !hasShortcutModifier) return undefined;
  if (hasShortcutModifier && event.key.length === 1 && !/[a-z0-9]/i.test(event.key)) return undefined;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return undefined;
  return [...modifiers, event.key].join('+');
}

export function recordInteraction(kind: 'click' | 'key', element: string | undefined, detail?: Record<string, unknown>): void {
  const name = element ?? 'unknown';
  noteInteraction(name);
  log.debug('ui.interaction', { element: name, interaction: kind, page: getAmbientPage(), ...detail });
}

export default function InteractionTracer() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const onClick = (event: MouseEvent) => {
      const element = describeElement(event.target);
      // A navigation control names the page the user is going to.
      const page = navTargetPage(event.target);
      if (page) setAmbientPage(page);
      recordInteraction('click', element);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = keyLabel(event);
      if (!key) return;
      recordInteraction('key', describeElement(event.target), { key });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return null;
}
