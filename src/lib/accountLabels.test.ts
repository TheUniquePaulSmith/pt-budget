import { describe, expect, it } from 'vitest';

import {
  accountDetailLine,
  accountLabelText,
  accountNameKey,
  buildAccountLabels,
  labelForDraft,
  maskedCard,
  suggestAccountName,
  type AccountLabelSource,
  type AccountLabelWords,
} from './accountLabels';
import type { AccountType } from '@/types/database';

const TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit Card',
  loan: 'Loan',
  investment: 'Investment',
  retirement: 'Retirement',
};

const words: AccountLabelWords = {
  typeLabel: (type) => TYPE_LABELS[type],
  jointOwner: (owner) => `${owner} (joint)`,
  joint: 'Joint',
  closed: 'Closed',
  moreCards: (count) => `+${count} more`,
};

function account(id: number, name: string, extra: Partial<AccountLabelSource> = {}): AccountLabelSource {
  return { id, name, type: 'checking', ownership: 'individual', owner_display_name: 'Avery', ...extra };
}

const cards = (...lastFours: string[]) => lastFours.map((last_four) => ({ last_four }));

describe('suggestAccountName', () => {
  it('joins the bank and the type', () => {
    expect(suggestAccountName({ institution: 'Huntington', type: 'checking' }, words.typeLabel)).toBe('Huntington Checking');
    expect(suggestAccountName({ institution: '  Summit   Card Services ', type: 'credit' }, words.typeLabel)).toBe(
      'Summit Card Services Credit Card'
    );
  });

  it('is the type alone without a bank', () => {
    expect(suggestAccountName({ institution: '', type: 'savings' }, words.typeLabel)).toBe('Savings');
    expect(suggestAccountName({ institution: null, type: 'loan' }, words.typeLabel)).toBe('Loan');
  });

  it('does not repeat a type the bank name already says', () => {
    expect(suggestAccountName({ institution: 'Lakeside Savings', type: 'savings' }, words.typeLabel)).toBe('Lakeside Savings');
  });
});

describe('accountDetailLine', () => {
  it('lists bank, type, owner and cards', () => {
    const line = accountDetailLine(
      account(1, 'Everyday', { institution: 'Huntington', cards: cards('1111', '2222') }),
      words
    );
    expect(line).toBe('Huntington · Checking · Avery · ••1111 ••2222');
  });

  it('leaves out what the name already says', () => {
    // An account saved under its suggested name would otherwise read "Huntington Checking / Huntington · Checking · …".
    expect(accountDetailLine(account(1, 'Huntington Checking', { institution: 'Huntington', cards: cards('1111') }), words)).toBe(
      'Avery · ••1111'
    );
    expect(accountDetailLine(account(2, 'Avery 401(k)', { type: 'retirement', institution: 'Northstar' }), words)).toBe(
      'Northstar · Retirement'
    );
  });

  it('marks a joint account, with or without its owner', () => {
    expect(accountDetailLine(account(1, 'Bills', { ownership: 'joint' }), words)).toBe('Checking · Avery (joint)');
    expect(accountDetailLine(account(2, 'Avery bills', { ownership: 'joint' }), words)).toBe('Checking · Joint');
    expect(accountDetailLine(account(3, 'Household Joint', { ownership: 'joint' }), words)).toBe('Checking · Avery');
  });

  it('caps the cards and says how many more there are', () => {
    const line = accountDetailLine(account(1, 'Checking', { cards: cards('1111', '2222', '3333', '4444', '5555') }), words);
    expect(line).toBe('Avery · ••1111 ••2222 ••3333 +2 more');
  });

  it('says when the account is closed', () => {
    expect(accountDetailLine(account(1, 'Old card', { type: 'credit', is_active: 0 }), words)).toBe('Credit Card · Avery · Closed');
  });

  it('resolves the owner from the people list when the row does not carry the name', () => {
    const line = accountDetailLine({ id: 1, name: 'Bills', type: 'checking', owner_user_id: 7 }, words, [
      { id: 7, display_name: 'Jordan' },
    ]);
    expect(line).toBe('Checking · Jordan');
  });

  it('is empty when the name says everything', () => {
    expect(accountDetailLine({ id: 1, name: 'Avery Checking', type: 'checking', owner_display_name: 'Avery' }, words)).toBe('');
    expect(accountDetailLine({ id: 2, name: 'Sparse row' }, words)).toBe('');
  });
});

