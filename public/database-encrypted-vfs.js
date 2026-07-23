// Encrypting VFS overlay for the budget-tracker SharedWorker.
//
// Wraps IDBBatchAtomicVFS (vendored, unmodified) and transparently AES-256-GCM
// encrypts/decrypts every page before it reaches — or after it leaves —
// IndexedDB. SQLite itself never sees ciphertext; only jRead/jWrite are
// overridden, since every other VFS method (jOpen/jDelete/jLock/jSync/...)
// operates on (path, version) bookkeeping that is agnostic to what "offset"
// numerically means.
import { IDBBatchAtomicVFS } from './wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import * as VFS from './wa-sqlite/src/VFS.js';

export const NONCE_LENGTH = 12; // AES-GCM IV
export const TAG_LENGTH = 16; // AES-GCM appends the tag to the ciphertext
export const OVERHEAD = NONCE_LENGTH + TAG_LENGTH;
export const DEFAULT_BLOCK_SIZE = 4096;

export function physicalBlockSize(blockSize) {
  return blockSize + OVERHEAD;
}

/**
 * Reproduces IDBBatchAtomicVFS.getFilename()'s format for code that needs to
 * derive the same AAD string from a raw (path) block record directly —
 * i.e. code walking the `blocks` object store outside of an open file handle,
 * such as the worker's snapshot export/import and change-password re-encryption.
 */
export function formatFilename(vfsName, path) {
  return `IDB(${vfsName}):${path}`;
}

/**
 * Splits a logical byte range [iOffset, iOffset+iAmt) into per-block
 * read/write instructions. Exported standalone so the offset arithmetic
 * (the trickiest part of this file) is unit-testable without any VFS/IndexedDB
 * involvement.
 */
export function planBlocks(iOffset, iAmt, blockSize) {
  if (iAmt <= 0) return [];
  const firstBlock = Math.floor(iOffset / blockSize);
  const lastBlock = Math.floor((iOffset + iAmt - 1) / blockSize);
  const plan = [];
  for (let blockIndex = firstBlock; blockIndex <= lastBlock; blockIndex++) {
    const blockStart = blockIndex * blockSize;
    const rangeStart = Math.max(iOffset, blockStart);
    const rangeEnd = Math.min(iOffset + iAmt, blockStart + blockSize);
    plan.push({
      blockIndex,
      destStart: rangeStart - iOffset,
      destEnd: rangeEnd - iOffset,
      srcStart: rangeStart - blockStart,
      srcEnd: rangeEnd - blockStart,
      isFullBlock: rangeStart === blockStart && rangeEnd === blockStart + blockSize,
    });
  }
  return plan;
}

function blockAad(path, blockIndex) {
  return new TextEncoder().encode(`${path}:${blockIndex}`);
}

/** Encrypts one full logical block with a fresh random nonce. */
export async function encryptBlock(pageKey, path, blockIndex, plaintext) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: blockAad(path, blockIndex) },
    pageKey,
    plaintext
  );
  const physical = new Uint8Array(NONCE_LENGTH + cipherBuf.byteLength);
  physical.set(nonce, 0);
  physical.set(new Uint8Array(cipherBuf), NONCE_LENGTH);
  return physical;
}

/**
 * Decrypts one full physical block.
 * @throws if the key is wrong or the data was tampered with/corrupted.
 */
export async function decryptBlock(pageKey, path, blockIndex, physicalBuf) {
  const nonce = physicalBuf.subarray(0, NONCE_LENGTH);
  const ciphertext = physicalBuf.subarray(NONCE_LENGTH);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: blockAad(path, blockIndex) },
    pageKey,
    ciphertext
  );
  return new Uint8Array(plainBuf);
}

export class EncryptedIDBBatchAtomicVFS extends IDBBatchAtomicVFS {
  /** @type {CryptoKey|null} */
  #pageKey = null;
  #blockSize = DEFAULT_BLOCK_SIZE;

  // IDBBatchAtomicVFS.create() constructs `new IDBBatchAtomicVFS(...)`
  // literally (not `new this(...)`), so it must be overridden here or
  // callers would silently get a plain, unencrypting VFS instance.
  static async create(name, module, options) {
    const vfs = new EncryptedIDBBatchAtomicVFS(name, module, options);
    await vfs.isReady();
    return vfs;
  }

  /** Supplies the page-encryption key. The VFS reads/writes as ciphertext until this is called. */
  setKey(cryptoKey, blockSize = DEFAULT_BLOCK_SIZE) {
    this.#pageKey = cryptoKey;
    this.#blockSize = blockSize;
  }

