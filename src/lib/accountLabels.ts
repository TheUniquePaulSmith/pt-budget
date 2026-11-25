/**
 * How an account is named on screen. Pure: no React and no translation (the
 * caller passes the few words it needs as `AccountLabelWords`).
 *
 * An account has a short name the user chose (or accepted: see
 * `suggestAccountName`), and the app never relies on that name alone:
 *
 * - `text` is the name, plus one distinguishing detail when another account
 *   has the same name ("Huntington · Avery"). Table cells, chips, sentences.
 * - `detailLine` is the always-on second line of account pickers and the
 *   import steps: bank, type, owner, card numbers, minus whatever `text`
 *   already says.
 */

import type { Account, AccountCard, AccountType, User } from '@/types/database';

/** A card as the labels need it: `Account.cards` from `getAccounts()` fits, and so does a form draft. */
export type AccountLabelCard = Pick<AccountCard, 'last_four'> &
  Partial<Pick<AccountCard, 'id' | 'nickname' | 'user_id' | 'user_display_name'>>;

/** Only `id` and `name` are required, so sparse rows and form drafts can be labelled too. */
export type AccountLabelSource = Pick<Account, 'id' | 'name'> &
  Partial<
    Pick<Account, 'type' | 'ownership' | 'owner_user_id' | 'owner_display_name' | 'institution' | 'is_active' | 'currency'>
  > & { cards?: readonly AccountLabelCard[] };

/** The translated words a label is built from. */
export interface AccountLabelWords {
  /** "Checking", "Credit Card". */
  typeLabel: (type: AccountType) => string;
  /** "Avery (joint)". */
  jointOwner: (owner: string) => string;
  /** "Joint": a joint account whose owner the name already gives, or has none. */
  joint: string;
  /** "Closed". */
  closed: string;
  /** "+2 more". */
  moreCards: (count: number) => string;
}

export type AccountHintKind = 'owner' | 'type' | 'card' | 'institution';

export interface AccountLabel {
  account: AccountLabelSource;
  name: string;
  /** The one detail that tells this account from others with the same name. */
  hint: { kind: AccountHintKind; text: string } | null;
  /** `name`, or "name · hint". */
  text: string;
  /** Bank, type, owner and cards that `text` does not already say; '' when nothing is left. */
  detailLine: string;
  /** Another account has the same name. */
  clashes: boolean;
}

export type AccountLabels = ReadonlyMap<number, AccountLabel>;

type LabelUser = Pick<User, 'id' | 'display_name'>;

/** Separator between the name and its hint, and between the parts of a detail line. */
export const LABEL_SEPARATOR = ' · ';

/** Cards listed on a detail line before "+N more". */
export const MAX_DETAIL_CARDS = 3;

