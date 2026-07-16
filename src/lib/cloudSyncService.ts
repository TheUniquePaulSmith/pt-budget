import { isEncryptedArchive, readEncryptedArchiveMeta } from './databaseEncryption';
import type { DatabaseService } from './databaseService';
import {
  createCloudProviderClient,
  type CloudProviderClient,
} from './cloudProviderClients';
import { clearGoogleToken } from './cloudAuthGoogle';
import { CloudAuthRequiredError, CloudConflictError } from './cloudSyncErrors';
import {
  createDefaultDatabaseSourceState,
  getLinkedCloudFile,
  loadPersistedDatabaseSourceState,
  persistDatabaseSourceState,
  type CloudLinkedFile,
  type CloudProvider,
  type PersistedDatabaseSourceState,
} from './databaseSourceStorage';

export type ClientFactory = (provider: CloudProvider) => CloudProviderClient;

export type SyncStage = 'flushing' | 'exporting' | 'encrypting' | 'uploading' | 'done';
export type SyncStageCallback = (stage: SyncStage, progress?: number) => void;

export type SyncOutcome =
  | 'saved'
  | 'no-changes'
  | 'conflict'
  | 'auth-required'
  | 'locked'
  | 'error';

export type ReconcileOutcome =
  | 'in-sync'
  | 'remote-newer'
  | 'local-newer'
  | 'both-changed'
  | 'auth-required'
  | 'no-link';

export type ConflictResolutionChoice = 'use-cloud' | 'overwrite' | 'keep-both';

function createFileName(suffix?: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return suffix ? `budget-tracker-${timestamp}-${suffix}.zip` : `budget-tracker-${timestamp}.zip`;
}

/** The conflict-detection baseline for a provider: Drive `version`, Graph `eTag`. */
function conflictBaseline(provider: CloudProvider, file: CloudLinkedFile): string | null {
  return provider === 'gdrive' ? file.version : file.etag;
}

/**
 * Pure decision logic for whether a linked cloud file changed since we last
 * saw it. Prefers the etag/version baseline; when neither side has one yet
 * (a link created before conflict detection existed), falls back to
 * comparing the provider's own modified-time, and if even that's
 * unavailable, conservatively assumes it changed rather than trusting a
 * possibly-stale local copy.
 */
export function hasFileChangedRemotely(
  provider: CloudProvider,
  linkedFile: CloudLinkedFile,
  current: CloudLinkedFile
): boolean {
  const baseline = conflictBaseline(provider, linkedFile);
  const currentValue = conflictBaseline(provider, current);

  if (baseline && currentValue) {
    return currentValue !== baseline;
  }

  if (linkedFile.modifiedAt && current.modifiedAt) {
    return current.modifiedAt !== linkedFile.modifiedAt;
  }

  return true;
}

/** Pure decision table used by reconcileOnOpen. */
export function decideReconcileOutcome(input: {
  hasLink: boolean;
  remoteChanged: boolean;
  isDirty: boolean;
}): ReconcileOutcome {
  if (!input.hasLink) {
    return 'no-link';
  }
  if (input.remoteChanged && input.isDirty) {
    return 'both-changed';
  }
  if (input.remoteChanged) {
    return 'remote-newer';
  }
  if (input.isDirty) {
    return 'local-newer';
  }
  return 'in-sync';
}

function recordConflict(provider: CloudProvider, remote: CloudLinkedFile) {
  return persistDatabaseSourceState((state) => ({
    ...state,
    conflict: {
      provider,
      detectedAt: new Date().toISOString(),
      remoteModifiedAt: remote.modifiedAt,
      remoteEtag: conflictBaseline(provider, remote),
    },
  }));
}

function recordSyncError(error: unknown) {
  return persistDatabaseSourceState((state) => ({
    ...state,
    lastSyncAttemptAt: new Date().toISOString(),
    lastSyncError:
      error instanceof Error ? error.message : 'Failed to sync to cloud storage',
  }));
}

