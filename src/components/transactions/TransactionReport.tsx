'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Box,
  Typography,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Button,
  Card,
  CardContent,
  IconButton,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Collapse,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
  useMediaQuery,
  useTheme,
  CircularProgress,
} from '@mui/material';
import {
  AutoFixHigh,
  FilterList,
  ClearAll,
  Download,
  EditNote,
  ExpandMore,
  MoreVert,
  Receipt,
  Rule,
  ViewColumn,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import type { GridColDef, GridColumnVisibilityModel, GridPaginationModel, GridRowSelectionModel, GridSortModel } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, categoryChipColumn, currencyColumn, dateColumn, indicatorsColumn, userColumn } from '@/components/common/DataGrid/columns';
import { useLongPress } from '@/components/common/DataGrid/useLongPress';
import { useOptionalLocale } from '@/contexts/LocaleContext';
import { useFormatters } from '@/contexts/useFormatters';
import { useClassificationRulesSlice, useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import type { ClassificationScanSummary } from '@/types/classification';
import ClassificationRulesDialog from './ClassificationRulesDialog';
import TransactionLabelDialog from './TransactionLabelDialog';
import TransactionRowActionsMenu from './TransactionRowActionsMenu';
import TransactionBulkActionsBar, { BulkActionKind } from './TransactionBulkActionsBar';
import BulkSetCategoryDialog from './BulkSetCategoryDialog';
import BulkSetCompanyDialog from './BulkSetCompanyDialog';
import BulkSetProjectDialog from './BulkSetProjectDialog';
import BulkSubscriptionLinkDialog from './BulkSubscriptionLinkDialog';
import { Transaction, TransactionType, Category, Company, Account, TransactionsPaginatedResult, User } from '@/types/database';
import { format } from 'date-fns';

type Order = 'asc' | 'desc';

const GRID_FIELD_TO_VISIBLE_COLUMN_KEY = {
  date: 'date',
  description: 'description',
  comment: 'comment',
  commentIndicator: 'commentIndicator',
  category_name: 'category',
  company_name: 'company',
  service_name: 'service',
  project_name: 'project',
  label: 'label',
  effective_user_name: 'user',
  account_name: 'account',
  card_last_four: 'card',
  indicators: 'indicators',
  amount: 'amount',
  actions: 'actions',
} as const;

export default function TransactionReport() {
  const { t } = useTranslation(['transactions', 'common']);
  const {
    transactionVersion,
    budgetVersion,
    categories,
    companies,
    projects,
    accounts,
    users = [],
    recurringSeries = [],
    getTransactionsPaginated,
    getTransactionsForExport,
    setTransactionComment,
    getEffectiveBudgetPlan,
  } = useTransactionReportSlice();
  const {
    classificationRules,
    addClassificationRule,
    updateClassificationRule,
    deleteClassificationRule,
    previewClassificationRuleMatches,
    runClassificationScan,
    countTypeReviews,
  } = useClassificationRulesSlice();

  // Transaction typing: rules dialog, on-demand scan, rows awaiting review.
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [scanSummary, setScanSummary] = useState<ClassificationScanSummary | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  const [companyFilter, setCompanyFilter] = useState<number[]>([]);
  const [projectFilter, setProjectFilter] = useState<number[]>([]);
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [userFilter, setUserFilter] = useState<number[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [missingCategory, setMissingCategory] = useState(false);
  const [missingCompany, setMissingCompany] = useState(false);
  const [missingProject, setMissingProject] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [needsTypeReview, setNeedsTypeReview] = useState(false);

  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [orderBy, setOrderBy] = useState<string>('date');
  const [order, setOrder] = useState<Order>('desc');

  // Results
  const [result, setResult] = useState<TransactionsPaginatedResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Dialog
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentTransaction, setCommentTransaction] = useState<Transaction | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  // Opened from the row's kebab (anchorEl) or from a right-click / long-press (anchorPosition).
  const [quickActions, setQuickActions] = useState<{
    anchorEl?: HTMLElement | null;
    anchorPosition?: { top: number; left: number } | null;
    transaction: Transaction;
  } | null>(null);

  // Bulk selection + actions
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  });
  const selectedIds = React.useMemo(() => Array.from(rowSelectionModel.ids) as number[], [rowSelectionModel]);
  const [bulkAction, setBulkAction] = useState<BulkActionKind | null>(null);

  // Column visibility
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Grid fills remaining viewport height below the filters/summary sections
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const [gridHeight, setGridHeight] = useState(640);
  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    description: true,
    commentIndicator: true,
    comment: true,
    category: true,
    company: true,
    service: true,
    project: true,
    label: true,
    user: true,
    amount: true,
    account: true,
    card: true,
    indicators: true,
    actions: true,
  });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    if (isMobile) {
      setVisibleColumns(prev => ({ ...prev, category: false, company: false, service: false, project: false, label: false, account: false, user: false, card: false, indicators: false }));
    }
  }, [isMobile]);

  useEffect(() => {
    const updateGridHeight = () => {
      const node = gridWrapperRef.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      const available = window.innerHeight - top - 24;
      setGridHeight(Math.max(available, 400));
    };
    updateGridHeight();
    // Re-measure after the filters/column-controls collapse animation settles.
    const timeout = setTimeout(updateGridHeight, 350);
    window.addEventListener('resize', updateGridHeight);
    return () => {
      window.removeEventListener('resize', updateGridHeight);
      clearTimeout(timeout);
    };
  }, [filtersExpanded, showColumnControls, isMobile, loading]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page when filters change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setPage(0);
  }, [debouncedSearch, typeFilter, categoryFilter, companyFilter, projectFilter, accountFilter, userFilter, startDate, endDate, minAmount, maxAmount, missingCategory, missingCompany, missingProject, flaggedOnly, includeExcluded, needsTypeReview, rowsPerPage]);

  // How many rows carry an automatic, unconfirmed type (drives the review banner).
  useEffect(() => {
    let cancelled = false;
    countTypeReviews()
      .then((count) => {
        if (!cancelled) setReviewCount(count);
      })
      .catch((err) => console.error('Failed to count transactions needing type review:', err));
    return () => { cancelled = true; };
  }, [transactionVersion, countTypeReviews]);

  const handleAutoClassify = async () => {
    setClassifying(true);
    setScanError(null);
    try {
      setScanSummary(await runClassificationScan());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : t('report.autoClassifyFailed'));
    } finally {
      setClassifying(false);
    }
  };

  // Fetch from DB whenever page/filters/sort/version change
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      try {
        const data = await getTransactionsPaginated({
          page,
          pageSize: rowsPerPage,
          sortBy: orderBy,
          sortOrder: order,
          search: debouncedSearch || undefined,
          type: typeFilter === 'all' ? undefined : typeFilter,
          categoryIds: categoryFilter.length > 0 ? categoryFilter : undefined,
          companyIds: companyFilter.length > 0 ? companyFilter : undefined,
          projectIds: projectFilter.length > 0 ? projectFilter : undefined,
          accountIds: accountFilter.length > 0 ? accountFilter : undefined,
          userIds: userFilter.length > 0 ? userFilter : undefined,
          startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
          endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
          minAmount: minAmount ? parseFloat(minAmount) : undefined,
          maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
          missingCategory: missingCategory || undefined,
          missingCompany: missingCompany || undefined,
          missingProject: missingProject || undefined,
          flaggedOnly: flaggedOnly || undefined,
          includeExcluded: includeExcluded || undefined,
          needsTypeReview: needsTypeReview || undefined,
        });
        if (!cancelled) setResult(data);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [transactionVersion, page, rowsPerPage, orderBy, order, debouncedSearch, typeFilter, categoryFilter, companyFilter, projectFilter, accountFilter, userFilter, startDate, endDate, minAmount, maxAmount, missingCategory, missingCompany, missingProject, flaggedOnly, includeExcluded, needsTypeReview, getTransactionsPaginated]);

  const columnLabels = {
    date: t('common:fields.date'), description: t('common:fields.description'), comment: t('common:fields.comment'), category: t('common:fields.category'),
    commentIndicator: t('report.columns.hasComment'), company: t('common:fields.company'), service: t('report.columns.service'), project: t('common:fields.project'), label: t('report.columns.label'),
    user: t('common:fields.user'), amount: t('common:fields.amount'), account: t('common:fields.account'), card: t('common:fields.card'),
    indicators: t('report.columns.indicators'), actions: t('common:fields.actions'),
  };

  const handleColumnToggle = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
    setPage(0);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setCategoryFilter([]);
    setCompanyFilter([]);
    setProjectFilter([]);
    setAccountFilter([]);
    setUserFilter([]);
    setStartDate(null);
    setEndDate(null);
    setMinAmount('');
    setMaxAmount('');
    setMissingCategory(false);
    setMissingCompany(false);
    setMissingProject(false);
    setFlaggedOnly(false);
    setIncludeExcluded(false);
    setNeedsTypeReview(false);
    setPage(0);
  };

  const handleLabelTransaction = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setLabelDialogOpen(true);
  };

  const handleOpenCommentDialog = (transaction: Transaction) => {
    setCommentTransaction(transaction);
    setCommentDraft(transaction.comment || '');
    setCommentDialogOpen(true);
  };

  const handleSaveComment = async () => {
    if (!commentTransaction) return;
    await setTransactionComment(commentTransaction.id, commentDraft);
    setCommentDialogOpen(false);
    setCommentTransaction(null);
    setCommentDraft('');
  };

  const handleExportCSV = async () => {
    try {
      const rows = await getTransactionsForExport({
        sortBy: orderBy,
        sortOrder: order,
        search: debouncedSearch || undefined,
        type: typeFilter === 'all' ? undefined : typeFilter,
        categoryIds: categoryFilter.length > 0 ? categoryFilter : undefined,
        companyIds: companyFilter.length > 0 ? companyFilter : undefined,
        projectIds: projectFilter.length > 0 ? projectFilter : undefined,
        accountIds: accountFilter.length > 0 ? accountFilter : undefined,
        userIds: userFilter.length > 0 ? userFilter : undefined,
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
        missingCategory: missingCategory || undefined,
        missingCompany: missingCompany || undefined,
        missingProject: missingProject || undefined,
        flaggedOnly: flaggedOnly || undefined,
        includeExcluded: includeExcluded || undefined,
        needsTypeReview: needsTypeReview || undefined,
      });

      const headers = Object.entries(columnLabels)
        .filter(([key]) => visibleColumns[key as keyof typeof visibleColumns] && key !== 'actions' && key !== 'label')
        .map(([, label]) => label);

      const yesLabel = t('common:actions.yes');
      const noLabel = t('common:actions.no');
      const csvData = rows.map((t: Transaction) => {
        const row: string[] = [];
        if (visibleColumns.date) row.push(t.date);
        if (visibleColumns.description) row.push(t.description);
        if (visibleColumns.comment) row.push(t.comment || '');
        if (visibleColumns.commentIndicator) row.push(t.comment?.trim() ? yesLabel : noLabel);
        if (visibleColumns.category) row.push(t.category_name || '');
        if (visibleColumns.company) row.push(t.company_name || '');
        if (visibleColumns.service) row.push(t.service_name || '');
        if (visibleColumns.project) row.push(t.project_name || '');
        if (visibleColumns.amount) row.push(Math.abs(t.amount).toString());
        if (visibleColumns.user) row.push(t.effective_user_name || '');
        if (visibleColumns.account) row.push(t.account_name || '');
        if (visibleColumns.card) row.push(t.card_last_four || '');
        return row;
      });

      const csvContent = [headers, ...csvData]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transaction-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  const { money, date, number } = useFormatters();
  const dateFnsLocale = useOptionalLocale()?.dateFnsLocale;
  const formatCurrency = useCallback((amount: number, currency?: string | null) => money(amount, currency), [money]);

  const renderTransactionLabel = useCallback((transaction: Transaction) => {
    if (transaction.project_id && transaction.project_name) {
      return <Chip label={t('report.projectChip', { name: transaction.project_name })} color="primary" size="small" variant="outlined" />;
    }
    if (transaction.trip_id && transaction.trip_name) {
      return <Chip label={t('report.tripChip', { name: transaction.trip_name })} color="secondary" size="small" variant="outlined" />;
    }
    return null;
  }, [t]);

  // Categories with a threshold in the budget plan effective this month —
  // drives the Budget chip in the indicators column.
  const [budgetedCategoryIds, setBudgetedCategoryIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    getEffectiveBudgetPlan(format(new Date(), 'yyyy-MM'))
      .then((plan) => {
        if (!cancelled) {
          setBudgetedCategoryIds(new Set((plan?.categories ?? []).map((c) => c.category_id)));
        }
      })
      .catch((err) => console.error('Failed to load effective budget plan:', err));
    return () => { cancelled = true; };
  }, [budgetVersion, getEffectiveBudgetPlan]);

  const gridColumns = React.useMemo<GridColDef<Transaction>[]>(() => [
    {
      ...dateColumn<Transaction>('date', t('common:fields.date'), (value) => date(value)),
      flex: 0.65,
    },
    {
      field: 'description',
      headerName: t('common:fields.description'),
      flex: 1.5,
      minWidth: 220,
    },
    {
      field: 'comment',
      headerName: t('common:fields.comment'),
      flex: 1,
      minWidth: 180,
      valueGetter: (_, row) => row.comment || '',
    },
    {
      field: 'commentIndicator',
      headerName: t('report.columns.hasComment'),
      minWidth: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const hasComment = !!params.row.comment?.trim();
        return <Chip label={hasComment ? t('common:actions.yes') : t('common:actions.no')} color={hasComment ? 'success' : 'default'} size="small" variant="outlined" />;
      },
    },
    categoryChipColumn<Transaction>('category_name', { headerName: t('common:fields.category'), uncategorized: t('report.uncategorized') }),
    {
      field: 'company_name',
      headerName: t('common:fields.company'),
      minWidth: 160,
      flex: 0.75,
      valueGetter: (_, row) => row.company_name || '',
    },
    {
      field: 'service_name',
      headerName: t('report.columns.service'),
      minWidth: 160,
      flex: 0.75,
      valueGetter: (_, row) => row.service_name || '',
    },
    {
      field: 'project_name',
      headerName: t('common:fields.project'),
      minWidth: 160,
      flex: 0.8,
      valueGetter: (_, row) => row.project_name || '',
    },
    {
      field: 'label',
      headerName: t('report.columns.label'),
      minWidth: 160,
      sortable: false,
      filterable: false,
      renderCell: (params) => renderTransactionLabel(params.row),
    },
    userColumn<Transaction>({
      headerName: t('common:fields.user'),
      owner: t('report.owner'),
      effectiveUser: t('report.effectiveUser'),
      unassigned: t('report.unassigned'),
    }),
    accountColumn<Transaction>({
      headerName: t('common:fields.account'),
      owner: t('report.owner'),
      unknownAccount: t('report.unknownAccount'),
    }),
    cardColumn<Transaction>({ headerName: t('common:fields.card'), noCard: t('report.noCard') }),
    indicatorsColumn(budgetedCategoryIds, {
      headerName: t('report.columns.indicators'),
      flagged: t('report.indicators.flagged'),
      excluded: t('report.indicators.excluded'),
      refund: t('report.indicators.refund'),
      refundUnconfirmed: t('report.indicators.refundUnconfirmed'),
      transfer: t('report.indicators.transfer'),
      transferUnconfirmed: t('report.indicators.transferUnconfirmed'),
      budget: t('report.indicators.budget'),
      trip: t('report.indicators.trip'),
      project: t('report.indicators.project'),
      series: t('report.indicators.series'),
      card: t('report.indicators.card'),
    }),
    currencyColumn<Transaction>('amount', money, { headerName: t('common:fields.amount'), currencyOf: (row) => row.account_currency }),
    {
      field: 'actions',
      headerName: t('common:fields.actions'),
      minWidth: 130,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} justifyContent="center">
          <IconButton size="small" onClick={() => handleOpenCommentDialog(params.row)} title={t('report.editComment')}>
            <EditNote fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleLabelTransaction(params.row)} title={t('report.labelTransaction')}>
            <Receipt fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={(event) =>
              setQuickActions({ anchorEl: event.currentTarget, transaction: params.row })
            }
            title={t('report.moreActions')}
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ], [budgetedCategoryIds, money, date, t, renderTransactionLabel]);

  const columnVisibilityModel = React.useMemo(() => ({
    date: visibleColumns.date,
    description: visibleColumns.description,
    comment: visibleColumns.comment,
    commentIndicator: visibleColumns.commentIndicator,
    category_name: visibleColumns.category,
    company_name: visibleColumns.company,
    service_name: visibleColumns.service,
    project_name: visibleColumns.project,
    label: visibleColumns.label,
    effective_user_name: visibleColumns.user,
    account_name: visibleColumns.account,
    card_last_four: visibleColumns.card,
    indicators: visibleColumns.indicators,
    amount: visibleColumns.amount,
    actions: visibleColumns.actions,
  }), [visibleColumns]);

  const handleColumnVisibilityModelChange = useCallback((model: GridColumnVisibilityModel) => {
    setVisibleColumns((prev) => {
      const next = { ...prev };
      for (const [field, key] of Object.entries(GRID_FIELD_TO_VISIBLE_COLUMN_KEY)) {
        next[key] = model[field] !== false;
      }
      return next;
    });
  }, []);

  // MUI DataGrid syncs controlled sortModel/paginationModel props by reference
  // equality, so a fresh literal on every render is treated as a real change
  // and re-applies sorting/pagination, resetting the grid's scroll to the top.
  const sortModel = React.useMemo<GridSortModel>(() => [{ field: orderBy, sort: order }], [orderBy, order]);
  const paginationModel = React.useMemo<GridPaginationModel>(() => ({ page, pageSize: rowsPerPage }), [page, rowsPerPage]);

  const handleSortModelChange = (model: GridSortModel) => {
    const sort = model[0];
    setOrderBy(sort?.field || 'date');
    setOrder(sort?.sort === 'asc' ? 'asc' : 'desc');
    setPage(0);
  };

  const handlePaginationModelChange = (model: GridPaginationModel) => {
    setPage(model.page);
    setRowsPerPage(model.pageSize);
  };

  const transactions = React.useMemo(() => result?.data ?? [], [result]);
  const totalCount = result?.total ?? 0;
  const totalIncome = result?.totalIncome ?? 0;
  const totalExpenses = result?.totalExpenses ?? 0;
  const netIncome = totalIncome - totalExpenses;

  // Right-click (desktop) and long-press (touch) open the same row menu as the
  // kebab button. DataGrid rows carry the row id in data-id.
  const openRowMenuAt = useCallback(
    (rowId: number, position: { top: number; left: number }) => {
      const transaction = transactions.find((row) => row.id === rowId);
      if (transaction) setQuickActions({ anchorPosition: position, transaction });
    },
    [transactions]
  );
  const handleRowContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const rowId = Number(event.currentTarget.getAttribute('data-id'));
    if (!Number.isFinite(rowId)) return;
    event.preventDefault();
    openRowMenuAt(rowId, { top: event.clientY, left: event.clientX });
  };
  const longPressHandlers = useLongPress(({ target, clientX, clientY }) => {
    const rowId = Number(target.getAttribute('data-id'));
    if (Number.isFinite(rowId)) openRowMenuAt(rowId, { top: clientY, left: clientX });
  });

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsLocale}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {/* Header */}
        <Box sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'center' },
          mb: 3,
          gap: { xs: 2, sm: 0 }
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Receipt color="primary" />
            <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
              {t('report.title')}
            </Typography>
          </Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            useFlexGap
            flexWrap="wrap"
            justifyContent="flex-end"
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            <Button
              variant="outlined"
              startIcon={classifying ? <CircularProgress size={16} color="inherit" /> : <AutoFixHigh />}
              onClick={() => { void handleAutoClassify(); }}
              disabled={classifying}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
              data-testid="transactions-auto-classify"
            >
              {classifying ? t('report.classifying') : t('report.autoClassify')}
            </Button>
            <Button variant="outlined" startIcon={<Rule />} onClick={() => setRulesDialogOpen(true)} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }} data-testid="transactions-type-rules">
              {t('report.typeRules')}
            </Button>
            <Button variant="outlined" startIcon={<ClearAll />} onClick={handleClearFilters} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              {t('report.clearFilters')}
            </Button>
            <Button variant="contained" startIcon={<Download />} onClick={handleExportCSV} disabled={totalCount === 0} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              {t('report.exportCsv')}
            </Button>
            <Button variant="outlined" startIcon={<ViewColumn />} onClick={() => setShowColumnControls(!showColumnControls)} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              {t('report.columnsButton')}
            </Button>
          </Stack>
        </Box>

        {/* Column Visibility Controls */}
        <Collapse in={showColumnControls}>
          <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ViewColumn />
              <Typography variant="h6">{t('report.columnVisibility')}</Typography>
            </Box>
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" size="small" onClick={() => setVisibleColumns({ date: true, description: true, comment: true, commentIndicator: true, category: true, company: true, service: true, project: true, label: true, user: true, amount: true, account: true, card: true, indicators: true, actions: true })}>{t('report.showAll')}</Button>
              <Button variant="outlined" size="small" onClick={() => setVisibleColumns({ date: true, description: true, comment: true, commentIndicator: true, category: false, company: false, service: false, project: false, label: false, user: false, amount: true, account: false, card: false, indicators: false, actions: true })}>{t('report.mobileView')}</Button>
            </Box>
            <FormGroup>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
                {Object.entries(columnLabels).map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={<Checkbox checked={visibleColumns[key as keyof typeof visibleColumns]} onChange={() => handleColumnToggle(key as keyof typeof visibleColumns)} size="small" />}
                    label={label}
                  />
                ))}
              </Box>
            </FormGroup>
          </Paper>
        </Collapse>

        {/* Rows typed automatically (transfer / refund / rule) and not yet confirmed */}
        {reviewCount > 0 && !needsTypeReview && (
          <Alert
            severity="info"
            sx={{ mb: 3 }}
            data-testid="type-review-banner"
            action={
              <Button color="inherit" size="small" onClick={() => { setNeedsTypeReview(true); setFiltersExpanded(true); }}>
                {t('report.review')}
              </Button>
            }
          >
            {t('report.reviewBanner', { count: reviewCount })}
          </Alert>
        )}

        {/* Summary Stats */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: { xs: 2, sm: 3 }, mb: 3 }}>
          <Card><CardContent>
            <Typography variant="h6" color="success.main">{formatCurrency(totalIncome)}</Typography>
            <Typography variant="body2" color="text.secondary">{t('report.totalIncome')}</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color="error.main">{formatCurrency(totalExpenses)}</Typography>
            <Typography variant="body2" color="text.secondary">{t('report.totalExpenses')}</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color={netIncome >= 0 ? 'success.main' : 'error.main'}>{formatCurrency(netIncome)}</Typography>
            <Typography variant="body2" color="text.secondary">{t('report.netIncome')}</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color="primary.main">{number(totalCount)}</Typography>
            <Typography variant="body2" color="text.secondary">{t('report.transactionsCount')}</Typography>
          </CardContent></Card>
        </Box>

        {/* Filters */}
        <Accordion
          expanded={filtersExpanded}
          onChange={(_, expanded) => setFiltersExpanded(expanded)}
          sx={{ mb: 3 }}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterList />
              <Typography variant="h6">{t('report.filters')}</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
              <TextField fullWidth label={t('common:actions.search')} placeholder={t('report.searchPlaceholder')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <FormControl fullWidth>
                <InputLabel>{t('common:fields.type')}</InputLabel>
                <Select value={typeFilter} label={t('common:fields.type')} onChange={(e) => setTypeFilter(e.target.value as any)}>
                  <MenuItem value="all">{t('common:fields.all')}</MenuItem>
                  <MenuItem value="income">{t('common:transactionType.income')}</MenuItem>
                  <MenuItem value="expense">{t('common:transactionType.expense')}</MenuItem>
                  <MenuItem value="refund">{t('common:transactionType.refund')}</MenuItem>
                  <MenuItem value="transfer">{t('common:transactionType.transfer')}</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              <DatePicker label={t('report.startDate')} value={startDate} onChange={setStartDate} slotProps={{ textField: { fullWidth: true } }} />
              <DatePicker label={t('report.endDate')} value={endDate} onChange={setEndDate} slotProps={{ textField: { fullWidth: true } }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              <TextField fullWidth label={t('report.minAmount')} type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} inputProps={{ min: 0, step: 0.01 }} />
              <TextField fullWidth label={t('report.maxAmount')} type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputProps={{ min: 0, step: 0.01 }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
              <Autocomplete multiple options={categories} getOptionLabel={(o) => o.name} value={categories.filter((c: Category) => categoryFilter.includes(c.id))} onChange={(_, v) => setCategoryFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label={t('report.categories')} />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={companies} getOptionLabel={(o) => o.name} value={companies.filter((c: Company) => companyFilter.includes(c.id))} onChange={(_, v) => setCompanyFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label={t('report.companies')} />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={projects} getOptionLabel={(o) => o.name} value={projects.filter((p: any) => projectFilter.includes(p.id))} onChange={(_, v) => setProjectFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label={t('report.projects')} />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={accounts}
                getOptionLabel={(o) => o.owner_display_name ? `${o.owner_display_name} - ${o.name}` : o.name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={accounts.filter((a: Account) => accountFilter.includes(a.id))}
                onChange={(_, v) => setAccountFilter(v.map(x => x.id))}
                renderOption={(props, option) => { const { key, ...op } = props; return <li key={option.id} {...op}>{option.owner_display_name ? `${option.owner_display_name} - ${option.name}` : option.name}</li>; }}
                renderInput={(p) => <TextField {...p} label={t('report.accounts')} />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.owner_display_name ? `${o.owner_display_name} - ${o.name}` : o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={users}
                getOptionLabel={(o) => o.display_name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={users.filter((user: User) => userFilter.includes(user.id))}
                onChange={(_, v) => setUserFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label={t('report.users')} />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.display_name} size="small" {...cp} />; })} />
            </Box>
            <FormGroup row>
              <FormControlLabel
                control={<Checkbox checked={missingCategory} onChange={(e) => setMissingCategory(e.target.checked)} size="small" />}
                label={t('report.missingCategory')}
              />
              <FormControlLabel
                control={<Checkbox checked={missingCompany} onChange={(e) => setMissingCompany(e.target.checked)} size="small" />}
                label={t('report.missingCompany')}
              />
              <FormControlLabel
                control={<Checkbox checked={missingProject} onChange={(e) => setMissingProject(e.target.checked)} size="small" />}
                label={t('report.missingProject')}
              />
              <FormControlLabel
                control={<Checkbox checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} size="small" />}
                label={t('report.flaggedOnly')}
              />
              <FormControlLabel
                control={<Checkbox checked={includeExcluded} onChange={(e) => setIncludeExcluded(e.target.checked)} size="small" />}
                label={t('report.showExcluded')}
              />
              <FormControlLabel
                control={<Checkbox checked={needsTypeReview} onChange={(e) => setNeedsTypeReview(e.target.checked)} size="small" />}
                label={t('report.needsTypeReview')}
              />
            </FormGroup>
          </Box>
          </AccordionDetails>
        </Accordion>

        {/* Bulk Actions */}
        <TransactionBulkActionsBar
          selectedCount={selectedIds.length}
          onOpenAction={(kind) => setBulkAction(kind)}
          onClearSelection={() => setRowSelectionModel({ type: 'include', ids: new Set() })}
        />

        {/* Results Grid */}
        <Paper>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          <Box ref={gridWrapperRef}>
            <AppDataGrid
              rows={transactions}
              columns={gridColumns}
              rowCount={totalCount}
              loading={loading}
              paginationMode="server"
              sortingMode="server"
              paginationModel={paginationModel}
              onPaginationModelChange={handlePaginationModelChange}
              sortModel={sortModel}
              onSortModelChange={handleSortModelChange}
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={handleColumnVisibilityModelChange}
              checkboxSelection
              keepNonExistentRowsSelected
              rowSelectionModel={rowSelectionModel}
              onRowSelectionModelChange={setRowSelectionModel}
              pageSizeOptions={isMobile ? [10, 25] : [10, 25, 50, 100]}
              height={gridHeight}
              slotProps={{ row: { onContextMenu: handleRowContextMenu, ...longPressHandlers } }}
              getRowClassName={(params) => (params.row.is_excluded ? 'transaction-row--excluded' : '')}
              sx={{ '& .transaction-row--excluded': { opacity: 0.55 } }}
              footerSummary={
                <Typography variant="body2" color="text.secondary">
                  {t('report.footerIncome')} <Typography component="span" variant="body2" color="success.main">{formatCurrency(totalIncome)}</Typography>
                  {' • '}{t('report.footerExpenses')} <Typography component="span" variant="body2" color="error.main">{formatCurrency(totalExpenses)}</Typography>
                  {' • '}{t('report.footerNet')} <Typography component="span" variant="body2" color={netIncome >= 0 ? 'success.main' : 'error.main'}>{formatCurrency(netIncome)}</Typography>
                </Typography>
              }
              emptyMessage={t('report.emptyMessage')}
              disableVirtualization={process.env.NODE_ENV === 'test'}
            />
          </Box>
        </Paper>

        {!loading && totalCount === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" color="text.secondary">{t('report.emptyMessage')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('report.emptyHint')}</Typography>
          </Box>
        )}

        <TransactionLabelDialog
          open={labelDialogOpen}
          onClose={() => { setLabelDialogOpen(false); setSelectedTransaction(null); }}
          transaction={selectedTransaction}
          onSuccess={() => console.log('Transaction labeled successfully')}
        />
        <TransactionRowActionsMenu
          anchorEl={quickActions?.anchorEl ?? null}
          anchorPosition={quickActions?.anchorPosition ?? null}
          transaction={quickActions?.transaction ?? null}
          onClose={() => setQuickActions(null)}
        />
        <BulkSetCategoryDialog
          open={bulkAction === 'category'}
          transactionIds={selectedIds}
          onClose={() => setBulkAction(null)}
        />
        <BulkSetCompanyDialog
          open={bulkAction === 'company'}
          transactionIds={selectedIds}
          onClose={() => setBulkAction(null)}
        />
        <BulkSetProjectDialog
          open={bulkAction === 'project'}
          transactionIds={selectedIds}
          onClose={() => setBulkAction(null)}
        />
        <BulkSubscriptionLinkDialog
          open={bulkAction === 'series'}
          transactionIds={selectedIds}
          onClose={() => setBulkAction(null)}
        />
        <Dialog open={commentDialogOpen} onClose={() => setCommentDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('report.editComment')}</DialogTitle>
          <DialogContent>
            <TextField
              label={t('common:fields.comment')}
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              fullWidth
              multiline
              minRows={3}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCommentDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button variant="contained" onClick={() => { void handleSaveComment(); }}>{t('common:actions.save')}</Button>
          </DialogActions>
        </Dialog>
        <ClassificationRulesDialog
          open={rulesDialogOpen}
          rules={classificationRules}
          accounts={accounts}
          onClose={() => setRulesDialogOpen(false)}
          onCreate={async (rule) => { await addClassificationRule(rule); }}
          onUpdate={updateClassificationRule}
          onDelete={deleteClassificationRule}
          previewMatches={previewClassificationRuleMatches}
        />
        <Snackbar
          open={scanSummary !== null || scanError !== null}
          autoHideDuration={8000}
          onClose={() => { setScanSummary(null); setScanError(null); }}
        >
          {scanError ? (
            <Alert severity="error" variant="filled" onClose={() => setScanError(null)}>{scanError}</Alert>
          ) : (
            <Alert severity="success" variant="filled" onClose={() => setScanSummary(null)} data-testid="auto-classify-summary">
              {scanSummary
                ? t(scanSummary.reverted > 0 ? 'report.scanSummaryReverted' : 'report.scanSummary', {
                    scanned: scanSummary.scanned,
                    transfers: t('report.scanTransfers', { count: scanSummary.transfersPaired }),
                    refunds: t('report.scanRefunds', { count: scanSummary.refundsInferred }),
                    rulesApplied: scanSummary.rulesApplied,
                    reverted: scanSummary.reverted,
                  })
                : ''}
            </Alert>
          )}
        </Snackbar>
      </Box>
    </LocalizationProvider>
  );
}
