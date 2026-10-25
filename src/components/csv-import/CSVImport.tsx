'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { CloudUpload, CheckCircle, Error as ErrorIcon, ExpandMore, InsertDriveFile } from '@mui/icons-material';
import Papa from 'papaparse';
import { Account, AccountCard } from '@/types/database';
import {
  applyAccountSelection,
  applyAccountSkip,
  autoDetectColumnMapping,
  buildAccountPrefillFromCsv,
  buildDuplicateGroups,
  createAccountMatches,
  createHashUpdatesForSelectedDuplicates,
  mapTransactionsFromCSV,
  summarizeAccountResolutions,
  type CSVAccountMatch as AccountMatch,
  type CSVImportAnalysisResult as AnalysisResult,
  type CSVImportColumnMapping as ColumnMapping,
} from '@/lib/csvImportService';
import { useCsvImportSlice } from '@/contexts/useDatabaseSlices';
import { logger } from '@/lib/logging';
import { AccountFormDialog, type AccountFormValues } from '@/components/accounts/AccountFormDialog';
import type { AccountCardInput, AccountFormPrefill } from '@/components/accounts/accountFormModel';
import InternalDuplicatesResolver from './InternalDuplicatesResolver';
import CsvAccountMappingRow, { CSV_ACCOUNT_CREATE_VALUE, CSV_ACCOUNT_SKIP_VALUE } from './CsvAccountMappingRow';
import CsvImportResultSummary, { type CsvImportResult } from './CsvImportResultSummary';

const log = logger.child({ component: 'CSVImport' });

/** Static-mapping Select value that opens the "create account" dialog instead of mapping a column. */
const NEW_ACCOUNT_OPTION = 'NEW_ACCOUNT';

interface CSVImportProps {
  open: boolean;
  onClose: () => void;
  /** Fired when the user dismisses the result summary after at least one row was imported. */
  onSuccess: () => void;
}

/** Which flow opened the inline account dialog, so the created id lands in the right place. */
type CreateAccountTarget =
  | { kind: 'mapping'; csvValue: string }
  | { kind: 'direct' };

const EMPTY_MAPPING: ColumnMapping = {
  accountColumn: '',
  dateColumn: '',
  amountColumn: '',
  descriptionColumn: '',
  uniqueIdentifierColumn: '',
};

