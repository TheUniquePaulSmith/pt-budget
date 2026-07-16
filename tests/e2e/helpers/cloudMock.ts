import type { Page, Route } from '@playwright/test';

/**
 * In-memory fake of the slice of the Google Drive v3 REST API (plus the
 * OAuth implicit-grant authorize endpoint) that cloudProviderClients.ts /
 * cloudAuthGoogle.ts talk to. Installed via installGoogleDriveRoutes and
 * driven through a MockGoogleDriveStore, so specs can seed pre-existing
 * files, simulate a remote edit (conflict), and assert on what got
 * uploaded — all without any real network access or Google credentials.
 *
 * OneDrive is intentionally not mocked here: MSAL's redirect/silent-token
 * machinery isn't cheap to fake convincingly, so the OneDrive provider path
 * is covered by unit tests only (see cloudProviderClients.test.ts).
 */

export interface MockDriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: number;
  version: string;
  md5Checksum: string;
  bytes: Uint8Array;
}

export interface RecordedUpload {
  fileId: string | null;
  fileName: string;
  bytes: Uint8Array;
}

let mockFileCounter = 0;
let mockVersionCounter = 0;

export class MockGoogleDriveStore {
  private readonly files = new Map<string, MockDriveFile>();
  /** Every upload the mock has received, oldest first — for asserting what got synced. */
  readonly uploads: RecordedUpload[] = [];

  /** Seeds a pre-existing remote file, as if it were uploaded from another device. */
  seedFile(params: { name: string; bytes: Uint8Array; id?: string }): MockDriveFile {
    const file: MockDriveFile = {
      id: params.id ?? `mock-drive-file-${++mockFileCounter}`,
      name: params.name,
      modifiedTime: new Date().toISOString(),
      size: params.bytes.byteLength,
      version: String(++mockVersionCounter),
      md5Checksum: `mock-checksum-${mockVersionCounter}`,
      bytes: params.bytes,
    };
    this.files.set(file.id, file);
    return file;
  }

  get(fileId: string): MockDriveFile | undefined {
    return this.files.get(fileId);
  }

  list(): MockDriveFile[] {
    return Array.from(this.files.values());
  }

  /** Simulates the file changing on another device: new version/bytes, no upload recorded. */
  simulateRemoteEdit(fileId: string, bytes: Uint8Array): void {
    const file = this.files.get(fileId);
    if (!file) {
      throw new Error(`simulateRemoteEdit: unknown mock file id ${fileId}`);
    }
    file.bytes = bytes;
    file.size = bytes.byteLength;
    file.modifiedTime = new Date().toISOString();
    file.version = String(++mockVersionCounter);
  }

  /** Records an upload (create when fileId is null, replace otherwise) and returns the resulting file resource. */
  recordUpload(fileId: string | null, name: string, bytes: Uint8Array): MockDriveFile {
    const existing = fileId ? this.files.get(fileId) : undefined;
    const file: MockDriveFile = {
      id: fileId ?? `mock-drive-file-${++mockFileCounter}`,
      name: existing?.name ?? name,
      modifiedTime: new Date().toISOString(),
      size: bytes.byteLength,
      version: String(++mockVersionCounter),
      md5Checksum: `mock-checksum-${mockVersionCounter}`,
      bytes,
    };
    this.files.set(file.id, file);
    this.uploads.push({ fileId, fileName: name, bytes });
    return file;
  }
}

