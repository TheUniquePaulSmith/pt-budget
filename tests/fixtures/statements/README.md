# Statement fixtures

The corpus the Import Wizard's pipeline is tested against: one file per shape of bank export, each with a
`<name>.expected.json` beside it. `src/lib/statementImport/corpus.test.ts` runs every fixture through
`readStatement` → `proposeLayout` → `analyzeStatement` and compares the result with what the manifest states.

| Folder | For | Owner |
|---|---|---|
| `raw/` | What the **readers** must cope with at the byte and file level: encodings, byte-order marks, line endings, delimiters, lines above the header, total rows, headerless files, OFX / QFX. | Readers |
| `layouts/` | What **interpretation and analysis** must work out from a cleanly read table: column roles, date order, decimal separator, sign, and the issues to report. Plain UTF-8, comma-separated, header first. | Interpretation |

## Rules

- **Synthetic data only.** Never commit a real statement, a real account number or a real person's name. Invent the
  rows; model the *shape* (column names and order, formats, quirks) on what banks export.
- One quirk per file where possible, named for it: `debit-credit-columns.csv`, `utf16-tab.txt`, `preamble-and-total.csv`.
- Files in these folders are byte-exact (`.gitattributes` turns off line-ending conversion). Create a fixture that
  needs a specific encoding or byte-order mark with a script, not an editor, and say how in its `description`.
- A manifest states only what the fixture is there to prove. Every section is optional, and a section that is absent
  is not checked, so a `raw/` fixture usually has `read` only and a `layouts/` fixture `layout` and `analysis`.

## `<name>.expected.json`

```jsonc
{
  "file": "debit-credit-columns.csv",          // the data file, in the same folder
  "description": "Checking export with separate Debit and Credit columns and a running balance.",

  // Inputs the test passes in (all optional).
  "context": {
    "today": "2026-11-10",                     // default 2026-11-10
    "accountType": "checking",                 // LayoutContext / AnalysisContext accountType
    "fallbackDateOrder": "MDY",
    "fallbackDecimal": "."
  },

  // What readStatement must return.
  "read": {
    "issues": [],                              // codes of ReadResult.issues, in order
    "tables": 1,
    // The rest describe the first table (or use "tableIndex" to pick another).
    "format": "delimited",
    "encoding": "utf-8",
    "delimiter": ",",
    "headerLine": 1,
    "columns": ["Date", "Description", "Debit", "Credit", "Balance"],
    "rows": 12,
    "notes": [],                               // codes of StatementTable.notes, in order
    "fingerprint": "delimited:date|description|debit|credit|balance"
  },

  // What proposeLayout must return (compared as a subset: extra keys are allowed).
  "layout": {
    "roles": { "date": 0, "description": [1], "debit": 2, "credit": 3, "balance": 4 },
    "dateOrder": "MDY",
    "decimal": ".",
    "amountSign": "asIs",
    "missing": []
  },

  // What analyzeStatement must return for that layout.
  "analysis": {
    "readyRows": 12,
    "blockedRows": 0,
    "skippedRows": 0,
    "firstDate": "2026-09-01",
    "lastDate": "2026-09-28",
    "moneyIn": 2400,
    "moneyOut": 1873.44,
    "issueCodes": []                           // codes of AnalysisReport.issues, sorted
  }
}
```