/** "••1111": the only form a card or account number is shown in. */
export function maskedCard(lastFour: string): string {
  return `••${lastFour}`;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** Two names are the same account name when they differ only by case or spacing. */
export function accountNameKey(name: string): string {
  return clean(name).toLowerCase();
}

function words(value: string): string[] {
  return clean(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Whether `text` already says `part`: every word of the part is a word of the
 * text. Scripts written without spaces have no word boundaries to compare, so
 * for those the part only has to appear in the text.
 */
function alreadySays(text: string, part: string): boolean {
  const partWords = words(part);
  if (partWords.length === 0) return true;
  const textWords = new Set(words(text));
  if (partWords.every((word) => textWords.has(word))) return true;
  const unspaced = /[぀-ヿ㐀-鿿가-힯]/u.test(part);
  return unspaced && clean(text).toLowerCase().includes(clean(part).toLowerCase());
}

/**
 * The name an account gets when the user leaves the field empty: the bank and
 * the type ("Huntington Checking"), or the type alone without a bank.
 */
export function suggestAccountName(
  input: { institution?: string | null; type: AccountType },
  typeLabel: (type: AccountType) => string
): string {
  const institution = clean(input.institution);
  const type = clean(typeLabel(input.type));
  if (!institution) return type;
  return alreadySays(institution, type) ? institution : `${institution} ${type}`;
}

function ownerNameOf(account: AccountLabelSource, users: readonly LabelUser[]): string {
  const joined = clean(account.owner_display_name);
  if (joined) return joined;
  if (account.owner_user_id == null) return '';
  return clean(users.find((user) => user.id === account.owner_user_id)?.display_name);
}

/**
 * The second line under an account's name: what the first line does not
 * already say. `shownAsHint` is the detail the first line carries next to the
 * name ("Huntington · Avery"), which is then not repeated here. The cards stay
 * together even when one of them is the hint.
 */
export function accountDetailLine(
  account: AccountLabelSource,
  labelWords: AccountLabelWords,
  users: readonly LabelUser[] = [],
  shownAsHint?: AccountHintKind | null
): string {
  const name = account.name;
  const parts: string[] = [];

  const institution = clean(account.institution);
  if (institution && shownAsHint !== 'institution' && !alreadySays(name, institution)) parts.push(institution);

  if (account.type && shownAsHint !== 'type') {
    const type = clean(labelWords.typeLabel(account.type));
    if (type && !alreadySays(name, type)) parts.push(type);
  }

  const owner = ownerNameOf(account, users);
  const showOwner = owner !== '' && shownAsHint !== 'owner' && !alreadySays(name, owner);
  const showJoint = account.ownership === 'joint' && !alreadySays(name, labelWords.joint);
  if (showOwner && showJoint) parts.push(labelWords.jointOwner(owner));
  else if (showOwner) parts.push(owner);
  else if (showJoint) parts.push(labelWords.joint);

  const cards = account.cards ?? [];
  if (cards.length > 0) {
    const shown = cards.slice(0, MAX_DETAIL_CARDS).map((card) => maskedCard(card.last_four));
    if (cards.length > MAX_DETAIL_CARDS) shown.push(labelWords.moreCards(cards.length - MAX_DETAIL_CARDS));
    parts.push(shown.join(' '));
  }

  if (account.is_active === 0) parts.push(labelWords.closed);

  return parts.join(LABEL_SEPARATOR);
}

interface HintCandidate {
  account: AccountLabelSource;
  owner: string;
  type: string;
  institution: string;
  cards: string[];
}

const HINT_ORDER: readonly AccountHintKind[] = ['owner', 'type', 'card', 'institution'];

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The detail that tells `candidate` from the other accounts with its name.
 * `strict` asks for a value no other account has; otherwise one that at least
 * one other account does not share is enough (three accounts, two alike).
 */
function findHint(
  candidate: HintCandidate,
  others: readonly HintCandidate[],
  strict: boolean
): AccountLabel['hint'] {
  const tellsApart = (differs: (other: HintCandidate) => boolean) =>
    strict ? others.every(differs) : others.some(differs);

  for (const kind of HINT_ORDER) {
    if (kind === 'card') {
      const card = candidate.cards.find((lastFour) => tellsApart((other) => !other.cards.includes(lastFour)));
      if (card) return { kind, text: maskedCard(card) };
      continue;
    }
    const value = candidate[kind];
    if (value && tellsApart((other) => !sameText(other[kind], value))) return { kind, text: value };
  }
  return null;
}

/** Labels for every account, keyed by id. Names are compared across the whole list, closed accounts included. */
export function buildAccountLabels(
  accounts: readonly AccountLabelSource[],
  labelWords: AccountLabelWords,
  users: readonly LabelUser[] = []
): AccountLabels {
  const groups = new Map<string, HintCandidate[]>();
  for (const account of accounts) {
    const candidate: HintCandidate = {
      account,
      owner: ownerNameOf(account, users),
      type: account.type ? clean(labelWords.typeLabel(account.type)) : '',
      institution: clean(account.institution),
      cards: (account.cards ?? []).map((card) => card.last_four),
    };
    const key = accountNameKey(account.name);
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  const labels = new Map<number, AccountLabel>();
  for (const group of groups.values()) {
    const clashes = group.length > 1;
    for (const candidate of group) {
      const others = group.filter((other) => other !== candidate);
      const hint = clashes ? (findHint(candidate, others, true) ?? findHint(candidate, others, false)) : null;
      const name = candidate.account.name;
      labels.set(candidate.account.id, {
        account: candidate.account,
        name,
        hint,
        text: hint ? `${name}${LABEL_SEPARATOR}${hint.text}` : name,
        detailLine: accountDetailLine(candidate.account, labelWords, users, hint?.kind),
        clashes,
      });
    }
  }
  return labels;
}

/** The compact text for an account id, for sentences and accessible names; `fallback` when the account is gone. */
export function accountLabelText(
  labels: AccountLabels,
  accountId: number | null | undefined,
  fallback?: string | null
): string {
  const label = accountId == null ? undefined : labels.get(accountId);
  return label?.text ?? fallback ?? '';
}

/**
 * The label an account being added or edited would get next to the existing
 * ones. A draft that edits an account replaces it in the list (same `id`).
 */
export function labelForDraft(
  draft: AccountLabelSource,
  accounts: readonly AccountLabelSource[],
  labelWords: AccountLabelWords,
  users: readonly LabelUser[] = []
): AccountLabel {
  const others = accounts.filter((account) => account.id !== draft.id);
  // Built over the others plus the draft, so the draft is always in the map.
  return buildAccountLabels([...others, draft], labelWords, users).get(draft.id) as AccountLabel;
}
