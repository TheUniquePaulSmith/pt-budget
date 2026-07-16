import { ensureGoogleToken, isGoogleDriveConfigured } from './cloudAuthGoogle';
import { ensureMicrosoftToken, isOneDriveConfigured } from './cloudAuthMicrosoft';
import { CloudAuthRequiredError, CloudConflictError } from './cloudSyncErrors';

import type { CloudLinkedFile, CloudProvider } from './databaseSourceStorage';

interface UploadCloudFileOptions {
  fileId?: string;
  fileName: string;
  bytes: Uint8Array;
  /** Conflict baseline (Drive `version` or Graph `eTag`) to check before overwriting an existing file. */
  ifMatch?: string | null;
  /** Skips the conflict check — used for "overwrite" conflict resolution and brand-new-file migrations. */
  force?: boolean;
  onProgress?: (fraction: number) => void;
}

export interface CloudProviderClient {
  readonly provider: CloudProvider;
  isConfigured(): boolean;
  authenticate(interactive?: boolean): Promise<void>;
  listDatabaseFiles(): Promise<CloudLinkedFile[]>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  getFileMetadata(fileId: string): Promise<CloudLinkedFile>;
  uploadFile(options: UploadCloudFileOptions): Promise<CloudLinkedFile>;
}

// Provider simple-upload limits: above these, each API requires a chunked
// session instead of a single request (OneDrive's /content PUT rejects
// anything over 4MB; Google's multipart uploadType tops out around 5MB).
const ONEDRIVE_SIMPLE_UPLOAD_MAX = 4_000_000;
const GOOGLE_MULTIPART_UPLOAD_MAX = 5_000_000;
// 5 MiB — a multiple of both OneDrive's required 320 KiB chunk granularity
// and Google's required 256 KiB granularity, so one constant works for both.
const CLOUD_UPLOAD_CHUNK_BYTES = 5_242_880;

const GOOGLE_FILE_FIELDS = 'id,name,modifiedTime,size,webViewLink,version,md5Checksum';
const ONEDRIVE_FILE_FIELDS = 'id,name,lastModifiedDateTime,size,webUrl,eTag,cTag';

function normalizeCloudFile(
  provider: CloudProvider,
  file: {
    id: string;
    name: string;
    modifiedAt?: string | null;
    size?: number | null;
    webUrl?: string | null;
    etag?: string | null;
    cTag?: string | null;
    version?: string | null;
    md5Checksum?: string | null;
  }
): CloudLinkedFile {
  return {
    provider,
    fileId: file.id,
    fileName: file.name,
    modifiedAt: file.modifiedAt ?? null,
    size: file.size ?? null,
    webUrl: file.webUrl ?? null,
    etag: file.etag ?? null,
    cTag: file.cTag ?? null,
    version: file.version ?? null,
    md5Checksum: file.md5Checksum ?? null,
  };
}

/**
 * Retries `authenticate(false)` interactively when (and only when) it
 * failed because no valid token was cached — any other error propagates
 * unchanged rather than silently masking an unrelated failure.
 */
async function ensureAuthenticated(client: CloudProviderClient): Promise<void> {
  await client.authenticate(false).catch(async (error) => {
    if (error instanceof CloudAuthRequiredError) {
      await client.authenticate(true);
      return;
    }
    throw error;
  });
}

interface GoogleDriveFileResource {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  version?: string;
  md5Checksum?: string;
}

function normalizeGoogleFile(file: GoogleDriveFileResource, fallbackSize?: number): CloudLinkedFile {
  return normalizeCloudFile('gdrive', {
    id: file.id,
    name: file.name,
    modifiedAt: file.modifiedTime ?? null,
    size: file.size ? Number(file.size) : (fallbackSize ?? null),
    webUrl: file.webViewLink ?? null,
    version: file.version ?? null,
    md5Checksum: file.md5Checksum ?? null,
  });
}

class GoogleDriveClient implements CloudProviderClient {
  readonly provider = 'gdrive' as const;
  private accessToken: string | null = null;

  isConfigured(): boolean {
    return isGoogleDriveConfigured();
  }

