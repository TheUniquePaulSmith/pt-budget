import { PublicClientApplication } from '@azure/msal-browser';

import type { CloudLinkedFile, CloudProvider } from './databaseSourceStorage';

interface CloudProviderConfig {
  googleClientId: string | null;
  microsoftClientId: string | null;
  microsoftTenantId: string;
}

interface UploadCloudFileOptions {
  fileId?: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface CloudProviderClient {
  readonly provider: CloudProvider;
  isConfigured(): boolean;
  authenticate(interactive?: boolean): Promise<void>;
  listDatabaseFiles(): Promise<CloudLinkedFile[]>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  uploadFile(options: UploadCloudFileOptions): Promise<CloudLinkedFile>;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: Record<string, unknown>) => {
            requestAccessToken: (options?: Record<string, unknown>) => void;
          };
        };
      };
    };
  }
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive';
const MICROSOFT_SCOPES = ['User.Read', 'Files.ReadWrite.All'];

let googleScriptPromise: Promise<void> | null = null;
let googleAccessToken: string | null = null;
let msalInstancePromise: Promise<PublicClientApplication> | null = null;

function getCloudProviderConfig(): CloudProviderConfig {
  return {
    googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null,
    microsoftClientId: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID ?? null,
    microsoftTenantId:
      process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID ?? 'common',
  };
}

function normalizeCloudFile(
  provider: CloudProvider,
  file: {
    id: string;
    name: string;
    modifiedAt?: string | null;
    size?: number | null;
    webUrl?: string | null;
  }
): CloudLinkedFile {
  return {
    provider,
    fileId: file.id,
    fileName: file.name,
    modifiedAt: file.modifiedAt ?? null,
    size: file.size ?? null,
    webUrl: file.webUrl ?? null,
  };
}

function ensureGoogleScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google auth is only available in the browser'));
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-google-identity="true"]'
      );

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), {
          once: true,
        });
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Failed to load Google Identity Services')),
          { once: true }
        );
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
}

function isInteractionRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('interaction_required') ||
    message.includes('popup') ||
    message.includes('user cancelled') ||
    message.includes('consent')
  );
}

class GoogleDriveClient implements CloudProviderClient {
  readonly provider = 'gdrive' as const;

  isConfigured(): boolean {
    return Boolean(getCloudProviderConfig().googleClientId);
  }

  async authenticate(interactive = true): Promise<void> {
    const { googleClientId } = getCloudProviderConfig();
    if (!googleClientId) {
      throw new Error(
        'Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.'
      );
    }

    await ensureGoogleScriptLoaded();

    if (googleAccessToken && !interactive) {
      return;
    }

    googleAccessToken = await new Promise<string>((resolve, reject) => {
      const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
        client_id: googleClientId,
        scope: GOOGLE_SCOPE,
        prompt: interactive ? 'consent' : '',
        callback: (response: { access_token?: string; error?: string }) => {
          if (response.error || !response.access_token) {
            reject(
              new Error(response.error || 'Failed to authenticate with Google')
            );
            return;
          }

          resolve(response.access_token);
        },
      });

      if (!tokenClient) {
        reject(new Error('Failed to initialize Google token client'));
        return;
      }

      tokenClient.requestAccessToken();
    });
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async listDatabaseFiles(): Promise<CloudLinkedFile[]> {
    await this.authenticate(false).catch(async (error) => {
      if (isInteractionRequiredError(error)) {
        await this.authenticate(true);
        return;
      }
      throw error;
    });

    const response = await this.fetchJson<{
      files: Array<{
        id: string;
        name: string;
        modifiedTime?: string;
        size?: string;
        webViewLink?: string;
      }>;
    }>(
      'https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size,webViewLink)&q=trashed=false and mimeType!=\'application/vnd.google-apps.folder\''
    );

    return response.files
      .filter((file) => file.name.toLowerCase().endsWith('.zip'))
      .map((file) =>
        normalizeCloudFile('gdrive', {
          id: file.id,
          name: file.name,
          modifiedAt: file.modifiedTime ?? null,
          size: file.size ? Number(file.size) : null,
          webUrl: file.webViewLink ?? null,
        })
      );
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    await this.authenticate(false).catch(async () => {
      await this.authenticate(true);
    });

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download Google Drive file: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async uploadFile({ fileId, fileName, bytes }: UploadCloudFileOptions) {
    await this.authenticate(false).catch(async () => {
      await this.authenticate(true);
    });

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
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload Google Drive file: ${response.status}`);
    }

    const file = await response.json();
    return normalizeCloudFile('gdrive', {
      id: file.id,
      name: file.name,
      modifiedAt: file.modifiedTime ?? null,
      size: file.size ? Number(file.size) : bytes.byteLength,
      webUrl: file.webViewLink ?? null,
    });
  }
}

async function getMsalInstance() {
  const { microsoftClientId, microsoftTenantId } = getCloudProviderConfig();

  if (!microsoftClientId) {
    throw new Error(
      'OneDrive is not configured. Set NEXT_PUBLIC_MICROSOFT_CLIENT_ID.'
    );
  }

  if (!msalInstancePromise) {
    const instance = new PublicClientApplication({
      auth: {
        clientId: microsoftClientId,
        authority: `https://login.microsoftonline.com/${microsoftTenantId}`,
        redirectUri:
          typeof window === 'undefined' ? undefined : window.location.origin,
      },
      cache: {
        cacheLocation: 'localStorage',
      },
    });

    msalInstancePromise = instance.initialize().then(() => instance);
  }

  return msalInstancePromise;
}

