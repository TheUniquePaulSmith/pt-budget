/**
 * Works out who (or what) sent a visitor to the 404 page. Everything here is
 * derived locally from the browser: `document.referrer`, the navigation
 * timing entry and the URL itself. Nothing is stored or sent anywhere.
 *
 * Browsers deliberately limit what is available: a cross-origin referrer is
 * trimmed to the site (no path) by default, and many senders (email clients,
 * apps, privacy modes) send none at all. The report says so instead of guessing.
 */

export type SenderKind =
  | 'direct'
  | 'self'
  | 'local'
  | 'search'
  | 'ai'
  | 'social'
  | 'chat'
  | 'email'
  | 'code'
  | 'other';

export type EventKind = 'reload' | 'history' | 'prerender' | 'link' | 'typed';

export interface NotFoundBrowserContext {
  /** `document.referrer`; empty when the browser shared none. */
  referrer: string;
  location: { origin: string; pathname: string; search: string; hash: string };
  /** `PerformanceNavigationTiming.type` of the document load, when known. */
  navigationType: string | null;
  redirectCount: number;
}

export interface NotFoundOriginReport {
  /** The path, query and hash that did not resolve. */
  requested: string;
  sender: { kind: SenderKind; label: string; detail: string | null };
  event: { kind: EventKind; label: string };
  /** Tracking tags carried by the URL (utm_*, ref, ...), if any. */
  campaign: string | null;
  quip: string;
}

interface KnownSender {
  kind: SenderKind;
  label: string;
  domains: string[];
}