describe('buildAccountLabels', () => {
  it('leaves a unique name alone', () => {
    const labels = buildAccountLabels([account(1, 'Household Checking'), account(2, 'Rewards Visa', { type: 'credit' })], words);
    expect(labels.get(1)).toMatchObject({ name: 'Household Checking', hint: null, text: 'Household Checking', clashes: false });
    expect(labels.get(2)?.text).toBe('Rewards Visa');
  });

  it('tells same-named accounts apart by owner first', () => {
    const labels = buildAccountLabels(
      [account(1, 'Huntington'), account(2, 'Huntington', { owner_display_name: 'Jordan' })],
      words
    );
    expect(labels.get(1)).toMatchObject({ text: 'Huntington · Avery', hint: { kind: 'owner', text: 'Avery' }, clashes: true });
    expect(labels.get(2)?.text).toBe('Huntington · Jordan');
  });

  it('falls back to the type when the owner is the same', () => {
    const labels = buildAccountLabels([account(1, 'Huntington'), account(2, 'Huntington', { type: 'credit' })], words);
    expect(labels.get(1)?.text).toBe('Huntington · Checking');
    expect(labels.get(2)).toMatchObject({ text: 'Huntington · Credit Card', hint: { kind: 'type' } });
  });

  it('falls back to the card number when owner and type are the same', () => {
    const labels = buildAccountLabels(
      [account(1, 'Huntington', { cards: cards('1111') }), account(2, 'Huntington', { cards: cards('2222') })],
      words
    );
    expect(labels.get(1)).toMatchObject({ text: 'Huntington · ••1111', hint: { kind: 'card' } });
    expect(labels.get(2)?.text).toBe('Huntington · ••2222');
  });

  it('skips a card number both accounts have', () => {
    const labels = buildAccountLabels(
      [account(1, 'Huntington', { cards: cards('4821', '1111') }), account(2, 'Huntington', { cards: cards('4821', '2222') })],
      words
    );
    expect(labels.get(1)?.text).toBe('Huntington · ••1111');
    expect(labels.get(2)?.text).toBe('Huntington · ••2222');
  });

  it('uses the bank as the last resort', () => {
    const labels = buildAccountLabels(
      [account(1, 'Savings', { type: 'savings', institution: 'Cedar Valley' }), account(2, 'Savings', { type: 'savings', institution: 'Pine State' })],
      words
    );
    expect(labels.get(1)).toMatchObject({ text: 'Savings · Cedar Valley', hint: { kind: 'institution' } });
    expect(labels.get(2)?.text).toBe('Savings · Pine State');
  });

  it('gives no hint when nothing differs', () => {
    const labels = buildAccountLabels([account(1, 'Huntington'), account(2, 'Huntington')], words);
    expect(labels.get(1)).toMatchObject({ text: 'Huntington', hint: null, clashes: true });
    expect(labels.get(2)?.hint).toBeNull();
  });

  it('compares names without case and extra spaces, and keeps each name as typed', () => {
    const labels = buildAccountLabels(
      [account(1, 'Huntington'), account(2, '  huntington ', { owner_display_name: 'Jordan' })],
      words
    );
    expect(accountNameKey('  HUNTINGTON   Checking ')).toBe('huntington checking');
    expect(labels.get(1)?.clashes).toBe(true);
    expect(labels.get(2)?.name).toBe('  huntington ');
  });

  it('gives each of three accounts the detail only it has, where there is one', () => {
    // Avery has two; Jordan's is the only one of its owner; of Avery's, each type is unique.
    const labels = buildAccountLabels(
      [
        account(1, 'Huntington'),
        account(2, 'Huntington', { type: 'credit' }),
        account(3, 'Huntington', { owner_display_name: 'Jordan' }),
      ],
      words
    );
    expect(labels.get(3)?.text).toBe('Huntington · Jordan');
    expect(labels.get(2)?.text).toBe('Huntington · Credit Card');
    // Account 1 shares its owner with 2 and its type with 3: the first detail that sets it apart from one of them.
    expect(labels.get(1)?.text).toBe('Huntington · Avery');
  });

  it('prefers a card only this account has over a shared owner or type', () => {
    const labels = buildAccountLabels(
      [
        account(1, 'Huntington', { cards: cards('1111') }),
        account(2, 'Huntington', { type: 'credit' }),
        account(3, 'Huntington', { owner_display_name: 'Jordan' }),
      ],
      words
    );
    expect(labels.get(1)?.text).toBe('Huntington · ••1111');
  });

  it('counts a closed account when comparing names', () => {
    const labels = buildAccountLabels([account(1, 'Visa', { type: 'credit' }), account(2, 'Visa', { is_active: 0 })], words);
    expect(labels.get(1)?.text).toBe('Visa · Credit Card');
    expect(labels.get(2)?.detailLine).toContain('Closed');
  });

  it('carries the detail line on every label', () => {
    const labels = buildAccountLabels([account(1, 'Everyday', { institution: 'Huntington', cards: cards('1111') })], words);
    expect(labels.get(1)?.detailLine).toBe('Huntington · Checking · Avery · ••1111');
  });

  it('does not repeat on the second line the detail the first line already carries', () => {
    const labels = buildAccountLabels(
      [
        account(1, 'Huntington', { institution: 'Huntington', ownership: 'joint', cards: cards('1111', '2222') }),
        account(2, 'Huntington', { institution: 'Huntington', type: 'credit', cards: cards('9034') }),
        account(3, 'Visa', { type: 'credit', ownership: 'joint' }),
        account(4, 'Visa', { type: 'credit', owner_display_name: 'Jordan' }),
        account(5, 'Savings', { type: 'savings', cards: cards('1111') }),
        account(6, 'Savings', { type: 'savings', cards: cards('2222') }),
      ],
      words
    );
    // The type is the hint: the second line is the rest.
    expect(labels.get(1)).toMatchObject({ text: 'Huntington · Checking', detailLine: 'Avery (joint) · ••1111 ••2222' });
    expect(labels.get(2)).toMatchObject({ text: 'Huntington · Credit Card', detailLine: 'Avery · ••9034' });
    // The owner is the hint: a joint account still says so.
    expect(labels.get(3)).toMatchObject({ text: 'Visa · Avery', detailLine: 'Credit Card · Joint' });
    expect(labels.get(4)).toMatchObject({ text: 'Visa · Jordan', detailLine: 'Credit Card' });
    // A card as the hint: the cards stay together on the second line.
    expect(labels.get(5)).toMatchObject({ text: 'Savings · ••1111', detailLine: 'Avery · ••1111' });
  });
});

