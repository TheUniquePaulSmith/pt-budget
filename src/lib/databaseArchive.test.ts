import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  buildDatabaseStatusFile,
  createDatabaseArchive,
  DATABASE_VFS_SNAPSHOT_FORMAT,
  parseDatabaseArchive,
  type DatabaseVfsSnapshot,
} from './databaseArchive';

const snapshot: DatabaseVfsSnapshot = {
  format: DATABASE_VFS_SNAPSHOT_FORMAT,
  idbName: 'ptbudgetapp',
  exportedAt: '2026-05-27T12:00:00.000Z',
  metadata: [{ name: '/budget-app.db', fileSize: 1024, version: 3 }],
  blocks: [
    {
      path: '/budget-app.db',
      offset: 0,
      version: 3,
      data: Uint8Array.from([1, 2, 3, 4]),
    },
  ],
};

describe('databaseArchive', () => {
  it('round-trips a snapshot archive', async () => {
    const status = buildDatabaseStatusFile({
      exportedAt: snapshot.exportedAt,
      lastWriteTimestamp: snapshot.exportedAt,
      tableStats: { accounts: 2, transactions: 5 },
      snapshot,
    });

    const archive = await createDatabaseArchive({ snapshot, status });
    const parsed = await parseDatabaseArchive(archive);

    expect(parsed.status.lastWriteTimestamp).toBe(snapshot.exportedAt);
    expect(parsed.status.snapshotSummary.blockCount).toBe(1);
    expect(parsed.snapshot).toEqual(snapshot);
  });

  it('rejects archives that do not contain exactly two files', async () => {
    const zip = new JSZip();
    zip.file('only-one-file.txt', 'invalid');
    const archive = await zip.generateAsync({ type: 'uint8array' });

    await expect(parseDatabaseArchive(archive)).rejects.toThrow(
      'Archive must contain exactly two files'
    );
  });
});