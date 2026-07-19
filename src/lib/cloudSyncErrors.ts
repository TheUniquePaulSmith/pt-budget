// Error types shared across the cloud-auth and cloud-sync layers.

import type { CloudLinkedFile } from './databaseSourceStorage';

export type CloudAuthErrorCode =
  | 'access_denied'
  | 'popup_blocked'
  | 'popup_closed'
  | 'timeout'
  | 'state_mismatch'
  | 'config'
  | 'provider_error';

/** Thrown when an operation needs cloud authentication but was told not to prompt interactively. */
export class CloudAuthRequiredError extends Error {
  constructor(message = 'Cloud authentication is required') {
    super(message);
    this.name = 'CloudAuthRequiredError';
  }
}

export class CloudAuthCancelledError extends Error {
  code: CloudAuthErrorCode;

  constructor(message: string, code: CloudAuthErrorCode = 'access_denied') {
    super(message);
    this.name = 'CloudAuthCancelledError';
    this.code = code;
  }
}

/** Thrown when a cloud file has changed remotely since we last saw it. */
export class CloudConflictError extends Error {
  remote: CloudLinkedFile | null;

  constructor(message: string, remote: CloudLinkedFile | null = null) {
    super(message);
    this.name = 'CloudConflictError';
    this.remote = remote;
  }
}

export class CloudUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudUploadError';
  }
}
