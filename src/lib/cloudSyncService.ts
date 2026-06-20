import { parseDatabaseArchive } from './databaseArchive';
import type { DatabaseService } from './databaseService';
import {
  createCloudProviderClient,
  type CloudProviderClient,
} from './cloudProviderClients';
import {
  createDefaultDatabaseSourceState,
  getLinkedCloudFile,
  loadPersistedDatabaseSourceState,
  persistDatabaseSourceState,
  type CloudLinkedFile,
  type CloudProvider,
  type PersistedDatabaseSourceState,
} from './databaseSourceStorage';

export type CloudUserActionReason =
  | 'configuration'
  | 'authentication'
  | 'file-selection';

export interface CloudSyncResult {
  action:
    | 'connected'
    | 'imported-cloud'
    | 'kept-local'
    | 'saved-cloud'
    | 'needs-user-action';
  state: PersistedDatabaseSourceState;
  linkedFile: CloudLinkedFile | null;
  userActionReason?: CloudUserActionReason;
}

function createFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `budget-tracker-${timestamp}.zip`;
}

function compareTimestamps(
  localTimestamp: string | null,
  cloudTimestamp: string | null
) {
  if (!cloudTimestamp) {
    return 1;
  }

  if (!localTimestamp) {
    return -1;
  }

  return localTimestamp.localeCompare(cloudTimestamp);
}

function promptForCloudFile(
  provider: CloudProvider,
  files: CloudLinkedFile[]
): CloudLinkedFile | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (files.length === 0) {
    throw new Error(
      `No backup archives were found in ${provider === 'gdrive' ? 'Google Drive' : 'OneDrive'}.`
    );
  }

  const promptMessage = files
    .slice(0, 20)
    .map(
      (file, index) =>
        `${index + 1}. ${file.fileName}${file.modifiedAt ? ` (${file.modifiedAt})` : ''}`
    )
    .join('\n');
  const response = window.prompt(
    `Select a ${provider === 'gdrive' ? 'Google Drive' : 'OneDrive'} backup archive by number:\n${promptMessage}`,
    '1'
  );

  if (!response) {
    return null;
  }

  const selectedIndex = Number(response) - 1;
  return Number.isInteger(selectedIndex) ? files[selectedIndex] ?? null : null;
}

function createNeedsUserActionResult(
  provider: CloudProvider,
  state: PersistedDatabaseSourceState,
  reason: CloudUserActionReason,
  errorMessage: string
): CloudSyncResult {
  return {
    action: 'needs-user-action',
    linkedFile: getLinkedCloudFile(state, provider),
    userActionReason: reason,
    state: {
      ...state,
      source: provider,
      lastSyncError: errorMessage,
    },
  };
}

async function ensureClientReady(
  client: CloudProviderClient,
  interactive: boolean
) {
  if (!client.isConfigured()) {
    throw new Error('Provider is not configured');
  }

  await client.authenticate(interactive);
}

export async function openDatabaseFromCloud(options: {
  databaseService: DatabaseService;
  provider: CloudProvider;
  interactive: boolean;
  allowFilePrompt: boolean;
  preferStoredFile?: boolean;
}): Promise<CloudSyncResult> {
  const {
    databaseService,
    provider,
    interactive,
    allowFilePrompt,
    preferStoredFile = true,
  } = options;
  const currentState = loadPersistedDatabaseSourceState();
  const client = createCloudProviderClient(provider);

  try {
    await ensureClientReady(client, interactive);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Cloud authentication is required';
    const reason = client.isConfigured() ? 'authentication' : 'configuration';
    return createNeedsUserActionResult(provider, currentState, reason, message);
  }

  let linkedFile = preferStoredFile
    ? getLinkedCloudFile(currentState, provider)
    : null;

  if (!linkedFile) {
    if (!allowFilePrompt) {
      return createNeedsUserActionResult(
        provider,
        currentState,
        'file-selection',
        'Select a cloud backup archive to continue.'
      );
    }

    const files = await client.listDatabaseFiles();
    linkedFile = promptForCloudFile(provider, files);

    if (!linkedFile) {
      return createNeedsUserActionResult(
        provider,
        currentState,
        'file-selection',
        'A cloud backup archive must be selected to continue.'
      );
    }
  }

  const archiveBytes = await client.downloadFile(linkedFile.fileId);
  const archive = await parseDatabaseArchive(archiveBytes);
  const localStatus = await databaseService.getDatabaseStatus().catch(() => null);
  const localTimestamp =
    localStatus?.lastWriteTimestamp ?? currentState.lastLocalWriteTimestamp;
  const cloudTimestamp = archive.status.lastWriteTimestamp;
  const timestampComparison = compareTimestamps(localTimestamp, cloudTimestamp);

  const baseState = {
    ...currentState,
    source: provider,
    linkedFiles: {
      ...currentState.linkedFiles,
      [provider]: linkedFile,
    },
    lastCloudFileTimestamp: cloudTimestamp,
    lastSyncError: null,
  };

  if (timestampComparison >= 0) {
    const nextState = persistDatabaseSourceState({
      ...baseState,
      lastLocalWriteTimestamp: localTimestamp,
    });
    return {
      action: 'kept-local',
      linkedFile,
      state: nextState,
    };
  }

  await databaseService.importDatabaseArchiveData(archiveBytes);

  const nextState = persistDatabaseSourceState({
    ...baseState,
    lastLocalWriteTimestamp: cloudTimestamp,
    lastCloudSyncTimestamp: new Date().toISOString(),
  });

  return {
    action: 'imported-cloud',
    linkedFile,
    state: nextState,
  };
}

export async function saveDatabaseToCloud(options: {
  databaseService: DatabaseService;
  provider: CloudProvider;
  interactive: boolean;
  createNewFile?: boolean;
}): Promise<CloudSyncResult> {
  const {
    databaseService,
    provider,
    interactive,
    createNewFile = false,
  } = options;
  const currentState = loadPersistedDatabaseSourceState();
  const client = createCloudProviderClient(provider);

  try {
    await ensureClientReady(client, interactive);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Cloud authentication is required';
    return createNeedsUserActionResult(
      provider,
      currentState,
      client.isConfigured() ? 'authentication' : 'configuration',
      message
    );
  }

  const linkedFile = createNewFile
    ? null
    : getLinkedCloudFile(currentState, provider);
  const archiveBytes = await databaseService.exportDatabase();
  const localStatus = await databaseService.getDatabaseStatus();
  const uploadedFile = await client.uploadFile({
    fileId: linkedFile?.fileId,
    fileName: linkedFile?.fileName ?? createFileName(),
    bytes: archiveBytes,
  });

  const nextState = persistDatabaseSourceState({
    ...currentState,
    source: provider,
    linkedFiles: {
      ...currentState.linkedFiles,
      [provider]: uploadedFile,
    },
    lastLocalWriteTimestamp: localStatus.lastWriteTimestamp,
    lastCloudFileTimestamp: localStatus.lastWriteTimestamp,
    lastCloudSyncTimestamp: new Date().toISOString(),
    lastSyncError: null,
  });

  return {
    action: linkedFile ? 'saved-cloud' : 'connected',
    linkedFile: uploadedFile,
    state: nextState,
  };
}

export function switchDatabaseSource(source: PersistedDatabaseSourceState['source']) {
  return persistDatabaseSourceState((state) => ({
    ...state,
    source,
    lastSyncError: null,
  }));
}

export function getPersistedCloudState() {
  return loadPersistedDatabaseSourceState() ?? createDefaultDatabaseSourceState();
}