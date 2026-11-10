/**
 * The three file-wide format decisions: date order, decimal mark, and the
 * sign of a single amount column. Each test names the evidence it rests on.
 */

import { describe, expect, it } from 'vitest';

import { balanceMismatchRows, checkBalance, reconciles } from './balance';
import { DateReader } from './cells';
import { inferDateOrder } from './dateOrder';
import { inferDecimal } from './decimal';
import { SIGN_CERTAIN, type SignInput, inferAmountSign } from './sign';

const lineOf = (at: number) => at + 2;
const dateOrder = (cells: string[], fallback?: Parameters<typeof inferDateOrder>[3]) =>
  inferDateOrder(cells, new DateReader(), lineOf, fallback);

describe('date order: one per file, from the whole column', () => {
  it('a first part above 12 means day first', () => {
    const result = dateOrder(['04/06/2026', '05/06/2026', '23/06/2026']);
    expect(result).toMatchObject({ order: 'DMY', mixed: false, confidence: 0.98 });
    expect(result.assumption).toEqual({
      subject: 'dateOrder',
      code: 'dayFirstFromFile',
      basis: 'file',
      confidence: 0.98,
      params: { example: '23/06/2026', line: 4 },
    });
  });

  it('a second part above 12 means month first', () => {
    const result = dateOrder(['04/06/2026', '04/23/2026']);
    expect(result).toMatchObject({ order: 'MDY', mixed: false });
    expect(result.assumption).toMatchObject({ code: 'monthFirstFromFile', params: { example: '04/23/2026', line: 3 } });
  });

  it('the file wins over the fallback', () => {
    expect(dateOrder(['23/06/2026'], { order: 'MDY' }).order).toBe('DMY');
    expect(dateOrder(['06/23/2026'], { order: 'DMY' }).order).toBe('MDY');
  });

  it('dotted dates are day first', () => {
    expect(dateOrder(['01.10.2026', '02.10.2026']).assumption?.code).toBe('dayFirstFromFile');
  });

  it('both kinds in one file is "mixed": the majority order is taken with little confidence', () => {
    const result = dateOrder(['13/09/2026', '15/09/2026', '09/17/2026', '20/09/2026']);
    expect(result).toMatchObject({ order: 'DMY', mixed: true, confidence: 0.3 });
    expect(result.assumption).toMatchObject({ code: 'dayFirstByMajority', params: { count: 3, otherCount: 1 } });
    expect(dateOrder(['13/09/2026', '09/17/2026', '09/18/2026']).assumption?.code).toBe('monthFirstByMajority');
  });

  it('year-first and month-name dates leave nothing to decide', () => {
    expect(dateOrder(['2026-10-01', '2026/10/02'])).toMatchObject({ order: 'YMD', confidence: 1 });
    expect(dateOrder(['2026年9月1日']).assumption).toMatchObject({ code: 'datesUnambiguous', basis: 'file', confidence: 1 });
    // Month names read the same either way; the order only matters for other files of this format.
    expect(dateOrder(['12 Oct 2026', '13 Oct 2026'], { order: 'DMY' })).toMatchObject({ order: 'DMY', confidence: 1 });
  });

  it('with no hard evidence, the reading that keeps the rows in date order is taken', () => {
    // Day first: 3, 7 and 11 September, 2 and 8 October. Month first the rows would jump around the year.
    const result = dateOrder(['03/09/2026', '07/09/2026', '11/09/2026', '02/10/2026', '08/10/2026'], { order: 'MDY' });
    expect(result).toMatchObject({ order: 'DMY', confidence: 0.75 });
    expect(result.assumption).toMatchObject({ code: 'dayFirstBySequence', basis: 'file' });

    const usStyle = dateOrder(['09/03/2026', '09/07/2026', '09/11/2026', '10/02/2026', '10/08/2026'], { order: 'DMY' });
    expect(usStyle.assumption).toMatchObject({ code: 'monthFirstBySequence' });
  });

  it('truly ambiguous files fall back to the caller, and say on what basis', () => {
    // In order both ways: 1 Feb / 3 Apr / 5 Jun, or 2 Jan / 4 Mar / 6 May.
    const cells = ['01/02/2026', '03/04/2026', '05/06/2026'];
    expect(dateOrder(cells, { order: 'DMY' })).toMatchObject({
      order: 'DMY',
      confidence: 0.5,
      assumption: { code: 'dayFirstAssumed', basis: 'language', params: { example: '01/02/2026' } },
    });
    expect(dateOrder(cells)).toMatchObject({
      order: 'MDY',
      confidence: 0.4,
      assumption: { code: 'monthFirstAssumed', basis: 'default' },
    });
    // A year-first language reads an ambiguous day / month pair day first.
    expect(dateOrder(cells, { order: 'YMD' }).order).toBe('DMY');
    expect(dateOrder(cells, { order: 'DMY', basis: 'ai' }).assumption?.basis).toBe('ai');
  });

  it('a column without dates assumes nothing', () => {
    expect(dateOrder(['', 'n/a'], { order: 'DMY' })).toEqual({ order: 'DMY', confidence: 1, assumption: null, mixed: false });
  });
});