class OneDriveClient implements CloudProviderClient {
  readonly provider = 'onedrive' as const;
  private accessToken: string | null = null;

  isConfigured(): boolean {
    return Boolean(getCloudProviderConfig().microsoftClientId);
  }

  async authenticate(interactive = true): Promise<void> {
    const instance = await getMsalInstance();
    const activeAccount =
      instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;

    if (activeAccount) {
      instance.setActiveAccount(activeAccount);
      try {
        const result = await instance.acquireTokenSilent({
          account: activeAccount,
          scopes: MICROSOFT_SCOPES,
        });
        this.accessToken = result.accessToken;
        return;
      } catch (error) {
        if (!interactive || !isInteractionRequiredError(error)) {
          throw error;
        }
      }
    }

    if (!interactive) {
      throw new Error('Interactive Microsoft authentication is required');
    }

    const loginResult = await instance.loginPopup({
      scopes: MICROSOFT_SCOPES,
      prompt: 'select_account',
    });
    instance.setActiveAccount(loginResult.account);
    this.accessToken = loginResult.accessToken;
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
    await this.authenticate(false).catch(async (error) => {
      if (isInteractionRequiredError(error)) {
        await this.authenticate(true);
        return;
      }
      throw error;
    });

    const response = await this.graphRequest<{
      value: Array<{
        id: string;
        name: string;
        lastModifiedDateTime?: string;
        size?: number;
        webUrl?: string;
        file?: object;
      }>;
    }>(
      'https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,lastModifiedDateTime,size,webUrl,file'
    );

    return response.value
      .filter((entry) => entry.file && entry.name.toLowerCase().endsWith('.zip'))
      .map((entry) =>
        normalizeCloudFile('onedrive', {
          id: entry.id,
          name: entry.name,
          modifiedAt: entry.lastModifiedDateTime ?? null,
          size: entry.size ?? null,
          webUrl: entry.webUrl ?? null,
        })
      );
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    await this.authenticate(false).catch(async () => {
      await this.authenticate(true);
    });

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

  async uploadFile({ fileId, fileName, bytes }: UploadCloudFileOptions) {
    await this.authenticate(false).catch(async () => {
      await this.authenticate(true);
    });

    const endpoint = fileId
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`
      : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(
          fileName
        )}:/content`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/zip',
      },
      body: bytes,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload OneDrive file: ${response.status}`);
    }

    const file = await response.json();
    return normalizeCloudFile('onedrive', {
      id: file.id,
      name: file.name,
      modifiedAt: file.lastModifiedDateTime ?? null,
      size: file.size ?? bytes.byteLength,
      webUrl: file.webUrl ?? null,
    });
  }
}

export function createCloudProviderClient(
  provider: CloudProvider
): CloudProviderClient {
  return provider === 'gdrive' ? new GoogleDriveClient() : new OneDriveClient();
}