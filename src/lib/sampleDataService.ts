/**
 * Sample Data Service
 * 
 * Handles loading sample data from JSON files in /public/sample-data/
 * Used for developer testing and demonstrations
 */

import { databaseWorkerService } from './databaseWorkerService';
import { SAMPLE_DATA_QUERIES } from './sqlQueries';

interface SampleDataFile {
  table: string;
  data: any[];
}

export class SampleDataService {
  private static SAMPLE_DATA_FILES = [
    'users.json',
    'accounts.json',
    'account_cards.json',
    'categories.json',
    'companies.json',
    'projects.json',
    'trips.json',
    'transactions.json', // Load transactions last due to foreign keys
  ];

  /**
   * Load all sample data from public/sample-data/ folder
   */
  static async loadAllSampleData(): Promise<void> {
    console.info('[Sample Data] Starting sample data load...');
    
    for (const filename of this.SAMPLE_DATA_FILES) {
      try {
        await this.loadSampleDataFile(filename);
      } catch (error) {
        // If file doesn't exist, just log and continue
        if (error instanceof Error && error.message.includes('Failed to fetch')) {
          console.info(`[Sample Data] ${filename} not found, skipping...`);
          continue;
        }
        console.error(`[Sample Data] Failed to load ${filename}:`, error);
        throw error;
      }
    }
    
    console.info('[Sample Data] All sample data loaded successfully');
  }

  /**
   * Load a single sample data file
   */
  private static async loadSampleDataFile(filename: string): Promise<void> {
    const response = await fetch(`/sample-data/${filename}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
    }

    const sampleData: SampleDataFile = await response.json();
    console.info(`[Sample Data] Loading ${sampleData.data.length} records into ${sampleData.table}`);

    await this.insertTableData(sampleData.table, sampleData.data);
  }

  /**
   * Insert data into a specific table preserving primary keys
   */
  private static async insertTableData(tableName: string, data: any[]): Promise<void> {
    if (data.length === 0) return;

    let query: string;
    let maxId = 0;

    // Map table name to appropriate insert query
    switch (tableName) {
      case 'users':
        query = SAMPLE_DATA_QUERIES.INSERT_USER;
        for (const row of data) {
          await databaseWorkerService.query(query, [
            row.id,
            row.display_name,
            row.created_at,
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'accounts':
        query = SAMPLE_DATA_QUERIES.INSERT_ACCOUNT;
        for (const row of data) {
          await databaseWorkerService.query(query, [
            row.id,
            row.name,
            row.type,
            row.owner_user_id,
            row.created_at,
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'account_cards':
        query = SAMPLE_DATA_QUERIES.INSERT_ACCOUNT_CARD;
        for (const row of data) {
          await databaseWorkerService.query(query, [
            row.id,
            row.account_id,
            row.last_four,
            row.nickname || null,
            row.user_id || null,
            row.created_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'categories':
        query = SAMPLE_DATA_QUERIES.INSERT_CATEGORY;
        for (const row of data) {
          await databaseWorkerService.query(query, [
            row.id,
            row.name,
            row.color,
            row.type,
            row.created_at,
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'companies':
        query = SAMPLE_DATA_QUERIES.INSERT_COMPANY;
        for (const row of data) {
          await databaseWorkerService.query(query, [
            row.id,
            row.name,
            row.created_at,
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'transactions':
        query = SAMPLE_DATA_QUERIES.INSERT_TRANSACTION;
        for (const row of data) {
          await databaseWorkerService.query(query, [
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
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'projects':
        query = SAMPLE_DATA_QUERIES.INSERT_PROJECT;
        for (const row of data) {
          await databaseWorkerService.query(query, [
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
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      case 'trips':
        query = SAMPLE_DATA_QUERIES.INSERT_TRIP;
        for (const row of data) {
          await databaseWorkerService.query(query, [
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
            row.updated_at
          ]);
          maxId = Math.max(maxId, row.id);
        }
        break;

      default:
        throw new Error(`Unknown table: ${tableName}`);
    }

    // Reset the auto-increment sequence to prevent ID conflicts
    if (maxId > 0) {
      await databaseWorkerService.query(SAMPLE_DATA_QUERIES.RESET_SEQUENCE, [maxId, tableName]);
      console.info(`[Sample Data] Reset ${tableName} sequence to ${maxId}`);
    }
  }

  /**
   * Check if sample data should be loaded based on URL query parameter
   */
  static shouldLoadSampleData(): boolean {
    if (typeof window === 'undefined') return false;
    
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('loadSampleData') === 'true';
  }

  /**
   * Export existing database table to JSON format for sample data
   * Useful for creating sample data files from existing database
   */
  static async exportTableToJSON(tableName: string): Promise<string> {
    const rows = await databaseWorkerService.query(`SELECT * FROM ${tableName}`);
    
    const sampleData: SampleDataFile = {
      table: tableName,
      data: rows
    };
    
    return JSON.stringify(sampleData, null, 2);
  }
}