export default function CSVImport({ open, onClose, onSuccess }: CSVImportProps) {
  const {
    accounts,
    users,
    addAccountWithCard,
    addUser,
    generateTransactionHash,
    truncateImportTable,
    insertIntoTempTable,
    deleteFromTempTable,
    updateTempTransactionHashes,
    checkDuplicateTransactions,
    bulkInsertFromTempTable,
    createImportBatch,
    finalizeImportBatch,
    findAccountsByLastFour,
    findAccountsByFullNumber,
    getAccountCards,
    runSubscriptionScan,
  } = useCsvImportSlice();

  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [accountMatches, setAccountMatches] = useState<AccountMatch[]>([]);
  const [accountCardsByAccountId, setAccountCardsByAccountId] = useState<Record<number, AccountCard[]>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateResolverOpen, setDuplicateResolverOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateAccountTarget | null>(null);
  const [expandedSections, setExpandedSections] = useState<{
    columnMapping: boolean;
    accountMapping: boolean;
    preview: boolean;
  }>({
    columnMapping: true,
    accountMapping: true,
    preview: true,
  });

  const resetImportState = useCallback(() => {
    setFile(null);
    setCsvData([]);
    setPreview([]);
    setMapping(EMPTY_MAPPING);
    setAccountMatches([]);
    setLoading(false);
    setImporting(false);
    setAnalyzing(false);
    setAnalysisResult(null);
    setImportResult(null);
    setError(null);
    setDuplicateResolverOpen(false);
    setCreateTarget(null);
    setExpandedSections({
      columnMapping: true,
      accountMapping: true,
      preview: true,
    });
  }, []);

  // Reset stale state (e.g. a previous import's success message) whenever the
  // dialog opens, since the parent may close it without routing through
  // handleClose.
  useEffect(() => {
    if (open) {
      resetImportState();
    }
  }, [open, resetImportState]);

  // Function to analyze account column and find matching accounts. Keeps the
  // user's earlier decisions (a linked or skipped value) when it re-runs after
  // the accounts collection refreshes, e.g. after creating an account inline.
  const analyzeAccountColumn = useCallback(async (data: any[], accountColumn: string) => {
    const matches = await createAccountMatches(
      data,
      accountColumn,
      async (lastFour) => {
        const matchingAccounts = await findAccountsByLastFour(lastFour);
        log.debug('Matched CSV account value by last four', {
          operation: 'analyzeAccountColumn',
          lastFour,
          matches: matchingAccounts.length,
        });
        return matchingAccounts;
      },
      async (fullNumber) => {
        const matchingAccounts = await findAccountsByFullNumber(fullNumber);
        log.debug('Matched CSV account value by full number', {
          operation: 'analyzeAccountColumn',
          matches: matchingAccounts.length,
        });
        return matchingAccounts;
      },
      { accounts }
    );

    setAccountMatches((previous) =>
      matches.map((match) => {
        const earlier = previous.find((candidate) => candidate.csvAccountValue === match.csvAccountValue);
        if (earlier && (earlier.selectedAccountId || earlier.skipped)) {
          return {
            ...match,
            selectedAccountId: earlier.selectedAccountId,
            selectedCardId: earlier.selectedCardId ?? null,
            skipped: earlier.skipped,
          };
        }
        return {
          ...match,
          selectedCardId: match.selectedAccountId
            ? accountCardsByAccountId[match.selectedAccountId]?.find((card) => card.last_four === match.lastFourValue)?.id ?? null
            : null,
        };
      })
    );
  }, [accounts, accountCardsByAccountId, findAccountsByLastFour, findAccountsByFullNumber]);

  // Preload all account cards when dialog opens (and again after an inline creation refreshes accounts)
  useEffect(() => {
    if (open && accounts.length > 0) {
      const loadAllCards = async () => {
        const cardsByAccount: Record<number, AccountCard[]> = {};
        for (const account of accounts) {
          try {
            const cards = await getAccountCards(account.id);
            cardsByAccount[account.id] = cards;
          } catch (loadError) {
            log.error('Failed to load cards for account', {
              operation: 'loadAccountCards',
              accountId: account.id,
              error: loadError,
            });
            cardsByAccount[account.id] = [];
          }
        }
        setAccountCardsByAccountId(cardsByAccount);
      };
      loadAllCards();
    }
  }, [open, accounts, getAccountCards]);

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
            hintedAccounts: [],
            selectedAccountId: accountId,
            selectedCardId: accountCardsByAccountId[accountId]?.[0]?.id ?? null,
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
  }, [csvData, mapping.accountColumn, accounts, accountCardsByAccountId, analyzeAccountColumn]);

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
          error: (parseError: any) => reject(parseError)
        });
      });

      setCsvData(result);
      setPreview(result.slice(0, 5)); // Show first 5 rows for preview

      // Auto-detect common column mappings
      if (result.length > 0) {
        const headers = Object.keys(result[0]);
        setMapping(autoDetectColumnMapping(headers));
        // Don't automatically analyze account column - let user select it first
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
    } finally {
      setLoading(false);
    }
  };

  const updateAccountMapping = useCallback((csvValue: string, accountId: number, cardId?: number | null) => {
    setAccountMatches((prev) => {
      const match = prev.find((candidate) => candidate.csvAccountValue === csvValue);
      const resolvedCardId = cardId
        ?? accountCardsByAccountId[accountId]?.find((card) => card.last_four === match?.lastFourValue)?.id
        ?? accountCardsByAccountId[accountId]?.[0]?.id
        ?? null;
      return applyAccountSelection(prev, csvValue, accountId, resolvedCardId);
    });
  }, [accountCardsByAccountId]);

  const skipAccountMapping = useCallback((csvValue: string) => {
    setAccountMatches((prev) => applyAccountSkip(prev, csvValue));
  }, []);

  const markAccountUnresolved = useCallback((csvValue: string) => {
    setAccountMatches((prev) =>
      prev.map((match) =>
        match.csvAccountValue === csvValue
          ? { ...match, selectedAccountId: null, selectedCardId: null, skipped: false }
          : match
      )
    );
  }, []);

  // --- Inline account creation (mapping rows and the static "New account…" option) ---

  const createPrefill = useMemo<AccountFormPrefill | undefined>(() => {
    if (!createTarget) return undefined;
    if (createTarget.kind === 'mapping') {
      const prefill = buildAccountPrefillFromCsv(createTarget.csvValue, file?.name);
      return {
        name: prefill.name,
        institution: prefill.institution,
        cardNumberInput: prefill.cardNumberInput,
      };
    }
    return { institution: buildAccountPrefillFromCsv('', file?.name).institution };
  }, [createTarget, file]);

  const handleStaticAccountColumnChange = (value: string) => {
    if (value === NEW_ACCOUNT_OPTION) {
      setCreateTarget({ kind: 'direct' });
      return;
    }
    setMapping({ ...mapping, accountColumn: value });
  };

  const handleAddAccount = useCallback(
    (account: AccountFormValues, ownerUserId: number, card: AccountCardInput) =>
      addAccountWithCard(account, ownerUserId, card),
    [addAccountWithCard]
  );

  const handleAddUser = useCallback(
    (displayName: string) => addUser({ display_name: displayName }),
    [addUser]
  );

  // `addAccountWithCard` awaits the accounts refresh before resolving, so by the
  // time this runs the new account is in `accounts` and a DIRECT_ACCOUNT mapping
  // or a per-value selection resolves against it.
  const handleAccountCreated = useCallback(({ accountId, cardId }: { accountId: number; cardId: number }) => {
    if (!createTarget) return;
    log.info('Created account from CSV import', {
      operation: 'createAccountInline',
      accountId,
      target: createTarget.kind,
    });
    if (createTarget.kind === 'mapping') {
      updateAccountMapping(createTarget.csvValue, accountId, cardId);
    } else {
      setMapping((prev) => ({ ...prev, accountColumn: `DIRECT_ACCOUNT:${accountId}` }));
    }
    setError(null);
  }, [createTarget, updateAccountMapping]);

  const handleUpdateAccountUnsupported = useCallback(async () => {
    throw new Error('Editing accounts is not available during import');
  }, []);

  const toggleSection = (section: 'columnMapping' | 'accountMapping' | 'preview') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleResolveDuplicates = async (selectedIndices: Set<number>) => {
    if (!analysisResult || !analysisResult.duplicateGroups) return;

    setDuplicateResolverOpen(false);

    // Apply updates and deletions
    try {
      const { hashUpdates, tempIdsToDelete } = await createHashUpdatesForSelectedDuplicates(
        analysisResult.duplicateGroups,
        selectedIndices,
        generateTransactionHash
      );

      // Update hashes for varied transactions
      if (hashUpdates.length > 0) {
        await updateTempTransactionHashes(hashUpdates);
      }

      // Delete excluded transactions from temp table
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
      const { mapped: mappedTransactions, rejected } = await mapTransactionsFromCSV(
        csvData,
        mapping,
        accountMatches,
        generateTransactionHash
      );

      const totalRows = csvData.length;
      const mappableRows = mappedTransactions.length;
      const skippedRows = totalRows - mappableRows - rejected.length;

      // Insert ALL mapped transactions into temp table
      await truncateImportTable();
      const allTransactions = mappedTransactions.map(m => m.transaction);
      const tempIds = await insertIntoTempTable(allTransactions);
      const { duplicateGroups, internalDuplicateCount } = buildDuplicateGroups(
        mappedTransactions,
        tempIds
      );

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
        rejectedRows: rejected,
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
    const opLog = log.withOperation('importRows');

    try {
      // Record the import run first so every inserted row can point at it
      // (data freshness, "undo this import").
      const batchId = await createImportBatch({
        source: 'csv',
        file_name: file?.name ?? null,
        account_ids: accountMatches
          .map((match) => match.selectedAccountId)
          .filter((id): id is number => id != null),
        total_rows: csvData.length,
      });

      // Bulk insert from temp table (excludes duplicates)
      const successCount = await bulkInsertFromTempTable(batchId);

      await finalizeImportBatch(batchId, {
        inserted_count: successCount,
        duplicate_count: analysisResult.duplicateCount,
        skipped_count: analysisResult.skippedRows,
        rejected_count: analysisResult.rejectedRows.length,
      });

      // Clean up import table after successful import
      await truncateImportTable();

      // Assign merchants and refresh recurring-subscription detection for the
      // newly imported rows (they are exactly the company_id IS NULL set).
      // Non-fatal: the import itself already succeeded.
      if (successCount > 0) {
        try {
          await runSubscriptionScan();
        } catch (scanError) {
          opLog.warn('Post-import subscription scan failed', { error: scanError });
        }
      }

      opLog.info('CSV import finished', {
        batchId,
        inserted: successCount,
        duplicates: analysisResult.duplicateCount,
        skipped: analysisResult.skippedRows,
        rejected: analysisResult.rejectedRows.length,
      });

      // The summary stays on screen; `onSuccess` fires when the user dismisses it.
      setImportResult({
        inserted: successCount,
        duplicates: analysisResult.duplicateCount,
        skipped: analysisResult.skippedRows,
        rejected: analysisResult.rejectedRows.length,
        errors: analysisResult.rejectedRows.map((row) => `Row ${row.rowNumber}: ${row.reason}`),
      });
    } catch (err) {
      opLog.error('CSV import failed', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to import transactions');
      // Clean up import table on error
      await truncateImportTable();
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    const importedRows = importResult?.inserted ?? 0;

    // Clear import table when closing modal
    truncateImportTable().catch((truncateError) =>
      log.error('Error clearing import table on close', { operation: 'close', error: truncateError })
    );

    resetImportState();
    if (importedRows > 0) {
      onSuccess();
    }
    onClose();
  };

  const columnOptions = csvData.length > 0 ? Object.keys(csvData[0]) : [];

  const isDirectMapping = mapping.accountColumn.startsWith('DIRECT_ACCOUNT:');
  const resolution = summarizeAccountResolutions(csvData, mapping, accountMatches);
  const importableTransactions = resolution.importableRows;

  const canImport = csvData.length > 0 &&
    mapping.accountColumn && (isDirectMapping || columnOptions.includes(mapping.accountColumn)) &&
    mapping.dateColumn && columnOptions.includes(mapping.dateColumn) &&
    mapping.amountColumn && columnOptions.includes(mapping.amountColumn) &&
    mapping.descriptionColumn && columnOptions.includes(mapping.descriptionColumn) &&
    importableTransactions > 0 &&
    resolution.unresolvedRows === 0;

  const accountDisplayName = (account: Account) =>
    account.owner_display_name ? `${account.owner_display_name} - ${account.name}` : account.name;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Transactions from CSV</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={3}>
          {/* File Upload. Once the import has run the file is fixed: show it read-only. */}
          {importResult ? (
            <Box
              data-testid="csv-import-file-readonly"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.5,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                color: 'text.secondary',
              }}
            >
              <InsertDriveFile fontSize="small" />
              <Typography variant="body1" noWrap>
                {file?.name ?? 'CSV file'}
              </Typography>
            </Box>
          ) : (
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
          )}

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
          {csvData.length > 0 && !loading && !importResult && (
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
              {(mapping.accountColumn && !isDirectMapping && !columnOptions.includes(mapping.accountColumn)) ||
               (mapping.dateColumn && !columnOptions.includes(mapping.dateColumn)) ||
               (mapping.amountColumn && !columnOptions.includes(mapping.amountColumn)) ||
               (mapping.descriptionColumn && !columnOptions.includes(mapping.descriptionColumn)) ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Some selected columns don&apos;t exist in your CSV. Please reselect the correct columns from the dropdown.
                </Alert>
              ) : null}

              <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2} mt={2}>
                <FormControl fullWidth required>
                  <InputLabel id="csv-account-column-label">Account Number Column</InputLabel>
                  <Select
                    labelId="csv-account-column-label"
                    value={mapping.accountColumn}
                    label="Account Number Column"
                    onChange={(e) => handleStaticAccountColumnChange(e.target.value)}
                    SelectDisplayProps={{ 'data-testid': 'csv-account-column-select' } as React.HTMLAttributes<HTMLDivElement>}
                  >
                    {columnOptions.map(col => (
                      <MenuItem key={col} value={col}>{col}</MenuItem>
                    ))}
                    {columnOptions.length > 0 && (
                      <MenuItem disabled sx={{ opacity: 0.6, fontWeight: 'bold' }}>
                        ─────── Or Select Account ───────
                      </MenuItem>
                    )}
                    {accounts.map(account => {
                      const cards = accountCardsByAccountId[account.id] || [];
                      const lastFour = cards.length > 0 ? cards[0].last_four : null;
                      return (
                        <MenuItem key={`account-${account.id}`} value={`DIRECT_ACCOUNT:${account.id}`}>
                          {accountDisplayName(account)}{lastFour ? ` - ${lastFour}` : ''}
                        </MenuItem>
                      );
                    })}
                    {columnOptions.length > 0 && (
                      <MenuItem value={NEW_ACCOUNT_OPTION} sx={{ fontStyle: 'italic' }}>
                        New account…
                      </MenuItem>
                    )}
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
          {csvData.length > 0 && !mapping.accountColumn && !importResult && (
            <Box>
              <Alert severity="info">
                <Typography variant="body2">
                  Select an &quot;Account Number Column&quot; from your CSV, or choose an account directly if all transactions belong to one account.
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Direct Account Selection Confirmation */}
          {csvData.length > 0 && isDirectMapping && !importResult && (
            <Box>
              <Alert severity="success">
                <Typography variant="body2">
                  All transactions will be imported to: <strong>
                    {(() => {
                      const accountId = parseInt(mapping.accountColumn.replace('DIRECT_ACCOUNT:', ''));
                      const account = accounts.find(acc => acc.id === accountId);
                      return account ? accountDisplayName(account) : 'Unknown Account';
                    })()}
                  </strong>
                </Typography>
              </Alert>
            </Box>
          )}

          {/* Account Mapping */}
          {accountMatches.length > 0 && !isDirectMapping && !importResult && (
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
                    Select which of your accounts corresponds to each account number found in the CSV,
                    create the account if it is not in the app yet, or skip it.
                  </Typography>

                  <Box sx={{ mt: 1 }}>
                    {accountMatches.map((match, index) => (
                      <CsvAccountMappingRow
                        key={match.csvAccountValue}
                        index={index}
                        match={match}
                        accounts={accounts}
                        rowCount={csvData.filter((row) => String(row[mapping.accountColumn]) === match.csvAccountValue).length}
                        onSelectAccount={(accountId) => updateAccountMapping(match.csvAccountValue, accountId)}
                        onSkip={() => skipAccountMapping(match.csvAccountValue)}
                        onUnresolve={() => markAccountUnresolved(match.csvAccountValue)}
                        onCreate={() => setCreateTarget({ kind: 'mapping', csvValue: match.csvAccountValue })}
                      />
                    ))}
                  </Box>

                  {/* Row accounting before Analyze: nothing is skipped silently. */}
                  <Alert
                    severity={resolution.unresolvedRows > 0 ? 'warning' : resolution.skippedRows > 0 ? 'info' : 'success'}
                    data-testid="csv-account-resolution-summary"
                  >
                    <Typography variant="body2">
                      {resolution.importableRows} of {resolution.totalRows} rows will be imported
                      {resolution.skippedRows > 0 && (
                        <>
                          {' '}· {resolution.skippedRows} row{resolution.skippedRows === 1 ? '' : 's'} will be skipped
                          {' '}({resolution.skippedValues.join(', ')})
                        </>
                      )}
                      .
                    </Typography>
                    {resolution.unresolvedRows > 0 && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {resolution.unresolvedValues.length === 1
                          ? `Account "${resolution.unresolvedValues[0]}" is not linked yet`
                          : `${resolution.unresolvedValues.length} CSV accounts are not linked yet`}
                        {' '}({resolution.unresolvedRows} row{resolution.unresolvedRows === 1 ? '' : 's'}).
                        Create or choose an account for each, or pick &quot;Skip this account&quot;, before analyzing.
                      </Typography>
                    )}
                  </Alert>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Data Preview */}
          {preview.length > 0 && !importResult && (
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
                {analysisResult.rejectedRows.length > 0 && (
                  <Box>
                    <Typography variant="body2" sx={{ mt: 1, fontWeight: 'bold', color: 'error.main' }}>
                      • Rows that could not be read: {analysisResult.rejectedRows.length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 2, display: 'block' }}>
                      These rows will not be imported. Fix the date or amount in the CSV and import again.
                    </Typography>
                    <List dense disablePadding sx={{ ml: 2, maxHeight: 160, overflow: 'auto' }}>
                      {analysisResult.rejectedRows.slice(0, 20).map((row) => (
                        <ListItem key={row.rowNumber} disableGutters sx={{ py: 0 }}>
                          <ListItemText
                            primaryTypographyProps={{ variant: 'caption' }}
                            primary={`Row ${row.rowNumber}: ${row.reason}`}
                          />
                        </ListItem>
                      ))}
                      {analysisResult.rejectedRows.length > 20 && (
                        <ListItem disableGutters sx={{ py: 0 }}>
                          <ListItemText
                            primaryTypographyProps={{ variant: 'caption' }}
                            primary={`…and ${analysisResult.rejectedRows.length - 20} more`}
                          />
                        </ListItem>
                      )}
                    </List>
                  </Box>
                )}
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

          {/* Import Results: stays visible until the user closes the dialog. */}
          {importResult && <CsvImportResultSummary result={importResult} fileName={file?.name ?? null} />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} data-testid="csv-import-close">
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

      {/* Inline account creation (per CSV value, or for the whole file) */}
      <AccountFormDialog
        open={createTarget !== null}
        editingAccount={null}
        users={users}
        initialValues={createPrefill}
        onClose={() => setCreateTarget(null)}
        onAdd={handleAddAccount}
        onUpdate={handleUpdateAccountUnsupported}
        onCreated={handleAccountCreated}
        onAddUser={handleAddUser}
      />
    </Dialog>
  );
}

export { CSV_ACCOUNT_CREATE_VALUE, CSV_ACCOUNT_SKIP_VALUE, NEW_ACCOUNT_OPTION };