/** Lists the backup archives available in `provider`'s linked folder/drive. */
export async function listCloudFiles({
  provider,
  interactive,
  clientFactory = createCloudProviderClient,
}: {
  provider: CloudProvider;
  interactive: boolean;
  clientFactory?: ClientFactory;
}): Promise<CloudLinkedFile[]> {
  const client = clientFactory(provider);
  if (!client.isConfigured()) {
    throw new Error('Provider is not configured');
  }
  await client.authenticate(interactive);
  return client.listDatabaseFiles();
}

export interface DownloadedCloudArchive {
  bytes: Uint8Array;
  cloudTimestamp: string | null;
  freshMeta: CloudLinkedFile;
}

/**
 * Downloads `file` and reads its embedded lastSaveTimestamp WITHOUT
 * decrypting the payload (the timestamp lives in the archive's unencrypted
 * header). Also re-fetches metadata so the caller gets a fresh etag/version
 * to persist alongside the link.
 */
export async function downloadCloudArchive({
  provider,
  file,
  clientFactory = createCloudProviderClient,
}: {
  provider: CloudProvider;
  file: CloudLinkedFile;
  clientFactory?: ClientFactory;
}): Promise<DownloadedCloudArchive> {
  const client = clientFactory(provider);
  const [bytes, freshMeta] = await Promise.all([
    client.downloadFile(file.fileId),
    client.getFileMetadata(file.fileId),
  ]);

  let cloudTimestamp: string | null = null;
  if (isEncryptedArchive(bytes)) {
    try {
      cloudTimestamp = readEncryptedArchiveMeta(bytes).lastSaveTimestamp;
    } catch {
      cloudTimestamp = null;
    }
  }

  return { bytes, cloudTimestamp, freshMeta };
}

/**
 * Persists a cloud link (source, linked file, sync timestamps) and clears
 * dirty/conflict state. Split out from applyDownloadedArchive so callers
 * that already have decrypted/imported bytes through a different path
 * (e.g. a password-verification step that imports separately) can persist
 * the same link without re-importing.
 */
export function persistCloudLink({
  provider,
  file,
  cloudTimestamp = null,
}: {
  provider: CloudProvider;
  file: CloudLinkedFile;
  cloudTimestamp?: string | null;
}): PersistedDatabaseSourceState {
  const now = new Date().toISOString();

  return persistDatabaseSourceState((state) => ({
    ...state,
    source: provider,
    linkedFiles: { ...state.linkedFiles, [provider]: file },
    lastLocalWriteTimestamp: cloudTimestamp ?? state.lastLocalWriteTimestamp,
    lastCloudFileTimestamp: cloudTimestamp ?? state.lastCloudFileTimestamp,
    lastCloudSyncTimestamp: now,
    lastSyncAttemptAt: now,
    lastSyncError: null,
    pendingChangesSince: null,
    conflict: null,
  }));
}

/**
 * Imports previously-downloaded archive bytes and persists the cloud link.
 * The caller is responsible for the worker already holding the decryption
 * key (import will fail otherwise).
 */
export async function applyDownloadedArchive({
  databaseService,
  provider,
  file,
  bytes,
}: {
  databaseService: DatabaseService;
  provider: CloudProvider;
  file: CloudLinkedFile;
  bytes: Uint8Array;
}): Promise<PersistedDatabaseSourceState> {
  await databaseService.importDatabaseArchiveData(bytes);

  const cloudTimestamp = databaseService.getEncryptedArchiveTimestamp(bytes);
  return persistCloudLink({ provider, file, cloudTimestamp });
}

/**
 * Exports the current database and uploads it to `provider`, with
 * etag/version-based conflict detection. Never prompts interactively —
 * callers (manual "Sync now", or the auto-sync scheduler) that get
 * 'auth-required' back are expected to offer a "Reconnect" affordance that
 * re-runs authentication from a user gesture instead.
 */
