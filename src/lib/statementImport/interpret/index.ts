/**
 * Interpretation and analysis: StatementTable → LayoutProposal → AnalysisReport.
 *
 *   proposeLayout     which column is what (header aliases in nine languages, then the
 *                     cell contents), one date order and one decimal mark for the whole
 *                     file, the sign of the amounts; every inference is an Assumption
 *                     (codes in ./assumptionCodes.ts) with its basis and confidence.
 *   analyzeStatement  the rows as they would be imported, with the user's overrides,
 *                     and the findings of the issue catalog (../issueCodes.ts).
 *
 * Pure: no React, no database. The signatures are part of the frozen contract
 * (../types.ts); everything else in this folder is internal to it and to ../ai.
 */

export { analyzeStatement } from './analyze';
export { ASSUMPTION_CODES, type AssumptionCode } from './assumptionCodes';
export { proposeLayout } from './proposeLayout';
