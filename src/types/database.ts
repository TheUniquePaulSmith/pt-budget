// Database type definitions for the budget tracker app

/**
 * What a money movement means. `amount` stays signed (negative = out):
 * expense (out), income (in, earnings), refund (in, nets against spending),
 * transfer (either direction, between the household's own accounts; counts
 * toward neither income nor spending).
 */
export type TransactionType = 'income' | 'expense' | 'refund' | 'transfer';

export type AccountType = 'checking' | 'savings' | 'credit' | 'loan' | 'investment' | 'retirement';
export type AccountOwnership = 'individual' | 'joint';

export interface Transaction {
  id: number;
  date: string;
  amount: number;
  description: string;
  comment?: string | null;
  account_id: number;
  card_id: number | null;
  category_id: number | null;
  company_id: number | null;
  project_id: number | null;
  trip_id: number | null;
  type: TransactionType;
  transaction_hash?: string; // For duplicate detection
  hash_variation_seed?: number; // Variation seed for handling legitimate duplicates
  external_id?: string | null; // Bank reference number, a second dedup key
  transfer_group_id?: string | null; // Shared by both legs of a paired transfer
  type_locked?: number; // SQLite boolean: user set the type; automatic re-typing must not touch it
  is_excluded?: number; // SQLite boolean: leave out of every report and total
  is_flagged?: number; // SQLite boolean: marked for review
  import_batch_id?: number | null;
  created_at: string;
  updated_at: string;
  // Joined fields from SQL queries
  category_name?: string;
  category_color?: string;
  category_type?: string;
  company_name?: string;
  account_name?: string;
  account_type?: string;
  card_last_four?: string;
  card_nickname?: string | null;
  effective_user_id?: number | null;
  effective_user_name?: string;
  account_owner_name?: string;
  series_id?: number | null;
  series_name?: string;
  service_name?: string;
  project_name?: string;
  trip_name?: string;
}

export interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense';
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  display_name: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: number;
  name: string; // User-friendly name for the account
  type: AccountType;
  ownership?: AccountOwnership; // Always present on rows read from the database; optional for inputs
  owner_user_id: number;
  institution?: string | null;
  opening_balance?: number;
  opening_balance_date?: string | null;
  credit_limit?: number | null;
  is_active?: number; // SQLite boolean
  include_in_net_worth?: number; // SQLite boolean
  import_sign_inverted?: number; // SQLite boolean: this bank exports charges as positive numbers
  created_at: string;
  updated_at: string;
  // Joined fields from SQL queries
  owner_display_name?: string; // Owner's display name
  cards?: AccountCard[]; // Array of cards associated with this account
}

export interface AccountCard {
  id: number;
  account_id: number;
  last_four: string; // Last 4 digits of card number
  full_number?: string | null; // Optional full number, used only to disambiguate cards sharing a last_four; never displayed
  nickname?: string | null; // Optional nickname for the card (e.g., "My Card", "Spouse Card")
  user_id?: number | null; // Optional: which user has this specific card
  created_at: string;
  // Joined fields from SQL queries
  user_display_name?: string;
  account_name?: string;
}

// AccountUser removed; ownership is represented by Account.owner_user_id

/** One import run; lets the app say how fresh its data is and undo an import. */
export interface ImportBatch {
  id: number;
  imported_at: string;
  source: 'csv' | 'manual' | 'sample';
  file_name: string | null;
  account_ids_json: string | null;
  total_rows: number;
  inserted_count: number;
  duplicate_count: number;
  skipped_count: number;
  rejected_count: number;
  min_date: string | null;
  max_date: string | null;
}

/** Statement balance for accounts valued rather than transacted (investment, retirement, loan). */
export interface AccountBalanceSnapshot {
  id: number;
  account_id: number;
  as_of_date: string;
  balance: number;
  note?: string | null;
  created_at: string;
}