export async function syncToCloud({
  databaseService,
  provider,
  force = false,
  onStage,
  clientFactory = createCloudProviderClient,
}: {
  databaseService: DatabaseService;
  provider: CloudProvider;
  force?: boolean;
  onStage?: SyncStageCallback;
  clientFactory?: ClientFactory;
}): Promise<SyncOutcome> {
  const isReady = await databaseService.isEncryptionReady().catch(() => false);
  if (!isReady) {
    return 'locked';
  }

  const currentState = loadPersistedDatabaseSourceState();
  const linkedFile = getLinkedCloudFile(currentState, provider);

  if (!force && linkedFile && !currentState.pendingChangesSince) {
    return 'no-changes';
  }

  const client = clientFactory(provider);
  try {
    await client.authenticate(false);
  } catch (error) {
    if (error instanceof CloudAuthRequiredError) {
      return 'auth-required';
    }
    throw error;
  }

  if (linkedFile && !force) {
    let current: CloudLinkedFile;
    try {
      current = await client.getFileMetadata(linkedFile.fileId);
    } catch (error) {
      recordSyncError(error);
      return 'error';
    }

    if (hasFileChangedRemotely(provider, linkedFile, current)) {
      recordConflict(provider, current);
      return 'conflict';
    }
  }

  onStage?.('flushing');

  let archiveBytes: Uint8Array;
  let lastWriteTimestamp: string;
  try {
    const status = await databaseService.getDatabaseStatus();
    lastWriteTimestamp = status.lastWriteTimestamp ?? new Date().toISOString();
    archiveBytes = await databaseService.exportDatabase({
      onStage: (stage) => onStage?.(stage),
    });
  } catch (error) {
    recordSyncError(error);
    return 'error';
  }

  onStage?.('uploading', 0);

  try {
    const uploaded = await client.uploadFile({
      fileId: linkedFile?.fileId,
      fileName: linkedFile?.fileName ?? createFileName(),
      bytes: archiveBytes,
      ifMatch: linkedFile ? conflictBaseline(provider, linkedFile) : null,
      force,
      onProgress: (fraction) => onStage?.('uploading', fraction),
    });

    persistDatabaseSourceState((state) => ({
      ...state,
      source: provider,
      linkedFiles: { ...state.linkedFiles, [provider]: uploaded },
      lastLocalWriteTimestamp: lastWriteTimestamp,
      lastCloudFileTimestamp: lastWriteTimestamp,
      lastCloudSyncTimestamp: new Date().toISOString(),
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncError: null,
      pendingChangesSince: null,
      conflict: null,
    }));

    onStage?.('done');
    return 'saved';
  } catch (error) {
    if (error instanceof CloudConflictError) {
      if (error.remote) {
        recordConflict(provider, error.remote);
      }
      return 'conflict';
    }

    recordSyncError(error);
    return 'error';
  }
}

/**
 * Compares the linked cloud file against the last-known baseline to decide
 * what (if anything) needs to happen when the app opens. Cheap — only
 * fetches metadata, never downloads the archive itself.
 */
export async function reconcileOnOpen({
  provider,
  clientFactory = createCloudProviderClient,
}: {
  provider: CloudProvider;
  clientFactory?: ClientFactory;
}): Promise<ReconcileOutcome> {
  const state = loadPersistedDatabaseSourceState();
  const linkedFile = getLinkedCloudFile(state, provider);

  if (!linkedFile) {
    return 'no-link';
  }

  const client = clientFactory(provider);
  try {
    await client.authenticate(false);
  } catch (error) {
    if (error instanceof CloudAuthRequiredError) {
      return 'auth-required';
    }
    throw error;
  }

  const current = await client.getFileMetadata(linkedFile.fileId);
  const outcome = decideReconcileOutcome({
    hasLink: true,
    remoteChanged: hasFileChangedRemotely(provider, linkedFile, current),
    isDirty: Boolean(state.pendingChangesSince),
  });

  if (outcome === 'both-changed') {
    // Persist the conflict now rather than leaving it implicit — the
    // auto-sync scheduler only reacts to local changes, so a conflict
    // detected purely from the remote side at boot would otherwise never
    // get surfaced to the user via the status chip.
    recordConflict(provider, current);
  }

  return outcome;
}

