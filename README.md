# Budget Tracker Application

A client-side personal finance and project cost tracking application built with Next.js, React, TypeScript, Material UI, and SQLite WebAssembly. The app runs entirely in the browser, keeps data local to the user, and still provides a worker-backed database, cross-tab synchronization, import/export workflows, analytics, and browser-backed automated tests.

## 🚀 Core Purpose

Budget Tracker is designed to manage day-to-day finances and longer-running spending work in one place. The current codebase supports:

- Personal income and expense tracking
- Category, company, account, and account-card management
- House project and trip tracking with transaction labeling
- CSV-based transaction import with duplicate analysis
- Local-first database storage and exportable SQLite backups

## 🏗️ Architecture & Technology

- **Next.js 15 App Router** with static export output and a client-only application shell
- **React 19 + TypeScript 5** for the UI and application logic
- **Material UI 7** with MUI X charts, data grid, and date pickers
- **wa-sqlite / WebAssembly SQLite** assets served from `public/`
- **SharedWorker-backed database execution** in `public/database-worker.js`
- **Local browser persistence** using browser-managed storage plus file import/export flows
- **Dedicated database domain contexts** with thin adapter hooks in `src/contexts/useDatabaseSlices.ts`
- **Local AI side panel** using wllama for browser-based GGUF model inference
- **Vitest + Playwright** for deterministic unit coverage and real-browser worker/database validation

## ✨ Key Features

### 💰 Financial Management

- **Transaction Tracking**: add, filter, sort, and review income and expense transactions
- **Category and Company Management**: create and manage transaction metadata directly in the app
- **Account Management**: manage accounts, account ownership, and account cards
- **Project and Trip Labels**: attach transactions to projects and trips for grouped reporting
- **CSV Import Pipeline**: import transaction files with column auto-detection, account matching, duplicate analysis, and temp-table staging

### 📊 Analytics & Reporting

- **Interactive Dashboard** with summary cards, date-range controls, charts, and recent transactions
- **Transaction Report** with search, advanced filters, column visibility controls, sorting, pagination, and label editing
- **Category / Company / Account-aware reporting** using joined transaction data from the browser-backed database
- **Read-only SQL Query Page** for direct `SELECT` inspection of database state during debugging and validation
- **Local AI Assistant** for model-assisted transaction analysis, recurring subscription detection, and staged transaction classification suggestions

### 🏠 Planning & Organization

- **Project Management** for estimated costs and linked spending
- **Trip Management** for travel-related tracking and transaction grouping
- **Manage Data Dialog** for maintaining reusable categories and companies

### 💾 Storage, Import, and Diagnostics

- **Create New Database / Load Existing Database** flows through the initialization gate
- **SQLite Export** from the dashboard and settings UI
- **Cross-Tab Synchronization** through a shared worker-backed database session
- **Storage Quota Monitoring** in the settings page
- **Browser Compatibility Gate** before database setup
- **Developer Console** with log capture/export, plus developer-only sample data export tooling when `?dev=true` is present

### Local AI Models

The AI side panel is local-only and does not auto-load a model. Use the `Choose GGUF` button in the Model tab to select a local `.gguf` file from your machine. The picker filters for GGUF files. For split models, select all `.gguf` shard files together; the app sorts the selected files by name before loading them.

The app serves wllama's wasm asset locally from `public/wllama/wllama.wasm`; no CDN inference path is required. WebGPU is detected at runtime. Multi-threaded wasm may require the host to serve `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers; static export hosting must be configured separately if those headers are needed.

## 🔒 Data Security & Privacy

### 🛡️ Local-First by Design

- **100% Local Processing**: all application logic and database work run in the browser
- **Local AI Inference**: GGUF models are loaded by the browser with wllama after explicit user selection
- **No Backend Required**: there is no application server or remote database
- **No Required Cloud Services**: the app does not depend on external data services to function
- **Offline-Friendly Runtime**: once loaded, the app can continue working with local browser storage

### 🔐 User Control

- **Data stays on the device** unless the user explicitly exports it
- **SQLite backup export** keeps data portable
- **File-based workflows** make ownership and backup strategies explicit
- **No vendor lock-in** because exported data is in standard SQLite format

## 🌟 What Makes This App Different

1. **Browser-only database architecture** with a real SQLite engine in the client
2. **SharedWorker execution** for multi-tab access and UI-thread isolation
3. **Project and trip budgeting workflows** alongside regular finance tracking
4. **Practical diagnostics** including SQL inspection, storage monitoring, and console capture
5. **Real browser test coverage** for the worker, WebAssembly, and persistence path

## 📊 Database Schema

For detailed information about the database structure and relationships, see [Database Schema - ER Diagram](./erDiagram.md). This includes:

- Complete entity relationship diagram
- Table structures and constraints
- Foreign key relationships
- CSV import mapping documentation
- Duplicate detection strategy

## 🚀 Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a compatible browser.

## 🧪 Testing

The project uses a two-lane testing strategy:

- **Vitest** for unit and component coverage of service logic, context hooks, and focused UI behavior
- **Playwright (Chromium)** for browser-backed validation of SharedWorker communication, persistence, and real user flows

### Test Commands

```bash
# Default local verification after a change
npm test

# Fast unit and component suite only
npm run test:unit

# Unit suite with enforced coverage
npm run test:unit:coverage

# Watch mode for local editing
npm run test:unit:watch

# Smoke subset of browser coverage
npm run test:e2e:smoke

# Full browser suite
npm run test:e2e
```

### What Each Lane Covers

