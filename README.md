# Budget Tracker Application

A comprehensive personal finance management application designed for end-users to manage their finances, budgeting, and projects in a completely client-side environment.

## 🚀 Core Purpose

A powerful yet user-friendly budget tracking application that provides enterprise-level database functionality in a privacy-focused package that runs entirely in your browser. Perfect for personal finance management, home project budgeting, and comprehensive expense tracking.

## 🏗️ Architecture & Technology

- **Single Page Application (SPA)** - No server dependencies required
- **100% Client-Side** - No backend servers or server-side rendering
- **SQLite Database** - Uses SQL.js (SQLite compiled to WebAssembly) for robust data management
- **IndexedDB Storage** - Stores serialized SQLite database for session persistence
- **File System Access API** - Modern browser API for direct file saving/loading
- **React + TypeScript** - Built with Next.js framework and Material-UI components

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
  - Resume previous session (auto-loads from browser storage)
- **Auto-Save Functionality** - Automatic saving to chosen file location
- **Session Persistence** - Continue where you left off using IndexedDB
- **Data Export** - Complete database backups in .db format

### 🔧 Advanced Features
- **Settings Management** - Comprehensive settings page with multiple tabs
- **Storage Quota Monitoring** - Track browser storage usage
- **Cross-Browser Compatibility** - Graceful degradation for browsers without File System Access API
- **Auto-Save Status Indicator** - Real-time status in navigation bar with tooltips
- **Data Validation** - Robust error handling and data integrity checks

### 🎨 User Experience
- **Modern Material Design** - Clean, intuitive interface
- **Responsive Layout** - Works on desktop and mobile devices
- **Dark/Light Theme Support** - Theme customization (coming soon)
- **Real-time Updates** - Instant data refresh across components
- **Progress Indicators** - Loading states and status feedback

## 🔒 Data Security & Privacy

- **Local-First Approach** - All data stays on your device
- **No Cloud Dependencies** - No external servers or data transmission
- **File-Based Backups** - You control your own data files
- **Browser Storage** - Encrypted IndexedDB storage for session data

## 🌟 Unique Selling Points

1. **No Backend Required** - Completely self-contained application
2. **Professional Database** - Full SQLite functionality in the browser
3. **File System Integration** - Direct file saving like desktop applications
4. **Project-Specific Budgeting** - Specialized for home project management
5. **Advanced Analytics** - Professional-grade financial reporting
6. **Session Continuity** - Never lose work with automatic session saving

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
│   │   ├── AutoSaveIndicator.tsx   # Auto-save status
│   │   ├── SettingsPage.tsx    # Application settings
│   │   └── ...
│   ├── contexts/
│   │   └── DatabaseContext.tsx # Database state management
│   ├── lib/
│   │   ├── database.ts         # SQLite database manager
│   │   └── sessionManager.ts   # Session persistence
│   └── types/                  # TypeScript type definitions
├── public/
│   └── sql-wasm/              # SQLite WebAssembly files
└── ...
```

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

## 📋 Requirements

- Node.js 18+ 
- Modern web browser with JavaScript enabled
- ~50MB available browser storage for large databases

## 🤝 Contributing

This is a personal finance application designed for individual use. The codebase is structured for easy customization and extension.

## 📄 License

This project is for personal use. Please ensure you comply with all dependencies' licenses when modifying or distributing.

---

**Built with ❤️ using Next.js, React, TypeScript, and SQLite**