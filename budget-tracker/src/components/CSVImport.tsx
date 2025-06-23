'use client';

import React, { useState } from 'react';
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
  List,  ListItem,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { CloudUpload, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import Papa from 'papaparse';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction } from '@/lib/database';

interface CSVImportProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

export default function CSVImport({ open, onClose, onSuccess }: CSVImportProps) {
  const { db } = useDatabaseContext();
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [mapping, setMapping] = useState({
    dateColumn: '',
    amountColumn: '',
    descriptionColumn: '',
    categoryColumn: '',
  });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        const headers = Object.keys(result[0]).map(h => h.toLowerCase());
        
        setMapping({
          dateColumn: headers.find(h => h.includes('date') || h.includes('time')) || '',
          amountColumn: headers.find(h => h.includes('amount') || h.includes('debit') || h.includes('credit')) || '',
          descriptionColumn: headers.find(h => h.includes('description') || h.includes('memo') || h.includes('detail')) || '',
          categoryColumn: headers.find(h => h.includes('category') || h.includes('type')) || '',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
    } finally {
      setLoading(false);
    }
  };  const mapTransactionsFromCSV = (data: any[], columnMapping: {
    dateColumn: string;
    amountColumn: string;
    descriptionColumn: string;
    categoryColumn: string;
  }): Omit<Transaction, 'id' | 'created_at' | 'updated_at'>[] => {
    return data.map(row => {
      const dateStr = row[columnMapping.dateColumn];
      const amountStr = String(row[columnMapping.amountColumn]);
      const description = String(row[columnMapping.descriptionColumn]);
      
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
      
      return {
        date,
        amount: Math.abs(amount) * (type === 'expense' ? -1 : 1),
        description: description || 'Imported transaction',
        category_id: 'cat-1', // Default category
        company_id: undefined,
        account_last_four: '0000', // Default
        type,
      };
    });
  };

  const handleImport = async () => {
    if (!db || !csvData.length || !mapping.dateColumn || !mapping.amountColumn || !mapping.descriptionColumn) {
      setError('Please ensure database is loaded and required columns are mapped');
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const mappedTransactions = mapTransactionsFromCSV(csvData, mapping);
      
      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const transaction of mappedTransactions) {
        try {
          await db.addTransaction(transaction);
          successCount++;
        } catch (err) {
          failedCount++;
          errors.push(`Row ${mappedTransactions.indexOf(transaction) + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      setImportResult({
        success: successCount,
        failed: failedCount,
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
      dateColumn: '',
      amountColumn: '',
      descriptionColumn: '',
      categoryColumn: '',
    });
    setLoading(false);
    setImporting(false);
    setImportResult(null);
    setError(null);
    onClose();
  };

  const canImport = mapping.dateColumn && mapping.amountColumn && mapping.descriptionColumn && csvData.length > 0;
  const columnOptions = csvData.length > 0 ? Object.keys(csvData[0]) : [];

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
                Map your CSV columns to transaction fields. Date, Amount, and Description are required.
              </Typography>
              
              <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2} mt={2}>
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
                  <InputLabel>Category Column (Optional)</InputLabel>
                  <Select
                    value={mapping.categoryColumn}
                    label="Category Column (Optional)"
                    onChange={(e) => setMapping({ ...mapping, categoryColumn: e.target.value })}
                  >
                    <MenuItem value="">None</MenuItem>
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
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
                  Import completed: {importResult.success} successful, {importResult.failed} failed
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
            {importing ? 'Importing...' : `Import ${csvData.length} Transactions`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
