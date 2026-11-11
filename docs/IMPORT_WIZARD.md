# Import Wizard

How transactions get from a bank's export file into the database: the guided import on the full-screen **Import**
page, the pure pipeline behind it, what it reports, and what it stores. `CLAUDE.md` has the short version; the code
wins where the two disagree.

## What the user does

The page has two views: **Import** (the wizard) and **History & formats**.

| Step | What happens |
|---|---|
| 1. Files | Drop or pick one or more files. Each statement in a file becomes one item in the queue (an OFX file with two accounts is two statements). |
| 2. Account | "Which account is this for?" The file's own account number is looked up; the result is *recognised*, *assumed* (with the reason) or asked. An account, and a person, can be created without leaving the import. |
| 3. Check how we read it | The first rows as they will be imported (date, description, money in / out), the role of each column, and the date order, decimal mark and sign in plain words. Advanced: header row, delimiter, encoding. "Ask AI" when a provider is set up and the detection is unsure. |
| 4. Things to check | Blockers, warnings and notes; the rows they concern, with fix or skip; duplicates; detected transfers; gaps and overlaps with what the account already has. Import stays out of reach while a blocker is open. |
| 5. Summary | Counts, date range, totals in and out, "Remember this format". |
| 6. Done | The result per statement, View transactions, Import another, Undo. |

A file in a format that was saved for the same account, with no blockers, goes straight to the summary.

## Pipeline

Everything in `src/lib/statementImport/` is pure (no React, no database, no `window`). The shapes are in `types.ts`;
components and services import from `index.ts` only.

```
bytes ─► readStatement ─► StatementTable ─► proposeLayout ─► ImportLayout ─► analyzeStatement ─► AnalysisReport
         readers/                           interpret/                        interpret/
```

### 1. `readStatement(file, options?)`: bytes to tables (`readers/`)

- The file is judged by its **content**, never by its extension, the wording of its header or the app language.
- Encoding (`encoding.ts`): byte-order mark, strict UTF-8, UTF-16 without a mark, the charset an OFX header declares,
  Windows-1252 as the fallback (`encodingGuessed`).
- Kind (`sniff.ts`): XLSX, XLS, PDF, QIF, HTML, images and other binaries come back as `unsupportedFormat` with
  `params.kind`. They are named, not read.
- Delimited text (`tokenize.ts`, `delimited.ts`): comma, semicolon, tab or pipe. The table is found by the shape of
  the cells, so lines above the header (`preambleSkipped`) and lines below the last row that are clearly not rows
  (`trailerSkipped`) are taken out and kept in `meta`. Headerless files get "Column n" names (`headerMissing`); rows
  of the wrong width are padded or cut and listed (`raggedRows`); a file that stops mid-row says so
  (`truncatedFile`). `sourceLines` are real file lines.
- OFX 1.x (SGML), OFX 2.x (XML) and QFX (`ofx.ts`): one table per statement, with a preset layout, the account
  number, type, institution and currency as hints, and `FITID` as the reference.
- Account hints (`accountHints.ts`): labelled values in the preamble, an IBAN anywhere, and numbers in the file name
  that are not date stamps.
- A file that cannot be read returns no tables and one issue. For a readable file, everything the reader decided is a
  note on the table.
- `fingerprint` identifies the file's shape (the header names, or the column count, or the OFX institution and
  account type). Saved formats are filed under it.

### 2. `proposeLayout(table, context?)`: what each column is (`interpret/`)

- Order of trust: a saved format, then evidence in the file, then the language's convention as a fallback.
- Columns: header aliases in the nine app languages (`headerAliases.ts`, `vocabulary.ts`), then the cell contents
  (`profile.ts`, `roles.ts`). Handles one signed amount column, a money-out / money-in pair, a DR / CR indicator,
  two date columns, a description spread over several columns, a reference, a running balance, a per-row account.
- **One date order per file** (`dateOrder.ts`): one unambiguous date settles it; otherwise the sequence of the rows,
  then the fallback. A file is never read with two orders (`parseCsvDate(…, { strict: true })`).
- **One decimal mark per file** (`decimal.ts`).
- **Sign** (`sign.ts`): from the running balance, telling words, the share of positive amounts and the account type.
  A card export with positive charges becomes `inverted`. The wizard always confirms the sign of a single amount
  column with a worded example, unless a saved format or an OFX preset settled it.
- Every inference is an `Assumption` (subject `columns`, `dateOrder`, `decimal` or `amountSign`; codes in
  `assumptionCodes.ts`) with its basis (`profile`, `file`, `history`, `language`, `default`, `ai`) and a confidence.
  Below 0.6 on the date order or the decimal mark, the wizard asks.

### 3. `analyzeStatement(table, layout, context)`: rows and findings (`interpret/analyze.ts`)

- Returns the rows as they would be imported, with the user's overrides (skip a row, or correct its date, amount or
  description; the file is never rewritten), the statistics for the summary, and the findings.
- A row that only reads in the other date order is blocked (`dateOrderMixed`), not guessed.
- Total lines among the data are left out automatically (`summaryRow`) and can be brought back.
- A money cell that only makes sense with the other decimal mark is `unreadableAmount`, never read as a different
  number.
