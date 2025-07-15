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
} from '@mui/material';
import { CloudUpload, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import Papa from 'papaparse';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction, Account } from '@/types/database';

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
  selectedAccountId: string | null;
}

export default function CSVImport({ open, onClose, onSuccess }: CSVImportProps) {
  const { 
    addTransaction, 
    accounts, 
    generateTransactionHash,
    getAllTransactionHashes
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
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Function to analyze account column and find matching accounts
  const analyzeAccountColumn = useCallback((data: any[], accountColumn: string) => {
    // Get unique account values from CSV
    const uniqueAccountValues = [...new Set(data.map(row => String(row[accountColumn])))];
    
    console.debug(`Available accounts in database:`, accounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type
    })));
    
    const matches: AccountMatch[] = uniqueAccountValues.map(csvValue => {
      // Extract last 4 digits from CSV value (e.g., "...1682" -> "1682")
      const lastFourMatch = csvValue.match(/(\d{4})$/);
      const lastFour = lastFourMatch ? lastFourMatch[1] : '';
      console.debug(`Analyzing account column: ${csvValue}, extracted last four: "${lastFour}" (type: ${typeof lastFour})`);
      
      // Filter accounts directly here instead of using findAccountsByLastFour
      const matchingAccounts = lastFour ? accounts.filter(account => account.last_four === lastFour) : [];
      console.debug(`Found ${matchingAccounts.length} matching accounts for last four "${lastFour}":`, matchingAccounts);
      
      return {
        csvAccountValue: csvValue,
        lastFourValue: lastFour,
        matchingAccounts,
        selectedAccountId: matchingAccounts.length === 1 ? matchingAccounts[0].id : null,
      };
    });
    
    setAccountMatches(matches);
  }, [accounts]);

  // Clear invalid column mappings when CSV data changes
  useEffect(() => {
    if (csvData.length > 0) {
      const columnHeaders = Object.keys(csvData[0]);
      const updatedMapping = { ...mapping };
      let hasInvalidMappings = false;

      // Check each mapping and clear if invalid
      if (mapping.accountColumn && !columnHeaders.includes(mapping.accountColumn)) {
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
      analyzeAccountColumn(csvData, mapping.accountColumn);
    } else {
      // Clear account matches if no account column is selected
      setAccountMatches([]);
    }
  }, [csvData, mapping.accountColumn, analyzeAccountColumn]);

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

  const updateAccountMapping = (csvValue: string, accountId: string) => {
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
    return data.filter(row => {
      const csvAccountValue = String(row[columnMapping.accountColumn]);
      const accountMapping = accountMappings.find(m => m.csvAccountValue === csvAccountValue);
      return accountMapping?.selectedAccountId; // Only include rows with mapped accounts
    }).map(row => {
      const csvAccountValue = String(row[columnMapping.accountColumn]);
      const accountMapping = accountMappings.find(m => m.csvAccountValue === csvAccountValue);
      const lastFourValue = accountMapping?.lastFourValue || '';
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

  const handleImport = async () => {
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

    for (const { name, value } of requiredMappings) {
      if (!value) {
        setError(`Please select a column for ${name}`);
        return;
      }
      if (!columnHeaders.includes(value)) {
        setError(`Selected ${name} column "${value}" does not exist in the CSV`);
        return;
      }
    }

    // Check if at least one account is mapped
    const mappedAccounts = accountMatches.filter(match => match.selectedAccountId);
    if (mappedAccounts.length === 0) {
      setError('Please map at least one account to import transactions');
      return;
    }

    const unmappedAccounts = accountMatches.filter(match => !match.selectedAccountId);
    if (unmappedAccounts.length > 0) {
      console.warn(`Will skip transactions for unmapped accounts: ${unmappedAccounts.map(m => m.csvAccountValue).join(', ')}`);
    }

    setImporting(true);
    setError(null);

    try {
      const mappedTransactions = mapTransactionsFromCSV(csvData, mapping, accountMatches);
      
      // Calculate skipped transactions (those without account mapping)
      const totalTransactions = csvData.length;
      const mappableTransactions = mappedTransactions.length;
      const initialSkippedCount = totalTransactions - mappableTransactions;
      
      // Grab all transaction hashes from the database to check for duplicates
      const existingHashes = await getAllTransactionHashes();


      let successCount = 0;
      let failedCount = 0;
      let skippedCount = initialSkippedCount; // Start with pre-filtered skipped count
      let duplicateCount = 0;
      const errors: string[] = [];

      for (const { transaction, csvAccountValue, hash } of mappedTransactions) {
        try {
          // Check for duplicates first
          const isDuplicate = existingHashes.includes(hash);
          if (isDuplicate) {
            duplicateCount++;
            continue;
          }

          await addTransaction(transaction);
          successCount++;
        } catch (err) {
          if (err instanceof Error && err.message.includes('No account mapping found')) {
            skippedCount++;
          } else {
            failedCount++;
            errors.push(`Account ${csvAccountValue}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }

      setImportResult({
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
        duplicates: duplicateCount,
        errors: errors.slice(0, 10), // Show first 10 errors
      });

      if (successCount > 0) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import transactions');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
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
    setImportResult(null);
    setError(null);
    onClose();
  };

  const columnOptions = csvData.length > 0 ? Object.keys(csvData[0]) : [];
  
  // Calculate how many transactions can be imported
  const importableTransactions = csvData.length > 0 && mapping.accountColumn && accountMatches.length > 0 
    ? csvData.filter(row => {
        const csvAccountValue = String(row[mapping.accountColumn]);
        const accountMapping = accountMatches.find(m => m.csvAccountValue === csvAccountValue);
        return accountMapping?.selectedAccountId;
      }).length
    : 0;
    
  const skippedTransactions = csvData.length - importableTransactions;

  const canImport = csvData.length > 0 && 
    mapping.accountColumn && columnOptions.includes(mapping.accountColumn) &&
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
            <Box>
              <Typography variant="h6" gutterBottom>
                Map CSV Columns
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Map your CSV columns to transaction fields. All fields are required for proper import.
              </Typography>
              
              {/* Show validation warning if invalid columns are selected */}
              {(mapping.accountColumn && !columnOptions.includes(mapping.accountColumn)) ||
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
          )}

          {/* Account Mapping Helper Message */}
          {csvData.length > 0 && !mapping.accountColumn && (
            <Box>
              <Alert severity="info">
                <Typography variant="body2">
                  Select an &quot;Account Number Column&quot; above to map CSV account numbers to your accounts.
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Account Mapping */}
          {accountMatches.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Map CSV Account Numbers to Your Accounts
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
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
                              {account.name} - {account.type}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Data Preview */}
          {preview.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Preview (First 5 rows)
              </Typography>
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
            </Box>
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
          <Button 
            onClick={handleImport} 
            variant="contained" 
            disabled={!canImport || importing}
          >
            {importing ? 'Importing...' : 
             importableTransactions > 0 
               ? `Import ${importableTransactions} Transaction${importableTransactions === 1 ? '' : 's'}${skippedTransactions > 0 ? ` (${skippedTransactions} will be skipped)` : ''}`
               : 'No transactions to import'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
