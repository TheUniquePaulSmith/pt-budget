# Budget Tracker Application

A comprehensive personal finance management application designed for end-users to manage their finances, budgeting, and projects in a completely client-side environment.

## 🚀 Core Purpose

A powerful yet user-friendly budget tracking application that provides enterprise-level database functionality in a privacy-focused package that runs entirely in your browser. Perfect for personal finance management, home project budgeting, and comprehensive expense tracking.

## 🏗️ Architecture & Technology

- **Single Page Application (SPA)** - No server dependencies required
- **100% Client-Side** - No backend servers or server-side rendering
- **SQLite Database** - Uses wa-sqlite (SQLite compiled to WebAssembly) for robust data management
- **SharedWorker Architecture** - Database operations run in a dedicated SharedWorker for performance isolation
- **Browser Local Storage** - Uses IndexedDB and browser storage for persistent data
- **File System Access API** - Modern browser API for direct file saving/loading
- **React + TypeScript** - Built with Next.js framework and Material-UI components
- **Automated Compatibility Testing** - Built-in browser capability detection and testing

## ✨ Key Features

### 💰 Financial Management
- **Transaction Tracking** - Add, view, and categorize income/expense transactions
- **Category Management** - Custom categories with color coding for both income and expenses
- **Company/Vendor Tracking** - Manage and track transactions by company
- **Account Management** - Multiple account support
- **CSV Import/Export** - Import transactions from CSV files and export database backups

### 📊 Analytics & Reporting
- **Interactive Dashboard** - Real-time financial overview with charts
- **Spending Analysis** - Pie charts showing spending breakdown by category
- **Income Analysis** - Visual representation of income sources
- **Trend Analysis** - Line charts showing income vs expenses over time
- **Time Period Filtering** - View data by week, month, or year
- **Summary Statistics** - Total income, expenses, net income, and transaction counts

### 🏠 Project Management
- **House Projects** - Dedicated project tracking for home improvement/construction
- **Budget vs Actual** - Compare estimated costs to actual spending
- **Project-specific Transactions** - Link transactions to specific projects
- **Cost Analysis** - Track project costs and progress

### 💾 Data Management & Storage
- **Multiple Database Options:**
  - Create new database with file save location
  - Load existing database files
- **Persistent Storage** - Data persists automatically using IndexedDB
- **Data Export** - Complete database backups in .db format
- **SharedWorker Database Engine** - Database operations run in isolation for optimal performance
- **Cross-Tab Synchronization** - Multiple browser tabs share the same database instance

### 🔧 Advanced Features
- **Browser Compatibility Testing** - Automatic detection of required browser features
- **Real-time Compatibility Checks** - Tests SharedWorker, WebAssembly, SQLite, and storage support
- **Settings Management** - Comprehensive settings page with multiple tabs
- **Storage Quota Monitoring** - Track browser storage usage
- **Cross-Browser Compatibility** - Graceful degradation for browsers without File System Access API
- **Auto-Save Status Indicator** - Real-time status in navigation bar with tooltips
- **Data Validation** - Robust error handling and data integrity checks
- **Message-Based Architecture** - Clean communication between UI and database worker

### 🎨 User Experience
- **Modern Material Design** - Clean, intuitive interface
- **Responsive Layout** - Works on desktop and mobile devices
- **Dark/Light Theme Support** - Theme customization (coming soon)
- **Real-time Updates** - Instant data refresh across components
- **Progress Indicators** - Loading states and status feedback

## 🔒 Data Security & Privacy

### 🛡️ Complete Privacy Protection
- **100% Local Processing** - All data processing happens entirely in your browser
- **Zero Server Communication** - No data is ever transmitted to external servers
- **No Analytics or Tracking** - Application doesn't collect any usage data or personal information
- **No Third-Party Services** - No external APIs, CDNs, or cloud services are used
- **Offline Capability** - Works completely offline once loaded

### 🔐 Data Security Features
- **Local-First Architecture** - All financial data stays exclusively on your device
- **Browser-Native Encryption** - IndexedDB provides built-in data protection
- **File-Based Backups** - You maintain complete control over your data files
- **No Data Sharing** - Impossible for data to be shared since there's no backend
- **Secure Storage** - Uses browser's secure IndexedDB for persistent storage

### 🏠 Data Ownership & Control
- **Full Data Ownership** - You own and control all your financial data
- **Export Anytime** - Complete database export functionality available
- **No Vendor Lock-in** - Standard SQLite format ensures data portability
- **Manual Backups** - Create and manage your own backup files
- **Clear Data Path** - Transparent about where and how data is stored

## 🌟 Unique Selling Points

1. **No Backend Required** - Completely self-contained application
2. **Professional Database** - Full SQLite functionality in the browser
3. **File System Integration** - Direct file saving like desktop applications
4. **Project-Specific Budgeting** - Specialized for home project management
5. **Advanced Analytics** - Professional-grade financial reporting
6. **Persistent Storage** - Data persists automatically using IndexedDB
7. **SharedWorker Architecture** - Multi-tab synchronization with isolated database operations
8. **Built-in Compatibility Testing** - Automatic browser feature detection and validation

## 📊 Database Schema

For detailed information about the database structure and relationships, see [Database Schema - ER Diagram](./erDiagram.md). This includes:
- Complete entity relationship diagram
- Table structures and constraints
- Foreign key relationships
- CSV import mapping documentation
- Duplicate detection strategy

## 🚀 Getting Started

First, install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## 📁 Project Structure