describe('decimal mark: one per file, from every money column', () => {
  it('two decimals after a point, or a point after commas, is a decimal point', () => {
    expect(inferDecimal(['12.50', '1,234.56', '7'])).toMatchObject({
      decimal: '.',
      confidence: 0.98,
      assumption: { code: 'decimalFromFile', basis: 'file', params: { mark: '.', example: '12.50' } },
    });
  });

  it('two decimals after a comma, or a comma after points, is a decimal comma, whatever the fallback', () => {
    expect(inferDecimal(['-54,20', '1.234,56'], { decimal: '.' })).toMatchObject({
      decimal: ',',
      assumption: { code: 'decimalFromFile', params: { mark: ',', example: '-54,20' } },
    });
  });

  it('a file with both takes the majority, with less confidence the closer the split', () => {
    const mostlyPoint = inferDecimal(['12.50', '13.50', '14.50', '15.50', '12,50']);
    expect(mostlyPoint.decimal).toBe('.');
    expect(mostlyPoint.confidence).toBeCloseTo(0.75, 2);
    expect(inferDecimal(['12.50', '12,50']).confidence).toBe(0.3);
  });

  it('only "1,234"-style values: the mark groups thousands (money has no three decimals)', () => {
    expect(inferDecimal(['1,250', '3,400', '12'], { decimal: ',' })).toMatchObject({
      decimal: '.',
      confidence: 0.8,
      assumption: { code: 'decimalByGrouping', basis: 'file', params: { mark: '.', group: ',', example: '1,250' } },
    });
    expect(inferDecimal(['1.250', '3.400'])).toMatchObject({ decimal: ',', assumption: { params: { mark: ',', group: '.' } } });
    // Five or more and it is as good as certain: whole-yen and whole-won statements look like this.
    expect(inferDecimal(['285,000', '8,420', '5,236', '30,000', '78,000']).confidence).toBe(0.95);
  });

  it('"1,234" and "1.234" in the same file and nothing else: the fallback decides', () => {
    expect(inferDecimal(['1,234', '1.234'], { decimal: ',' })).toMatchObject({
      decimal: ',',
      confidence: 0.5,
      assumption: { code: 'decimalAssumed', basis: 'language', params: { mark: ',', example: '1,234' } },
    });
    expect(inferDecimal(['1,234', '1.234'])).toMatchObject({ decimal: '.', confidence: 0.4, assumption: { basis: 'default' } });
  });

  it('whole numbers assume nothing', () => {
    expect(inferDecimal(['12', '-7', '', 'text'], { decimal: ',' })).toEqual({ decimal: ',', confidence: 1, assumption: null });
  });
});

describe('running balance', () => {
  it('reconciles an oldest-first file', () => {
    const check = checkBalance([null, -50, 200, -25], [1000, 950, 1150, 1125]);
    expect(check).toMatchObject({ comparable: 3, matched: 3, orientation: 1, newestFirst: false });
    expect(reconciles(check)).toBe(true);
  });

  it('reconciles a newest-first file', () => {
    const check = checkBalance([-25, 200, -50], [1125, 1150, 950], ['2026-09-03', '2026-09-02', '2026-09-01']);
    expect(check).toMatchObject({ comparable: 2, matched: 2, orientation: 1, newestFirst: true });
  });

  it('sees a balance that moves against the amounts (money owed, or inverted amounts)', () => {
    // Purchases printed negative while the amount owed goes up.
    expect(checkBalance([-25, -40, 500], [525, 565, 65])).toMatchObject({ matched: 2, orientation: -1 });
  });

  it('uses the dates to tell oldest-first from newest-first when every amount is the same', () => {
    const amounts = [450, 450, 450];
    const owed = [9550, 9100, 8650];
    expect(checkBalance(amounts, owed, ['2026-01-15', '2026-02-15', '2026-03-15'])).toMatchObject({
      orientation: -1,
      newestFirst: false,
    });
  });

  it('does not call a column that never adds up a running balance', () => {
    const check = checkBalance([1450, 1450, 1450, 1450], [164587.82, 164173.92, 163758.3, 163340.95]);
    expect(check).toMatchObject({ comparable: 3, matched: 0 });
    expect(reconciles(check)).toBe(false);
    expect(checkBalance([10, 20], [null, null])).toBeNull();
  });

  it('lists the rows whose balance does not follow', () => {
    const amounts = [null, -50, 200, -25, -10];
    const balances = [1000, 950, 1150, 1100, 1090];
    const check = checkBalance(amounts, balances);
    expect(check).toMatchObject({ comparable: 4, matched: 3 });
    expect(balanceMismatchRows(amounts, balances, check as NonNullable<typeof check>)).toEqual([3]);
  });
});