  /** Forgets the key. Any subsequent jRead/jWrite fails closed. */
  clearKey() {
    this.#pageKey = null;
  }

  get isUnlocked() {
    return this.#pageKey !== null;
  }

  /** Reads and decrypts one full logical block. */
  async #readBlock(fileId, blockIndex) {
    const blockSize = this.#blockSize;
    const pbs = physicalBlockSize(blockSize);
    const physicalBuf = new Uint8Array(pbs);
    const rc = await super.jRead(fileId, physicalBuf, blockIndex * pbs);

    if (rc === VFS.SQLITE_IOERR_SHORT_READ) {
      // No physical block stored yet (new/sparse file). Zero plaintext
      // reproduces the unencrypted VFS's contract for a missing page.
      return { rc, plaintext: new Uint8Array(blockSize) };
    }
    if (rc !== VFS.SQLITE_OK) {
      return { rc, plaintext: null };
    }

    try {
      const plaintext = await decryptBlock(this.#pageKey, this.getFilename(fileId), blockIndex, physicalBuf);
      return { rc: VFS.SQLITE_OK, plaintext };
    } catch {
      return { rc: VFS.SQLITE_IOERR_DATA, plaintext: null };
    }
  }

  /** Encrypts one full logical block and writes it physically. */
  async #writeBlock(fileId, blockIndex, plaintext) {
    const physical = await encryptBlock(this.#pageKey, this.getFilename(fileId), blockIndex, plaintext);
    return super.jWrite(fileId, physical, blockIndex * physicalBlockSize(this.#blockSize));
  }

  async jRead(fileId, pData, iOffset) {
    if (!this.#pageKey) return VFS.SQLITE_IOERR_READ;

    for (const block of planBlocks(iOffset, pData.byteLength, this.#blockSize)) {
      const { rc, plaintext } = await this.#readBlock(fileId, block.blockIndex);
      if (rc === VFS.SQLITE_IOERR_SHORT_READ) {
        // Match the unencrypted VFS's contract: everything from here to the
        // end of the requested range reads as zero, and the loop stops.
        pData.fill(0, block.destStart);
        return VFS.SQLITE_IOERR_SHORT_READ;
      }
      if (rc !== VFS.SQLITE_OK) return rc;
      pData.set(plaintext.subarray(block.srcStart, block.srcEnd), block.destStart);
    }
    return VFS.SQLITE_OK;
  }

  async jWrite(fileId, pData, iOffset) {
    if (!this.#pageKey) return VFS.SQLITE_IOERR_WRITE;

    for (const block of planBlocks(iOffset, pData.byteLength, this.#blockSize)) {
      // Snapshot the incoming bytes now: pData may be a view over growable
      // wasm memory, and holding a live view across the awaits below is
      // unsafe if the heap is resized concurrently.
      const incoming = pData.slice(block.destStart, block.destEnd);

      let plaintext;
      if (block.isFullBlock) {
        plaintext = incoming;
      } else {
        // Partial/unaligned write (rollback-journal or super-journal edge
        // case) — read-modify-write at block granularity.
        const { rc, plaintext: existing } = await this.#readBlock(fileId, block.blockIndex);
        if (rc !== VFS.SQLITE_OK && rc !== VFS.SQLITE_IOERR_SHORT_READ) return rc;
        plaintext = existing;
        plaintext.set(incoming, block.srcStart);
      }

      const rc = await this.#writeBlock(fileId, block.blockIndex, plaintext);
      if (rc !== VFS.SQLITE_OK) return rc;
    }
    return VFS.SQLITE_OK;
  }

  // jFileSize/jTruncate stay synchronous (like the base class) since they
  // need no crypto — just a fixed physical<->logical size scaling. Keeping
  // them non-async also matters for hasAsyncMethod's dispatch check.

  jFileSize(fileId, pSize64) {
    const rc = super.jFileSize(fileId, pSize64); // writes the PHYSICAL size
    if (rc !== VFS.SQLITE_OK) return rc;
    const pbs = BigInt(physicalBlockSize(this.#blockSize));
    const physicalBytes = pSize64.getBigInt64(0, true);
    const blockCount = physicalBytes / pbs;
    pSize64.setBigInt64(0, blockCount * BigInt(this.#blockSize), true);
    return VFS.SQLITE_OK;
  }

  jTruncate(fileId, iSize) {
    const blockCount = Math.ceil(iSize / this.#blockSize);
    return super.jTruncate(fileId, blockCount * physicalBlockSize(this.#blockSize));
  }
}