```
budget-tracker/
├── src/
│   ├── app/                    # Next.js app directory
│   ├── components/             # React components
│   │   ├── Dashboard.tsx       # Main dashboard with analytics
│   │   ├── AddTransaction.tsx  # Transaction entry form
│   │   ├── DatabaseInitializer.tsx # Database setup
│   │   ├── SettingsPage.tsx    # Application settings
│   │   └── ...
│   ├── contexts/
│   │   └── DatabaseContext.tsx # Database state management
│   ├── lib/
│   │   ├── waSqliteDatabase.ts # wa-sqlite WebAssembly integration
│   │   ├── databaseService.ts  # Business logic and high-level operations
│   │   ├── databaseWorkerService.ts # SharedWorker communication layer
│   │   └── sqlQueries.ts       # Centralized SQL query definitions
│   ├── types/
│   │   └── database.ts         # TypeScript type definitions
│   └── workers/
│       └── databaseWorker.ts   # SharedWorker for database operations
├── public/
│   └── wa-sqlite/             # wa-sqlite WebAssembly files
└── ...
```

### SharedWorker Database Architecture

The application uses a sophisticated multi-layered architecture for database operations:

```
React Components → DatabaseService → DatabaseWorkerService → SharedWorker
                     (business)        (transport)           (execution)
```

**Layer Breakdown:**

1. **database.ts** - Type definitions and interfaces for all data models
2. **databaseService.ts** - Business logic layer containing SQL queries, data mapping, and validation
3. **databaseWorkerService.ts** - Communication layer managing message passing with SharedWorker
4. **databaseWorker.ts** - SharedWorker that runs database operations in isolation

**SharedWorker Benefits:**
- **Performance Isolation** - Database operations don't block the main UI thread
- **Multi-Tab Synchronization** - Multiple browser tabs share the same database instance
- **Memory Efficiency** - Single database connection shared across all tabs
- **Background Processing** - Heavy operations (CSV imports, exports) run in background

### Database Service Architecture Details

The database layer follows a clean, multi-tier architecture with clear separation of concerns:

#### Core Database Files

**1. `/types/database.ts` - Type Definitions**
- Defines TypeScript interfaces for all data models (Transaction, Category, Company, etc.)
- Provides type safety and IntelliSense throughout the application
- Acts as the "contract" defining data structure expectations
- Referenced by both services and UI components

**2. `databaseWorkerService.ts` - Communication Layer**
- Manages message passing between main thread and SharedWorker
- Handles worker lifecycle, connection management, and heartbeat monitoring
- Provides low-level database operations (query, exec, import/export)
- Acts as the "transport layer" for database communication
- Implements timeout handling and error recovery

**3. `databaseService.ts` - Business Logic Layer**
- Contains actual SQL queries and business rules
- Maps database rows to TypeScript objects
- Handles transaction hashing, duplicate detection, and validation
- Provides clean, high-level API for React components
- Implements domain-specific operations (analytics, project costs, etc.)

**4. `/workers/databaseWorker.ts` - Execution Layer**
- SharedWorker that runs database operations in isolation
- Manages wa-sqlite WebAssembly instance
- Handles IndexedDB storage and file operations
- Processes heavy operations without blocking UI

#### Architecture Flow

```
React Components → DatabaseService → DatabaseWorkerService → SharedWorker
                     (business)        (transport)           (execution)
```

| Layer | File | Responsibility | Why It's Essential |
|-------|------|----------------|-------------------|
| **Types** | `database.ts` | Type definitions | Type safety, IntelliSense, contracts |
| **Business** | `databaseService.ts` | SQL queries, data mapping, validation | Clean API, business logic isolation |
| **Transport** | `databaseWorkerService.ts` | Message passing, connection management | Worker communication, error handling |
| **Execution** | `databaseWorker.ts` | Database operations, storage management | Performance isolation, multi-tab sync |

#### Supporting Database Files

**5. `sqlQueries.ts` - SQL Query Definitions**
- Contains all SQL statements organized by entity (transactions, categories, etc.)
- Centralizes query management for maintainability
- Separates SQL logic from business logic
- Enables easy query optimization and debugging

**6. `waSqliteDatabase.ts` - SQLite Integration Layer**
- Manages wa-sqlite WebAssembly initialization
- Handles SQLite-specific operations and configurations
- Provides SQLite instance management
- Bridges between JavaScript and SQLite WASM

This architecture ensures:
- **Maintainability** - Clear separation of concerns makes code easy to modify
- **Testability** - Each layer can be tested independently
- **Performance** - Database operations don't block the UI thread
- **Scalability** - Easy to add new features without affecting existing code
- **Type Safety** - TypeScript ensures data integrity across all layers
## 🛠️ Building for Production

Build the application:

```bash
npm run build
```

The build is optimized for production and includes:
- Code splitting and optimization
- Static asset optimization
- TypeScript compilation
- ESLint validation

## 🌐 Browser Compatibility

- **Modern Browsers** - Chrome, Firefox, Safari, Edge (latest versions)
- **File System Access API** - Available in Chromium-based browsers for auto-save
- **Graceful Degradation** - Manual export/import in browsers without File System Access
- [Note] Does not currently work on Chrome for Android, but slated to be fixed in late 2025

## 📋 Requirements

- Modern web browser with JavaScript enabled
- Node.js 18+ (for development)
- ~50MB available browser storage for large databases

## 🤝 Contributing

This is a personal finance application designed for individual use. The codebase is structured for easy customization and extension.

## 📄 License

This project is for personal use. Please ensure you comply with all dependencies' licenses when modifying or distributing.

---

**Built with ❤️ using Next.js, React, TypeScript, and SQLite**