/**
 * Whether and how the app can be installed (web app manifest:
 * src/app/manifest.ts), as one small store the Install controls read.
 *
 * - Chromium browsers (Chrome, Edge, Opera, Samsung Internet; desktop and
 *   Android) fire `beforeinstallprompt`; the event is kept and its `prompt()`
 *   opens the browser's own install dialog. One event allows one prompt.
 * - Safari has no install API: on iPhone/iPad and on the Mac the controls
 *   open a short guide (Share → Add to Home Screen, File → Add to Dock).
 * - Firefox cannot install web apps, so nothing is offered there.
 * - Inside the installed app (`display-mode: standalone`, or iOS
 *   `navigator.standalone`) and after `appinstalled`, the status is
 *   `installed` and the controls hide.
 *
 * Pure: the window, navigator and media query are parameters.
 */

export type InstallGuide = 'ios' | 'macSafari';
export type InstallStatus = 'installed' | 'promptable' | 'guide' | 'unavailable';
export type InstallOutcome = 'accepted' | 'dismissed' | 'guide' | 'unavailable';

/** The non-standard Chromium event (not in lib.dom.d.ts). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface AppInstallState {
  status: InstallStatus;
  guide: InstallGuide | null;
  /** The Safari guide dialog is open. */
  guideOpen: boolean;
}

/** Which Safari guide applies to this browser, if any. */
export function detectInstallGuide(env: { userAgent: string; maxTouchPoints: number }): InstallGuide | null {
  const ua = env.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  const iosDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (iosDevice) return 'ios';
  const otherEngine = /Chrome|Chromium|CriOS|Edg\/|OPR\/|Firefox|FxiOS/.test(ua);
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !otherEngine) return 'macSafari';
  return null;
}

export interface AppInstallStore {
  getState: () => AppInstallState;
  subscribe: (listener: () => void) => () => void;
  /** Keeps a `beforeinstallprompt` event for the next `requestInstall`. */
  capturePrompt: (event: BeforeInstallPromptEvent) => void;
  markInstalled: () => void;
  /** Opens the browser's install dialog, or the Safari guide. */
  requestInstall: () => Promise<InstallOutcome>;
  closeGuide: () => void;
}

export function createAppInstallStore(options: { guide: InstallGuide | null; standalone: boolean }): AppInstallStore {
  let prompt: BeforeInstallPromptEvent | null = null;
  let installed = options.standalone;
  let guideOpen = false;
  let state: AppInstallState;
  const listeners = new Set<() => void>();

  const compute = (): AppInstallState => ({
    status: installed ? 'installed' : prompt ? 'promptable' : options.guide ? 'guide' : 'unavailable',
    guide: options.guide,
    guideOpen,
  });
  const publish = () => {
    const next = compute();
    if (next.status === state.status && next.guideOpen === state.guideOpen) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  state = compute();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capturePrompt: (event) => {
      prompt = event;
      publish();
    },
    markInstalled: () => {
      installed = true;
      prompt = null;
      publish();
    },
    requestInstall: async () => {
      if (installed) return 'unavailable';
      if (prompt) {
        const event = prompt;
        // A prompt can be shown once; the browser fires a new event later if it allows another.
        prompt = null;
        try {
          await event.prompt();
          const { outcome } = await event.userChoice;
          if (outcome === 'accepted') installed = true;
          return outcome;
        } finally {
          publish();
        }
      }
      if (options.guide) {
        guideOpen = true;
        publish();
        return 'guide';
      }
      return 'unavailable';
    },
    closeGuide: () => {
      guideOpen = false;
      publish();
    },
  };
}

type InstallWindow = Pick<Window, 'addEventListener' | 'matchMedia'> & {
  navigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { standalone?: boolean };
};

const STANDALONE_QUERY = '(display-mode: standalone)';

/** Creates the store for a window and keeps it in step with the browser's install events. */
export function connectAppInstall(win: InstallWindow): AppInstallStore {
  const media = win.matchMedia(STANDALONE_QUERY);
  const store = createAppInstallStore({
    guide: detectInstallGuide(win.navigator),
    standalone: media.matches || win.navigator.standalone === true,
  });
  win.addEventListener('beforeinstallprompt', (event) => {
    // Keeps Chromium's own mini-infobar away; the app offers its own Install controls.
    event.preventDefault();
    store.capturePrompt(event as BeforeInstallPromptEvent);
  });
  win.addEventListener('appinstalled', () => store.markInstalled());
  media.addEventListener?.('change', (event) => {
    if (event.matches) store.markInstalled();
  });
  return store;
}
