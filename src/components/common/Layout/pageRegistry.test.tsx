// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ai/AiPanelProvider', () => ({
  useAiPanel: () => ({ isOpen: false, openPanel: vi.fn(), closePanel: vi.fn(), togglePanel: vi.fn() }),
}));

import {
  DEFAULT_PAGE_ID,
  PAGE_DEFINITIONS,
  getMobileNavigationPages,
  getNavigationPages,
  getPage,
} from './pageRegistry';

describe('pageRegistry', () => {
  it('has unique ids and nav-<id> test ids', () => {
    const ids = PAGE_DEFINITIONS.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of PAGE_DEFINITIONS) {
      expect(page.testId).toBe(`nav-${page.id}`);
      expect(page.label.trim()).not.toBe('');
      expect(page.icon).toBeTruthy();
      expect(typeof page.render).toBe('function');
    }
  });

  it('registers the notifications page in the main navigation', () => {
    const notifications = getPage('notifications');
    expect(notifications.section).toBe('main');
    expect(notifications.hiddenFromNav).toBeFalsy();
    expect(notifications.mobileNav).toBe(true);
    expect(getNavigationPages().map((page) => page.id)).toContain('notifications');
  });

  it('keeps settings and the developer console out of the page list as full-screen pages', () => {
    for (const id of ['settings', 'developer-console'] as const) {
      const page = getPage(id);
      expect(page.hiddenFromNav).toBe(true);
      expect(page.fullScreen).toBe(true);
    }
    expect(getNavigationPages().map((page) => page.id)).not.toContain('settings');
  });

  it('orders navigation pages and preserves the historical labels the e2e suite clicks', () => {
    const nav = getNavigationPages();
    const orders = nav.map((page) => page.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(nav.map((page) => page.label)).toEqual([
      'Dashboard',
      'Projects',
      'Trips',
      'Budget',
      'Accounts',
      'Transactions',
      'Subscriptions',
      'Notifications',
      'SQL Query',
    ]);
    expect(getPage('settings').label).toBe('Settings');
    expect(getPage('developer-console').label).toBe('Developer Console');
  });

  it('exposes the mobile navigation candidates and the default page', () => {
    expect(getMobileNavigationPages().every((page) => page.mobileNav)).toBe(true);
    expect(getMobileNavigationPages().map((page) => page.id)).toContain('dashboard');
    expect(DEFAULT_PAGE_ID).toBe('dashboard');
  });

  it('throws for unknown ids', () => {
    expect(() => getPage('nope' as never)).toThrow('Unknown page: nope');
  });
});
