/**
 * Words the analysis looks for inside cells (not headers): money-in /
 * money-out indicators, pending markers, total lines, and the phrases that
 * tell which way a payment went. All nine app languages, matched after
 * `foldText` (lower case, no diacritics).
 */

import { foldText } from './text';

function folded(words: string[]): Set<string> {
  return new Set(words.map((word) => foldText(word).trim()));
}

// ---------------------------------------------------------------------------
// Direction indicator ("DR" / "CR", "Debit" / "Credit")
// ---------------------------------------------------------------------------

const DIRECTION_OUT = folded([
  'dr', 'd', 'db', 'debit', 'debits', 'debited', 'withdrawal', 'withdraw', 'out', 'outflow', 'charge', 'purchase',
  'sale', 'expense', 'payment out', 'paid out', 'money out', '-',
  'debito', 'débito', 'cargo', 'debe', 'retiro', 'egreso', 'salida', 'gasto',
  'débit', 'retrait', 'sortie', 'dépense',
  'soll', 's', 'belastung', 'lastschrift', 'ausgang', 'ausgabe',
  'saída', 'despesa',
  'addebito', 'dare', 'uscita',
  '借', '借方', '支出', '出', '转出', '付款',
  '出金', '支払', '引出',
  '출금', '지출', '지급',
]);

const DIRECTION_IN = folded([
  'cr', 'c', 'credit', 'credits', 'credited', 'deposit', 'in', 'inflow', 'income', 'refund', 'payment in', 'paid in',
  'money in', '+',
  'credito', 'crédito', 'abono', 'haber', 'depósito', 'ingreso', 'entrada',
  'crédit', 'dépôt', 'entrée', 'recette', 'versement',
  'haben', 'h', 'gutschrift', 'eingang', 'einnahme',
  'receita',
  'accredito', 'avere', 'entrata',
  '贷', '贷方', '收入', '入', '转入', '收款',
  '入金', '預入',
  '입금', '수입',
]);

/** 'out' / 'in' for a direction-indicator cell, or null when the word is not one we know. */
export function directionOfToken(cell: string): 'out' | 'in' | null {
  const token = foldText(cell).trim();
  if (!token) return null;
  if (DIRECTION_OUT.has(token)) return 'out';
  if (DIRECTION_IN.has(token)) return 'in';
  return null;
}

// ---------------------------------------------------------------------------
// Status column
// ---------------------------------------------------------------------------

const STATUS_PENDING = folded([
  'pending', 'pend', 'authorized', 'authorised', 'authorization', 'hold', 'on hold', 'processing', 'in process',
  'in progress', 'uncleared', 'unposted', 'not posted', 'scheduled', 'memo', 'temporary',
  'pendiente', 'en proceso', 'retenido', 'autorizado',
  'en attente', 'en cours', 'autorisé',
  'vorgemerkt', 'ausstehend', 'offen', 'in bearbeitung', 'reserviert',
  'pendente', 'em processamento', 'autorizada', 'cativo',
  'in sospeso', 'in corso', 'in attesa', 'contabilizzazione in corso', 'autorizzato',
  '待入账', '处理中', '未入账', '待处理', '未出账',
  '未確定', '処理中', '保留', '未決済',
  '보류', '처리중', '대기', '미확정', '승인대기',
]);

const STATUS_SETTLED = folded([
  'posted', 'cleared', 'completed', 'complete', 'settled', 'booked', 'final', 'reconciled', 'processed', 'paid',
  'success', 'successful',
  'contabilizado', 'liquidado', 'completado', 'registrado', 'aplicado',
  'comptabilisé', 'effectué', 'terminé', 'validé',
  'gebucht', 'abgeschlossen', 'ausgeführt', 'verbucht',
  'lançado', 'concluído', 'efetivado', 'liquidada',
  'contabilizzato', 'completato', 'eseguito', 'registrato',
  '已入账', '已完成', '成功', '已记账', '交易成功',
  '確定', '完了', '済', '決済済',
  '완료', '확정', '정상', '승인',
]);

export function isPendingStatus(cell: string): boolean {
  return STATUS_PENDING.has(foldText(cell).trim());
}

/** True for any word a status column uses, pending or not. */
export function isStatusWord(cell: string): boolean {
  const token = foldText(cell).trim();
  return STATUS_PENDING.has(token) || STATUS_SETTLED.has(token);
}

