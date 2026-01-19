'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { CloudUpload, CheckCircle, Error as ErrorIcon, ExpandMore } from '@mui/icons-material';
import Papa from 'papaparse';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction, Account } from '@/types/database';
import InternalDuplicatesResolver from './InternalDuplicatesResolver';

interface CSVImportProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

interface AnalysisResult {
  totalRows: number;
  mappableRows: number;
  duplicateCount: number;
  internalDuplicates: number;
  uniqueCount: number;
  skippedRows: number;
  duplicateGroups?: DuplicateGroup[];
}

interface DuplicateGroup {
  hash: string;
  transactions: Array<{
    index: number;
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
    csvAccountValue: string;
    tempId: number;
  }>;
}

interface ColumnMapping {
  accountColumn: string;
  dateColumn: string;
  amountColumn: string;
  descriptionColumn: string;
  uniqueIdentifierColumn: string;
}

interface AccountMatch {
  csvAccountValue: string;
  lastFourValue: string;
  matchingAccounts: Account[];
  selectedAccountId: number | null;
}

export default function CSVImport({ open, onClose, onSuccess }: CSVImportProps) {
  const { 
    accounts, 
    generateTransactionHash,
    truncateImportTable,
    insertIntoTempTable,
    deleteFromTempTable,
    checkDuplicateTransactions,
    bulkInsertFromTempTable,
    findAccountsByLastFour,
  } = useDatabaseContext();
  
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    accountColumn: '',
    dateColumn: '',
    amountColumn: '',
    descriptionColumn: '',
    uniqueIdentifierColumn: '',
  });
  const [accountMatches, setAccountMatches] = useState<AccountMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateResolverOpen, setDuplicateResolverOpen] = useState(false);
  const [excludedTransactionIndices, setExcludedTransactionIndices] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<{
    columnMapping: boolean;
    accountMapping: boolean;
    preview: boolean;
  }>({
    columnMapping: true,
    accountMapping: true,
    preview: true,
  });

  // Function to analyze account column and find matching accounts
  const analyzeAccountColumn = useCallback(async (data: any[], accountColumn: string) => {
    // Get unique account values from CSV
    const uniqueAccountValues = [...new Set(data.map(row => String(row[accountColumn])))];
    
    console.debug(`Available accounts in database:`, accounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type
    })));
    
    const matches: AccountMatch[] = await Promise.all(uniqueAccountValues.map(async csvValue => {
      // Extract last 4 digits from CSV value (e.g., "...1682" -> "1682")
      const lastFourMatch = csvValue.match(/(\d{4})$/);
      const lastFour = lastFourMatch ? lastFourMatch[1] : '';
      console.debug(`Analyzing account column: ${csvValue}, extracted last four: "${lastFour}" (type: ${typeof lastFour})`);
      
      // Use findAccountsByLastFour to search account_cards table
      const matchingAccounts = lastFour ? await findAccountsByLastFour(lastFour) : [];
      console.debug(`Found ${matchingAccounts.length} matching accounts for last four "${lastFour}":`, matchingAccounts);
      
      return {
        csvAccountValue: csvValue,
        lastFourValue: lastFour,
        matchingAccounts,
        selectedAccountId: matchingAccounts.length === 1 ? matchingAccounts[0].id : null,
      };
    }));
    
    setAccountMatches(matches);
  }, [accounts, findAccountsByLastFour]);

  // Clear invalid column mappings when CSV data changes
  useEffect(() => {
    if (csvData.length > 0) {
      const columnHeaders = Object.keys(csvData[0]);
      const updatedMapping = { ...mapping };
      let hasInvalidMappings = false;

      // Check each mapping and clear if invalid
      // Skip validation for direct account selection (DIRECT_ACCOUNT:123)
      if (mapping.accountColumn && !mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') && !columnHeaders.includes(mapping.accountColumn)) {
        updatedMapping.accountColumn = '';
        hasInvalidMappings = true;
      }
      if (mapping.dateColumn && !columnHeaders.includes(mapping.dateColumn)) {
        updatedMapping.dateColumn = '';
        hasInvalidMappings = true;
      }
      if (mapping.amountColumn && !columnHeaders.includes(mapping.amountColumn)) {
        updatedMapping.amountColumn = '';
        hasInvalidMappings = true;
      }
      if (mapping.descriptionColumn && !columnHeaders.includes(mapping.descriptionColumn)) {
        updatedMapping.descriptionColumn = '';
        hasInvalidMappings = true;
      }
      if (mapping.uniqueIdentifierColumn && !columnHeaders.includes(mapping.uniqueIdentifierColumn)) {
        updatedMapping.uniqueIdentifierColumn = '';
        hasInvalidMappings = true;
      }

      if (hasInvalidMappings) {
        setMapping(updatedMapping);
        setError('Some column mappings were cleared because they don&apos;t exist in the CSV. Please reselect them.');
      }
    }
  }, [csvData, mapping]);

  // Analyze account column when it's selected and CSV data is available
  useEffect(() => {
    if (csvData.length > 0 && mapping.accountColumn) {
      // Check if a direct account was selected
      if (mapping.accountColumn.startsWith('DIRECT_ACCOUNT:')) {
        const accountId = parseInt(mapping.accountColumn.replace('DIRECT_ACCOUNT:', ''));
        const selectedAccount = accounts.find(acc => acc.id === accountId);
        if (selectedAccount) {
          // Create a single account match that maps everything to the selected account
          setAccountMatches([{
            csvAccountValue: 'ALL_TRANSACTIONS',
            lastFourValue: '',
            matchingAccounts: [selectedAccount],
            selectedAccountId: accountId,
          }]);
        }
      } else {
        // Call async function
        analyzeAccountColumn(csvData, mapping.accountColumn);
      }
    } else {
      // Clear account matches if no account column is selected
      setAccountMatches([]);
    }
  }, [csvData, mapping.accountColumn, analyzeAccountColumn, accounts]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setLoading(true);

    try {
      // Parse CSV for column detection and preview
      const text = await selectedFile.text();
      const result = await new Promise<any[]>((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data),
          error: (error: any) => reject(error)
        });
      });
      
      setCsvData(result);
      setPreview(result.slice(0, 5)); // Show first 5 rows for preview

      // Auto-detect common column mappings
      if (result.length > 0) {
        const headers = Object.keys(result[0]);
        
        const newMapping: ColumnMapping = {
          accountColumn: headers.find(h => h.toLowerCase().includes('account') && h.toLowerCase().includes('number')) || '',
          dateColumn: headers.find(h => h.toLowerCase().includes('date') || h.toLowerCase().includes('time')) || '',
          amountColumn: headers.find(h => h.toLowerCase().includes('amount') || h.toLowerCase().includes('billing')) || '',
          descriptionColumn: headers.find(h => h.toLowerCase().includes('merchant') || h.toLowerCase().includes('description') || h.toLowerCase().includes('memo')) || '',
          uniqueIdentifierColumn: headers.find(h => h.toLowerCase().includes('reference') || h.toLowerCase().includes('id')) || '',
        };
        
        setMapping(newMapping);
        
        // Don't automatically analyze account column - let user select it first
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
    } finally {
      setLoading(false);
    }
  };

  const updateAccountMapping = (csvValue: string, accountId: number) => {
    setAccountMatches(prev => 
      prev.map(match => 
        match.csvAccountValue === csvValue 
          ? { ...match, selectedAccountId: accountId }
          : match
      )
    );
  };

  const mapTransactionsFromCSV = (
    data: any[], 
    columnMapping: ColumnMapping,
    accountMappings: AccountMatch[]
  ): Array<{
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
    csvAccountValue: string;
    lastFourValue: string;
    hash: string;
  }> => {
    // Check if a direct account was selected
    const isDirectAccount = columnMapping.accountColumn.startsWith('DIRECT_ACCOUNT:');
    const directAccountMapping = isDirectAccount ? accountMappings[0] : null;

    return data.filter(row => {
      if (isDirectAccount) {
        return directAccountMapping?.selectedAccountId; // All rows are valid if direct account is selected
      }
      const csvAccountValue = String(row[columnMapping.accountColumn]);
      const accountMapping = accountMappings.find(m => m.csvAccountValue === csvAccountValue);
      return accountMapping?.selectedAccountId; // Only include rows with mapped accounts
    }).map(row => {
      let csvAccountValue: string;
      let accountMapping: AccountMatch | undefined | null;
      let lastFourValue: string;

      if (isDirectAccount) {
        csvAccountValue = 'ALL_TRANSACTIONS';
        accountMapping = directAccountMapping;
        lastFourValue = '';
      } else {
        csvAccountValue = String(row[columnMapping.accountColumn]);
        accountMapping = accountMappings.find(m => m.csvAccountValue === csvAccountValue);
        lastFourValue = accountMapping?.lastFourValue || '';
      }

      // We know this exists because we filtered above
      if (!accountMapping?.selectedAccountId) {
        throw new Error(`No account mapping found for ${csvAccountValue}`);
      }

      const dateStr = row[columnMapping.dateColumn];
      const amountStr = String(row[columnMapping.amountColumn]);
      const description = String(row[columnMapping.descriptionColumn]);
      const uniqueIdentifier = columnMapping.uniqueIdentifierColumn 
        ? String(row[columnMapping.uniqueIdentifierColumn]) 
        : undefined;
      
      // Parse date
      let date: string;
      try {
        const parsedDate = new Date(dateStr);
        if (isNaN(parsedDate.getTime())) {
          throw new Error('Invalid date');
        }
        date = parsedDate.toISOString().split('T')[0];
      } catch {
        date = new Date().toISOString().split('T')[0];
      }
      
      // Parse amount
      const cleanAmount = amountStr.replace(/[^\d.-]/g, '');
      const amount = parseFloat(cleanAmount) || 0;
      
      // Determine transaction type
      const type: 'income' | 'expense' = amount > 0 ? 'income' : 'expense';
      
      const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
        date,
        amount: Math.abs(amount) * (type === 'expense' ? -1 : 1),
        description: description || 'Imported transaction',
        account_id: accountMapping.selectedAccountId,
        category_id: null,
        company_id: null,
        project_id: null,
        trip_id: null,
        type,
      };

      // Generate hash for duplicate detection
      //Hash is date, amount, description, 
      const hash = generateTransactionHash(
        csvAccountValue,
        date,
        amount,
        description,
        uniqueIdentifier
      );
      
      return {
        transaction: { ...transaction, transaction_hash: hash },
        csvAccountValue,
        lastFourValue,
        hash,
      };
    });
  };

  const toggleSection = (section: 'columnMapping' | 'accountMapping' | 'preview') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleResolveDuplicates = async (selectedIndices: Set<number>) => {
    if (!analysisResult || !analysisResult.duplicateGroups) return;

    // Collect temp_ids of excluded transactions
    const tempIdsToDelete: number[] = [];
    
    analysisResult.duplicateGroups.forEach(group => {
      group.transactions.forEach(item => {
        if (!selectedIndices.has(item.index)) {
          tempIdsToDelete.push(item.tempId);
        }
      });
    });
    
    setDuplicateResolverOpen(false);
    
    // Delete excluded transactions from temp table
    try {
      if (tempIdsToDelete.length > 0) {
        await deleteFromTempTable(tempIdsToDelete);
      }
      
      // Recalculate counts after deletion
      const existingHashes = await checkDuplicateTransactions();
      const duplicateCount = existingHashes.length;
      
      // Calculate remaining transaction count
      const remainingCount = analysisResult.mappableRows - tempIdsToDelete.length;
      const uniqueCount = remainingCount - duplicateCount;

      // Update analysis result
      setAnalysisResult({
        ...analysisResult,
        internalDuplicates: 0, // All resolved
        duplicateCount,
        uniqueCount,
        duplicateGroups: undefined, // Clear duplicate groups after resolution
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update analysis after duplicate resolution');
    }
  };

  const handleAnalyze = async () => {
    if (!csvData.length) {
      setError('No CSV data available');
      return;
    }

    const columnHeaders = Object.keys(csvData[0]);
    
    // Validate that all required columns are mapped and exist in the CSV
    const requiredMappings = [
      { field: 'accountColumn', name: 'Account Number', value: mapping.accountColumn },
      { field: 'dateColumn', name: 'Date', value: mapping.dateColumn },
      { field: 'amountColumn', name: 'Amount', value: mapping.amountColumn },
      { field: 'descriptionColumn', name: 'Description', value: mapping.descriptionColumn },
    ];

    for (const { name, value, field } of requiredMappings) {
      if (!value) {
        setError(`Please select a column for ${name}`);
        return;
      }
      // Skip validation for direct account selection
      if (field === 'accountColumn' && value.startsWith('DIRECT_ACCOUNT:')) {
        continue;
      }
      if (!columnHeaders.includes(value)) {
        setError(`Selected ${name} column "${value}" does not exist in the CSV`);
        return;
      }
    }

    // Check if at least one account is mapped
    const mappedAccounts = accountMatches.filter(match => match.selectedAccountId);
    if (mappedAccounts.length === 0) {
      setError('Please map at least one account to analyze transactions');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    
    // Collapse mapping and preview sections when analyzing
    setExpandedSections({
      columnMapping: false,
      accountMapping: false,
      preview: false,
    });

    try {
      const mappedTransactions = mapTransactionsFromCSV(csvData, mapping, accountMatches);
      
      const totalRows = csvData.length;
      const mappableRows = mappedTransactions.length;
      const skippedRows = totalRows - mappableRows;
      
      // Detect internal duplicates within the CSV itself and group them
      type TransactionItem = {
        index: number;
        transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
        csvAccountValue: string;
      };
      const hashMap = new Map<string, Array<TransactionItem>>();
      
      mappedTransactions.forEach((mapped, index) => {
        if (!hashMap.has(mapped.hash)) {
          hashMap.set(mapped.hash, []);
        }
        hashMap.get(mapped.hash)!.push({
          index,
          transaction: mapped.transaction,
          csvAccountValue: mapped.csvAccountValue,
        });
      });
      
      // Insert ALL mapped transactions into temp table
      await truncateImportTable();
      const allTransactions = mappedTransactions.map(m => m.transaction);
      const tempIds = await insertIntoTempTable(allTransactions);
      
      // Map temp_ids back to transactions in hashMap
      mappedTransactions.forEach((mapped, index) => {
        const tempId = tempIds[index];
        const items = hashMap.get(mapped.hash);
        if (items) {
          const item = items.find(i => i.index === index);
          if (item) {
            (item as any).tempId = tempId; // Add tempId to the transaction item
          }
        }
      });
      
      // Find duplicate groups (hashes with more than 1 transaction)
      const duplicateGroups: DuplicateGroup[] = [];
      let internalDuplicateCount = 0;
      
      hashMap.forEach((transactions, hash) => {
        if (transactions.length > 1) {
          duplicateGroups.push({ 
            hash, 
            transactions: transactions.map(t => ({
              ...t,
              tempId: (t as any).tempId
            }))
          });
          internalDuplicateCount += transactions.length - 1; // Count extras beyond the first
        }
      });
      
      // Check for duplicates against existing database transactions
      const existingHashes = await checkDuplicateTransactions();
      const duplicateCount = existingHashes.length;
      const uniqueCount = mappableRows - internalDuplicateCount - duplicateCount;

      setAnalysisResult({
        totalRows,
        mappableRows,
        duplicateCount,
        internalDuplicates: internalDuplicateCount,
        uniqueCount,
        skippedRows,
        duplicateGroups: duplicateGroups.length > 0 ? duplicateGroups : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze transactions');
      // Clean up import table on error
      await truncateImportTable();
    } finally {
      setAnalyzing(false);
    }
  };
  const handleImport = async () => {
    if (!csvData.length) {
      setError('No CSV data available');
      return;
    }
    
    // If analysis was not done, require it first
    if (!analysisResult) {
      setError('Please analyze the file first before importing');
      return;
    }

    setImporting(true);
    setError(null);

    try {
      // Bulk insert from temp table (excludes duplicates)
      const successCount = await bulkInsertFromTempTable();
      
      // Clean up import table after successful import
      await truncateImportTable();

      const totalTransactions = csvData.length;
      const mappableTransactions = analysisResult.mappableRows;
      const skippedCount = analysisResult.skippedRows;
      const duplicateCount = analysisResult.duplicateCount;

      setImportResult({
        success: successCount,
        failed: 0,
        skipped: skippedCount,
        duplicates: duplicateCount,
        errors: [],
      });

      if (successCount > 0) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import transactions');
      // Clean up import table on error
      await truncateImportTable();
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    // Clear import table when closing modal
    truncateImportTable().catch(err => 
      console.error('Error clearing import table on close:', err)
    );
    
    setFile(null);
    setCsvData([]);
    setPreview([]);
    setMapping({
      accountColumn: '',
      dateColumn: '',
      amountColumn: '',
      descriptionColumn: '',
      uniqueIdentifierColumn: '',
    });
    setAccountMatches([]);
    setLoading(false);
    setImporting(false);
    setAnalyzing(false);
    setAnalysisResult(null);
    setImportResult(null);
    setError(null);
    setDuplicateResolverOpen(false);
    setExcludedTransactionIndices(new Set());
    setExpandedSections({
      columnMapping: true,
      accountMapping: true,
      preview: true,
    });
    onClose();
  };

  const columnOptions = csvData.length > 0 ? Object.keys(csvData[0]) : [];
  
  // Calculate how many transactions can be imported
  const importableTransactions = csvData.length > 0 && mapping.accountColumn && accountMatches.length > 0 
    ? (mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') 
        ? csvData.length // All transactions when direct account is selected
        : csvData.filter(row => {
            const csvAccountValue = String(row[mapping.accountColumn]);
            const accountMapping = accountMatches.find(m => m.csvAccountValue === csvAccountValue);
            return accountMapping?.selectedAccountId;
          }).length)
    : 0;
    
  const skippedTransactions = csvData.length - importableTransactions;
    
  const canImport = csvData.length > 0 && 
    mapping.accountColumn && (mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') || columnOptions.includes(mapping.accountColumn)) &&
    mapping.dateColumn && columnOptions.includes(mapping.dateColumn) &&
    mapping.amountColumn && columnOptions.includes(mapping.amountColumn) &&
    mapping.descriptionColumn && columnOptions.includes(mapping.descriptionColumn) &&
    importableTransactions > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Transactions from CSV</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={3}>
          {/* File Upload */}
          <Box>
            <input
              accept=".csv"
              style={{ display: 'none' }}
              id="csv-file-input"
              type="file"
              onChange={handleFileSelect}
            />
            <label htmlFor="csv-file-input">
              <Button
                variant="outlined"
                component="span"
                startIcon={<CloudUpload />}
                fullWidth
                size="large"
              >
                {file ? file.name : 'Choose CSV File'}
              </Button>
            </label>
          </Box>

          {error && (
            <Alert severity="error" icon={<ErrorIcon />}>
              {error}
            </Alert>
          )}

          {loading && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Parsing CSV file...
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {/* Column Mapping */}
          {csvData.length > 0 && !loading && (
            <Accordion 
              expanded={expandedSections.columnMapping} 
              onChange={() => toggleSection('columnMapping')}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
                  Map CSV Columns
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    Map your CSV columns to transaction fields. All fields are required for proper import.
                  </Typography>
              
              {/* Show validation warning if invalid columns are selected */}
              {(mapping.accountColumn && !mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') && !columnOptions.includes(mapping.accountColumn)) ||
               (mapping.dateColumn && !columnOptions.includes(mapping.dateColumn)) ||
               (mapping.amountColumn && !columnOptions.includes(mapping.amountColumn)) ||
               (mapping.descriptionColumn && !columnOptions.includes(mapping.descriptionColumn)) ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Some selected columns don&apos;t exist in your CSV. Please reselect the correct columns from the dropdown.
                </Alert>
              ) : null}
              
              <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2} mt={2}>
                <FormControl fullWidth required>
                  <InputLabel>Account Number Column</InputLabel>
                  <Select
                    value={mapping.accountColumn}
                    label="Account Number Column"
                    onChange={(e) => setMapping({ ...mapping, accountColumn: e.target.value })}
                  >
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                    {columnOptions.length > 0 && accounts.length > 0 && (
                      <MenuItem disabled sx={{ opacity: 0.6, fontWeight: 'bold' }}>
                        ─────── Or Select Account ───────
                      </MenuItem>
                    )}
                    {accounts.map(account => (
                      <MenuItem key={`account-${account.id}`} value={`DIRECT_ACCOUNT:${account.id}`}>
                        {account.user_display_names ? `${account.user_display_names} - ` : ''}{account.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth required>
                  <InputLabel>Date Column</InputLabel>
                  <Select
                    value={mapping.dateColumn}
                    label="Date Column"
                    onChange={(e) => setMapping({ ...mapping, dateColumn: e.target.value })}
                  >
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth required>
                  <InputLabel>Amount Column</InputLabel>
                  <Select
                    value={mapping.amountColumn}
                    label="Amount Column"
                    onChange={(e) => setMapping({ ...mapping, amountColumn: e.target.value })}
                  >
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth required>
                  <InputLabel>Description Column</InputLabel>
                  <Select
                    value={mapping.descriptionColumn}
                    label="Description Column"
                    onChange={(e) => setMapping({ ...mapping, descriptionColumn: e.target.value })}
                  >
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Unique Identifier Column (Optional)</InputLabel>
                  <Select
                    value={mapping.uniqueIdentifierColumn}
                    label="Unique Identifier Column (Optional)"
                    onChange={(e) => setMapping({ ...mapping, uniqueIdentifierColumn: e.target.value })}
                  >
                    <MenuItem value="">None</MenuItem>
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Optional: Additional field to include in duplicate detection hash (e.g., transaction reference number)
                  </Typography>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Account Mapping Helper Message */}
          {csvData.length > 0 && !mapping.accountColumn && (
            <Box>
              <Alert severity="info">
                <Typography variant="body2">
                  Select an &quot;Account Number Column&quot; from your CSV, or choose an account directly if all transactions belong to one account.
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Direct Account Selection Confirmation */}
          {csvData.length > 0 && mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') && (
            <Box>
              <Alert severity="success">
                <Typography variant="body2">
                  All transactions will be imported to: <strong>
                    {(() => {
                      const accountId = parseInt(mapping.accountColumn.replace('DIRECT_ACCOUNT:', ''));
                      const account = accounts.find(acc => acc.id === accountId);
                      return account ? `${account.user_display_names ? account.user_display_names + ' - ' : ''}${account.name}` : 'Unknown Account';
                    })()}
                  </strong>
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Account Mapping */}
          {accountMatches.length > 0 && !mapping.accountColumn.startsWith('DIRECT_ACCOUNT:') && (
            <Accordion 
              expanded={expandedSections.accountMapping} 
              onChange={() => toggleSection('accountMapping')}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
                  Map CSV Account Numbers to Your Accounts
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    Select which of your accounts corresponds to each account number found in the CSV.
                  </Typography>
                
                  <Box sx={{ mt: 2 }}>
                    {accountMatches.map((match) => (
                  <Box key={match.csvAccountValue} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Box sx={{ mb: 1, fontWeight: 'medium', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" component="span">
                        CSV Account:
                      </Typography>
                      <Chip label={match.csvAccountValue} size="small" />
                    </Box>
                    
                    {match.matchingAccounts.length === 0 ? (
                      <Alert severity="warning">
                        No accounts found with matching last 4 digits. This account will be skipped during import.
                      </Alert>
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Select Account</InputLabel>
                        <Select
                          value={match.selectedAccountId || ''}
                          label="Select Account"
                          onChange={(e) => updateAccountMapping(match.csvAccountValue, e.target.value)}
                        >
                          {match.matchingAccounts.map(account => (
                            <MenuItem key={account.id} value={account.id}>
                              {account.user_display_names ? `${account.user_display_names} - ` : ''}{account.name} - {account.type}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Box>
                ))}
                </Box>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Data Preview */}
          {preview.length > 0 && (
            <Accordion 
              expanded={expandedSections.preview} 
              onChange={() => toggleSection('preview')}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
                  Preview (First 5 rows)
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <List dense>
                  {preview.map((row, index) => (
                    <ListItem key={index} divider={index < preview.length - 1}>
                      <ListItemText
                        primary={`Row ${index + 1}`}
                        secondary={
                          <Box component="span">
                            {Object.entries(row).map(([key, value]) => (
                              <Box key={key} component="span" display="block">
                                <strong>{key}:</strong> {String(value)}
                              </Box>
                            ))}
                          </Box>
                        }
                      />
                    </ListItem>
                    ))}
                  </List>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Import Progress */}
          {importing && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Importing transactions...
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {/* Analysis Progress */}
          {analyzing && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Analyzing file for duplicates...
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {/* Analysis Results */}
          {analysisResult && !importResult && (
            <Box>
              <Alert severity="info" icon={<CheckCircle />}>
                <Typography variant="body2" gutterBottom>
                  <strong>Analysis Complete:</strong>
                </Typography>
                <Typography variant="body2">
                  • Total rows in CSV: {analysisResult.totalRows}
                </Typography>
                <Typography variant="body2">
                  • Rows with mapped accounts: {analysisResult.mappableRows}
                </Typography>
                <Typography variant="body2">
                  • Skipped (unmapped accounts): {analysisResult.skippedRows}
                </Typography>
                {analysisResult.internalDuplicates > 0 && (
                  <Box>
                    <Typography variant="body2" sx={{ mt: 1, fontWeight: 'bold', color: 'warning.main' }}>
                      • Internal duplicates in CSV: {analysisResult.internalDuplicates}
                    </Typography>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        ml: 2, 
                        color: 'primary.main', 
                        textDecoration: 'underline', 
                        cursor: 'pointer',
                        '&:hover': { color: 'primary.dark' }
                      }}
                      onClick={() => setDuplicateResolverOpen(true)}
                    >
                      → Resolve internal duplicates
                    </Typography>
                  </Box>
                )}
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 'bold', color: analysisResult.duplicateCount > 0 ? 'warning.main' : 'success.main' }}>
                  • Already in database: {analysisResult.duplicateCount}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                  • Unique transactions to import: {analysisResult.uniqueCount}
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Import Results */}
          {importResult && (
            <Box>
              <Alert 
                severity={importResult.failed === 0 ? "success" : importResult.success > 0 ? "warning" : "error"}
                icon={importResult.failed === 0 ? <CheckCircle /> : <ErrorIcon />}
              >
                <Typography variant="body2">
                  Import completed: {importResult.success} successful, {importResult.failed} failed, {importResult.skipped} skipped, {importResult.duplicates} duplicates
                </Typography>
              </Alert>
              
              {importResult.errors.length > 0 && (
                <Box mt={2}>
                  <Typography variant="body2" color="error" gutterBottom>
                    Errors:
                  </Typography>
                  <List dense>
                    {importResult.errors.map((error, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={error} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {importResult ? 'Close' : 'Cancel'}
        </Button>
        {!importResult && (
          <>
            <Button 
              onClick={handleAnalyze} 
              variant="outlined" 
              disabled={!canImport || analyzing || importing}
              sx={{ mr: 1 }}
            >
              {analyzing ? 'Analyzing...' : 'Analyze File'}
            </Button>
            <Button 
              onClick={handleImport} 
              variant="contained" 
              disabled={!analysisResult || importing || analyzing}
            >
              {importing ? 'Importing...' : 
               analysisResult 
                 ? `Import ${analysisResult.uniqueCount} Transaction${analysisResult.uniqueCount === 1 ? '' : 's'}`
                 : 'Analyze File First'}
            </Button>
          </>
        )}
      </DialogActions>

      {/* Internal Duplicates Resolver */}
      {analysisResult?.duplicateGroups && (
        <InternalDuplicatesResolver
          open={duplicateResolverOpen}
          onClose={() => setDuplicateResolverOpen(false)}
          duplicateGroups={analysisResult.duplicateGroups}
          onResolve={handleResolveDuplicates}
        />
      )}
    </Dialog>
  );
}