  async authenticate(interactive = true): Promise<void> {
    this.accessToken = await ensureGoogleToken(interactive);
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async listDatabaseFiles(): Promise<CloudLinkedFile[]> {
    await ensureAuthenticated(this);

    const response = await this.fetchJson<{ files: GoogleDriveFileResource[] }>(
      `https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime desc&fields=files(${GOOGLE_FILE_FIELDS})&q=trashed=false and mimeType!='application/vnd.google-apps.folder'`
    );

    return response.files
      .filter((file) => file.name.toLowerCase().endsWith('.zip'))
      .map((file) => normalizeGoogleFile(file));
  }

  async getFileMetadata(fileId: string): Promise<CloudLinkedFile> {
    await ensureAuthenticated(this);

    const file = await this.fetchJson<GoogleDriveFileResource>(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${GOOGLE_FILE_FIELDS}`
    );

    return normalizeGoogleFile(file);
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    await ensureAuthenticated(this);

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download Google Drive file: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async uploadFile(options: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    const { fileId, bytes, ifMatch, force = false } = options;
    await ensureAuthenticated(this);

    if (fileId && !force && ifMatch) {
      const current = await this.getFileMetadata(fileId);
      if (current.version !== ifMatch) {
        throw new CloudConflictError(
          'The Google Drive file has changed since it was last synced.',
          current
        );
      }
    }

    if (bytes.byteLength <= GOOGLE_MULTIPART_UPLOAD_MAX) {
      return this.uploadMultipart(options);
    }

    return this.uploadResumable(options);
  }

  private async uploadMultipart({
    fileId,
    fileName,
    bytes,
  }: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: 'application/zip',
    });
    const boundary = `budget-tracker-${Date.now()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
    ]);
    const method = fileId ? 'PATCH' : 'POST';
    const endpoint = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=${GOOGLE_FILE_FIELDS}`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${GOOGLE_FILE_FIELDS}`;

    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload Google Drive file: ${response.status}`);
    }

    const file = (await response.json()) as GoogleDriveFileResource;
    return normalizeGoogleFile(file, bytes.byteLength);
  }

  private async uploadResumable({
    fileId,
    fileName,
    bytes,
    onProgress,
  }: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    const method = fileId ? 'PATCH' : 'POST';
    const initiateEndpoint = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=resumable&fields=${GOOGLE_FILE_FIELDS}`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${GOOGLE_FILE_FIELDS}`;

    const initiateResponse = await fetch(initiateEndpoint, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ name: fileName, mimeType: 'application/zip' }),
    });

    if (!initiateResponse.ok) {
      throw new Error(
        `Failed to start Google Drive resumable upload: ${initiateResponse.status}`
      );
    }

    const sessionUrl = initiateResponse.headers.get('Location');
    if (!sessionUrl) {
      throw new Error('Google Drive did not return a resumable upload session URL');
    }

    const total = bytes.byteLength;
    let offset = 0;
    let finalFile: GoogleDriveFileResource | null = null;

    while (offset < total) {
      const end = Math.min(offset + CLOUD_UPLOAD_CHUNK_BYTES, total);
      const chunk = bytes.subarray(offset, end);

      const chunkResponse = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
      });

      // 308 means "keep going" (a range-incomplete response, not an error).
      if (chunkResponse.status === 308) {
        offset = end;
        onProgress?.(offset / total);
        continue;
      }

      if (!chunkResponse.ok) {
        throw new Error(`Failed to upload Google Drive file chunk: ${chunkResponse.status}`);
      }

      finalFile = (await chunkResponse.json()) as GoogleDriveFileResource;
      offset = end;
      onProgress?.(offset / total);
      break;
    }

    if (!finalFile) {
      throw new Error('Google Drive resumable upload did not complete');
    }

    return normalizeGoogleFile(finalFile, bytes.byteLength);
  }
}

interface OneDriveItemResource {
  id: string;
  name: string;
  lastModifiedDateTime?: string;
  size?: number;
  webUrl?: string;
  eTag?: string;
  cTag?: string;
  file?: object;
}

function normalizeOneDriveItem(item: OneDriveItemResource, fallbackSize?: number): CloudLinkedFile {
  return normalizeCloudFile('onedrive', {
    id: item.id,
    name: item.name,
    modifiedAt: item.lastModifiedDateTime ?? null,
    size: item.size ?? fallbackSize ?? null,
    webUrl: item.webUrl ?? null,
    etag: item.eTag ?? null,
    cTag: item.cTag ?? null,
  });
}

class OneDriveClient implements CloudProviderClient {
  readonly provider = 'onedrive' as const;
  private accessToken: string | null = null;

  isConfigured(): boolean {
    return isOneDriveConfigured();
  }

  async authenticate(interactive = true): Promise<void> {
    this.accessToken = await ensureMicrosoftToken(interactive);
  }

  private async graphRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Microsoft Graph request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async listDatabaseFiles(): Promise<CloudLinkedFile[]> {
    await ensureAuthenticated(this);

    const response = await this.graphRequest<{ value: OneDriveItemResource[] }>(
      `https://graph.microsoft.com/v1.0/me/drive/root/children?$select=${ONEDRIVE_FILE_FIELDS},file`
    );

    return response.value
      .filter((entry) => entry.file && entry.name.toLowerCase().endsWith('.zip'))
      .map((entry) => normalizeOneDriveItem(entry));
  }

