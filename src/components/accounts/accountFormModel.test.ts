import { describe, expect, it } from 'vitest';

import {
  buildAccountDraft,
  buildAccountFormValues,
  createAccountCardFormState,
  createAccountFormState,
  draftCardsFromInput,
} from './accountFormModel';

describe('buildAccountFormValues', () => {
  it('saves an account whose name was left empty under the suggested name', () => {
    const state = createAccountFormState(null, { institution: 'Huntington' });
    expect(state.name).toBe('');

    const built = buildAccountFormValues(state, 'Huntington Checking');

    expect(built).toEqual({ ok: true, value: expect.objectContaining({ name: 'Huntington Checking', institution: 'Huntington' }) });
  });

  it('keeps a name the user typed', () => {
    const state = { ...createAccountFormState(null, { institution: 'Huntington' }), name: '  Vacation fund ' };
    const built = buildAccountFormValues(state, 'Huntington Checking');
    expect(built.ok && built.value.name).toBe('Vacation fund');
  });

  it('still refuses an account with neither a name nor a suggestion', () => {
    expect(buildAccountFormValues(createAccountFormState())).toEqual({ ok: false, error: 'nameRequired' });
    expect(buildAccountFormValues({ ...createAccountFormState(), name: '   ' }, '  ')).toEqual({ ok: false, error: 'nameRequired' });
  });

  it('rejects amounts that are not numbers', () => {
    const state = { ...createAccountFormState(), name: 'Checking', openingBalance: 'abc' };
    expect(buildAccountFormValues(state)).toEqual({ ok: false, error: 'numbersInvalid' });
  });
});

describe('buildAccountDraft', () => {
  it('is the account as the form would save it, under id 0 while it is new', () => {
    const state = { ...createAccountFormState(null, { institution: ' Huntington ', type: 'credit' }), ownership: 'joint' as const };

    const draft = buildAccountDraft(state, 'Huntington Credit Card', {
      ownerUserId: 2,
      ownerDisplayName: 'Jordan',
      cards: [{ last_four: '2222' }],
    });

    expect(draft).toEqual({
      id: 0,
      name: 'Huntington Credit Card',
      type: 'credit',
      ownership: 'joint',
      institution: 'Huntington',
      owner_user_id: 2,
      owner_display_name: 'Jordan',
      is_active: 1,
      currency: 'USD',
      cards: [{ last_four: '2222' }],
    });
  });

  it('keeps the id and the typed name of an account being edited', () => {
    const state = { ...createAccountFormState(), name: 'Everyday', isActive: false };
    expect(buildAccountDraft(state, 'Checking', { id: 7 })).toMatchObject({ id: 7, name: 'Everyday', is_active: 0, cards: [] });
  });
});

describe('draftCardsFromInput', () => {
  it('has no card until the number has four digits', () => {
    expect(draftCardsFromInput(createAccountCardFormState())).toEqual([]);
    expect(draftCardsFromInput({ ...createAccountCardFormState(), cardNumberInput: '48' })).toEqual([]);
  });

  it('shows only the last four of what was typed', () => {
    const state = { cardNumberInput: '4000 0000 0000 4821', cardNickname: ' Main Debit ', cardUserId: 3 };
    expect(draftCardsFromInput(state)).toEqual([{ last_four: '4821', nickname: 'Main Debit', user_id: 3 }]);
  });
});