// More specific entries first: `gemini.google.com` must win over Google Search.
const KNOWN_SENDERS: KnownSender[] = [
  { kind: 'ai', label: 'Gemini', domains: ['gemini.google.com'] },
  { kind: 'ai', label: 'ChatGPT', domains: ['chatgpt.com', 'chat.openai.com'] },
  { kind: 'ai', label: 'Claude', domains: ['claude.ai'] },
  { kind: 'ai', label: 'Perplexity', domains: ['perplexity.ai'] },
  { kind: 'ai', label: 'Copilot', domains: ['copilot.microsoft.com'] },
  { kind: 'email', label: 'Gmail', domains: ['mail.google.com'] },
  { kind: 'email', label: 'Outlook', domains: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'] },
  { kind: 'email', label: 'Yahoo Mail', domains: ['mail.yahoo.com'] },
  { kind: 'email', label: 'Proton Mail', domains: ['mail.proton.me'] },
  { kind: 'search', label: 'Bing', domains: ['bing.com'] },
  { kind: 'search', label: 'DuckDuckGo', domains: ['duckduckgo.com'] },
  { kind: 'search', label: 'Brave Search', domains: ['search.brave.com'] },
  { kind: 'search', label: 'Ecosia', domains: ['ecosia.org'] },
  { kind: 'search', label: 'Yahoo Search', domains: ['search.yahoo.com', 'yahoo.com'] },
  { kind: 'search', label: 'Baidu', domains: ['baidu.com'] },
  { kind: 'search', label: 'Yandex', domains: ['yandex.com', 'yandex.ru'] },
  { kind: 'search', label: 'Kagi', domains: ['kagi.com'] },
  { kind: 'search', label: 'Startpage', domains: ['startpage.com'] },
  { kind: 'social', label: 'Facebook', domains: ['facebook.com', 'fb.com'] },
  { kind: 'social', label: 'Instagram', domains: ['instagram.com'] },
  { kind: 'social', label: 'X (Twitter)', domains: ['x.com', 'twitter.com', 't.co'] },
  { kind: 'social', label: 'LinkedIn', domains: ['linkedin.com', 'lnkd.in'] },
  { kind: 'social', label: 'Reddit', domains: ['reddit.com'] },
  { kind: 'social', label: 'Hacker News', domains: ['news.ycombinator.com'] },
  { kind: 'social', label: 'Bluesky', domains: ['bsky.app'] },
  { kind: 'social', label: 'Threads', domains: ['threads.net'] },
  { kind: 'social', label: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
  { kind: 'social', label: 'TikTok', domains: ['tiktok.com'] },
  { kind: 'social', label: 'Pinterest', domains: ['pinterest.com'] },
  { kind: 'chat', label: 'Slack', domains: ['slack.com'] },
  { kind: 'chat', label: 'Discord', domains: ['discord.com'] },
  { kind: 'chat', label: 'Microsoft Teams', domains: ['teams.microsoft.com'] },
  { kind: 'chat', label: 'WhatsApp', domains: ['web.whatsapp.com', 'whatsapp.com'] },
  { kind: 'chat', label: 'Telegram', domains: ['t.me', 'web.telegram.org'] },
  { kind: 'code', label: 'GitHub', domains: ['github.com'] },
  { kind: 'code', label: 'GitLab', domains: ['gitlab.com'] },
  { kind: 'code', label: 'Bitbucket', domains: ['bitbucket.org'] },
  { kind: 'code', label: 'Stack Overflow', domains: ['stackoverflow.com'] },
  { kind: 'code', label: 'npm', domains: ['npmjs.com'] },
];

const GOOGLE_SEARCH_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;

const QUIPS: Record<SenderKind, string[]> = {
  direct: [
    'No sender on record. Maybe a typo, maybe the money flew off with the evidence.',
    'Nobody sent you. Either you typed it yourself or the sender kept their receipts private.',
  ],
  self: [
    'The call is coming from inside the budget. An older page of this app pointed here.',
    'An earlier page of this very app sent you. Family, but awkward.',
  ],
  local: [
    'Your own dev server sent you here. Check the route, then check the budget.',
    'Localhost sent you. Somebody is mid-build, and it is probably you.',
  ],
  search: [
    'A search engine sent you. Search results age like receipts in a coat pocket.',
    'Search indexes remember pages long after they have been spent.',
  ],
  ai: [
    'An AI sent you here. It may have confidently invented this address.',
    'Chatbots are great at URLs that sound real. This one only sounded real.',
  ],
  social: [
    'Someone shared a link that stopped working. Awkward for them, too.',
    'The link went round the internet while the page left the building.',
  ],
  chat: [
    'Someone dropped a link in chat and the page spent itself before you clicked.',
    'A chat link, a missing page: the oldest story in group messaging.',
  ],
  email: [
    'An email link went stale, like most things that live in an inbox.',
    'The email promised a page. The page has left the building.',
  ],
  code: [
    'A README pointed here. READMEs and reality drift apart over time.',
    'Docs linked here once. The page and the docs parted ways.',
  ],
  other: [
    'A link from somewhere out there pointed at this page. It is not here.',
    'Another site sent you this way. They may want to update their link.',
  ],
};

const EVENT_QUIPS: Partial<Record<EventKind, string[]>> = {
  reload: [
    'Refreshing will not bring it back. We checked the books.',
    'You reloaded and it is still gone. The page is not hiding, it is spent.',
  ],
  history: [
    'You travelled through history into a page that is not there. Brave.',
    'Back and forward both lead to the same empty ledger.',
  ],
};

function stableIndex(seed: string, length: number): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

function limit(text: string, max: number): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function describeSender(
  context: NotFoundBrowserContext
): NotFoundOriginReport['sender'] {
  if (!context.referrer) {
    return {
      kind: 'direct',
      label: 'Nobody',
      detail: 'No referrer. You typed or pasted the address, used a bookmark, or your browser kept the sender private.',
    };
  }

  let url: URL;
  try {
    url = new URL(context.referrer);
  } catch {
    return { kind: 'other', label: 'Somewhere unknown', detail: limit(context.referrer, 120) };
  }

  const path = `${url.pathname}${url.search}`;
  const hostname = url.hostname.toLowerCase();

  if (url.origin === context.location.origin) {
    return { kind: 'self', label: 'This app', detail: limit(path || '/', 120) };
  }

  if (isLocalHost(hostname)) {
    return { kind: 'local', label: 'Your dev server', detail: limit(`${url.host}${path === '/' ? '' : path}`, 120) };
  }

  // Cross-origin referrers usually arrive trimmed to the site, so `where` is
  // often just the host.
  const where = limit(`${url.host}${path === '/' ? '' : path}`, 120);

  const known = KNOWN_SENDERS.find((entry) => entry.domains.some((domain) => domainMatches(hostname, domain)));
  if (known) {
    return { kind: known.kind, label: known.label, detail: where };
  }
  if (GOOGLE_SEARCH_HOST.test(hostname)) {
    return { kind: 'search', label: 'Google Search', detail: where };
  }

  return { kind: 'other', label: hostname.replace(/^www\./, ''), detail: where };
}

function describeEvent(context: NotFoundBrowserContext): NotFoundOriginReport['event'] {
  const redirects =
    context.redirectCount > 0
      ? ` after ${context.redirectCount} redirect${context.redirectCount === 1 ? '' : 's'}`
      : '';

  switch (context.navigationType) {
    case 'reload':
      return { kind: 'reload', label: 'You reloaded the page' };
    case 'back_forward':
      return { kind: 'history', label: 'You used the back or forward button' };
    case 'prerender':
      return { kind: 'prerender', label: `Your browser prerendered it${redirects}` };
    default:
      return context.referrer
        ? { kind: 'link', label: `You followed a link${redirects}` }
        : { kind: 'typed', label: `You typed, pasted or bookmarked the address${redirects}` };
  }
}

const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source', 'from'];

function describeCampaign(search: string): string | null {
  const params = new URLSearchParams(search);
  const tags = CAMPAIGN_KEYS.flatMap((key) => {
    const value = params.get(key);
    return value ? [`${key}=${limit(value, 40)}`] : [];
  });
  return tags.length > 0 ? tags.slice(0, 3).join(' · ') : null;
}

export function describeNotFoundOrigin(context: NotFoundBrowserContext): NotFoundOriginReport {
  const { pathname, search, hash } = context.location;
  const sender = describeSender(context);
  const event = describeEvent(context);
  const requested = limit(`${pathname}${search}${hash}`, 140);

  const quipPool = EVENT_QUIPS[event.kind] ?? QUIPS[sender.kind];
  const quip = quipPool[stableIndex(`${context.referrer}|${requested}`, quipPool.length)];

  return { requested, sender, event, campaign: describeCampaign(search), quip };
}

/** Reads the live browser state; call from an effect, never during render. */
export function readNotFoundBrowserContext(): NotFoundBrowserContext {
  const navigation = window.performance
    ?.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;

  return {
    referrer: document.referrer,
    location: {
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
    navigationType: navigation?.type ?? null,
    redirectCount: navigation?.redirectCount ?? 0,
  };
}
