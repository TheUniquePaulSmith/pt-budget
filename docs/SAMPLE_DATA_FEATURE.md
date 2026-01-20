# Sample Data Auto-Loading Feature

## Overview

This developer feature enables automatic loading of sample data from a local folder structure when initializing a new database. It's designed for development, testing, and demonstrations, allowing quick database setup with realistic data.

## How It Works

### Query Parameter Detection
- Access the app with `?loadSampleData=true` query parameter
- When creating a new database, the system automatically loads sample data
- Sample data is loaded **after** database initialization but **before** the data refresh

### File Structure
Sample data files are located in `/public/sample-data/`:
```
public/
  sample-data/
    README.md
    users.json
    accounts.json
    account_cards.json
    categories.json
    companies.json
    transactions.json
    projects.json
    trips.json
```

### Loading Order
Files are loaded in dependency order to maintain foreign key relationships:
1. `users.json`
2. `accounts.json`
3. `account_cards.json`
4. `categories.json`
5. `companies.json`
6. `projects.json`
7. `trips.json`
8. `transactions.json` (last, depends on all other tables)

## Usage

### Step 1: Access with Query Parameter
Navigate to: `http://localhost:3000?loadSampleData=true`

### Step 2: Create New Database
Click "Create New Database" button

### Step 3: Automatic Loading
Sample data automatically loads with preserved primary keys

## Creating Sample Data Files

### Option 1: Export from Existing Database
1. Open the **Developer Console** (Settings → Developer Console)
2. Expand the **"Sample Data Export"** section
3. Click **"Export [table_name]"** for each table you want to export
4. Save the downloaded JSON files to `/public/sample-data/`

### Option 2: Manual Creation
Create JSON files following this format:

```json
{
  "table": "table_name",
  "data": [
    {
      "id": 1,
      "field1": "value1",
      "field2": "value2",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

## JSON File Format

### users.json
```json
{
  "table": "users",
  "data": [
    {
      "id": 1,
      "display_name": "Demo User",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### accounts.json
```json
{
  "table": "accounts",
  "data": [
    {
      "id": 1,
      "name": "Primary Checking",
      "type": "checking",
      "owner_user_id": 1,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### categories.json
```json
{
  "table": "categories",
  "data": [
    {
      "id": 1,
      "name": "Groceries",
      "color": "#4CAF50",
      "type": "expense",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### transactions.json
```json
{
  "table": "transactions",
  "data": [
    {
      "id": 1,
      "date": "2024-01-15",
      "amount": -85.43,
      "description": "Weekly grocery shopping",
      "account_id": 1,
      "category_id": 1,
      "company_id": 1,
      "project_id": null,
      "trip_id": null,
      "type": "expense",
      "transaction_hash": "1-2024-01-15--85.43-Weekly grocery shopping",
      "hash_variation_seed": 0,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

## Key Features

### ✅ Primary Key Preservation
- Uses explicit ID insertion for all records
- Maintains foreign key relationships across tables
- Automatically resets `sqlite_sequence` after loading

### ✅ Graceful Error Handling
- Missing files are silently skipped (no error thrown)
- Invalid JSON or foreign key violations cause errors with descriptive messages
- Database creation succeeds even if sample data fails

### ✅ Developer Console Integration
- Export any table to JSON format
- One-click export for all supported tables
- Downloaded files are ready to use as sample data

### ✅ Performance
- Batch inserts for fast loading
- Processes files sequentially to maintain dependencies
- Updates auto-increment sequences in one operation per table

## Technical Implementation

### Architecture
```
DatabaseContext → SampleDataService → DatabaseWorkerService → SharedWorker
```

### Key Files
- [`src/lib/sampleDataService.ts`](../src/lib/sampleDataService.ts) - Sample data loading logic
- [`src/lib/sqlQueries.ts`](../src/lib/sqlQueries.ts) - SQL queries for explicit ID insertion
- [`src/contexts/DatabaseContext.tsx`](../src/contexts/DatabaseContext.tsx) - Integration point
- [`src/components/common/Console/DeveloperConsolePage.tsx`](../src/components/common/Console/DeveloperConsolePage.tsx) - Export UI

### SQL Queries
```typescript
// Insert with explicit ID
INSERT INTO users (id, display_name, created_at, updated_at) 
VALUES (?, ?, ?, ?)

// Reset auto-increment sequence
UPDATE sqlite_sequence SET seq = ? WHERE name = ?
```

### Loading Process
1. Check URL for `?loadSampleData=true` parameter
2. After database creation, iterate through sample data files
3. For each file:
   - Fetch JSON from `/sample-data/[filename]`
   - Parse and validate structure
   - Insert records with explicit IDs
   - Track maximum ID
4. Reset `sqlite_sequence` for each table
5. Continue with normal data loading

## Error Handling

### Missing Files
```
[Sample Data] users.json not found, skipping...
```
- Files are optional
- Missing files won't break the database creation

### Invalid JSON
```
[Sample Data] Failed to load accounts.json: SyntaxError: Unexpected token
```
- Database creation succeeds
- Error displayed to user: "Database created but sample data failed to load"

### Foreign Key Violations
```
[Sample Data] Failed to load transactions.json: FOREIGN KEY constraint failed
```
- Ensure proper loading order
- Verify referenced IDs exist in parent tables

## Best Practices

### 1. Use Realistic Data
- Create sample data that represents real-world scenarios
- Include edge cases (nulls, long descriptions, etc.)
- Use current dates for better dashboard visualizations

### 2. Maintain Relationships
- Keep foreign key IDs consistent across files
- Verify `owner_user_id`, `account_id`, `category_id`, etc.
- Load files in dependency order

### 3. Start with Small Datasets
- 5-10 transactions per table for initial testing
- Expand as needed for specific test scenarios
- Keep sample data manageable for version control

### 4. Document Your Data
- Add comments in README about what the data represents
- Include scenarios covered (e.g., "Month with negative cash flow")
- Note any special test cases

### 5. Version Control
- Commit sample data files to git
- Update when database schema changes
- Tag versions that match schema migrations

## Troubleshooting

### Sample Data Not Loading
**Problem**: Created new database but no sample data appears

**Solutions**:
1. Verify URL contains `?loadSampleData=true`
2. Check browser console for errors
3. Verify JSON files exist in `/public/sample-data/`
4. Check JSON syntax is valid

### Primary Key Conflicts
**Problem**: Error: "UNIQUE constraint failed: users.id"

**Solutions**:
1. Clear browser storage and IndexedDB
2. Create completely new database
3. Ensure sample data IDs don't conflict with existing data

### Foreign Key Violations
**Problem**: Error: "FOREIGN KEY constraint failed"

**Solutions**:
1. Check loading order matches dependency tree
2. Verify all referenced IDs exist in parent tables
3. Check `owner_user_id` in accounts matches user ID
4. Ensure `account_id` in transactions matches account ID

### Large File Performance
**Problem**: Browser becomes unresponsive during load

**Solutions**:
1. Reduce sample data size (< 1000 records per table)
2. Remove unnecessary transactions
3. Consider chunked loading for very large datasets

## Examples

### Example 1: Basic Setup
```json
// users.json
{"table": "users", "data": [{"id": 1, "display_name": "Test User", ...}]}

// accounts.json
{"table": "accounts", "data": [{"id": 1, "owner_user_id": 1, "name": "Checking", ...}]}

// transactions.json
{"table": "transactions", "data": [{"id": 1, "account_id": 1, "amount": -50, ...}]}
```

### Example 2: Testing Budgets
Create sample data with:
- Multiple months of transactions
- Various categories
- Consistent spending patterns
- Budget violations

### Example 3: Trip Tracking
Create sample data with:
- Active trip with start_date < today
- Trip-tagged transactions
- Multiple trip categories
- Estimated vs actual costs

## Security Considerations

### Client-Side Only
- All sample data loaded client-side
- No server communication
- Files served as static assets

### Data Privacy
- Don't include real financial data in sample files
- Use fictional names and amounts
- Sanitize any exported data before committing

### Production
- Query parameter check ensures feature is opt-in
- No automatic loading without explicit URL parameter
- Safe to deploy with sample data files included

## Future Enhancements

### Potential Improvements
- [ ] Bulk export all tables at once
- [ ] Import sample data into existing database (merge mode)
- [ ] Sample data templates (personal, business, student)
- [ ] Randomized data generation
- [ ] Date range adjustment (shift all dates to current month)
- [ ] Compression for large sample datasets
- [ ] Sample data validation before loading
- [ ] Progress indicator during load

## API Reference

### SampleDataService

#### `loadAllSampleData(): Promise<void>`
Loads all sample data files from `/public/sample-data/` in dependency order.

#### `shouldLoadSampleData(): boolean`
Returns true if URL contains `?loadSampleData=true` parameter.

#### `exportTableToJSON(tableName: string): Promise<string>`
Exports a database table to JSON format for sample data creation.

### Usage in Code
```typescript
import { SampleDataService } from '@/lib/sampleDataService';

// Check if should load
if (SampleDataService.shouldLoadSampleData()) {
  await SampleDataService.loadAllSampleData();
}

// Export table
const json = await SampleDataService.exportTableToJSON('transactions');
```

## Changelog

### Version 1.0 (January 2026)
- Initial implementation
- Support for 8 core tables
- Developer Console export integration
- Automatic sequence reset
- Graceful error handling
- Documentation and examples
