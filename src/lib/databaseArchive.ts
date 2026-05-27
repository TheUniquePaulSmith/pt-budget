import { Buffer } from 'buffer';

import JSZip from 'jszip';

export const DATABASE_ARCHIVE_FILE_NAME = 'database.vfs.json';
export const DATABASE_STATUS_FILE_NAME = 'dbstatus.json';
export const DATABASE_VFS_SNAPSHOT_FORMAT = 'wa-sqlite-idb-batch-atomic-v1';
export const DATABASE_STATUS_FORMAT = 'budget-tracker-dbstatus-v1';

export interface DatabaseVfsSnapshotMetadataRecord {
  name: string;
  fileSize: number;
  version: number;
  pendingVersion?: number;
}

export interface DatabaseVfsSnapshotBlockRecord {
  path: string;
  offset: number;
  version: number;
  data: Uint8Array;
}

export interface DatabaseVfsSnapshot {
  format: typeof DATABASE_VFS_SNAPSHOT_FORMAT;
  idbName: string;
  exportedAt: string;
  metadata: DatabaseVfsSnapshotMetadataRecord[];
  blocks: DatabaseVfsSnapshotBlockRecord[];
}

export interface DatabaseStatusFile {
  format: typeof DATABASE_STATUS_FORMAT;
  exportedAt: string;
  lastWriteTimestamp: string;
  tableStats: Record<string, number>;
  snapshotSummary: {
    metadataCount: number;
    blockCount: number;
  };
}

interface SerializedDatabaseVfsSnapshotBlockRecord {
  path: string;
  offset: number;
  version: number;
  dataBase64: string;
}

interface SerializedDatabaseVfsSnapshot {
  format: typeof DATABASE_VFS_SNAPSHOT_FORMAT;
  idbName: string;
  exportedAt: string;
  metadata: DatabaseVfsSnapshotMetadataRecord[];
  blocks: SerializedDatabaseVfsSnapshotBlockRecord[];
}

export interface DatabaseArchiveContents {
  snapshot: DatabaseVfsSnapshot;
  status: DatabaseStatusFile;
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function serializeSnapshot(
  snapshot: DatabaseVfsSnapshot
): SerializedDatabaseVfsSnapshot {
  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => ({
      path: block.path,
      offset: block.offset,
      version: block.version,
      dataBase64: encodeBase64(block.data),
    })),
  };
}

function deserializeSnapshot(value: unknown): DatabaseVfsSnapshot {
  const snapshot = value as SerializedDatabaseVfsSnapshot;

  if (
    !snapshot ||
    snapshot.format !== DATABASE_VFS_SNAPSHOT_FORMAT ||
    !Array.isArray(snapshot.metadata) ||
    !Array.isArray(snapshot.blocks)
  ) {
    throw new Error('Archive database snapshot is invalid');
  }

  return {
    format: snapshot.format,
    idbName: snapshot.idbName,
    exportedAt: snapshot.exportedAt,
    metadata: snapshot.metadata,
    blocks: snapshot.blocks.map((block) => ({
      path: block.path,
      offset: block.offset,
      version: block.version,
      data: decodeBase64(block.dataBase64),
    })),
  };
}

function validateStatusFile(value: unknown): DatabaseStatusFile {
  const status = value as DatabaseStatusFile;

  if (
    !status ||
    status.format !== DATABASE_STATUS_FORMAT ||
    typeof status.lastWriteTimestamp !== 'string' ||
    !status.lastWriteTimestamp
  ) {
    throw new Error('Archive dbstatus.json is invalid');
  }

  return status;
}

export function buildDatabaseStatusFile({
  exportedAt,
  lastWriteTimestamp,
  tableStats,
  snapshot,
}: {
  exportedAt: string;
  lastWriteTimestamp: string;
  tableStats: Record<string, number>;
  snapshot: DatabaseVfsSnapshot;
}): DatabaseStatusFile {
  return {
    format: DATABASE_STATUS_FORMAT,
    exportedAt,
    lastWriteTimestamp,
    tableStats,
    snapshotSummary: {
      metadataCount: snapshot.metadata.length,
      blockCount: snapshot.blocks.length,
    },
  };
}

export async function createDatabaseArchive({
  snapshot,
  status,
}: DatabaseArchiveContents): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    DATABASE_ARCHIVE_FILE_NAME,
    JSON.stringify(serializeSnapshot(snapshot))
  );
  zip.file(DATABASE_STATUS_FILE_NAME, JSON.stringify(status, null, 2));

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function parseDatabaseArchive(
  archiveBytes: Uint8Array
): Promise<DatabaseArchiveContents> {
  const zip = await JSZip.loadAsync(archiveBytes);
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);

  if (fileEntries.length !== 2) {
    throw new Error('Archive must contain exactly two files');
  }

  const snapshotEntry = zip.file(DATABASE_ARCHIVE_FILE_NAME);
  const statusEntry = zip.file(DATABASE_STATUS_FILE_NAME);

  if (!snapshotEntry || !statusEntry) {
    throw new Error(
      `Archive must contain ${DATABASE_ARCHIVE_FILE_NAME} and ${DATABASE_STATUS_FILE_NAME}`
    );
  }

  const [snapshotText, statusText] = await Promise.all([
    snapshotEntry.async('text'),
    statusEntry.async('text'),
  ]);

  return {
    snapshot: deserializeSnapshot(JSON.parse(snapshotText)),
    status: validateStatusFile(JSON.parse(statusText)),
  };
}