- Coverage findings compare the file's dates with what the account already has (`getAccountImportCoverage`).

### AI help (`ai/`)

`buildAiLayoutSample` is exactly what would leave the device: the header and at most ten rows, with every run of
more than four digits masked to its last four. A hosted provider needs a confirmation that names it, each time; a
local endpoint does not. The reply only decides the columns; date order, decimal mark and sign are still read from
the whole file. The result is a proposal with basis `ai` that goes through the same preview and analysis.

## Findings

Every finding is a code in `issueCodes.ts` with a default severity and a scope, and a text in the `importIssues`
namespace (`issues.<code>.title` / `.detail`, `assumptions.<code>`) in nine languages. The UI renders codes; it does
not word a finding itself. `ISSUE_TEXT_PARAMS` lists the placeholders a text uses; row-scope titles are plural and
need `count`. The history keeps a count per code and nothing else, so a code whose title names a column or a
currency, or only makes sense while the import is open, also has a `summary` (`useFindingText.ts`). `issueCodes.test.ts` fails when a code has no text or a text has no code.

A **blocker** must be fixed or the rows skipped before Import is enabled. A **warning** is shown for a decision. An
**info** is a note.

| Scope | Code | Severity | What the user reads |
|---|---|---|---|
| file | `unsupportedFormat` | blocker | This kind of file cannot be imported |
| file | `emptyFile` | blocker | The file is empty |
| file | `noDataRows` | blocker | No transactions in this file |
| file | `encodingGuessed` | info | The text encoding was guessed |
| file | `preambleSkipped` | info | Lines above the column names were left out |
| file | `trailerSkipped` | info | Lines below the transactions were left out |
| file | `headerMissing` | warning | The file has no column names |
| file | `duplicateHeaderNames` | info | Two columns have the same name |
| file | `truncatedFile` | warning | The file seems to be cut off |
| file | `multipleAccountsInFile` | info | This file has more than one account |
| column | `dateOrderAmbiguous` | warning | Day and month could be the other way round |
| column | `dateOrderMixed` | blocker | {{count}} dates do not fit the order of the rest |
| column | `decimalAmbiguous` | warning | Check the decimal mark |
| column | `signAssumed` | warning | Check which amounts are money in and money out |
| column | `noDateColumn` | blocker | No date column |
| column | `noAmountColumn` | blocker | No amount column |
| column | `noDescriptionColumn` | blocker | No description column |
| column | `descriptionMostlyBlank` | warning | Most rows have no description |
| column | `referenceNotUnique` | info | “{{column}}” is not used to spot duplicates |
| column | `currencyMismatch` | warning | {{count}} rows are in {{fileCurrency}}, but the account is in {{accountCurrency}} |
| column | `columnNotImported` | info | “{{column}}” is not imported |
| row | `raggedRows` | warning | Some rows have more or fewer values than there are columns |
| row | `debitCreditBothFilled` | warning | {{count}} rows have both money out and money in |
| row | `unreadableDate` | blocker | {{count}} rows have a date we cannot read |
| row | `unreadableAmount` | blocker | {{count}} rows have an amount we cannot read |
| row | `excelMangledNumber` | blocker | {{count}} amounts were changed by a spreadsheet |
| row | `blankDescription` | warning | {{count}} rows have no description |
| row | `zeroAmount` | warning | {{count}} rows have an amount of zero |
| row | `futureDate` | warning | {{count}} rows are dated in the future |
| row | `dateFarFromOthers` | warning | {{count}} dates are far from the rest of the file |
| row | `amountOutlier` | info | {{count}} amounts are much larger than the rest |
| row | `pendingTransaction` | warning | {{count}} rows are still pending |
| row | `summaryRow` | info | {{count}} total lines were left out |
| row | `balanceMismatch` | warning | {{count}} rows do not match the bank's running balance |
| row | `duplicateInFile` | warning | Rows that appear more than once in this file |
| row | `alreadyImported` | info | Rows you have already imported |
| account | `accountRecognised` | info | Account recognised |
| account | `accountAssumedByLastFour` | warning | Account assumed from the last four digits |
| account | `accountAssumedByProfile` | warning | Account assumed from last time |
| account | `accountAssumedByName` | warning | Account assumed from its name |
| account | `accountAmbiguous` | blocker | More than one account matches |
| account | `accountValueMalformed` | warning | The account number in the file is damaged |
| account | `accountTypeMismatch` | warning | The file and the account are different kinds of account |
| account | `accountUnknown` | blocker | We do not know which account this file is for |
| coverage | `gapSinceLastImport` | warning | {{count}} days are not covered |
| coverage | `overlapsExisting` | info | Part of this file is already in the account |

The reader raises the first ten file codes and `raggedRows`. The wizard raises the account codes from
`AccountResolution` (`accountValueMalformed` instead of `accountUnknown` when a spreadsheet shortened the number to
something like `4.00E+14`) and `alreadyImported` (from staging). The analysis raises the rest, including
`accountTypeMismatch` when the file says what kind of account it is and the chosen account is another kind.

