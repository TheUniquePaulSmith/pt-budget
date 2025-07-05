import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';
import { Transaction } from '../types/database';

export interface CSVTransaction {
  date: string;
  amount: string | number;
  description: string;
  category?: string;
  account_last_four?: string;
}

export interface ParsedCSVResult {
  transactions: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>[];
  errors: string[];
  warnings: string[];
}

export class CSVParser {
  private static readonly REQUIRED_FIELDS = ['date', 'amount', 'description'];
  
  static parseCSVFile(file: File): Promise<ParsedCSVResult> {
    return new Promise((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.toLowerCase().trim(),
        complete: (results) => {
          const parsedResult = this.processCSVData(results.data as CSVTransaction[], results.errors);
          resolve(parsedResult);
        },
        error: (error) => {
          resolve({
            transactions: [],
            errors: [`Failed to parse CSV: ${error.message}`],
            warnings: []
          });
        }
      });
    });
  }

  private static processCSVData(data: CSVTransaction[], parseErrors: any[]): ParsedCSVResult {
    const transactions: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    // Add Papa Parse errors
    parseErrors.forEach(error => {
      errors.push(`Row ${error.row + 1}: ${error.message}`);
    });

    data.forEach((row, index) => {
      const rowNumber = index + 2; // +2 because index is 0-based and we have a header row

      try {
        const validationResult = this.validateAndTransformRow(row, rowNumber);
        
        if (validationResult.errors.length > 0) {
          errors.push(...validationResult.errors);
        }
        
        if (validationResult.warnings.length > 0) {
          warnings.push(...validationResult.warnings);
        }

        if (validationResult.transaction) {
          transactions.push(validationResult.transaction);
        }
      } catch (error) {
        errors.push(`Row ${rowNumber}: Unexpected error - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    return { transactions, errors, warnings };
  }

  private static validateAndTransformRow(row: CSVTransaction, rowNumber: number): {
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> | null;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required fields
    this.REQUIRED_FIELDS.forEach(field => {
      if (!row[field as keyof CSVTransaction] || row[field as keyof CSVTransaction] === '') {
        errors.push(`Row ${rowNumber}: Missing required field '${field}'`);
      }
    });

    if (errors.length > 0) {
      return { transaction: null, errors, warnings };
    }

    // Validate and parse date
    const dateResult = this.parseDate(row.date, rowNumber);
    if (dateResult.error) {
      errors.push(dateResult.error);
      return { transaction: null, errors, warnings };
    }

    // Validate and parse amount
    const amountResult = this.parseAmount(row.amount, rowNumber);
    if (amountResult.error) {
      errors.push(amountResult.error);
      return { transaction: null, errors, warnings };
    }

    // Determine transaction type based on amount
    const type: 'income' | 'expense' = amountResult.amount >= 0 ? 'income' : 'expense';
    const absoluteAmount = Math.abs(amountResult.amount);

    // Default category (will need to be assigned later)
    const defaultCategoryId = type === 'income' ? 'cat-inc-4' : 'cat-8'; // Other Income or Shopping

    // Extract account last four digits
    let accountLastFour = row.account_last_four || '';
    if (!accountLastFour) {
      accountLastFour = '0000'; // Default if not provided
      warnings.push(`Row ${rowNumber}: No account information provided, using default '0000'`);
    }

    // Clean up description
    const description = this.cleanDescription(row.description);

    const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
      date: dateResult.date,
      amount: absoluteAmount,
      description,
      account_id: '1', // Default account ID for CSV imports
      category_id: defaultCategoryId,
      company_id: null, // CSV import doesn't specify company
      project_id: null, // CSV import doesn't specify project
      type,
    };

    return { transaction, errors, warnings };
  }

  private static parseDate(dateStr: string, rowNumber: number): { date: string; error?: string } {
    try {
      // Try to parse various date formats
      const date = new Date(dateStr);
      
      if (isNaN(date.getTime())) {
        return { 
          date: '', 
          error: `Row ${rowNumber}: Invalid date format '${dateStr}'. Expected formats: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY` 
        };
      }

      // Return in ISO date format (YYYY-MM-DD)
      return { date: date.toISOString().split('T')[0] };
    } catch (error) {
      return { 
        date: '', 
        error: `Row ${rowNumber}: Unable to parse date '${dateStr}'` 
      };
    }
  }

  private static parseAmount(amountStr: string | number, rowNumber: number): { amount: number; error?: string } {
    try {
      let amount: number;
      
      if (typeof amountStr === 'number') {
        amount = amountStr;
      } else {
        // Remove common currency symbols and formatting
        const cleanAmount = amountStr
          .replace(/[$,\s]/g, '') // Remove $ , and spaces
          .replace(/[()]/g, ''); // Remove parentheses
        
        amount = parseFloat(cleanAmount);
      }

      if (isNaN(amount)) {
        return { 
          amount: 0, 
          error: `Row ${rowNumber}: Invalid amount '${amountStr}'. Must be a valid number.` 
        };
      }

      return { amount };
    } catch (error) {
      return { 
        amount: 0, 
        error: `Row ${rowNumber}: Unable to parse amount '${amountStr}'` 
      };
    }
  }

  private static cleanDescription(description: string): string {
    return description.trim().substring(0, 255); // Limit description length
  }

  // Helper method to suggest company mapping
  static suggestCompanyName(description: string): string {
    // Common patterns for extracting company names from transaction descriptions
    const patterns = [
      // Amazon variants
      { pattern: /amazon|amzn/i, company: 'Amazon' },
      { pattern: /walmart|wal-mart/i, company: 'Walmart' },
      { pattern: /target/i, company: 'Target' },
      { pattern: /starbucks/i, company: 'Starbucks' },
      { pattern: /mcdonalds|mcdonald's/i, company: 'McDonalds' },
      { pattern: /costco/i, company: 'Costco' },
      { pattern: /home depot/i, company: 'Home Depot' },
      { pattern: /best buy/i, company: 'Best Buy' },
      { pattern: /apple/i, company: 'Apple' },
      { pattern: /google/i, company: 'Google' },
      { pattern: /netflix/i, company: 'Netflix' },
      { pattern: /spotify/i, company: 'Spotify' },
      { pattern: /uber/i, company: 'Uber' },
      { pattern: /lyft/i, company: 'Lyft' },
    ];

    for (const { pattern, company } of patterns) {
      if (pattern.test(description)) {
        return company;
      }
    }

    // If no pattern matches, try to extract the first meaningful word
    const words = description.split(/[\s\*]+/).filter(word => 
      word.length > 2 && 
      !/^\d+$/.test(word) && // Not just numbers
      !/^[A-Z0-9]{6,}$/.test(word) // Not transaction codes
    );

    return words[0] || 'Unknown';
  }

  // Helper method to suggest category based on description
  static suggestCategory(description: string, type: 'income' | 'expense'): string {
    if (type === 'income') {
      if (/salary|payroll|wage/i.test(description)) return 'cat-inc-1'; // Salary
      if (/freelance|contractor|consulting/i.test(description)) return 'cat-inc-2'; // Freelance
      if (/dividend|interest|investment/i.test(description)) return 'cat-inc-3'; // Investment
      return 'cat-inc-4'; // Other Income
    }

    // Expense categories
    if (/mortgage|rent|housing/i.test(description)) return 'cat-1'; // Mortgage/Rent
    if (/insurance/i.test(description)) return 'cat-2'; // Insurance
    if (/restaurant|food|grocery|dining|starbucks|mcdonalds/i.test(description)) return 'cat-3'; // Food & Dining
    if (/electric|gas|water|utility|internet|phone/i.test(description)) return 'cat-4'; // Utilities
    if (/gas station|uber|lyft|transport|parking/i.test(description)) return 'cat-5'; // Transportation
    if (/netflix|spotify|entertainment|movie/i.test(description)) return 'cat-6'; // Entertainment
    if (/hospital|doctor|pharmacy|medical|health/i.test(description)) return 'cat-7'; // Healthcare
    
    return 'cat-8'; // Shopping (default)
  }

  // Generate a sample CSV template for users
  static generateSampleCSV(): string {
    const sampleData = [
      {
        date: '2025-01-15',
        amount: '-45.67',
        description: 'Starbucks Coffee',
        category: 'Food & Dining',
        account_last_four: '1234'
      },
      {
        date: '2025-01-14',
        amount: '2500.00',
        description: 'Salary Deposit',
        category: 'Salary',
        account_last_four: '1234'
      },
      {
        date: '2025-01-13',
        amount: '-89.99',
        description: 'Amazon Purchase',
        category: 'Shopping',
        account_last_four: '5678'
      }
    ];

    return Papa.unparse(sampleData);
  }
}

export default CSVParser;
