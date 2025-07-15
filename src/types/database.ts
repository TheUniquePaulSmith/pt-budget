// Database type definitions for the budget tracker app

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  account_id: string;
  category_id: string | null;
  company_id: string | null;
  project_id: string | null;
  type: 'income' | 'expense';
  transaction_hash?: string; // For duplicate detection
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
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string; // User-friendly name for the account
  type: 'checking' | 'savings' | 'credit';
  last_four: string; // Last 4 digits of account number
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  category_id: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
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