The layout warnings `dateOrderAmbiguous`, `decimalAmbiguous` and `signAssumed` describe what the *file* leaves open,
so the analysis returns them every time. The wizard hides them once the setting is confirmed or a saved format
settled it. A reader-preset layout (OFX) never gets them.

## Which account

`databaseService.imports.resolveAccounts` looks a value from the file up in this order:

1. The full number, in `account_cards.full_number` and `account_identifiers` (kind `number`): **recognised**.
2. The last four digits, in both tables: **assumed**.
3. A label (`account_identifiers`, kind `label`): **assumed**.
4. The account the saved format was last used for: **assumed**.
5. Nothing: **unknown**, with the accounts whose name or institution resembles the text as suggestions.

Every lookup goes through `accounts`, so a card, an identifier or a saved format that still points at a deleted
account is never matched (a reopened database does not enforce foreign keys, so those rows can outlive the account).

When several accounts match, the saved format's account settles it (still an assumption); otherwise the match is
**ambiguous** and the user chooses. Only a full-number match is ever called recognised. After a successful import the
wizard saves what the file called the account (`account_identifiers`, source `import`), so the next file is matched.

## What is stored (schema v7)

| Table | Holds |
|---|---|
| `import_profiles` | A saved format: name, format (`delimited` / `ofx`), fingerprint, institution, the account it is for, the layout and reader options (`config_json`), use count and last use. |
| `account_identifiers` | What statement files call an account: a number (with its last four) or a label, for any account type. Cards stay in `account_cards`. |
| `import_batches` | One row per imported statement: file name, accounts, counts, plus `profile_id`, `file_format` and `issues_json` (finding counts per code, accepted assumptions, rows fixed). |
| `temp_import_transactions` | The staging table (mirrors `transactions`). Emptied after every commit and on cancel. |

- **Saved formats** are trusted only for the account they were saved for. The same file shape used for another
  account keeps the columns, has its sign inferred and confirmed again, takes no fast path and saves its own format.
- **Sign** is stored in the saved format (`amountSign`). `accounts.import_sign_inverted` is unused.
- **Duplicates**: the SHA-256 transaction hash (account, date, amount, description) and `external_id` (the file's
  reference, the OFX `FITID`). Identical rows inside one file are all kept by default; the n-th copy carries a
  variation seed so a later overlapping file matches each stored copy. A reference that repeats within an account in
  one file is not used.
- **Commit** (`commitStaged`): one statement is one batch, in one transaction: the batch row and its details, the
  type decisions of the staged rows, the insert, the decisions for existing transfer legs, the totals. A failure
  leaves nothing behind. When every row is already stored, nothing is committed. Loan rules and the subscription
  scan run after the last file and are not part of the transaction.
- **Undo** (`undoBatch`, from History & formats): one transaction removes the batch's series links, loan payments
  and transactions, then the batch. The other leg of a transfer it was half of stays, unpaired: it goes back to
  income or expense by its sign unless the user set its type. The slice then recomputes the balance of each loan
  that lost a payment and refreshes the collections; the view re-runs the subscription scan. The confirmation shows
  the counts first (`getBatchImpact`).

Layering: `ImportWizard` / `ImportManage` → `useImportWizardSlice` / `useImportManageSlice` (`useImportsSlices.ts`)
→ `useDatabaseImportsSlice.ts` → `databaseService.imports` (`databaseServiceImports.ts`) → `sqlQueriesImports.ts`.

## Tests and fixtures

- `tests/fixtures/statements/` is the corpus: `raw/` for what the readers must cope with (written by
  `generate-fixtures.mjs` in that folder; rerun it, never edit the files), `layouts/` for what interpretation must
  work out. Each file has a `<name>.expected.json`; `corpus.test.ts` runs every one through the whole pipeline. The
  README there has the manifest format. **Synthetic data only**, and the files are byte-exact (`.gitattributes`).
- Service: `databaseServiceImports.test.ts` (stubbed transport) and `databaseServiceImportsSqlite.test.ts` (Node
  SQLite with the real schema: rollback on a failed commit, undo, identifier precedence).
- Wizard: `wizardModel.test.ts` (the reducer), `ImportWizard.test.tsx`; e2e in `tests/e2e/import-wizard.spec.ts`
  (card file with positive charges, fast path, bad rows, debit / credit, OFX, another account with a known format,
  two files, inline account creation, a 390 px screen) and `import-manage.spec.ts`.
- A spec that only needs imported rows calls `importStatementFile` from `tests/e2e/helpers/importFlow.ts`.

## Known limits

- XLSX, XLS, PDF and QIF are recognised and explained, not read.
- Loan statements import their payment amounts; principal, interest and escrow columns are reported as not imported.
- Two columns with the same header name (both "Amount") are not taken for a money-out / money-in pair; the user
  assigns them in step 3.
- A header repeated inside the data (paginated exports, a second "Pending" section) stays among the rows and shows
  up as unreadable rows.
- One staging table: two tabs importing at the same time are not supported.
- Transfers between accounts in different currencies are not paired automatically.
- The history keeps counts per finding, not the column or currency a finding named.
