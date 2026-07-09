/**
 * Sample Data Service
 *
 * Handles loading sample data from JSON files in /public/sample-data/
 * Used for developer testing and demonstrations
 */

import { databaseWorkerService } from './databaseWorkerService';
import { SAMPLE_DATA_QUERIES } from './sqlQueries';

interface SampleDataMeta {
  actualTransactionCount?: number;
}

interface SampleDataChunkFile {
  file: string;
  rowCount?: number;
}

export type SampleDataImportStage =
  | 'starting'
  | 'fetching-file'
  | 'importing-table'
  | 'table-progress'
  | 'table-complete'
  | 'complete'
  | 'cancelled';

export interface SampleDataImportProgress {
  stage: SampleDataImportStage;
  currentFile: string | null;
  currentTable: string | null;
  completedFiles: number;
  totalFiles: number;
  importedRows: number;
  expectedRows: number | null;
  isCancelable: boolean;
  message: string;
}

export interface LoadSampleDataOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SampleDataImportProgress) => void;
  transactionRowLimit?: number | null;
}

interface SampleDataFile {
  table: string;
  meta?: SampleDataMeta;
  data?: any[];
  dataFiles?: SampleDataChunkFile[];
}

interface SampleDataEnvelopeHeader {
  table: string;
  meta?: SampleDataMeta;
  remainingBuffer: string;
}

interface TableImportDefinition<T = any> {
  insertQuery: string;
  batchSize: number;
  progressLogInterval: number;
  toParameters: (row: T) => any[];
}

interface SampleDataLoadContext extends LoadSampleDataOptions {
  completedFiles: number;
  totalFiles: number;
  currentFile: string;
}