export interface BudgetPlan {
  id: number;
  effective_month: string;
  total_amount: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetPlanCategory {
  id: number;
  plan_id: number;
  category_id: number;
  amount: number;
  created_at: string;
  updated_at: string;
  category_name?: string;
  category_color?: string;
}

export interface BudgetPlanWithCategories extends BudgetPlan {
  categories: BudgetPlanCategory[];
}

export interface IncomeSource {
  id: number;
  name: string;
  kind: 'linked_account' | 'recurring_salary';
  user_id: number | null;
  account_id: number | null;
  amount: number | null;
  frequency: 'weekly' | 'biweekly' | 'semi_monthly' | 'monthly' | null;
  start_date: string | null;
  end_date: string | null;
  is_active: number;
  notes?: string | null;
  deposit_account_id?: number | null; // Where the pay lands; null = an account the app does not track
  match_pattern?: string | null; // Description text that identifies the payroll deposit
  created_at: string;
  updated_at: string;
  account_name?: string;
  user_display_name?: string;
  owner_display_name?: string;
}

export interface BudgetPeriod {
  type: 'month' | 'quarter' | 'year';
  key: string;
}

export interface BudgetCategoryStatus {
  category_id: number;
  category_name?: string;
  category_color?: string;
  budgetedAmount: number;
  actualExpenses: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface BudgetStatus {
  period: BudgetPeriod;
  months: string[];
  budgetedTotal: number | null;
  actualExpenses: number;
  remaining: number | null;
  isOverBudget: boolean;
  categories: BudgetCategoryStatus[];
  unbudgetedSpend: number;
  expectedIncome: number;
  actualLinkedIncome: number;
  monthsWithPlan: string[];
}

export interface TransactionScopeFilters {
  accountIds?: number[];
  userIds?: number[];
}

export interface Project {
  id: number;
  name: string;
  company_name: string;
  contact_details: string;
  project_category: 'plumbing' | 'electrical' | 'hvac' | 'roofing' | 'flooring' | 'painting' | 'landscaping' | 'general_contractor' | 'other';
  status: 'planning' | 'in_progress' | 'completed' | 'on_hold';
  start_date?: string | null;
  end_date?: string | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Trip {
  id: number;
  name: string;
  destination?: string | null;
  purpose?: string | null;
  trip_category: 'business' | 'vacation' | 'family' | 'medical' | 'education' | 'other';
  status: 'planning' | 'in_progress' | 'completed' | 'cancelled';
  start_date?: string | null;
  end_date?: string | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type MerchantRuleMatchType = 'exact' | 'prefix' | 'contains';
export type MerchantRuleKind = 'subscription' | 'bill' | 'purchase' | 'unknown';

export interface MerchantRule {
  id: number;
  rule_key: string; // Stable identity: 'community:<slug>' or 'user:<uuid>'
  source: 'community' | 'user';
  pattern: string; // Matched against the NORMALIZED description
  match_type: MerchantRuleMatchType;
  priority: number; // Lower wins: 50 user default, 1000 service-level, 2000 merchant catch-all
  merchant_name: string;
  service_name?: string | null;
  default_kind: MerchantRuleKind;
  enabled: number; // SQLite boolean (0/1)
  user_modified: number; // SQLite boolean (0/1); guards community reseeds
  notes?: string | null;
  default_category_id?: number | null; // Category to assign to matching rows at import time
  created_at: string;
  updated_at: string;
}

export type RecurringSeriesKind = 'subscription' | 'bill';
export type RecurringSeriesCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular';
export type RecurringSeriesStatus = 'candidate' | 'active' | 'inactive' | 'ignored';

export interface RecurringSeries {
  id: number;
  name: string;
  company_id: number | null;
  rule_id: number | null;
  kind: RecurringSeriesKind;
  cadence: RecurringSeriesCadence;
  expected_amount: number | null;
  amount_is_variable: number; // SQLite boolean (0/1)
  status: RecurringSeriesStatus;
  match_key: string; // 'rule:<rule_key>' or 'desc:<normalized description>'
  last_seen_date: string | null;
  next_expected_date: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields from SQL queries
  company_name?: string;
  card_last_four?: string;
  card_nickname?: string | null;
  transaction_count?: number;
  total_spent?: number;
}

export interface TransactionSeriesLink {
  id: number;
  transaction_id: number;
  series_id: number;
  match_source: 'rule' | 'heuristic' | 'ai' | 'manual';
  created_at: string;
}

// A cluster of unmatched transactions sharing a normalized description,
// surfaced on the Subscriptions page for manual/AI rule creation.
export interface UnmatchedCluster {
  normalized_description: string;
  occurrences: number;
  average_amount: number;
  first_seen: string;
  last_seen: string;
  transaction_ids: number[];
}

export interface SubscriptionScanSummary {
  scannedTransactions: number;
  merchantsMatched: number;
  seriesCreated: number;
  seriesUpdated: number;
  transactionsLinked: number;
}

export interface TransactionQueryParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
  type?: TransactionType;
  categoryIds?: number[];
  companyIds?: number[];
  projectIds?: number[];
  accountIds?: number[];
  userIds?: number[];
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  missingCategory?: boolean;
  missingCompany?: boolean;
  missingProject?: boolean;
}

export interface TransactionsPaginatedResult {
  data: Transaction[];
  total: number;
  totalIncome: number;
  totalExpenses: number;
}

export interface DashboardSummary {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  transactionCount: number;
}

export interface ChartCategoryData {
  id: number | string;
  label: string;
  value: number;
  color: string;
}

export interface ChartTrendsData {
  months: string[];
  income: number[];
  expenses: number[];
}

export interface ChartAccountData {
  accountNames: string[]; // User labels; kept for compatibility with existing chart consumers.
  income: number[];
  expenses: number[];
}

// One stacked series in a month-axis chart; `data` is aligned to the shared `months` array.
export interface ChartMonthSeries {
  id: number | string;
  label: string;
  color: string;
  data: number[];
}

export interface ChartCategoryTrends {
  months: string[];
  series: ChartMonthSeries[];
}

export interface ChartCommittedSplit {
  months: string[];
  committed: number[];
  discretionary: number[];
}

export interface ChartUpcomingCommitments {
  months: string[];
  amounts: number[];
}

export interface ChartCategoryDelta {
  id: number | string;
  label: string;
  color: string;
  current: number;
  previous: number;
  delta: number;
}

export interface ChartData {
  spendingByCategory: ChartCategoryData[];
  spendingByCompany: ChartCategoryData[];
  spendingByRecurring: ChartCategoryData[];
  incomeBySource: ChartCategoryData[];
  trends: ChartTrendsData;
  accountAnalysis: ChartAccountData;
  categoryTrends: ChartCategoryTrends;
  committedSplit: ChartCommittedSplit;
  upcomingCommitments: ChartUpcomingCommitments;
  // Current period vs the immediately preceding equal-length period.
  categoryDeltas: ChartCategoryDelta[];
  comparisonPeriodLabel: string;
}

export interface ProjectCosts {
  project_id: number;
  estimated: number;
  actual: number;
  transactions_total: number;
}

export interface TripCosts {
  trip_id: number;
  estimated: number;
  actual: number;
  transactions_total: number;
}