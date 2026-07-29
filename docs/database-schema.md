# Updated Database ER Diagram

Based on the current database schema (source of truth: `public/database-schema.js`), including users, accounts, account cards, trips, merchant rules, and recurring-subscription tracking:

```mermaid
erDiagram
    USERS {
        int id PK
        string display_name
        datetime created_at
        datetime updated_at
    }

    ACCOUNTS {
        int id PK
        string name
        string type
        int owner_user_id FK
        datetime created_at
        datetime updated_at
    }

    ACCOUNT_CARDS {
        int id PK
        int account_id FK
        string last_four
        string full_number
        string nickname
        int user_id FK
        datetime created_at
    }

    CATEGORIES {
        int id PK
        string name
        string color
        string type
        datetime created_at
        datetime updated_at
    }

    COMPANIES {
        int id PK
        string name
        datetime created_at
        datetime updated_at
    }

    PROJECTS {
        int id PK
        string name
        string company_name
        string contact_details
        string project_category
        string status
        date start_date
        date end_date
        float estimated_cost
        float actual_cost
        string notes
        datetime created_at
        datetime updated_at
    }

    TRIPS {
        int id PK
        string name
        string destination
        string purpose
        string trip_category
        string status
        date start_date
        date end_date
        float estimated_cost
        float actual_cost
        string notes
        datetime created_at
        datetime updated_at
    }

    TRANSACTIONS {
        int id PK
        date date
        float amount
        string description
        int account_id FK
        int category_id FK
        int company_id FK
        int project_id FK
        int trip_id FK
        string type
        string transaction_hash
        int hash_variation_seed
        datetime created_at
        datetime updated_at
    }

    TEMP_IMPORT_TRANSACTIONS {
        int id PK
        date date
        float amount
        string description
        int account_id
        string type
        string transaction_hash
        int hash_variation_seed
    }

    BUDGETS {
        int id PK
        int category_id FK
        float amount
        string period
        date start_date
        date end_date
        datetime created_at
        datetime updated_at
    }

    MERCHANT_RULES {
        int id PK
        string rule_key UK
        string source
        string pattern
        string match_type
        int priority
        string merchant_name
        string service_name
        string default_kind
        int enabled
        int user_modified
        string notes
        datetime created_at
        datetime updated_at
    }

    RECURRING_SERIES {
        int id PK
        string name
        int company_id FK
        int rule_id FK
        string kind
        string cadence
        float expected_amount
        int amount_is_variable
        string status
        string match_key UK
        date last_seen_date
        date next_expected_date
        string notes
        datetime created_at
        datetime updated_at
    }

    TRANSACTION_SERIES_LINKS {
        int id PK
        int transaction_id FK
        int series_id FK
        string match_source
        datetime created_at
    }

    APP_METADATA {
        string key PK
        string value
        datetime updated_at
    }

    USERS ||--o{ ACCOUNTS : owns
    ACCOUNTS ||--o{ ACCOUNT_CARDS : has
    USERS ||--o{ ACCOUNT_CARDS : carries
    ACCOUNTS ||--o{ TRANSACTIONS : contains
    CATEGORIES ||--o{ TRANSACTIONS : categorizes
    COMPANIES ||--o{ TRANSACTIONS : associated_with
    PROJECTS ||--o{ TRANSACTIONS : includes
    TRIPS ||--o{ TRANSACTIONS : includes
    CATEGORIES ||--o{ BUDGETS : has
    COMPANIES ||--o{ RECURRING_SERIES : bills_through
    MERCHANT_RULES ||--o{ RECURRING_SERIES : derives
    RECURRING_SERIES ||--o{ TRANSACTION_SERIES_LINKS : groups
    TRANSACTIONS ||--o| TRANSACTION_SERIES_LINKS : linked_by
```

## Key Features:

1. **Users Table**: Central user management with display names
2. **Accounts + Account Cards**: Accounts are owned via `owner_user_id`; card last-four digits live on `account_cards` and drive CSV import account matching. `account_cards.last_four` is unique per account (not globally), so different accounts may share a last-four; an optional `full_number` disambiguates them (used only for matching — never displayed, since the UI always shows just the last four digits) via `idx_account_cards_full_number`
3. **Trips Table**: Full trip management with categories, status, dates, and costs
4. **Transaction Labeling**: Transactions can be associated with both projects and trips
5. **CSV Import Staging**: `temp_import_transactions` stages imports for duplicate analysis before `transactions` receives them
6. **Merchant Rules**: Community-seeded + user-defined description patterns that map raw bank charge descriptions to merchants (`companies`), optional services, and a default kind (subscription / bill / purchase). Community reseeds respect `user_modified`
7. **Recurring Series**: Detected subscriptions and recurring bills with cadence, expected amount, status lifecycle (candidate → active / inactive / ignored), and idempotent rescans via unique `match_key`
8. **Transaction–Series Links**: Join table connecting transactions to their recurring series (avoids altering the transactions table)
9. **App Metadata**: Key/value store for versioned assets such as the community merchant-rules seed version

## Relationships:

- **One-to-Many**: Users → Accounts → Transactions
- **Optional References**: Transactions can reference Projects, Trips, Categories, and Companies
- **Flexible Labeling**: Transactions can be labeled with either a Project OR a Trip (or neither)
- **Merchant Mapping**: `merchant_rules.merchant_name` is resolved to a `companies` row at match time (not a hard FK, so rules can seed before companies exist)
- **Subscriptions**: A transaction belongs to at most one recurring series (`transaction_series_links.transaction_id` is UNIQUE)

## Schema Versioning:

Schema changes are delivered by a `PRAGMA user_version`-gated migration runner in `public/database-worker.js` (`runMigrations()`), driven by the `MIGRATIONS` export in `public/database-schema.js`. Migration statements must be idempotent (`CREATE TABLE IF NOT EXISTS`) because fresh databases already receive all tables from `createTables()`.
