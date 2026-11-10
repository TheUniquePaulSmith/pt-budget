import { describe, expect, it } from 'vitest';

import { type HeaderClass, matchHeader } from './headerAliases';

const firstClass = (name: string) => matchHeader(name)?.classes[0] ?? null;

describe('header aliases', () => {
  const cases: Array<[language: string, headers: Array<[string, HeaderClass]>]> = [
    [
      'English',
      [
        ['Date', 'date'],
        ['Transaction Date', 'transactionDate'],
        ['Trans. Date', 'transactionDate'],
        ['Post Date', 'postedDate'],
        ['Description', 'description'],
        ['Payee', 'payee'],
        ['Memo', 'memo'],
        ['Amount', 'amount'],
        ['Debit', 'debit'],
        ['Credit', 'credit'],
        ['Withdrawals', 'debit'],
        ['Deposits', 'credit'],
        ['Dr/Cr', 'direction'],
        ['Running Balance', 'balance'],
        ['Reference Number', 'reference'],
        ['Account Number', 'account'],
        ['Status', 'status'],
        ['Currency', 'currency'],
        ['Category', 'category'],
        ['Principal', 'principal'],
        ['Interest', 'interest'],
        ['Escrow', 'escrow'],
        ['Check Number', 'checkNumber'],
      ],
    ],
    [
      'Spanish',
      [
        ['Fecha', 'date'],
        ['Fecha de operación', 'transactionDate'],
        ['Fecha valor', 'postedDate'],
        ['Concepto', 'description'],
        ['Beneficiario', 'payee'],
        ['Importe', 'amount'],
        ['Cargo', 'debit'],
        ['Abono', 'credit'],
        ['Saldo', 'balance'],
        ['Número de cuenta', 'account'],
        ['Moneda', 'currency'],
        ['Categoría', 'category'],
      ],
    ],
    [
      'French',
      [
        ["Date d'opération", 'transactionDate'],
        ['Date de valeur', 'postedDate'],
        ['Libellé', 'description'],
        ['Montant', 'amount'],
        ['Débit', 'debit'],
        ['Crédit', 'credit'],
        ['Solde', 'balance'],
        ['Référence', 'reference'],
        ['Numéro de compte', 'account'],
        ['Devise', 'currency'],
        ['Catégorie', 'category'],
      ],
    ],
    [
      'German',
      [
        ['Buchungstag', 'date'],
        ['Wertstellung', 'postedDate'],
        ['Verwendungszweck', 'description'],
        ['Empfänger', 'payee'],
        ['Empfaenger', 'payee'],
        ['Beguenstigter/Zahlungspflichtiger', 'payee'],
        ['Betrag', 'amount'],
        ['Soll', 'debit'],
        ['Haben', 'credit'],
        ['Kontostand', 'balance'],
        ['Kontonummer', 'account'],
        ['Währung', 'currency'],
        ['Waehrung', 'currency'],
        ['Kategorie', 'category'],
        ['Zinsen', 'interest'],
        ['Tilgung', 'principal'],
      ],
    ],
    [
      'Portuguese',
      [
        ['Data', 'date'],
        ['Data Mov.', 'transactionDate'],
        ['Data Valor', 'postedDate'],
        ['Descrição', 'description'],
        ['Histórico', 'description'],
        ['Valor', 'amount'],
        ['Débito', 'debit'],
        ['Crédito', 'credit'],
        ['Saldo Contabilístico', 'balance'],
        ['Moeda', 'currency'],
        ['Juros', 'interest'],
      ],
    ],
    [
      'Italian',
      [
        ['Data contabile', 'date'],
        ['Data valuta', 'postedDate'],
        ['Descrizione', 'description'],
        ['Causale', 'description'],
        ['Importo', 'amount'],
        ['Dare', 'debit'],
        ['Avere', 'credit'],
        ['Saldo contabile', 'balance'],
        ['Numero conto', 'account'],
        ['Interessi', 'interest'],
      ],
    ],
    [
      'Chinese',
      [
        ['交易日期', 'transactionDate'],
        ['记账日期', 'postedDate'],
        ['摘要', 'description'],
        ['对方户名', 'payee'],
        ['备注', 'memo'],
        ['金额', 'amount'],
        ['交易金额(元)', 'amount'],
        ['支出', 'debit'],
        ['收入', 'credit'],
        ['余额', 'balance'],
        ['交易流水号', 'reference'],
        ['卡号', 'account'],
        ['币种', 'currency'],
        ['本金', 'principal'],
      ],
    ],
    [
      'Japanese',
      [
        ['日付', 'date'],
        ['ご利用日', 'transactionDate'],
        ['お取引内容', 'description'],
        ['ご利用店名', 'payee'],
        ['ご利用金額', 'amount'],
        ['出金', 'debit'],
        ['お預り金額', 'credit'],
        ['差引残高', 'balance'],
        ['口座番号', 'account'],
        ['通貨', 'currency'],
        ['利息', 'interest'],
      ],
    ],
    [
      'Korean',
      [
        ['거래일자', 'transactionDate'],
        ['적요', 'description'],
        ['가맹점명', 'payee'],
        ['거래금액', 'amount'],
        ['출금액', 'debit'],
        ['입금액', 'credit'],
        ['거래후잔액', 'balance'],
        ['계좌번호', 'account'],
        ['통화', 'currency'],
        ['이자', 'interest'],
      ],
    ],
  ];

  describe.each(cases)('%s', (_language, headers) => {
    it.each(headers)('%s → %s', (header, expected) => {
      expect(firstClass(header)).toBe(expected);
    });
  });

  it('ignores case, accents, punctuation and full-width forms', () => {
    expect(firstClass('  TRANSACTION_DATE ')).toBe('transactionDate');
    expect(firstClass('Descripción')).toBe('description');
    expect(firstClass('Ｄａｔｅ')).toBe('date');
    expect(firstClass('Check #')).toBe('checkNumber');
    expect(firstClass('Ref. No.')).toBe('reference');
  });

  it('takes the longest alias a header contains, as whole words', () => {
    expect(matchHeader('Transaction Date (local)')).toMatchObject({ classes: ['transactionDate'], exact: false });
    // "credit" is in there, but "card number" is the longer match.
    expect(firstClass('Credit Card Number')).toBe('account');
    expect(firstClass('Original Amount')).toBe('ignored');
    expect(firstClass('Customer Name')).toBe('ignored');
    expect(firstClass('Due Date')).toBe('ignored');
    expect(firstClass('Amount (USD)')).toBe('amount');
    // Not a whole word: "Update" does not contain the word "date".
    expect(matchHeader('Update')).toBeNull();
  });

  it('matches very short aliases only as the whole header', () => {
    expect(firstClass('Dr')).toBe('debit');
    expect(firstClass('Cr')).toBe('credit');
    expect(firstClass('In')).toBe('credit');
    expect(matchHeader('Dr Smith')).toBeNull();
    expect(firstClass('Dr Smith Fees')).toBe('fees');
    expect(matchHeader('Sent in error')).toBeNull();
  });

  it('lists every meaning of a word that differs by language, for the contents to decide', () => {
    expect(matchHeader('Valuta')?.classes).toEqual(['postedDate', 'currency']);
    expect(matchHeader('Type')?.classes).toEqual(['direction', 'type']);
    expect(matchHeader('Payment')?.classes).toEqual(['amount', 'credit']);
    expect(matchHeader('State')?.classes).toEqual(['status', 'ignored']);
  });

  it('returns null for a header nobody uses', () => {
    expect(matchHeader('How much')).toBeNull();
    expect(matchHeader('')).toBeNull();
    expect(matchHeader('Column 3')).toBeNull();
  });
});