describe('accountLabelText', () => {
  const labels = buildAccountLabels([account(1, 'Huntington'), account(2, 'Huntington', { owner_display_name: 'Jordan' })], words);

  it('is the compact text of a known account', () => {
    expect(accountLabelText(labels, 2)).toBe('Huntington · Jordan');
  });

  it('falls back for an account that is gone', () => {
    expect(accountLabelText(labels, 9, 'Old account')).toBe('Old account');
    expect(accountLabelText(labels, null, null)).toBe('');
    expect(accountLabelText(labels, undefined)).toBe('');
  });
});

describe('labelForDraft', () => {
  const saved = [account(1, 'Huntington', { cards: cards('1111') }), account(2, 'Rewards Visa', { type: 'credit' })];

  it('says when a new account would share a name', () => {
    const label = labelForDraft(account(0, 'Huntington', { type: 'credit', cards: cards('2222') }), saved, words);
    expect(label).toMatchObject({ clashes: true, text: 'Huntington · Credit Card' });
  });

  it('does not compare an edited account with itself', () => {
    const label = labelForDraft(account(1, 'Huntington', { cards: cards('1111') }), saved, words);
    expect(label).toMatchObject({ clashes: false, text: 'Huntington' });
  });

  it('labels a draft with a unique name plainly', () => {
    expect(labelForDraft(account(0, 'Vacation fund', { type: 'savings' }), saved, words)).toMatchObject({
      clashes: false,
      text: 'Vacation fund',
      detailLine: 'Savings · Avery',
    });
  });
});

describe('maskedCard', () => {
  it('shows the last four behind two dots', () => {
    expect(maskedCard('4821')).toBe('••4821');
  });
});
