export type DatabaseSource = 'local' | 'onedrive' | 'gdrive';
export type CloudProvider = Exclude<DatabaseSource, 'local'>;

export interface CloudLinkedFile {
  provider: CloudProvider;
  fileId: string;
  fileName: string;
  modifiedAt: string | null;
  size: number | null;
  webUrl: string | null;
}

export interface PersistedDatabaseSourceState {
  source: DatabaseSource;
  linkedFiles: Partial<Record<CloudProvider, CloudLinkedFile>>;
  lastLocalWriteTimestamp: string | null;
  lastCloudSyncTimestamp: string | null;
  lastCloudFileTimestamp: string | null;
  lastSyncError: string | null;
}

export const DATABASE_SOURCE_COOKIE_KEY = 'budgetTrackerDatabaseSource';
export const DATABASE_SOURCE_STATE_STORAGE_KEY =
  'budgetTrackerDatabaseSourceState';

export function createDefaultDatabaseSourceState(): PersistedDatabaseSourceState {
  return {
    source: 'local',
    linkedFiles: {},
    lastLocalWriteTimestamp: null,
    lastCloudSyncTimestamp: null,
    lastCloudFileTimestamp: null,
    lastSyncError: null,
  };
}

function isDatabaseSource(value: string | null | undefined): value is DatabaseSource {
  return value === 'local' || value === 'onedrive' || value === 'gdrive';
}

export function getDatabaseSourceCookie(): DatabaseSource {
  if (typeof document === 'undefined') {
    return 'local';
  }

  const cookieEntry = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${DATABASE_SOURCE_COOKIE_KEY}=`));

  const cookieValue = cookieEntry?.split('=')[1] ?? null;
  return isDatabaseSource(cookieValue) ? cookieValue : 'local';
}

export function setDatabaseSourceCookie(source: DatabaseSource) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${DATABASE_SOURCE_COOKIE_KEY}=${source}; path=/; max-age=31536000; samesite=lax`;
}

export function loadPersistedDatabaseSourceState(): PersistedDatabaseSourceState {
  const fallbackState = createDefaultDatabaseSourceState();
  fallbackState.source = getDatabaseSourceCookie();

  if (typeof window === 'undefined') {
    return fallbackState;
  }

  try {
    const rawState = window.localStorage.getItem(
      DATABASE_SOURCE_STATE_STORAGE_KEY
    );

    if (!rawState) {
      return fallbackState;
    }

    const parsedState = JSON.parse(rawState) as PersistedDatabaseSourceState;
    return {
      ...fallbackState,
      ...parsedState,
      source: getDatabaseSourceCookie(),
      linkedFiles: parsedState.linkedFiles ?? {},
    };
  } catch (error) {
    console.warn('Failed to load persisted database source state', error);
    return fallbackState;
  }
}

export function savePersistedDatabaseSourceState(
  state: PersistedDatabaseSourceState
) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    DATABASE_SOURCE_STATE_STORAGE_KEY,
    JSON.stringify(state)
  );
}

export function persistDatabaseSourceState(
  updater:
    | PersistedDatabaseSourceState
    | ((state: PersistedDatabaseSourceState) => PersistedDatabaseSourceState)
): PersistedDatabaseSourceState {
  const currentState = loadPersistedDatabaseSourceState();
  const nextState =
    typeof updater === 'function' ? updater(currentState) : updater;

  setDatabaseSourceCookie(nextState.source);
  savePersistedDatabaseSourceState(nextState);
  return nextState;
}

export function getLinkedCloudFile(
  state: PersistedDatabaseSourceState,
  provider: CloudProvider
): CloudLinkedFile | null {
  return state.linkedFiles[provider] ?? null;
}