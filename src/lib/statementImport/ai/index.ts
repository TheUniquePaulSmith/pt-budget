/**
 * AI help for layouts the built-in detection cannot work out.
 *
 * `buildAiLayoutSample` is exactly what would leave the device (the wizard
 * shows it in the confirmation before a remote provider is called), and the
 * prompt is built from that sample and nothing else. The prompt, the reply
 * validation and the mapping to a LayoutProposal live in ./layoutAssist.ts.
 * Both signatures here are part of the frozen contract.
 */

import type { AiComplete, AiLayoutSample, LayoutProposal, StatementTable } from '../types';

import { suggestLayout } from './layoutAssist';

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
 * proposal (every assumption has basis `ai` and a confidence of at most 0.7)
 * that goes through the same preview and analysis as a detected one, or null
 * when the reply is unusable. Never throws for a bad reply; an aborted or
 * failed provider call rejects.
 */
export async function suggestLayoutWithAi(
  table: StatementTable,
  complete: AiComplete,
  signal?: AbortSignal
): Promise<LayoutProposal | null> {
  return suggestLayout(table, buildAiLayoutSample(table), complete, signal);
}
