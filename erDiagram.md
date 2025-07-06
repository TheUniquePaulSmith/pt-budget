# Database Schema - Entity Relationship Diagram

```erDiagram
    categories {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        TEXT name "NOT NULL UNIQUE"
        TEXT type "NOT NULL CHECK (type IN ('income', 'expense'))"
        TEXT color "DEFAULT '#3b82f6'"
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    companies {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        TEXT name "NOT NULL UNIQUE"
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    accounts {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        TEXT name "NOT NULL"
        TEXT last_four "NOT NULL"
        TEXT type "NOT NULL"
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    projects {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        TEXT name "NOT NULL"
        TEXT company_name "NOT NULL"
        TEXT contact_details
        TEXT project_category "NOT NULL"
        TEXT status "NOT NULL DEFAULT 'planning'"
        TEXT start_date
        TEXT end_date
        REAL estimated_cost
        REAL actual_cost
        TEXT notes
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    budgets {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        INTEGER category_id FK "NOT NULL"
        REAL amount "NOT NULL"
        TEXT period "NOT NULL"
        TEXT start_date "NOT NULL"
        TEXT end_date "NOT NULL"
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    transactions {
        INTEGER id PK "PRIMARY KEY AUTOINCREMENT"
        TEXT date "NOT NULL"
        REAL amount "NOT NULL"
        TEXT description "NOT NULL"
        INTEGER category_id FK
        INTEGER company_id FK
        INTEGER project_id FK
        TEXT account_last_four
        TEXT type "NOT NULL CHECK (type IN ('income', 'expense'))"
        TEXT reference_number "For duplicate detection"
        TEXT posting_date
        TEXT merchant_city
        TEXT merchant_state
        TEXT merchant_zip
        TEXT mcc_code
        DATETIME created_at "DEFAULT CURRENT_TIMESTAMP"
        DATETIME updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    %% Foreign Key Relationships
    categories ||--o{ budgets : "has budgets"
    categories ||--o{ transactions : "categorizes"
    companies ||--o{ transactions : "involved in"
    projects ||--o{ transactions : "tracks costs"
    accounts ||--o{ transactions : "source account"
```

## Database Schema Overview

### Core Tables
- **categories**: Income/expense categories with color coding
- **companies**: Merchants and vendors from transactions
- **accounts**: Bank accounts (checking, savings, etc.)
- **projects**: House projects and contractor work
- **budgets**: Budget allocations per category
- **transactions**: Core financial transaction records

### Key Relationships
1. **Categories → Transactions** (One-to-Many): Each transaction can be categorized
2. **Categories → Budgets** (One-to-Many): Each budget is tied to a category
3. **Companies → Transactions** (One-to-Many): Transactions associated with merchants
4. **Projects → Transactions** (One-to-Many): Project cost tracking
5. **Accounts → Transactions** (One-to-Many): Multi-account support

### CSV Import Mapping (Huntington Bank Format)
- `Original Account Number` → `account_last_four`
- `Transaction Date` → `date`
- `Posting Date` → `posting_date`
- `Billing Amount` → `amount`
- `Merchant` → Maps to `companies.name`
- `Merchant City/State/Zip` → `merchant_city`, `merchant_state`, `merchant_zip`
- `Reference Number` → `reference_number` (for duplicate detection)
- `Debit/Credit Flag` → `type` (D=expense, C=income)
- `MCC Code` → `mcc_code`

### Duplicate Detection Strategy
The application prevents duplicate transactions by creating a hash from:
- Account number (last 4 digits)
- Transaction date
- Amount
- Merchant name/description
- Reference number (if available)

This ensures the same transaction cannot be imported multiple times across different CSV files.