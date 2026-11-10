import { describe, expect, it, vi } from 'vitest';

import { tableFromCells, tableFromCsv } from '../testing/tableFromCsv';
import type { AiComplete } from '../types';

import { buildAiLayoutSample, suggestLayoutWithAi } from './index';
import { AI_MAX_CONFIDENCE, buildAiLayoutPrompt, parseAiLayoutReply } from './layoutAssist';

/** A file whose headers say nothing, with an account number that must never leave the device. */
const ODD = tableFromCells([
  ['F1', 'F2', 'F3', 'F4'],
  ['400000000004821', '23/09/2026', 'CARD 1234 REF 99887766', '-54,20'],
  ['400000000004821', '24/09/2026', 'PAYROLL 5550001234', '2.400,00'],
  ['400000000004821', '25/09/2026', 'COFFEE', '-4,50'],
]);

const reply = (answer: unknown): AiComplete => async () => JSON.stringify(answer);
const GOOD = { date: 1, description: [2], amount: 3, account: 0, dateOrder: 'MDY', decimal: '.', amountSign: 'asIs' };

describe('AI layout help: what is sent', () => {
  it('builds the prompt from the masked sample and nothing else', async () => {
    const complete = vi.fn<AiComplete>(async () => JSON.stringify(GOOD));
    await suggestLayoutWithAi(ODD, complete);

    expect(complete).toHaveBeenCalledTimes(1);
    const [prompt] = complete.mock.calls[0];
    expect(prompt).toEqual(buildAiLayoutPrompt(buildAiLayoutSample(ODD)));
    const sent = `${prompt.system}\n${prompt.user}`;
    // No run of more than four digits from the file: account and reference numbers are masked.
    expect(sent).not.toMatch(/400000000004821|99887766|5550001234/);
    expect(prompt.user.match(/\d{5,}/g)).toBeNull();
    expect(prompt.user).toContain('•••4821');
    expect(prompt.user).toContain('CARD 1234 REF •••7766');
    expect(JSON.parse(prompt.user).columns).toEqual([
      { index: 0, name: 'F1' },
      { index: 1, name: 'F2' },
      { index: 2, name: 'F3' },
      { index: 3, name: 'F4' },
    ]);
  });

  it('sends at most ten rows, and passes the abort signal on', async () => {
    const many = tableFromCells([['A', 'B', 'C'], ...Array.from({ length: 40 }, (_, row) => [`2026-09-${String((row % 28) + 1).padStart(2, '0')}`, `ROW ${row}`, '-1.00'])]);
    const complete = vi.fn<AiComplete>(async () => '{}');
    const controller = new AbortController();
    await suggestLayoutWithAi(many, complete, controller.signal);
    const [prompt, signal] = complete.mock.calls[0];
    expect(JSON.parse(prompt.user).rows).toHaveLength(10);
    expect(signal).toBe(controller.signal);
  });

  it('does not call the provider for a table with nothing to show', async () => {
    const complete = vi.fn<AiComplete>(async () => '{}');
    const empty = { ...ODD, rows: [], sourceLines: [] };
    await expect(suggestLayoutWithAi(empty, complete)).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('AI layout help: the reply', () => {
  it('turns a valid reply into a proposal marked as the AI\'s, capped in confidence', async () => {
    const proposal = await suggestLayoutWithAi(ODD, reply(GOOD));
    expect(proposal).not.toBeNull();
    expect(proposal?.layout.roles).toEqual({ date: 1, description: [2], amount: 3, account: 0 });
    expect(proposal?.missing).toEqual([]);
    expect(proposal?.confidence).toBeLessThanOrEqual(AI_MAX_CONFIDENCE);
    expect(proposal?.assumptions.length).toBeGreaterThan(2);
    for (const assumption of proposal?.assumptions ?? []) {
      expect(assumption.basis).toBe('ai');
      expect(assumption.confidence).toBeLessThanOrEqual(0.7);
    }
    expect(proposal?.assumptions[0]).toMatchObject({
      subject: 'columns',
      code: 'columnsByAi',
      params: { date: 'F2', description: 'F3', amount: 'F4' },
    });
  });

  it('still reads the date order and decimal mark from the whole file, whatever the AI said', async () => {
    // The AI answered month-first and decimal point; row 1 is 23/09/2026 and the amounts are "-54,20".
    const proposal = await suggestLayoutWithAi(ODD, reply(GOOD));
    expect(proposal?.layout).toMatchObject({ dateOrder: 'DMY', decimal: ',' });
    expect(proposal?.assumptions.map((assumption) => assumption.code)).toEqual(
      expect.arrayContaining(['dayFirstFromFile', 'decimalFromFile'])
    );
  });

  it('uses the AI\'s date order, decimal mark and sign only where the file is silent', async () => {
    const silent = tableFromCsv(`
      F1,F2,F3
      01/02/2026,ALPHA,10
      03/04/2026,BRAVO,20
      05/06/2026,CHARLIE,30
    `);
    const proposal = await suggestLayoutWithAi(silent, reply({ date: 0, description: [1], amount: 2, dateOrder: 'DMY', amountSign: 'inverted' }));
    expect(proposal?.layout).toMatchObject({ dateOrder: 'DMY', amountSign: 'inverted' });
    expect(proposal?.assumptions.map((assumption) => [assumption.code, assumption.basis])).toEqual([
      ['columnsByAi', 'ai'],
      ['dayFirstAssumed', 'ai'],
      ['signFlippedByAi', 'ai'],
    ]);

    // Where the file does settle the sign, the AI's opinion is not needed.
    const clear = tableFromCsv(`
      F1,F2,F3
      2026-09-01,GROCERY,-54.20
      2026-09-02,ATM WITHDRAWAL,-20.00
      2026-09-03,PAYROLL DEPOSIT,2400.00
      2026-09-04,REFUND SHOP,5.00
    `);
    const sure = await suggestLayoutWithAi(clear, reply({ date: 0, description: [1], amount: 2, amountSign: 'inverted' }));
    expect(sure?.layout.amountSign).toBe('asIs');
  });

  it('accepts a debit / credit pair and a direction column with its words', async () => {
    const pair = tableFromCsv(`
      F1,F2,F3,F4
      2026-09-01,RENT,950.00,
      2026-09-02,PAYROLL,,2400.00
    `);
    const fromPair = await suggestLayoutWithAi(pair, reply({ date: 0, description: [1], amount: null, debit: 2, credit: 3 }));
    expect(fromPair?.layout.roles).toEqual({ date: 0, description: [1], debit: 2, credit: 3 });

    const indicator = tableFromCsv(`
      F1,F2,F3,F4
      2026-09-01,RENT,950.00,Paid
      2026-09-02,PAYROLL,2400.00,Got
    `);
    const fromIndicator = await suggestLayoutWithAi(
      indicator,
      reply({ date: 0, description: 1, amount: 2, direction: 3, directionOut: ['Paid'], directionIn: ['Got'] })
    );
    expect(fromIndicator?.layout).toMatchObject({
      roles: { date: 0, description: [1], amount: 2, direction: 3 },
      directionValues: { out: ['paid'], in: ['got'] },
    });
    expect(fromIndicator?.assumptions.find((assumption) => assumption.code === 'directionColumn')?.params).toMatchObject({
      out: 'Paid',
      in: 'Got',
    });
  });

  it('finds the JSON inside prose or a code fence', async () => {
    const fenced: AiComplete = async () => `Here is the layout:\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\nHope that helps!`;
    expect((await suggestLayoutWithAi(ODD, fenced))?.layout.roles.date).toBe(1);
  });

  it.each([
    ['not JSON at all', 'I think the first column is the date.'],
    ['broken JSON', '{"date": 1, "description": [2], "amount": '],
    ['an array', '[1, 2, 3]'],
    ['a column that does not exist', JSON.stringify({ ...GOOD, amount: 9 })],
    ['a negative column', JSON.stringify({ ...GOOD, date: -1 })],
    ['a column given as text', JSON.stringify({ ...GOOD, date: '1' })],
    ['an optional column that does not exist', JSON.stringify({ ...GOOD, balance: 12 })],
    ['no date', JSON.stringify({ ...GOOD, date: null })],
    ['no description', JSON.stringify({ ...GOOD, description: [] })],
    ['no amount of any kind', JSON.stringify({ ...GOOD, amount: null })],
    ['one column for two parts', JSON.stringify({ ...GOOD, amount: 1 })],
    ['an empty reply', ''],
  ])('returns null for %s', async (_what, text) => {
    await expect(suggestLayoutWithAi(ODD, async () => text)).resolves.toBeNull();
  });

  it('returns null, not an exception, when the provider resolves with something that is not text', async () => {
    const odd = (async () => ({ text: 'oops' })) as unknown as AiComplete;
    await expect(suggestLayoutWithAi(ODD, odd)).resolves.toBeNull();
  });

  it('lets a failed or aborted provider call reject', async () => {
    await expect(suggestLayoutWithAi(ODD, async () => { throw new Error('network down'); })).rejects.toThrow('network down');
  });

  it('drops format values it does not know instead of rejecting the columns', () => {
    const parsed = parseAiLayoutReply(JSON.stringify({ ...GOOD, dateOrder: 'dd/mm/yyyy', decimal: 'comma', amountSign: 'negative' }), 4);
    expect(parsed).toEqual({ roles: { date: 1, description: [2], amount: 3, account: 0 } });
    expect(parseAiLayoutReply(JSON.stringify({ ...GOOD, dateOrder: 'dmy', decimal: ',' }), 4)).toMatchObject({ dateOrder: 'DMY', decimal: ',' });
  });

  it('prefers the single amount when a confused reply gives both an amount and a pair', () => {
    const parsed = parseAiLayoutReply(JSON.stringify({ date: 0, description: [1], amount: 2, debit: 2, credit: 3 }), 4);
    expect(parsed?.roles).toEqual({ date: 0, description: [1], amount: 2 });
  });
});