/** "PENDING - COFFEE SHOP", "(pending) ..." at the start of a description. */
const PENDING_DESCRIPTION_RE = /^\s*[([]?\s*pending\b/i;

export function hasPendingPrefix(description: string): boolean {
  return PENDING_DESCRIPTION_RE.test(description);
}

// ---------------------------------------------------------------------------
// Total and balance lines that sit among the transactions
// ---------------------------------------------------------------------------

const SUMMARY_LABELS = [
  // en
  'total', 'totals', 'subtotal', 'sub total', 'grand total', 'sum', 'opening balance', 'closing balance',
  'beginning balance', 'ending balance', 'starting balance', 'balance forward', 'balance brought forward',
  'balance carried forward', 'brought forward', 'carried forward', 'previous balance', 'new balance',
  'statement balance', 'total debits', 'total credits', 'net change',
  // es
  'saldo anterior', 'saldo inicial', 'saldo final', 'suma', 'sumas', 'totales',
  // fr
  'total general', 'solde initial', 'solde final', 'ancien solde', 'nouveau solde', 'solde precedent', 'report',
  'sous total',
  // de
  'summe', 'gesamt', 'gesamtsumme', 'zwischensumme', 'anfangssaldo', 'endsaldo', 'alter kontostand',
  'neuer kontostand', 'ubertrag', 'saldovortrag',
  // pt
  'saldo atual', 'soma', 'totais',
  // it
  'totale', 'totali', 'saldo iniziale', 'saldo finale', 'saldo precedente', 'riporto',
  // zh
  '合计', '总计', '小计', '期初余额', '期末余额', '上期余额', '本期合计',
  // ja
  '合計', '小計', '総計', '前月繰越', '繰越残高', '繰越', '前回残高',
  // ko
  '합계', '소계', '총계', '이월잔액', '전월이월', '이월',
].map((label) => foldText(label));

/** A label like "Total", "Closing balance:", "合计" at the start of a cell. */
export function startsWithSummaryLabel(cell: string): boolean {
  const text = foldText(cell).replace(/[\s:：.\-–—*=]+/g, ' ').trim();
  if (!text) return false;
  return SUMMARY_LABELS.some(
    (label) => text === label || text.startsWith(`${label} `) || (label.charCodeAt(0) > 0x2e7f && text.startsWith(label))
  );
}

// ---------------------------------------------------------------------------
// Which way a payment went, from its description (sign inference)
// ---------------------------------------------------------------------------

/** Rows that are money coming in, whatever the account. */
const MONEY_IN_RE = new RegExp(
  [
    // en
    'payroll', 'salary', 'direct dep', 'direct deposit', 'deposit', 'refund', 'reimbursement', 'cashback',
    'cash back', 'interest paid', 'interest earned', 'interest payment', 'dividend', 'payment received',
    'payment thank you', 'payment - thank you', 'thank you for your payment', 'autopay payment', 'credit adjustment',
    // es
    'nomina', 'salario', 'deposito', 'reembolso', 'devolucion', 'abono', 'intereses ganados', 'pago recibido',
    // fr
    'salaire', 'paie', 'remboursement', 'virement recu', 'versement', 'interets crediteurs',
    // de
    'gehalt', 'lohn', 'gutschrift', 'erstattung', 'ruckzahlung', 'zinsgutschrift', 'zahlungseingang',
    // pt
    'ordenado', 'vencimento', 'estorno', 'rendimento', 'pagamento recebido',
    // it
    'stipendio', 'accredito', 'rimborso', 'bonifico a vostro favore', 'emolumenti',
    // zh
    '工资', '薪资', '退款', '利息', '存入', '转入',
    // ja
    '給与', '給料', '賞与', '返金', '利息', '振込入金',
    // ko
    '급여', '월급', '환불', '이자', '입금',
  ]
    .map((word) => foldText(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
);

/** Rows that are money going out, whatever the account. */
const MONEY_OUT_RE = new RegExp(
  [
    // en
    'purchase', 'pos ', 'point of sale', 'withdrawal', 'atm ', 'debit card', 'service fee', 'monthly fee',
    'annual fee', 'late fee', 'overdraft', 'interest charge', 'finance charge', 'check #', 'bill pay',
    // es
    'compra', 'retiro', 'comision', 'cajero',
    // fr
    'achat', 'retrait', 'prelevement', 'paiement par carte', 'frais',
    // de
    'kartenzahlung', 'lastschrift', 'abhebung', 'einkauf', 'gebuhr', 'entgelt',
    // pt
    'levantamento', 'pagamento de servicos', 'tarifa',
    // it
    'acquisto', 'prelievo', 'pagamento pos', 'addebito diretto',
    // zh
    '消费', '取款', '手续费', '支出',
    // ja
    'ショッピング', '引出', '手数料', 'お買物',
    // ko
    '결제', '출금', '수수료', '구매',
  ]
    .map((word) => foldText(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
);

/** What a description says about the direction of its row, or null when it says nothing. */
export function directionOfDescription(description: string): 'in' | 'out' | null {
  const text = foldText(description);
  if (!text) return null;
  const moneyIn = MONEY_IN_RE.test(text);
  const moneyOut = MONEY_OUT_RE.test(text);
  if (moneyIn === moneyOut) return null;
  return moneyIn ? 'in' : 'out';
}
