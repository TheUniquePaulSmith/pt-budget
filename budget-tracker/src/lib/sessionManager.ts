// Session management for client-side persistence
// Uses IndexedDB for database storage and localStorage for preferences

export interface SessionData {
  databaseContent: Uint8Array | null;
  autoSaveFileHandle: FileSystemFileHandle | null;
  lastAccessed: number;
  fileName?: string;
  sessionId: string;
  createdAt: number;
}

class SessionManager {
  private dbName = 'BudgetTrackerSession';
  private dbVersion = 1;
  private storeName = 'databaseStore';

  // Initialize IndexedDB
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }
  // Save database content to IndexedDB
  async saveDatabaseToSession(databaseContent: Uint8Array, fileName?: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const now = Date.now();
      const sessionId = 'current'; // Keep single session for now
      
      const sessionData: Omit<SessionData, 'autoSaveFileHandle'> = {
        databaseContent,
        lastAccessed: now,
        fileName,
        sessionId,
        createdAt: now
      };
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(sessionData, sessionId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      db.close();
    } catch (error) {
      console.error('Failed to save database to session:', error);
    }
  }
  // Load database content from IndexedDB
  async loadDatabaseFromSession(): Promise<Uint8Array | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      const data = await new Promise<any>((resolve, reject) => {
        const request = store.get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      
      if (data && data.databaseContent) {
        // Update last accessed time
        this.updateLastAccessed();
        return data.databaseContent;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to load database from session:', error);
      return null;
    }
  }
  // Update last accessed time
  private async updateLastAccessed(): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const data = await new Promise<any>((resolve, reject) => {
        const request = store.get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (data) {
        data.lastAccessed = Date.now();
        store.put(data, 'current');
      }
      
      db.close();
    } catch (error) {
      console.error('Failed to update last accessed time:', error);
    }
  }
  // Clear session data
  async clearSession(): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.delete('current');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      
      // Clear localStorage as well
      localStorage.removeItem('budgetTracker_autoSaveEnabled');
      localStorage.removeItem('budgetTracker_fileName');
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }

  // Save auto-save file handle (only works with File System Access API)
  saveAutoSaveFileHandle(fileHandle: FileSystemFileHandle): void {
    try {
      // We can't directly serialize FileSystemFileHandle, but we can store a reference
      // The browser should remember the file handle if we re-request it with the same name
      localStorage.setItem('budgetTracker_autoSaveEnabled', 'true');
      localStorage.setItem('budgetTracker_fileName', fileHandle.name);
    } catch (error) {
      console.error('Failed to save auto-save file handle:', error);
    }
  }

  // Check if auto-save was previously enabled
  isAutoSaveEnabled(): boolean {
    return localStorage.getItem('budgetTracker_autoSaveEnabled') === 'true';
  }

  // Get saved file name
  getSavedFileName(): string | null {
    return localStorage.getItem('budgetTracker_fileName');
  }

  // Clear auto-save settings
  clearAutoSaveSettings(): void {
    localStorage.removeItem('budgetTracker_autoSaveEnabled');
    localStorage.removeItem('budgetTracker_fileName');
  }

  // Check if there's a saved session  // Check if session exists without loading full database
  async hasSession(): Promise<boolean> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      const data = await new Promise<any>((resolve, reject) => {
        const request = store.get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      
      return data && data.databaseContent && data.databaseContent.length > 0;
    } catch (error) {
      console.error('Failed to check session existence:', error);
      return false;
    }
  }
  // Get session info without loading the full database
  async getSessionInfo(): Promise<{ fileName?: string; lastAccessed: number; createdAt: number } | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      const data = await new Promise<any>((resolve, reject) => {
        const request = store.get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      db.close();
      
      if (data) {
        return {
          fileName: data.fileName,
          lastAccessed: data.lastAccessed,
          createdAt: data.createdAt || data.lastAccessed // fallback for older sessions
        };
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get session info:', error);
      return null;
    }
  }
}

export const sessionManager = new SessionManager();
