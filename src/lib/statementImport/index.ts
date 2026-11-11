/**
 * Statement import: the pure pipeline behind the Import Wizard.
 *
 *   readStatement(file)                  bytes → one StatementTable per account in the file
 *   proposeLayout(table, context)        which column is what, date order, decimal, sign
 *   analyzeStatement(table, layout, …)   normalised rows + everything worth telling the user
 *
 * Components and services import from here, never from the sub-folders.
 * docs/IMPORT_WIZARD.md describes the stages and the issue catalog.
 */

export { buildAiLayoutSample, maskLongDigitRuns, suggestLayoutWithAi } from './ai';
export { analyzeStatement, isExcelMangled, proposeLayout } from './interpret';
export {
  ALL_IMPORT_ISSUE_CODES,
  IMPORT_ISSUE_CODES,
  type ImportIssueCode,
  defaultSeverityOf,
  scopeOf,
} from './issueCodes';
export { fingerprintOfColumns, readStatement } from './readers';
export type * from './types';