/**
 * Applies the user's choice for a detected conflict. 'use-cloud' discards
 * local changes and imports the remote copy; 'overwrite' force-pushes the
 * local copy over the remote one; 'keep-both' uploads the local copy under
 * a new filename, leaving the original remote file untouched so nothing is
 * silently lost either way.
 */
export async function resolveConflict({
  databaseService,
  provider,
  choice,
  clientFactory = createCloudProviderClient,
}: {
  databaseService: DatabaseService;
  provider: CloudProvider;
  choice: ConflictResolutionChoice;
  clientFactory?: ClientFactory;
}): Promise<SyncOutcome> {
  const state = loadPersistedDatabaseSourceState();
  const linkedFile = getLinkedCloudFile(state, provider);

  if (!linkedFile) {
    return 'error';
  }

  if (choice === 'use-cloud') {
    const client = clientFactory(provider);
    await client.authenticate(true);
    const { bytes, freshMeta } = await downloadCloudArchive({
      provider,
      file: linkedFile,
      clientFactory,
    });
    await applyDownloadedArchive({ databaseService, provider, file: freshMeta, bytes });
    return 'saved';
  }

  if (choice === 'overwrite') {
    return syncToCloud({ databaseService, provider, force: true, clientFactory });
  }

  // keep-both: upload under a new filename; the original remote file is untouched.
  const client = clientFactory(provider);
  await client.authenticate(true);
  const status = await databaseService.getDatabaseStatus();
  const archiveBytes = await databaseService.exportDatabase();
  const uploaded = await client.uploadFile({
    fileName: createFileName('conflict'),
    bytes: archiveBytes,
    force: true,
  });

  persistDatabaseSourceState((prevState) => ({
    ...prevState,
    source: provider,
    linkedFiles: { ...prevState.linkedFiles, [provider]: uploaded },
    lastLocalWriteTimestamp: status.lastWriteTimestamp,
    lastCloudFileTimestamp: status.lastWriteTimestamp,
    lastCloudSyncTimestamp: new Date().toISOString(),
    lastSyncAttemptAt: new Date().toISOString(),
    lastSyncError: null,
    pendingChangesSince: null,
    conflict: null,
  }));

  return 'saved';
}

export function switchDatabaseSource(source: PersistedDatabaseSourceState['source']) {
  return persistDatabaseSourceState((state) => ({
    ...state,
    source,
    lastSyncError: null,
  }));
}

export function setAutoSyncEnabled(enabled: boolean) {
  return persistDatabaseSourceState((state) => ({
    ...state,
    autoSyncEnabled: enabled,
  }));
}

/**
 * Unlinks `provider`'s file (so a later reconnect can't silently overwrite
 * it), falls back to local if it was the active source, and clears any
 * locally-cached auth for it. Microsoft's token lives in MSAL's own
 * localStorage-backed cache with no simple client-side "forget" short of a
 * full logout redirect, so this only clears what Google's simpler
 * sessionStorage-based token allows without one.
 */
export function disconnectCloudProvider(provider: CloudProvider): PersistedDatabaseSourceState {
  if (provider === 'gdrive') {
    clearGoogleToken();
  }

  return persistDatabaseSourceState((state) => {
    const linkedFiles = { ...state.linkedFiles };
    delete linkedFiles[provider];

    return {
      ...state,
      source: state.source === provider ? 'local' : state.source,
      linkedFiles,
      lastSyncError: null,
      conflict: state.conflict?.provider === provider ? null : state.conflict,
      pendingChangesSince: state.source === provider ? null : state.pendingChangesSince,
    };
  });
}

export function getPersistedCloudState() {
  return loadPersistedDatabaseSourceState() ?? createDefaultDatabaseSourceState();
}
