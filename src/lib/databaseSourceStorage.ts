export type DatabaseSource = 'local' | 'onedrive' | 'gdrive';
export type CloudProvider = Exclude<DatabaseSource, 'local'>;

export interface CloudLinkedFile {
  provider: CloudProvider;
  fileId: string;
  fileName: string;
  modifiedAt: string | null;
  size: number | null;
  webUrl: string | null;
  /** OneDrive/Graph item eTag, used for If-Match conditional uploads. */
  etag: string | null;
  /** OneDrive/Graph item cTag (content-only tag). */
  cTag: string | null;
  /** Google Drive file `version`, used as a pre-upload conflict check. */
  version: string | null;
  /** Google Drive file `md5Checksum`. */
  md5Checksum: string | null;
}

export interface DatabaseSourceConflict {
  provider: CloudProvider;
  detectedAt: string;
  remoteModifiedAt: string | null;
  remoteEtag: string | null;
}

export interface PersistedDatabaseSourceState {
  source: DatabaseSource;
  linkedFiles: Partial<Record<CloudProvider, CloudLinkedFile>>;
  lastLocalWriteTimestamp: string | null;
  lastCloudSyncTimestamp: string | null;
  lastCloudFileTimestamp: string | null;
  lastSyncError: string | null;
  /** Whether changes should be uploaded automatically once they settle. Defaults to true. */
  autoSyncEnabled: boolean;
  /** ISO timestamp of the *first* unsynced local change — the persisted "dirty" flag. Cleared on a successful sync. */
  pendingChangesSince: string | null;
  lastSyncAttemptAt: string | null;
  /** Set when the linked cloud file changed remotely while local changes were also pending. */
  conflict: DatabaseSourceConflict | null;
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
    autoSyncEnabled: true,
    pendingChangesSince: null,
    lastSyncAttemptAt: null,
    conflict: null,
  };
}

function isDatabaseSource(value: string | null | undefined): value is DatabaseSource {
  return value === 'local' || value === 'onedrive' || value === 'gdrive';
}

/** Fills in the conflict-detection fields with `null` for JSON persisted before they existed. */
function normalizeLinkedFile(file: CloudLinkedFile): CloudLinkedFile {
  return {
    ...file,
    etag: file.etag ?? null,
    cTag: file.cTag ?? null,
    version: file.version ?? null,
    md5Checksum: file.md5Checksum ?? null,
  };
}

function normalizeLinkedFiles(
  linkedFiles: Partial<Record<CloudProvider, CloudLinkedFile>> | undefined
): Partial<Record<CloudProvider, CloudLinkedFile>> {
  if (!linkedFiles) {
    return {};
  }

  const normalized: Partial<Record<CloudProvider, CloudLinkedFile>> = {};
  for (const provider of Object.keys(linkedFiles) as CloudProvider[]) {
    const file = linkedFiles[provider];
    if (file) {
      normalized[provider] = normalizeLinkedFile(file);
    }
  }
  return normalized;
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
      linkedFiles: normalizeLinkedFiles(parsedState.linkedFiles),
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

/**
 * Marks the database dirty as of `changedAt`, but only if it isn't already
 * dirty — the *first* unsynced change wins the pending-since timestamp, so
 * a burst of edits doesn't keep pushing it forward.
 */
export function markPendingChanges(changedAt: string): PersistedDatabaseSourceState {
  return persistDatabaseSourceState((state) =>
    state.pendingChangesSince ? state : { ...state, pendingChangesSince: changedAt }
  );
}

export function clearPendingChanges(): PersistedDatabaseSourceState {
  return persistDatabaseSourceState((state) => ({
    ...state,
    pendingChangesSince: null,
  }));
}

export function setConflict(
  conflict: DatabaseSourceConflict
): PersistedDatabaseSourceState {
  return persistDatabaseSourceState((state) => ({
    ...state,
    conflict,
  }));
}

export function clearConflict(): PersistedDatabaseSourceState {
  return persistDatabaseSourceState((state) => ({
    ...state,
    conflict: null,
  }));
}