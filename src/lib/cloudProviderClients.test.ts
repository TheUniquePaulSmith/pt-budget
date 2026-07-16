// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cloudAuthGoogle', () => ({
  ensureGoogleToken: vi.fn(async () => 'fake-google-token'),
  isGoogleDriveConfigured: vi.fn(() => true),
}));

vi.mock('./cloudAuthMicrosoft', () => ({
  ensureMicrosoftToken: vi.fn(async () => 'fake-ms-token'),
  isOneDriveConfigured: vi.fn(() => true),
}));

import { createCloudProviderClient } from './cloudProviderClients';
import { CloudConflictError } from './cloudSyncErrors';

// Must match CLOUD_UPLOAD_CHUNK_BYTES in cloudProviderClients.ts.
const CHUNK_BYTES = 5_242_880;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

describe('GoogleDriveClient.uploadFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('uses the multipart path at or under the 5MB threshold and requests version/md5Checksum fields', async () => {
    const client = createCloudProviderClient('gdrive');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'file-1',
        name: 'budget-tracker-database.zip',
        modifiedTime: '2026-07-14T00:00:00.000Z',
        version: '2',
        md5Checksum: 'abc',
      })
    );

    const bytes = new Uint8Array(1024);
    const result = await client.uploadFile({ fileName: 'budget-tracker-database.zip', bytes });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('uploadType=multipart');
    expect(String(url)).toContain('version');
    expect(String(url)).toContain('md5Checksum');
    expect(result).toMatchObject({ fileId: 'file-1', version: '2', md5Checksum: 'abc' });
  });

  it('switches to a resumable session for files over the 5MB threshold', async () => {
    const client = createCloudProviderClient('gdrive');
    const total = 5_000_001;
    const bytes = new Uint8Array(total);

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-1' } })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'file-2', name: 'budget-tracker-database.zip', version: '3' })
    );

    const result = await client.uploadFile({ fileName: 'budget-tracker-database.zip', bytes });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('uploadType=resumable');

    const [chunkUrl, chunkInit] = fetchMock.mock.calls[1];
    expect(chunkUrl).toBe('https://upload.example/session-1');
    expect(headerRecord(chunkInit)['content-range']).toBe(`bytes 0-${total - 1}/${total}`);
    expect(result.fileId).toBe('file-2');
  });

  it('splits a large resumable upload into correctly-ranged chunks', async () => {
    const client = createCloudProviderClient('gdrive');
    const total = CHUNK_BYTES * 2 + 12_345;
    const bytes = new Uint8Array(total);
    const onProgress = vi.fn();

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-2' } })
    );
    // Two full chunks report "keep going" (308); the final partial chunk
    // completes the upload with the driveItem JSON body.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 308 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 308 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'file-3', name: 'x.zip', version: '9' }));

    const result = await client.uploadFile({
      fileName: 'budget-tracker-database.zip',
      bytes,
      onProgress,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(headerRecord(fetchMock.mock.calls[1][1])['content-range']).toBe(
      `bytes 0-${CHUNK_BYTES - 1}/${total}`
    );
    expect(headerRecord(fetchMock.mock.calls[2][1])['content-range']).toBe(
      `bytes ${CHUNK_BYTES}-${2 * CHUNK_BYTES - 1}/${total}`
    );
    expect(headerRecord(fetchMock.mock.calls[3][1])['content-range']).toBe(
      `bytes ${2 * CHUNK_BYTES}-${total - 1}/${total}`
    );
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(result.fileId).toBe('file-3');
  });

  it('throws CloudConflictError when the Drive file version no longer matches before uploading', async () => {
    const client = createCloudProviderClient('gdrive');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'file-1', name: 'budget-tracker-database.zip', version: '99' })
    );

    await expect(
      client.uploadFile({
        fileId: 'file-1',
        fileName: 'budget-tracker-database.zip',
        bytes: new Uint8Array(10),
        ifMatch: '5',
      })
    ).rejects.toBeInstanceOf(CloudConflictError);

    // Only the metadata preflight ran — no upload request was attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force skips the version preflight entirely', async () => {
    const client = createCloudProviderClient('gdrive');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'file-1', name: 'budget-tracker-database.zip', version: '2' })
    );

    await client.uploadFile({
      fileId: 'file-1',
      fileName: 'budget-tracker-database.zip',
      bytes: new Uint8Array(10),
      ifMatch: '5',
      force: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('uploadType=multipart');
  });
});

describe('OneDriveClient.uploadFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('uses a simple PUT at or under the 4MB threshold, with If-Match when a baseline is given', async () => {
    const client = createCloudProviderClient('onedrive');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'item-1', name: 'budget-tracker-database.zip', eTag: '"etag-2"' })
    );

    const result = await client.uploadFile({
      fileId: 'item-1',
      fileName: 'budget-tracker-database.zip',
      bytes: new Uint8Array(1024),
      ifMatch: '"etag-1"',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/content');
    expect(headerRecord(init)['if-match']).toBe('"etag-1"');
    expect(result).toMatchObject({ fileId: 'item-1', etag: '"etag-2"' });
  });

  it('maps a 412 response to CloudConflictError with the current remote metadata', async () => {
    const client = createCloudProviderClient('onedrive');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 412 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'item-1', name: 'budget-tracker-database.zip', eTag: '"etag-current"' })
    );

    const error = await client
      .uploadFile({
        fileId: 'item-1',
        fileName: 'budget-tracker-database.zip',
        bytes: new Uint8Array(10),
        ifMatch: '"etag-stale"',
      })
      .catch((err) => err);

    expect(error).toBeInstanceOf(CloudConflictError);
    expect((error as CloudConflictError).remote?.etag).toBe('"etag-current"');
  });

  it('creates an upload session and chunks files over the 4MB threshold', async () => {
    const client = createCloudProviderClient('onedrive');
    const total = CHUNK_BYTES + 100;
    const bytes = new Uint8Array(total);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ uploadUrl: 'https://upload.example/onedrive-session-1' })
    );
    // First (full-size) chunk is still in progress: 202 with no final body.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nextExpectedRanges: [] }), { status: 202 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'item-2', name: 'budget-tracker-database.zip', eTag: '"etag-final"' })
    );

    const result = await client.uploadFile({
      fileName: 'budget-tracker-database.zip',
      bytes,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('createUploadSession');
    expect(headerRecord(fetchMock.mock.calls[1][1])['content-range']).toBe(
      `bytes 0-${CHUNK_BYTES - 1}/${total}`
    );
    expect(headerRecord(fetchMock.mock.calls[2][1])['content-range']).toBe(
      `bytes ${CHUNK_BYTES}-${total - 1}/${total}`
    );
    expect(result.fileId).toBe('item-2');
  });

  it('lists files requesting eTag/cTag fields', async () => {
    const client = createCloudProviderClient('onedrive');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            id: 'item-1',
            name: 'budget-tracker-database.zip',
            file: {},
            eTag: '"e1"',
            cTag: '"c1"',
          },
        ],
      })
    );

    const files = await client.listDatabaseFiles();

    expect(String(fetchMock.mock.calls[0][0])).toContain('eTag');
    expect(String(fetchMock.mock.calls[0][0])).toContain('cTag');
    expect(files[0]).toMatchObject({ fileId: 'item-1', etag: '"e1"', cTag: '"c1"' });
  });
});
