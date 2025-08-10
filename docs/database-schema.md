# Updated Database ER Diagram

Based on the updated database schema with Users, Accounts, and Trips functionality:

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
        int user_id FK
        string name
        string type
        string last_four
        datetime created_at
        datetime updated_at
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
        datetime created_at
        datetime updated_at
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
    
    USERS ||--o{ ACCOUNTS : has
    ACCOUNTS ||--o{ TRANSACTIONS : contains
    CATEGORIES ||--o{ TRANSACTIONS : categorizes
    COMPANIES ||--o{ TRANSACTIONS : associated_with
    PROJECTS ||--o{ TRANSACTIONS : includes
    TRIPS ||--o{ TRANSACTIONS : includes
    CATEGORIES ||--o{ BUDGETS : has
```

## Key Features Added:

1. **Users Table**: Central user management with display names
2. **Enhanced Accounts**: Now linked to users with last 4 digits and account types
3. **Trips Table**: Full trip management with categories, status, dates, and costs
4. **Transaction Labeling**: Transactions can now be associated with both projects and trips
5. **Normalized Structure**: Eliminated redundant AccountAlias table

## Relationships:

- **One-to-Many**: Users → Accounts → Transactions
- **Optional References**: Transactions can reference Projects, Trips, Categories, and Companies
- **Flexible Labeling**: Transactions can be labeled with either a Project OR a Trip (or neither)