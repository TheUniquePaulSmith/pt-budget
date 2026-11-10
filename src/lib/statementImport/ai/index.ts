/**
 * AI help for layouts the built-in detection cannot work out.
 *
 * BASELINE (Import Wizard foundation). `buildAiLayoutSample` is real: it is
 * what the wizard shows the user before anything is sent. `suggestLayoutWithAi`
 * is a stub that never calls the provider; the interpretation agent writes the
 * prompt, the reply validation and the mapping to a LayoutProposal. Both
 * signatures are part of the frozen contract.
 */

import type { AiComplete, AiLayoutSample, LayoutProposal, StatementTable } from '../types';

export const AI_LAYOUT_SAMPLE_ROWS = 10;

/** Masks every run of more than four digits down to its last four ("400000000004821" → "•••4821"). */
export function maskLongDigitRuns(text: string): string {
  return text.replace(/\d{5,}/g, (digits) => `•••${digits.slice(-4)}`);
}

export function buildAiLayoutSample(table: StatementTable, maxRows = AI_LAYOUT_SAMPLE_ROWS): AiLayoutSample {
  return {
    headers: table.columns.map((column) => column.name),
    rows: table.rows.slice(0, maxRows).map((cells) => cells.map(maskLongDigitRuns)),
  };
}

/**
 * Asks the user's AI provider to read the file's layout. Resolves with a
 * proposal (basis `ai`) that goes through the same preview and analysis as a
 * detected one, or null when the reply is unusable. Never throws for a bad
 * reply; an aborted or failed provider call rejects.
 */
export async function suggestLayoutWithAi(
  _table: StatementTable,
  _complete: AiComplete,
  _signal?: AbortSignal
): Promise<LayoutProposal | null> {
  return null;
}
