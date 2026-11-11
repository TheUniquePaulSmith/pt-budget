import { describe, expect, it, vi } from 'vitest';

import {
  type BeforeInstallPromptEvent,
  connectAppInstall,
  createAppInstallStore,
  detectInstallGuide,
} from './appInstall';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
};

describe('detectInstallGuide', () => {
  it('guides Safari users, iPhone and iPad (which reports a Mac) included', () => {
    expect(detectInstallGuide({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallGuide({ userAgent: UA.chromeIphone, maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallGuide({ userAgent: UA.safariMac, maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallGuide({ userAgent: UA.safariMac, maxTouchPoints: 0 })).toBe('macSafari');
  });

  it('leaves Chromium (it prompts) and Firefox (it cannot install) without a guide', () => {
    for (const userAgent of [UA.chromeWindows, UA.edge, UA.chromeMac, UA.firefoxMac, UA.android]) {
      expect(detectInstallGuide({ userAgent, maxTouchPoints: 0 }), userAgent).toBeNull();
    }
  });
});

function promptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('createAppInstallStore', () => {
  it('offers nothing until the browser fires its event, then prompts once and becomes installed', async () => {
    const store = createAppInstallStore({ guide: null, standalone: false });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getState().status).toBe('unavailable');
    expect(await store.requestInstall()).toBe('unavailable');

    const event = promptEvent('accepted');
    store.capturePrompt(event);
    expect(store.getState().status).toBe('promptable');
    expect(listener).toHaveBeenCalledTimes(1);

    expect(await store.requestInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('installed');
  });

  it('drops a dismissed prompt, since the browser allows each event one prompt', async () => {
    const store = createAppInstallStore({ guide: null, standalone: false });
    store.capturePrompt(promptEvent('dismissed'));

    expect(await store.requestInstall()).toBe('dismissed');
    expect(store.getState().status).toBe('unavailable');
  });

  it('opens and closes the Safari guide', async () => {
    const store = createAppInstallStore({ guide: 'ios', standalone: false });
    expect(store.getState()).toEqual({ status: 'guide', guide: 'ios', guideOpen: false });

    expect(await store.requestInstall()).toBe('guide');
    expect(store.getState().guideOpen).toBe(true);
    store.closeGuide();
    expect(store.getState().guideOpen).toBe(false);
  });

  it('offers nothing inside the installed app', async () => {
    const store = createAppInstallStore({ guide: 'ios', standalone: true });
    expect(store.getState().status).toBe('installed');
    expect(await store.requestInstall()).toBe('unavailable');
  });

  it('keeps the same state object while nothing changed (useSyncExternalStore)', () => {
    const store = createAppInstallStore({ guide: null, standalone: false });
    const before = store.getState();
    store.closeGuide();
    expect(store.getState()).toBe(before);
  });
});

describe('connectAppInstall', () => {
  function fakeWindow(options: { userAgent?: string; standalone?: boolean } = {}) {
    const target = new EventTarget();
    const media = Object.assign(new EventTarget(), { matches: options.standalone ?? false });
    const win = {
      addEventListener: target.addEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      matchMedia: vi.fn(() => media),
      navigator: { userAgent: options.userAgent ?? UA.chromeWindows, maxTouchPoints: 0 },
    };
    return { win, media };
  }

  it("keeps the browser's install event, holding back its own banner", () => {
    const { win } = fakeWindow();
    const store = connectAppInstall(win as never);
    const event = promptEvent('accepted');

    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().status).toBe('promptable');
  });

  it('becomes installed on appinstalled and when the window turns standalone', () => {
    const first = fakeWindow();
    const store = connectAppInstall(first.win as never);
    first.win.dispatchEvent(promptEvent('accepted'));
    first.win.dispatchEvent(new Event('appinstalled'));
    expect(store.getState().status).toBe('installed');

    const second = fakeWindow();
    const other = connectAppInstall(second.win as never);
    second.media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    expect(other.getState().status).toBe('installed');
    expect(second.win.matchMedia).toHaveBeenCalledWith('(display-mode: standalone)');
  });

  it('starts installed in a standalone window', () => {
    expect(connectAppInstall(fakeWindow({ standalone: true }).win as never).getState().status).toBe('installed');
  });
});
