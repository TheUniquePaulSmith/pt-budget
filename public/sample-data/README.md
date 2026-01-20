# Sample Data for Budget Tracker

This directory contains sample data files that can be automatically loaded into the database for development and testing purposes.

## Usage

To load sample data when creating a new database:

1. Navigate to the app with the query parameter: `http://localhost:3000?loadSampleData=true`
2. Click "Create New Database"
3. Sample data will automatically be loaded

## File Format

Each JSON file should follow this structure:

```json
{
  "table": "table_name",
  "data": [
    {
      "id": 1,
      "field1": "value1",
      "field2": "value2",
      ...
    }
  ]
}
```

## Available Files

- **users.json** - User accounts
- **accounts.json** - Bank accounts, credit cards, etc.
- **categories.json** - Transaction categories (income/expense)
- **companies.json** - Company/merchant names
- **transactions.json** - Sample transactions
- **projects.json** - Projects (optional)
- **trips.json** - Trips (optional)
- **account_cards.json** - Credit card details (optional)

## Loading Order

Files are loaded in dependency order to maintain foreign key relationships:

1. users
2. accounts
3. account_cards
4. categories
5. companies
6. projects
7. trips
8. transactions (last, as it depends on all other tables)

## Primary Keys

The sample data loader preserves primary key IDs, so you can create relationships between tables. After loading, the auto-increment sequence is reset to the maximum ID to prevent conflicts.

## Creating Sample Data

You can export existing database tables to create sample data files:

1. Use the Developer Console (when implemented)
2. Click "Export [table_name]" button
3. Save the JSON file to this directory
4. Edit as needed to create sample data

## Notes

- Missing files are silently skipped (no error)
- Invalid JSON or missing foreign keys will cause errors
- Sample data only loads when `?loadSampleData=true` is in the URL
- Sample data loads after database initialization, before data refresh