const DATA_ARRAY_START_PATTERN = /"data"\s*:\s*\[/;
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_PROGRESS_LOG_INTERVAL = 5000;
const TRANSACTION_BATCH_SIZE = 1000;
const TRANSACTION_PROGRESS_LOG_INTERVAL = 10000;

export class SampleDataService {
  private static SAMPLE_DATA_FILES = [
    'users.json',
    'accounts.json',
    'account_cards.json',
    'categories.json',
    'companies.json',
    'projects.json',
    'trips.json',
    'transactions.json',
  ];

  /**
   * Load all sample data from public/sample-data/ folder
   */
  static async loadAllSampleData(options: LoadSampleDataOptions = {}): Promise<void> {
    console.info('[Sample Data] Starting sample data load...');

    const totalFiles = this.SAMPLE_DATA_FILES.length;
    let completedFiles = 0;
    const transactionRowLimit =
      options.transactionRowLimit ?? this.getTransactionRowLimit();

    this.throwIfAborted(options.signal);
    this.reportProgress(options, {
      stage: 'starting',
      currentFile: null,
      currentTable: null,
      completedFiles,
      totalFiles,
      importedRows: 0,
      expectedRows: null,
      message: 'Preparing sample data import...',
    });

    for (const filename of this.SAMPLE_DATA_FILES) {
      try {
        this.throwIfAborted(options.signal);
        this.reportProgress(options, {
          stage: 'fetching-file',
          currentFile: filename,
          currentTable: filename.replace(/\.json$/i, ''),
          completedFiles,
          totalFiles,
          importedRows: 0,
          expectedRows: null,
          message: `Fetching ${filename}...`,
        });
        await this.loadSampleDataFile(filename, {
          ...options,
          transactionRowLimit,
          completedFiles,
          totalFiles,
          currentFile: filename,
        });
        completedFiles += 1;
      } catch (error) {
        if (this.isAbortError(error)) {
          this.reportProgress(options, {
            stage: 'cancelled',
            currentFile: filename,
            currentTable: filename.replace(/\.json$/i, ''),
            completedFiles,
            totalFiles,
            importedRows: 0,
            expectedRows: null,
            message: 'Cancelling sample data import...',
          });
          throw error;
        }

        if (error instanceof Error && error.message.includes('Failed to fetch')) {
          console.info(`[Sample Data] ${filename} not found, skipping...`);
          completedFiles += 1;
          continue;
        }

        console.error(`[Sample Data] Failed to load ${filename}:`, error);
        throw error;
      }
    }

    this.reportProgress(options, {
      stage: 'complete',
      currentFile: null,
      currentTable: null,
      completedFiles,
      totalFiles,
      importedRows: 0,
      expectedRows: null,
      message: 'Sample data import completed.',
    });
    console.info('[Sample Data] All sample data loaded successfully');
  }

  /**
   * Load a single sample data file
   */
  private static async loadSampleDataFile(
    filename: string,
    context: SampleDataLoadContext
  ): Promise<void> {
    this.throwIfAborted(context.signal);
    const response = await fetch(`/sample-data/${filename}`, {
      signal: context.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
    }

    const sampleData = await this.openSampleDataEnvelope(response, context.signal);
    await this.insertTableData(
      sampleData.table,
      sampleData.rows,
      {
        ...context,
        currentFile: filename,
      },
      sampleData.meta
    );
  }

  /**
   * Insert data into a specific table preserving primary keys
   */
  private static async insertTableData(
    tableName: string,
    rows: AsyncIterable<any> | Iterable<any>,
    context: SampleDataLoadContext,
    meta?: SampleDataMeta
  ): Promise<void> {
    const importDefinition = this.getImportDefinition(tableName);
    const limitedRows = this.applyTransactionRowLimit(
      tableName,
      rows,
      context.transactionRowLimit
    );
    const pendingRows: any[] = [];
    const expectedRowCount = this.getExpectedRowCount(
      tableName,
      rows,
      meta,
      context.transactionRowLimit
    );
    let totalRows = 0;
    let maxId = 0;
    let nextProgressLog = importDefinition.progressLogInterval;

    this.reportProgress(context, {
      stage: 'importing-table',
      currentFile: context.currentFile,
      currentTable: tableName,
      completedFiles: context.completedFiles,
      totalFiles: context.totalFiles,
      importedRows: 0,
      expectedRows: expectedRowCount,
      message: expectedRowCount
        ? `Importing ${expectedRowCount.toLocaleString()} records into ${tableName}`
        : `Importing records into ${tableName}`,
    });

    console.info(
      expectedRowCount
        ? `[Sample Data] Loading ${expectedRowCount.toLocaleString()} records into ${tableName}`
        : `[Sample Data] Loading records into ${tableName}`
    );

    for await (const row of limitedRows) {
      this.throwIfAborted(context.signal);
      pendingRows.push(row);

      if (typeof row?.id === 'number') {
        maxId = Math.max(maxId, row.id);
      }

      if (pendingRows.length < importDefinition.batchSize) {
        continue;
      }

      totalRows += await this.insertTableBatch(importDefinition, pendingRows);
      pendingRows.length = 0;
      this.reportTableProgress(tableName, totalRows, expectedRowCount, context);
      this.throwIfAborted(context.signal);

      while (totalRows >= nextProgressLog) {
        console.info(
          `[Sample Data] Loaded ${totalRows.toLocaleString()} records into ${tableName}`
        );
        nextProgressLog += importDefinition.progressLogInterval;
      }
    }

    if (pendingRows.length > 0) {
      this.throwIfAborted(context.signal);
      totalRows += await this.insertTableBatch(importDefinition, pendingRows);
      this.reportTableProgress(tableName, totalRows, expectedRowCount, context);
      this.throwIfAborted(context.signal);
    }

    if (totalRows === 0) {
      this.reportProgress(context, {
        stage: 'table-complete',
        currentFile: context.currentFile,
        currentTable: tableName,
        completedFiles: context.completedFiles + 1,
        totalFiles: context.totalFiles,
        importedRows: 0,
        expectedRows: expectedRowCount,
        message: `Finished importing ${tableName}.`,
      });
      return;
    }

    console.info(
      `[Sample Data] Finished loading ${totalRows.toLocaleString()} records into ${tableName}`
    );

    if (maxId > 0) {
      this.throwIfAborted(context.signal);
      await databaseWorkerService.query(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [
        maxId,
        tableName,
      ]);
      console.info(`[Sample Data] Reset ${tableName} sequence to ${maxId}`);
    }

    this.reportProgress(context, {
      stage: 'table-complete',
      currentFile: context.currentFile,
      currentTable: tableName,
      completedFiles: context.completedFiles + 1,
      totalFiles: context.totalFiles,
      importedRows: totalRows,
      expectedRows: expectedRowCount,
      message: `Finished importing ${tableName}.`,
    });
  }

  static isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private static getTransactionRowLimit(): number | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const limitValue = new URLSearchParams(window.location.search).get(
      'sampleDataTransactionLimit'
    );

    if (!limitValue) {
      return null;
    }

    const parsedLimit = Number.parseInt(limitValue, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return null;
    }

    return parsedLimit;
  }

  /**
   * Check if sample data should be loaded based on URL query parameter
   */
  static shouldLoadSampleData(): boolean {
    if (typeof window === 'undefined') return false;

    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('loadSampleData');
  }

  /**
   * Export existing database table to JSON format for sample data
   * Useful for creating sample data files from existing database
   */
  static async exportTableToJSON(tableName: string): Promise<string> {
    const rows = await databaseWorkerService.query(`SELECT * FROM ${tableName}`);

    const sampleData: SampleDataFile = {
      table: tableName,
      data: rows,
    };

    return JSON.stringify(sampleData, null, 2);
  }

  private static applyTransactionRowLimit(
    tableName: string,
    rows: AsyncIterable<any> | Iterable<any>,
    transactionRowLimit?: number | null
  ): AsyncIterable<any> | Iterable<any> {
    if (tableName !== 'transactions' || !transactionRowLimit) {
      return rows;
    }

    return this.takeRows(rows, transactionRowLimit);
  }

  private static getExpectedRowCount(
    tableName: string,
    rows: AsyncIterable<any> | Iterable<any>,
    meta?: SampleDataMeta,
    transactionRowLimit?: number | null
  ): number | null {
    const knownRowCount =
      meta?.actualTransactionCount ?? (Array.isArray(rows) ? rows.length : null);

    if (tableName !== 'transactions' || !transactionRowLimit) {
      return knownRowCount;
    }

    return knownRowCount === null
      ? transactionRowLimit
      : Math.min(knownRowCount, transactionRowLimit);
  }

  private static async *takeRows(
    rows: AsyncIterable<any> | Iterable<any>,
    limit: number
  ): AsyncGenerator<any> {
    let yieldedRows = 0;

    for await (const row of rows) {
      if (yieldedRows >= limit) {
        return;
      }

      yieldedRows += 1;
      yield row;
    }
  }

  private static async insertTableBatch(
    importDefinition: TableImportDefinition,
    rows: any[]
  ): Promise<number> {
    const parameterSets = rows.map((row) => importDefinition.toParameters(row));
    return databaseWorkerService.batchQuery(importDefinition.insertQuery, parameterSets, {
      useTransaction: true,
    });
  }

  private static getImportDefinition(tableName: string): TableImportDefinition {
    switch (tableName) {
      case 'users':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_USER,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.display_name,
            row.created_at,
            row.updated_at,
          ],
        };
      case 'accounts':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_ACCOUNT,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.name,
            row.type,
            row.owner_user_id,
            row.created_at,
            row.updated_at,
          ],
        };
      case 'account_cards':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_ACCOUNT_CARD,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.account_id,
            row.last_four,
            row.nickname || null,
            row.user_id || null,
            row.created_at,
          ],
        };
      case 'categories':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_CATEGORY,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.name,
            row.color,
            row.type,
            row.created_at,
            row.updated_at,
          ],
        };
      case 'companies':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_COMPANY,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.name,
            row.created_at,
            row.updated_at,
          ],
        };
      case 'transactions':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_TRANSACTION,
          batchSize: TRANSACTION_BATCH_SIZE,
          progressLogInterval: TRANSACTION_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.date,
            row.amount,
            row.description,
            row.account_id,
            row.category_id || null,
            row.company_id || null,
            row.project_id || null,
            row.trip_id || null,
            row.type,
            row.transaction_hash || null,
            row.hash_variation_seed || 0,
            row.created_at,
            row.updated_at,
          ],
        };
      case 'projects':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_PROJECT,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.name,
            row.description || null,
            row.budget || null,
            row.start_date || null,
            row.end_date || null,
            row.estimated_cost || 0,
            row.actual_cost || 0,
            row.status || 'planning',
            row.created_at,
            row.updated_at,
          ],
        };
      case 'trips':
        return {
          insertQuery: SAMPLE_DATA_QUERIES.INSERT_TRIP,
          batchSize: DEFAULT_BATCH_SIZE,
          progressLogInterval: DEFAULT_PROGRESS_LOG_INTERVAL,
          toParameters: (row) => [
            row.id,
            row.name,
            row.description || null,
            row.trip_category || 'other',
            row.status || 'planning',
            row.start_date || null,
            row.end_date || null,
            row.estimated_cost || 0,
            row.actual_cost || 0,
            row.notes || null,
            row.created_at,
            row.updated_at,
          ],
        };
      default:
        throw new Error(`Unknown table: ${tableName}`);
    }
  }

  private static async openSampleDataEnvelope(
    response: Response,
    signal?: AbortSignal
  ): Promise<{
    table: string;
    meta?: SampleDataMeta;
    rows: AsyncIterable<any> | Iterable<any>;
  }> {
    this.throwIfAborted(signal);
    if (!response.body) {
      const sampleData: SampleDataFile = await response.json();
      this.throwIfAborted(signal);
      return this.resolveParsedSampleDataEnvelope(sampleData, signal);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      this.throwIfAborted(signal);
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const header = this.tryParseStreamHeader(buffer);
      if (!header) {
        if (done) {
          break;
        }

        continue;
      }

      return {
        table: header.table,
        meta: header.meta,
        rows: this.iterateStreamedRows(
          reader,
          decoder,
          header.remainingBuffer,
          done,
          signal
        ),
      };
    }

    reader.releaseLock();

    const parsedEnvelope = JSON.parse(buffer) as SampleDataFile;
    return this.resolveParsedSampleDataEnvelope(parsedEnvelope, signal);
  }

  private static resolveParsedSampleDataEnvelope(
    sampleData: SampleDataFile,
    signal?: AbortSignal
  ): {
    table: string;
    meta?: SampleDataMeta;
    rows: AsyncIterable<any> | Iterable<any>;
  } {
    if (Array.isArray(sampleData.data)) {
      return {
        table: sampleData.table,
        meta: sampleData.meta,
        rows: sampleData.data,
      };
    }

    if (Array.isArray(sampleData.dataFiles)) {
      return {
        table: sampleData.table,
        meta: sampleData.meta,
        rows: this.iterateChunkedRows(sampleData.dataFiles, signal),
      };
    }

    throw new Error('Invalid sample data file: missing data array.');
  }

  private static async *iterateChunkedRows(
    dataFiles: SampleDataChunkFile[],
    signal?: AbortSignal
  ): AsyncGenerator<any> {
    for (const dataFile of dataFiles) {
      this.throwIfAborted(signal);

      if (!dataFile?.file) {
        throw new Error('Invalid sample data file: chunk file entry is missing.');
      }

      const response = await fetch(`/sample-data/${dataFile.file}`, {
        signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${dataFile.file}: ${response.statusText}`);
      }

      const chunkEnvelope = await this.openSampleDataEnvelope(response, signal);

      for await (const row of chunkEnvelope.rows) {
        yield row;
      }
    }
  }

  private static tryParseStreamHeader(buffer: string): SampleDataEnvelopeHeader | null {
    const match = buffer.match(DATA_ARRAY_START_PATTERN);
    if (!match || match.index === undefined) {
      return null;
    }

    const headerJson = `${buffer.slice(0, match.index)}"data":[]}`;

    try {
      const parsedHeader = JSON.parse(headerJson) as SampleDataFile;
      return {
        table: parsedHeader.table,
        meta: parsedHeader.meta,
        remainingBuffer: buffer.slice(match.index + match[0].length),
      };
    } catch {
      return null;
    }
  }

  private static async *iterateStreamedRows(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    initialBuffer: string,
    initialDone: boolean,
    signal?: AbortSignal
  ): AsyncGenerator<any> {
    let buffer = initialBuffer;
    let done = initialDone;

    try {
      while (true) {
        this.throwIfAborted(signal);
        const extracted = this.extractRowsFromBuffer(buffer);
        buffer = extracted.remainingBuffer;

        for (const rowText of extracted.rows) {
          yield JSON.parse(rowText);
        }

        if (extracted.arrayComplete) {
          return;
        }

        if (done) {
          break;
        }

        const nextChunk = await reader.read();
        done = nextChunk.done;
        this.throwIfAborted(signal);
        buffer += decoder.decode(nextChunk.value ?? new Uint8Array(), {
          stream: !done,
        });
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error('Invalid sample data file: incomplete data array.');
  }

  private static extractRowsFromBuffer(buffer: string): {
    rows: string[];
    remainingBuffer: string;
    arrayComplete: boolean;
  } {
    const rows: string[] = [];
    let remainingBuffer = buffer;

    while (true) {
      remainingBuffer = remainingBuffer.replace(/^[\s,]+/, '');

      if (!remainingBuffer) {
        return {
          rows,
          remainingBuffer,
          arrayComplete: false,
        };
      }

      if (remainingBuffer.startsWith(']')) {
        return {
          rows,
          remainingBuffer: remainingBuffer.slice(1),
          arrayComplete: true,
        };
      }

      if (!remainingBuffer.startsWith('{')) {
        return {
          rows,
          remainingBuffer,
          arrayComplete: false,
        };
      }

      const extractedObject = this.tryExtractJSONObject(remainingBuffer);
      if (!extractedObject) {
        return {
          rows,
          remainingBuffer,
          arrayComplete: false,
        };
      }

      rows.push(extractedObject.jsonText);
      remainingBuffer = extractedObject.remainingBuffer;
    }
  }

  private static tryExtractJSONObject(buffer: string): {
    jsonText: string;
    remainingBuffer: string;
  } | null {
    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];

      if (escaping) {
        escaping = false;
        continue;
      }

      if (character === '\\') {
        escaping = true;
        continue;
      }

      if (character === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (character === '{') {
        depth += 1;
        continue;
      }

      if (character === '}') {
        depth -= 1;

        if (depth === 0) {
          return {
            jsonText: buffer.slice(0, index + 1),
            remainingBuffer: buffer.slice(index + 1),
          };
        }
      }
    }

    return null;
  }

  private static reportTableProgress(
    tableName: string,
    importedRows: number,
    expectedRows: number | null,
    context: SampleDataLoadContext
  ) {
    this.reportProgress(context, {
      stage: 'table-progress',
      currentFile: context.currentFile,
      currentTable: tableName,
      completedFiles: context.completedFiles,
      totalFiles: context.totalFiles,
      importedRows,
      expectedRows,
      message: expectedRows
        ? `Imported ${importedRows.toLocaleString()} of ${expectedRows.toLocaleString()} records into ${tableName}`
        : `Imported ${importedRows.toLocaleString()} records into ${tableName}`,
    });
  }

  private static reportProgress(
    options: LoadSampleDataOptions,
    progress: Omit<SampleDataImportProgress, 'isCancelable'>
  ) {
    options.onProgress?.({
      ...progress,
      isCancelable: !(options.signal?.aborted ?? false),
    });
  }

  private static throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
      return;
    }

    const abortError = new Error('Sample data import cancelled');
    abortError.name = 'AbortError';
    throw abortError;
  }
}