- `npm run test:unit` runs the Vitest suite for files under `src/**/*.{test,spec}.{ts,tsx}`.
- `npm run test:unit:coverage` runs the same unit suite with V8 coverage reporting enabled.
- `npm run test:e2e:smoke` runs only Playwright tests tagged `@smoke`, which currently verify create/reopen persistence of the browser-backed database.
- `npm run test:e2e` runs the full browser suite in `tests/e2e/database-smoke.spec.ts`, including cross-page SharedWorker sharing, transaction creation, project-linked transaction verification, and worker recovery after disconnect.

### Testing Notes

- Browser tests run against `http://localhost:3000` and reuse an existing local dev server when one is already available.
- Coverage is currently enforced for [src/lib/databaseService.ts](./src/lib/databaseService.ts), which remains the highest-value deterministic business layer in the app.
- The HTML coverage report is written to `coverage/index.html`.
- The SQL Query page is intentionally read-only; mutating flows in browser tests should happen through real UI paths such as dashboard, trips, or projects.

## 📁 Project Structure

```text
budget-tracker/
├── src/
│   ├── app/                              # Next.js app entry, layout, global styles
│   ├── components/                       # Feature-based React components
│   │   ├── accounts/
│   │   ├── common/
│   │   ├── csv-import/
│   │   ├── dashboard/
│   │   ├── data-management/
│   │   ├── projects/
│   │   ├── settings/
│   │   ├── setup/
│   │   ├── sql-query/
│   │   ├── transactions/
│   │   └── trips/
│   ├── contexts/
│   │   ├── DatabaseContext.tsx
│   │   ├── LoggingContext.tsx
│   │   ├── useDatabaseSlices.ts
│   │   ├── useDatabaseInitialization.ts
│   │   ├── useDatabaseCollectionsState.ts
│   │   ├── useDatabaseTransactionSlice.ts
│   │   ├── useDatabaseAccountManagementSlices.ts
│   │   └── useDatabaseCatalogAndPlanningSlices.ts
│   ├── lib/
│   │   ├── csvImportService.ts
│   │   ├── databaseService.ts
│   │   ├── databaseWorkerService.ts
│   │   ├── sampleDataService.ts
│   │   └── sqlQueries.ts
│   ├── theme/
│   └── types/
├── public/
│   ├── database-worker.js                # SharedWorker execution layer
│   ├── sample-data/                      # JSON sample data used for local bootstrap
│   ├── sql-wasm/                         # SQL.js assets
│   ├── test-wa-sqlite.html               # Browser compatibility/testing helper
│   └── wa-sqlite/                        # wa-sqlite WebAssembly assets
├── tests/
│   └── e2e/
│       └── database-smoke.spec.ts
├── docs/
├── playwright.config.ts
├── vitest.config.ts
└── README.md
```

## 🧩 Current Database Architecture

The current codebase has a layered database and state model:

```text
React Components
  -> useDatabaseSlices.ts
  -> DatabaseContext domain hooks / providers
  -> DatabaseService
  -> DatabaseWorkerService
  -> public/database-worker.js
```

### Layer Breakdown

| Layer | Files | Responsibility |
|-------|-------|----------------|
| **Types** | `src/types/database.ts` | Shared TypeScript contracts for transactions, projects, trips, accounts, and related entities |
| **UI State / Context** | `src/contexts/DatabaseContext.tsx`, `src/contexts/useDatabaseSlices.ts`, internal slice hooks | Database initialization, cached collection state, domain contexts, and component-facing adapter hooks |
| **Business Logic** | `src/lib/databaseService.ts`, `src/lib/sqlQueries.ts` | SQL orchestration, row mapping, validation, analytics helpers, duplicate detection, and domain-specific operations |
| **Transport** | `src/lib/databaseWorkerService.ts` | Message passing, worker lifecycle, timeout handling, heartbeat/status management |
| **Execution** | `public/database-worker.js` | SharedWorker-hosted database execution and browser persistence integration |
| **Import / Sample Data Support** | `src/lib/csvImportService.ts`, `src/lib/sampleDataService.ts` | CSV mapping, duplicate grouping, account matching, and sample-data bootstrap/export helpers |

### Context Architecture

The provider layer has also been simplified compared to earlier versions of the app:

- `DatabaseProvider` now composes dedicated internal hooks instead of owning one large flat implementation file
- Provider-backed collection state lives in `useDatabaseCollectionsState.ts`
- Mutation logic is separated by domain into transaction, account/user, and catalog/planning hooks
- Dedicated domain hooks such as `useDatabaseStatus`, `useDatabaseCollections`, and `useDatabaseTransactions` are exposed from `DatabaseContext.tsx`
- `useDatabaseSlices.ts` remains the consumer-facing compatibility layer used by components

## 🛠️ Building for Production

Build the application:

```bash
npm run build
```

The current Next.js configuration uses static export output, so the production build is written to `dist/`.

## 🌐 Browser Compatibility

- **Modern desktop browsers** with JavaScript, WebAssembly, and SharedWorker support are the primary target
- **Chromium-based browsers** provide the best file-handling experience
- **Compatibility is checked at runtime** before database setup begins
- **Android/experimental support is browser-dependent**; the app currently includes an origin-trial meta tag in the layout for SharedWorker-on-Android experimentation, but mobile compatibility should still be validated per browser/device

## 📋 Requirements

- Node.js 18+ for development
- A modern browser with JavaScript, WebAssembly, and browser storage support
- Sufficient local browser storage for SQLite data and imports

## 🤝 Contributing

This is a personal finance application designed for individual use, but the codebase is structured to support continued refinement of the browser database architecture, UI workflows, and test coverage.

## 📄 License

This project is for personal use. Please ensure you comply with all dependency licenses when modifying or distributing it.

---

Built with Next.js, React, TypeScript, Material UI, and SQLite WebAssembly.