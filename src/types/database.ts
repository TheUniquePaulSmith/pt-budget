// Database type definitions for the budget tracker app

export interface Transaction {
  id: number;
  date: string;
  amount: number;
  description: string;
  account_id: number;
  category_id: number | null;
  company_id: number | null;
  project_id: number | null;
  trip_id: number | null;
  type: 'income' | 'expense';
  transaction_hash?: string; // For duplicate detection
  hash_variation_seed?: number; // Variation seed for handling legitimate duplicates
  created_at: string;
  updated_at: string;
  // Joined fields from SQL queries
  category_name?: string;
  category_color?: string;
  category_type?: string;
  company_name?: string;
  account_name?: string;
  account_type?: string;
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
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: number;
  name: string; // User-friendly name for the account
  type: 'checking' | 'savings' | 'credit' | 'joint';
  owner_user_id: number;
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
  nickname?: string | null; // Optional nickname for the card (e.g., "My Card", "Spouse Card")
  user_id?: number | null; // Optional: which user has this specific card
  created_at: string;
  // Joined fields from SQL queries
  user_display_name?: string;
  account_name?: string;
}

// AccountUser removed; ownership is represented by Account.owner_user_id

export interface Budget {
  id: number;
  category_id: number;
  amount: number;
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
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

export interface TransactionQueryParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
  type?: 'income' | 'expense';
  categoryIds?: number[];
  companyIds?: number[];
  projectIds?: number[];
  accountIds?: number[];
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
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
  accountNames: string[];
  income: number[];
  expenses: number[];
}

export interface ChartData {
  spendingByCategory: ChartCategoryData[];
  incomeBySource: ChartCategoryData[];
  trends: ChartTrendsData;
  accountAnalysis: ChartAccountData;
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