describe('sign of a single amount column', () => {
  const rows = (entries: Array<[amount: number, description: string, balance?: number]>, extra: Partial<SignInput> = {}): SignInput => ({
    amounts: entries.map(([amount]) => amount),
    printed: entries.map(([amount]) => amount.toFixed(2)),
    descriptions: entries.map(([, description]) => description),
    ...(entries.some(([, , balance]) => balance !== undefined) ? { balances: entries.map(([, , balance]) => balance ?? null) } : {}),
    ...extra,
  });

  it('a running balance that goes up with positive amounts: as printed, and certain for a known account', () => {
    const input = rows(
      [
        [-50, 'SHOP', 950],
        [200, 'TRANSFER', 1150],
        [-25, 'SHOP', 1125],
      ],
      { accountType: 'checking' }
    );
    expect(inferAmountSign(input)).toMatchObject({
      sign: 'asIs',
      confidence: 0.97,
      assumption: { subject: 'amountSign', code: 'signAsPrintedByBalance', basis: 'file' },
    });
  });

  it('a card balance (money owed) that goes up with positive amounts: purchases are positive, so flipped', () => {
    const input = rows(
      [
        [25, 'SHOP', 525],
        [40, 'SHOP', 565],
        [-500, 'PAYMENT THANK YOU', 65],
      ],
      { accountType: 'credit' }
    );
    expect(inferAmountSign(input)).toMatchObject({ sign: 'inverted', confidence: 0.97, assumption: { code: 'signFlippedByBalance' } });
  });

  it('a card that prints what is owed as a negative balance keeps the sign', () => {
    const input = rows(
      [
        [-25, 'SHOP', -525],
        [-40, 'SHOP', -565],
        [500, 'PAYMENT', -65],
      ],
      { accountType: 'credit' }
    );
    expect(inferAmountSign(input).sign).toBe('asIs');
  });

  it('a checking balance that goes down with positive amounts: the amounts are inverted', () => {
    const input = rows(
      [
        [50, 'SHOP', 950],
        [25, 'SHOP', 925],
        [-200, 'DEPOSIT', 1125],
      ],
      { accountType: 'checking' }
    );
    expect(inferAmountSign(input)).toMatchObject({ sign: 'inverted', assumption: { code: 'signFlippedByBalance' } });
  });

  it('without the account type a balance is trusted when the rows agree, and less when they do not', () => {
    const agreeing = rows([
      [-50, 'SHOP', 950],
      [-20, 'SHOP', 930],
      [200, 'PAYROLL', 1130],
    ]);
    expect(inferAmountSign(agreeing)).toMatchObject({ sign: 'asIs', confidence: 0.95 });

    // Positive purchases and a rising balance: a card's "owed" balance, as the payment row shows.
    const card = rows([
      [25, 'SHOP', 525],
      [40, 'SHOP', 565],
      [30, 'SHOP', 595],
      [-500, 'PAYMENT THANK YOU', 95],
      [-20, 'REFUND', 75],
    ]);
    const inferred = inferAmountSign(card);
    expect(inferred).toMatchObject({ sign: 'inverted', assumption: { code: 'signFlippedByKeywords' } });
    expect(inferred.confidence).toBeLessThan(SIGN_CERTAIN);

    // No wording to go by: the balance is taken as money held, and flagged as uncertain.
    const silent = rows([
      [25, 'A', 525],
      [40, 'B', 565],
      [-10, 'C', 555],
    ]);
    expect(inferAmountSign(silent)).toMatchObject({ sign: 'asIs', confidence: 0.7, assumption: { code: 'signAsPrintedByBalance' } });
  });

  it('most amounts negative, as spending is: as printed', () => {
    const input = rows([
      [-10, 'A'],
      [-20, 'B'],
      [-30, 'C'],
      [-40, 'D'],
      [-50, 'E'],
      [-60, 'F'],
      [-70, 'G'],
      [-80, 'H'],
      [-90, 'I'],
      [900, 'J'],
    ]);
    const inferred = inferAmountSign(input);
    expect(inferred).toMatchObject({ sign: 'asIs', confidence: 0.95, assumption: { code: 'signAsPrintedByShare', params: { percent: 90 } } });
    expect(inferred.confidence).toBeGreaterThanOrEqual(SIGN_CERTAIN);
  });

  it('most amounts positive on a spending account: flipped, but not certain', () => {
    const input = rows([
      [10, 'A'],
      [20, 'B'],
      [30, 'C'],
      [-400, 'D'],
    ]);
    const inferred = inferAmountSign(input);
    expect(inferred).toMatchObject({ sign: 'inverted', assumption: { code: 'signFlippedByShare', params: { percent: 75 } } });
    expect(inferred.confidence).toBeLessThan(SIGN_CERTAIN);
  });

  it('what the rows say backs up, or overrules, the head count', () => {
    const backed = rows([
      [-10, 'GROCERY'],
      [-20, 'ATM WITHDRAWAL'],
      [900, 'PAYROLL DEPOSIT'],
      [5, 'REFUND SHOP'],
    ]);
    expect(inferAmountSign(backed)).toMatchObject({ sign: 'asIs', assumption: { code: 'signAsPrintedByKeywords' } });
    expect(inferAmountSign(backed).confidence).toBeGreaterThanOrEqual(SIGN_CERTAIN);

    // Three negative "deposits" outweigh a small majority of negative values.
    const overruled = rows([
      [-900, 'PAYROLL DEPOSIT'],
      [-900, 'PAYROLL DEPOSIT'],
      [-5, 'REFUND SHOP'],
      [40, 'A'],
      [30, 'B'],
    ]);
    expect(inferAmountSign(overruled)).toMatchObject({
      sign: 'inverted',
      confidence: 0.7,
      assumption: { code: 'signFlippedByKeywords', params: { description: 'PAYROLL DEPOSIT', amount: '-900.00' } },
    });
  });

  it('only positive numbers: a card lists purchases, anything else is read as printed and asked about', () => {
    const allPositive: Array<[number, string]> = [
      [10, 'A'],
      [20, 'B'],
      [30, 'C'],
    ];
    expect(inferAmountSign(rows(allPositive, { accountType: 'credit' }))).toMatchObject({
      sign: 'inverted',
      confidence: 0.8,
      assumption: { code: 'signFlippedForCard' },
    });
    expect(inferAmountSign(rows(allPositive))).toMatchObject({
      sign: 'asIs',
      confidence: 0.5,
      assumption: { code: 'signAsPrintedDefault', basis: 'default' },
    });
    expect(inferAmountSign(rows(allPositive, { accountType: 'savings' }))).toMatchObject({ sign: 'asIs', confidence: 0.75 });
  });

  it('"payment" is money in on a loan or card account', () => {
    const payments: Array<[number, string]> = [
      [1450, 'MONTHLY PAYMENT'],
      [1450, 'MONTHLY PAYMENT'],
      [1450, 'MONTHLY PAYMENT'],
    ];
    expect(inferAmountSign(rows(payments, { accountType: 'loan' }))).toMatchObject({
      sign: 'asIs',
      confidence: 0.9,
      assumption: { code: 'signAsPrintedByKeywords' },
    });
    // On an unknown account "payment" says nothing.
    expect(inferAmountSign(rows(payments)).assumption.code).toBe('signAsPrintedDefault');
  });

  it('savings and investment files are not mostly spending: the split is not used', () => {
    const deposits = rows(
      [
        [100, 'A'],
        [100, 'B'],
        [100, 'C'],
        [-50, 'D'],
      ],
      { accountType: 'savings' }
    );
    expect(inferAmountSign(deposits)).toMatchObject({ sign: 'asIs', confidence: 0.8, assumption: { code: 'signAsPrintedDefault' } });
  });
});
