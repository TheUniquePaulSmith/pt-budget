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
  user_id: number;
  name: string; // User-friendly name for the account
  type: 'checking' | 'savings' | 'credit';
  last_four: string; // Last 4 digits of account number
  created_at: string;
  updated_at: string;
  // Joined fields from SQL queries
  user_display_name?: string;
}

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