import { describe, expect, it } from 'vitest';

import { describeNotFoundOrigin, type NotFoundBrowserContext } from './notFoundOrigin';

function context(overrides: Partial<NotFoundBrowserContext> = {}): NotFoundBrowserContext {
  return {
    referrer: '',
    location: { origin: 'https://ptbudget.org', pathname: '/gone/', search: '', hash: '' },
    navigationType: 'navigate',
    redirectCount: 0,
    ...overrides,
  };
}

describe('describeNotFoundOrigin', () => {
  it('reports what was requested', () => {
    const report = describeNotFoundOrigin(
      context({ location: { origin: 'https://ptbudget.org', pathname: '/gone/', search: '?a=1', hash: '#top' } })
    );
    expect(report.requested).toBe('/gone/?a=1#top');
  });

  it('treats a missing referrer as a typed or bookmarked address', () => {
    const report = describeNotFoundOrigin(context());
    expect(report.sender.kind).toBe('direct');
    expect(report.event).toEqual({ kind: 'typed', label: 'You typed, pasted or bookmarked the address' });
  });

  it('recognises an earlier page of this app', () => {
    const report = describeNotFoundOrigin(context({ referrer: 'https://ptbudget.org/accounts/?tab=1' }));
    expect(report.sender).toEqual({ kind: 'self', label: 'This app', detail: '/accounts/?tab=1' });
    expect(report.event.kind).toBe('link');
  });

  it('recognises the local dev server', () => {
    const report = describeNotFoundOrigin(context({ referrer: 'http://localhost:3000/' }));
    expect(report.sender.kind).toBe('local');
    expect(report.sender.detail).toBe('localhost:3000');
  });

  it.each([
    ['https://www.google.com/', 'search', 'Google Search'],
    ['https://www.google.co.uk/', 'search', 'Google Search'],
    ['https://duckduckgo.com/', 'search', 'DuckDuckGo'],
    ['https://gemini.google.com/', 'ai', 'Gemini'],
    ['https://chatgpt.com/', 'ai', 'ChatGPT'],
    ['https://mail.google.com/', 'email', 'Gmail'],
    ['https://l.facebook.com/', 'social', 'Facebook'],
    ['https://news.ycombinator.com/', 'social', 'Hacker News'],
    ['https://myteam.slack.com/', 'chat', 'Slack'],
    ['https://github.com/someone/repo', 'code', 'GitHub'],
  ] as const)('classifies %s as %s (%s)', (referrer, kind, label) => {
    const report = describeNotFoundOrigin(context({ referrer }));
    expect(report.sender.kind).toBe(kind);
    expect(report.sender.label).toBe(label);
  });

  it('does not mistake look-alike hosts for known senders', () => {
    const report = describeNotFoundOrigin(context({ referrer: 'https://notgithub.com/x' }));
    expect(report.sender.kind).toBe('other');
    expect(report.sender.label).toBe('notgithub.com');
  });

  it('falls back to the host for unknown sites and survives a garbage referrer', () => {
    expect(describeNotFoundOrigin(context({ referrer: 'https://www.example.org/blog/post' })).sender).toEqual({
      kind: 'other',
      label: 'example.org',
      detail: 'www.example.org/blog/post',
    });
    expect(describeNotFoundOrigin(context({ referrer: 'not a url' })).sender.kind).toBe('other');
  });

  it('describes reloads, history navigation and redirects', () => {
    expect(describeNotFoundOrigin(context({ navigationType: 'reload' })).event.kind).toBe('reload');
    expect(describeNotFoundOrigin(context({ navigationType: 'back_forward' })).event.kind).toBe('history');
    expect(
      describeNotFoundOrigin(context({ referrer: 'https://www.google.com/', redirectCount: 2 })).event.label
    ).toBe('You followed a link after 2 redirects');
  });

  it('surfaces campaign tags from the URL', () => {
    const report = describeNotFoundOrigin(
      context({
        location: {
          origin: 'https://ptbudget.org',
          pathname: '/promo/',
          search: '?utm_source=newsletter&utm_medium=email&utm_campaign=spring&ref=x',
          hash: '',
        },
      })
    );
    expect(report.campaign).toBe('utm_source=newsletter · utm_medium=email · utm_campaign=spring');
    expect(describeNotFoundOrigin(context()).campaign).toBeNull();
  });

  it('strips control characters and caps very long values', () => {
    const report = describeNotFoundOrigin(
      context({
        location: {
          origin: 'https://ptbudget.org',
          pathname: `/${'a'.repeat(300)}`,
          search: '?utm_source=bad\u0007value',
          hash: '',
        },
      })
    );
    expect(report.requested.length).toBeLessThanOrEqual(140);
    expect(report.campaign).toBe('utm_source=badvalue');
  });

  it('picks the same quip every time for the same visit', () => {
    const input = context({ referrer: 'https://www.google.com/' });
    expect(describeNotFoundOrigin(input).quip).toBe(describeNotFoundOrigin(input).quip);
    expect(describeNotFoundOrigin(input).quip.length).toBeGreaterThan(10);
  });
});