  async getFileMetadata(fileId: string): Promise<CloudLinkedFile> {
    await ensureAuthenticated(this);

    const entry = await this.graphRequest<OneDriveItemResource>(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}?$select=${ONEDRIVE_FILE_FIELDS}`
    );

    return normalizeOneDriveItem(entry);
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    await ensureAuthenticated(this);

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download OneDrive file: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async uploadFile(options: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    await ensureAuthenticated(this);

    if (options.bytes.byteLength <= ONEDRIVE_SIMPLE_UPLOAD_MAX) {
      return this.uploadSimple(options);
    }

    return this.uploadSession(options);
  }

  private async uploadSimple({
    fileId,
    fileName,
    bytes,
    ifMatch,
    force = false,
  }: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    const endpoint = fileId
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`
      : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(
          fileName
        )}:/content`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/zip',
    };
    if (fileId && !force && ifMatch) {
      headers['If-Match'] = ifMatch;
    }

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: bytes,
    });

    if (response.status === 412) {
      const current = await this.getFileMetadata(fileId as string);
      throw new CloudConflictError(
        'The OneDrive file has changed since it was last synced.',
        current
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to upload OneDrive file: ${response.status}`);
    }

    const file = (await response.json()) as OneDriveItemResource;
    return normalizeOneDriveItem(file, bytes.byteLength);
  }

  private async uploadSession({
    fileId,
    fileName,
    bytes,
    ifMatch,
    force = false,
    onProgress,
  }: UploadCloudFileOptions): Promise<CloudLinkedFile> {
    const sessionEndpoint = fileId
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/createUploadSession`
      : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(
          fileName
        )}:/createUploadSession`;

    const sessionHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (fileId && !force && ifMatch) {
      sessionHeaders['If-Match'] = ifMatch;
    }

    const sessionResponse = await fetch(sessionEndpoint, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace' },
      }),
    });

    if (sessionResponse.status === 412) {
      const current = await this.getFileMetadata(fileId as string);
      throw new CloudConflictError(
        'The OneDrive file has changed since it was last synced.',
        current
      );
    }

    if (!sessionResponse.ok) {
      throw new Error(`Failed to start OneDrive upload session: ${sessionResponse.status}`);
    }

    const session = (await sessionResponse.json()) as { uploadUrl: string };
    const total = bytes.byteLength;
    let offset = 0;
    let finalFile: OneDriveItemResource | null = null;

    while (offset < total) {
      const end = Math.min(offset + CLOUD_UPLOAD_CHUNK_BYTES, total);
      const chunk = bytes.subarray(offset, end);

      // No Authorization header on chunk PUTs — the session URL itself
      // authorizes the upload.
      const chunkResponse = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
      });

      if (!chunkResponse.ok) {
        throw new Error(`Failed to upload OneDrive file chunk: ${chunkResponse.status}`);
      }

      offset = end;
      onProgress?.(offset / total);

      // Intermediate chunks return 202 with nextExpectedRanges; only the
      // final chunk returns 200/201 with the completed driveItem.
      if (chunkResponse.status !== 202) {
        finalFile = (await chunkResponse.json()) as OneDriveItemResource;
      }
    }

    if (!finalFile) {
      throw new Error('OneDrive upload session did not complete');
    }

    return normalizeOneDriveItem(finalFile, bytes.byteLength);
  }
}

export function createCloudProviderClient(
  provider: CloudProvider
): CloudProviderClient {
  return provider === 'gdrive' ? new GoogleDriveClient() : new OneDriveClient();
}
