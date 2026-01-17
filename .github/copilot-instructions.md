# Budget Tracker - AI Coding Instructions

## Project Overview
This is a **100% client-side** personal finance application built with Next.js, TypeScript, and Material-UI. No backend servers - everything runs in the browser using SQLite WebAssembly with SharedWorker architecture for cross-tab synchronization.

## Core Architecture

### Database Layer Architecture
The app uses a sophisticated 4-layer database architecture:

1. **Types Layer**: [`src/types/database.ts`](src/types/database.ts) - TypeScript interfaces for all data models
2. **Business Layer**: [`src/lib/databaseService.ts`](src/lib/databaseService.ts) - SQL queries, data mapping, validation
3. **Transport Layer**: [`src/lib/databaseWorkerService.ts`](src/lib/databaseWorkerService.ts) - Message passing with SharedWorker
4. **Execution Layer**: [`public/database-worker.js`](public/database-worker.js) - SharedWorker running wa-sqlite WASM

```
React Components → DatabaseService → DatabaseWorkerService → SharedWorker
                     (business)        (transport)           (execution)
```

### Key Files by Layer
- **Business Logic**: All SQL queries in [`src/lib/sqlQueries.ts`](src/lib/sqlQueries.ts), organized by entity
- **Context Management**: [`src/contexts/DatabaseContext.tsx`](src/contexts/DatabaseContext.tsx) - Single context for database + data management
- **Worker Communication**: Message-based async communication with timeout handling
- **Data Flow**: Always use `useDatabaseContext()` hook for database operations in components

## Development Patterns

### Adding New Database Operations
1. Add SQL query to [`src/lib/sqlQueries.ts`](src/lib/sqlQueries.ts) under appropriate entity section
2. Add types/interfaces to [`src/types/database.ts`](src/types/database.ts) if needed
3. Add method to [`src/lib/databaseService.ts`](src/lib/databaseService.ts) that calls the worker
4. Update [`src/lib/databaseWorkerService.ts`](src/lib/databaseWorkerService.ts) to send message to SharedWorker based off query type
5. Update SharedWorker (`public/database-worker.js`) to handle new query type and return results
6. Expose new method in [`DatabaseContext`](src/contexts/DatabaseContext.tsx

### Component Architecture
- **Dialog Pattern**: Transaction forms use Material-UI dialogs (see [`src/components/AddTransaction.tsx`](src/components/AddTransaction.tsx))
- **Auto-complete Pattern**: Company/category creation on-the-fly using Autocomplete with `getOptionLabel`
- **Data Grid Pattern**: Use `@mui/x-data-grid` for tabular data with built-in sorting/filtering
- **Chart Pattern**: Use `@mui/x-charts` or `recharts` for analytics dashboards

### State Management Conventions
- **Single Context**: [`DatabaseContext`](src/contexts/DatabaseContext.tsx) manages both database connection + all data arrays
- **Optimistic Updates**: Update local state when callback succeeds, rollback on error
- **Memoization**: Use `useMemo` and `useCallback` extensively to prevent unnecessary re-renders
- **Error Boundaries**: Use try/catch in context methods, expose `error` state to components
- **Loading States**: Context exposes `isLoading` for operations, components show progress indicators

## Critical Development Setup

### Running the Application
```bash
npm run dev  # Uses Next.js with Turbopack for fast development
```
- **Port**: Development server runs on `http://localhost:3000`
- **SharedWorker**: Database worker accessible at `/database-worker.js` (public directory)
- **SQLite Files**: wa-sqlite WASM files served from `/public/wa-sqlite/`

### Database Development Workflow
1. **Schema Changes**: Update [`src/types/database.ts`](src/types/database.ts) interfaces first
2. **SQL Updates**: Modify queries in [`src/lib/sqlQueries.ts`](src/lib/sqlQueries.ts)
3. **Service Layer**: Update business logic in [`src/lib/databaseService.ts`](src/lib/databaseService.ts)
4. **Context Updates**: Expose new operations in [`DatabaseContext`](src/contexts/DatabaseContext.tsx)
5. **Migration**: Add table creation/modification SQL to worker initialization

### Testing Database Features
- **Browser Testing**: Use `/public/test-wa-sqlite.html` for wa-sqlite compatibility testing
- **Worker Debugging**: Check browser DevTools → Application → SharedWorkers
- **Database Inspection**: Export database and use SQLite browser tools

## Key Integration Points

### CSV Import System
- **Parser**: Uses `papaparse` library for CSV parsing
- **Mapping**: Dynamic field mapping UI in [`CSVImport`](src/components/CSVImport.tsx) component
- **Duplicate Detection**: Automatic hash-based duplicate prevention using account+date+amount+description
- **Batch Processing**: Large CSV files processed in chunks to prevent UI blocking

### File System Integration
- **Modern Browsers**: Uses File System Access API for direct file save/load (Chrome/Edge)
- **Fallback**: Traditional download/file input for other browsers
- **Format**: SQLite database files (.db) with optional compression

### SharedWorker Communication
- **Message Pattern**: All database operations use async message passing with unique IDs
- **Timeout Handling**: 30-second timeout on database operations with proper cleanup
- **Multi-tab Sync**: SharedWorker ensures data consistency across browser tabs
- **Heartbeat**: Regular status checking between main thread and worker, when disconnnected, attempt to reconnect, disable operations until reconnected

## Project-Specific Conventions

### Transaction Management
- **Amount Convention**: Negative for expenses, positive for income (enforced in business layer)
- **Hash Generation**: Automatic duplicate detection using account+date+amount+description hash
- **Association Pattern**: Transactions can link to categories, companies, projects, and trips
- **Audit Trail**: All entities have `created_at` and `updated_at` timestamps

### UI Component Patterns
- **Form Validation**: Client-side validation with Material-UI form helpers
- **Auto-save**: Real-time status indicator in navigation showing database save status
- **Responsive Design**: Mobile-first approach using Material-UI breakpoint system
- **Color Coding**: Categories use color picker with hex color storage

### Data Model Relationships
```
User (1) → Accounts (M) → Transactions (M)
Transactions (M) → Categories (1), Companies (1), Projects (1), Trips (1)
Projects/Trips → Budget tracking with estimated vs actual costs
```

## Common Gotchas
- **Worker Initialization**: Always check `isDatabaseLoaded` before database operations
- **Type Safety**: Use exact interfaces from [`database.ts`](src/types/database.ts) - worker communication is untyped
- **Client-Side Only**: No server-side rendering - use `'use client'` directive and check `typeof window`
- **SharedWorker Support**: Require modern browsers that support SharedWorkers
- **Memory Management**: Large CSV imports need chunked processing to prevent tab crashes

## Performance Considerations
- **Database Queries**: Use indexed columns (id, date, account_id) for filtering
- **Component Optimization**: Use React.memo for heavy data grid components  
- **Worker Offloading**: Heavy operations (CSV processing, analytics) run in SharedWorker
- **Lazy Loading**: Charts and complex visualizations load on demand