function toFileResource(file: MockDriveFile) {
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    size: String(file.size),
    webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
    version: file.version,
    md5Checksum: file.md5Checksum,
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Splits a `multipart/related` upload body into its JSON metadata part and
 * raw binary part. Operates on Buffers throughout (never round-trips
 * through a lossy string encoding) so the encrypted archive bytes come back
 * out byte-for-byte identical to what was sent.
 */
function parseMultipartRelated(
  body: Buffer,
  contentTypeHeader: string
): { metadata: { name?: string; mimeType?: string }; bytes: Uint8Array } {
  const boundaryMatch = contentTypeHeader.match(/boundary=([^;]+)/);
  if (!boundaryMatch) {
    throw new Error('Multipart upload missing boundary');
  }
  const boundary = Buffer.from(`--${boundaryMatch[1]}`, 'ascii');
  const doubleCrlf = Buffer.from('\r\n\r\n', 'ascii');

  const firstBoundaryEnd = body.indexOf(boundary) + boundary.length;
  const secondBoundaryStart = body.indexOf(boundary, firstBoundaryEnd);
  const secondBoundaryEnd = secondBoundaryStart + boundary.length;
  const thirdBoundaryStart = body.indexOf(boundary, secondBoundaryEnd);

  const jsonSection = body.subarray(firstBoundaryEnd, secondBoundaryStart);
  const jsonHeaderEnd = jsonSection.indexOf(doubleCrlf) + doubleCrlf.length;
  const metadata = JSON.parse(jsonSection.subarray(jsonHeaderEnd).toString('utf-8').trim());

  const binarySection = body.subarray(secondBoundaryEnd, thirdBoundaryStart);
  const binaryHeaderEnd = binarySection.indexOf(doubleCrlf) + doubleCrlf.length;
  // The last two bytes are the \r\n MIME framing adds before the closing
  // boundary marker, not part of the payload.
  const binaryBytes = binarySection.subarray(binaryHeaderEnd, binarySection.length - 2);

  return { metadata, bytes: new Uint8Array(binaryBytes) };
}

async function handleGoogleAuthorize(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const state = url.searchParams.get('state') ?? '';
  const redirectUri = url.searchParams.get('redirect_uri') || 'http://localhost:3000/auth/complete/';

  const fragment = new URLSearchParams({
    access_token: 'mock-google-access-token',
    token_type: 'Bearer',
    expires_in: '3599',
    scope: 'https://www.googleapis.com/auth/drive.file',
    state,
  }).toString();

  await route.fulfill({
    status: 302,
    headers: { Location: `${redirectUri}#${fragment}` },
  });
}

async function handleMultipartUpload(
  route: Route,
  store: MockGoogleDriveStore,
  fileId: string | null
): Promise<void> {
  const request = route.request();
  const contentType = request.headers()['content-type'] ?? '';
  const bodyBuffer = request.postDataBuffer();
  if (!bodyBuffer) {
    await fulfillJson(route, 400, { error: { message: 'Missing upload body' } });
    return;
  }

  const { metadata, bytes } = parseMultipartRelated(bodyBuffer, contentType);
  const file = store.recordUpload(fileId, metadata.name ?? 'budget-tracker.zip', bytes);
  await fulfillJson(route, 200, toFileResource(file));
}

interface ResumableSession {
  fileId: string | null;
  name: string;
  chunks: Buffer[];
}

const resumableSessions = new Map<string, ResumableSession>();
let resumableSessionCounter = 0;

async function handleResumableInitiate(
  route: Route,
  fileId: string | null
): Promise<void> {
  const request = route.request();
  const bodyBuffer = request.postDataBuffer();
  const metadata = bodyBuffer
    ? (JSON.parse(bodyBuffer.toString('utf-8')) as { name?: string })
    : { name: 'budget-tracker.zip' };

  const sessionId = `session-${++resumableSessionCounter}`;
  resumableSessions.set(sessionId, { fileId, name: metadata.name ?? 'budget-tracker.zip', chunks: [] });

  const url = new URL(request.url());
  await route.fulfill({
    status: 200,
    headers: { Location: `${url.origin}/upload/drive/v3/resumable/${sessionId}` },
    body: '',
  });
}

async function handleResumableChunk(
  route: Route,
  store: MockGoogleDriveStore,
  sessionId: string
): Promise<void> {
  const session = resumableSessions.get(sessionId);
  if (!session) {
    await fulfillJson(route, 404, { error: { message: 'Unknown upload session' } });
    return;
  }

  const request = route.request();
  const contentRange = request.headers()['content-range'] ?? '';
  const totalMatch = contentRange.match(/\/(\d+|\*)$/);
  const total = totalMatch && totalMatch[1] !== '*' ? Number(totalMatch[1]) : null;
  const chunk = request.postDataBuffer() ?? Buffer.alloc(0);
  session.chunks.push(chunk);

  const receivedSoFar = session.chunks.reduce((sum, part) => sum + part.length, 0);

  if (total !== null && receivedSoFar < total) {
    await route.fulfill({ status: 308, headers: { Range: `bytes=0-${receivedSoFar - 1}` } });
    return;
  }

  const bytes = new Uint8Array(Buffer.concat(session.chunks));
  resumableSessions.delete(sessionId);
  const file = store.recordUpload(session.fileId, session.name, bytes);
  await fulfillJson(route, 200, toFileResource(file));
}

async function handleDriveRequest(route: Route, store: MockGoogleDriveStore): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();

  const resumableChunkMatch = url.pathname.match(/^\/upload\/drive\/v3\/resumable\/([^/]+)$/);
  if (resumableChunkMatch && method === 'PUT') {
    await handleResumableChunk(route, store, resumableChunkMatch[1]);
    return;
  }

  const uploadMatch = url.pathname.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/);
  if (uploadMatch) {
    const fileId = uploadMatch[1] ?? null;
    const uploadType = url.searchParams.get('uploadType');
    if (uploadType === 'resumable') {
      await handleResumableInitiate(route, fileId);
    } else {
      await handleMultipartUpload(route, store, fileId);
    }
    return;
  }

  if (url.pathname === '/drive/v3/files' && method === 'GET') {
    await fulfillJson(route, 200, { files: store.list().map(toFileResource) });
    return;
  }

  const itemMatch = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (itemMatch && method === 'GET') {
    const file = store.get(itemMatch[1]);
    if (!file) {
      await fulfillJson(route, 404, { error: { message: 'File not found' } });
      return;
    }
    if (url.searchParams.get('alt') === 'media') {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(file.bytes),
      });
      return;
    }
    await fulfillJson(route, 200, toFileResource(file));
    return;
  }

  await route.continue();
}

/**
 * Installs the mock Google authorize endpoint + Drive REST API on `page`'s
 * browsing context (not just `page` itself) so a popup opened from it — the
 * real OAuth flow opens one via window.open() — is covered too.
 */
export async function installGoogleDriveRoutes(page: Page, store: MockGoogleDriveStore): Promise<void> {
  const context = page.context();

  await context.route('https://accounts.google.com/o/oauth2/v2/auth**', handleGoogleAuthorize);
  await context.route('https://www.googleapis.com/**', (route) => handleDriveRequest(route, store));
}

/**
 * Mirrors isEncryptedArchive()'s header check (src/lib/databaseEncryption.ts)
 * without importing app source into the Playwright/Node test runner: reads
 * the 4-byte little-endian header length, then looks for the format marker
 * in the JSON header that follows.
 */
export function looksLikeEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength > 65_536 || 4 + headerLength > bytes.byteLength) return false;

  const peekEnd = Math.min(4 + 100, 4 + headerLength);
  const peek = Buffer.from(bytes.slice(4, peekEnd)).toString('utf-8');
  return peek.includes('budget-tracker-encrypted-v1');
}
