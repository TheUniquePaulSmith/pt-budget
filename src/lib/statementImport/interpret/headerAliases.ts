/**
 * What bank exports call their columns, in the nine app languages.
 *
 * "Booking" dates (Buchungstag, data contabile, fecha contable) are plain
 * dates: they are what the statement is ordered by. Only a value / posting
 * date is the second, "posted" date.
 *
 * A header is matched after `normalizeHeader` (lower case, no diacritics,
 * punctuation as spaces), first as a whole and then by the longest alias it
 * contains as whole words ("Transaction Date (local)" → transaction date). A
 * few words mean different things in different languages ("Valuta" is a value
 * date in German and a currency in Italian), so an alias can name several
 * classes: `resolveHeaderClass` picks the first one the column's contents fit.
 *
 * The file's language is never assumed from the UI language: every alias of
 * every language is always in play.
 */

import { hasCjk, normalizeHeader } from './text';

export type HeaderClass =
  // Dates
  | 'date'
  | 'transactionDate'
  | 'postedDate'
  // Text
  | 'description'
  | 'altDescription'
  | 'payee'
  | 'memo'
  // Money
  | 'amount'
  | 'debit'
  | 'credit'
  | 'direction'
  | 'balance'
  // Other parts the import uses
  | 'reference'
  | 'account'
  | 'status'
  | 'currency'
  // Recognised, but not imported
  | 'category'
  | 'principal'
  | 'interest'
  | 'escrow'
  | 'fees'
  | 'checkNumber'
  // Known not to be any of the above (a transaction type, a branch, a card holder…)
  | 'type'
  | 'ignored';

/** Classes the analysis reports as `columnNotImported` when the layout leaves them out. */
export const NOT_IMPORTED_CLASSES: ReadonlySet<HeaderClass> = new Set([
  'category',
  'principal',
  'interest',
  'escrow',
  'fees',
  'checkNumber',
]);

/**
 * Aliases per class. Order matters only for a word listed under two classes:
 * the class that comes first here is tried first.
 */
const ALIASES: Array<[HeaderClass, string[]]> = [
  [
    'transactionDate',
    [
      // en
      'transaction date', 'trans date', 'tran date', 'txn date', 'trx date', 'date of transaction', 'purchase date',
      'date of purchase', 'activity date', 'trade date', 'original date', 'transaction time', 'transaction datetime',
      'transaction date time', 'authorization date', 'auth date', 'sale date', 'charge date', 'payment date',
      'date paid', 'paid date', 'date received', 'received date',
      // es
      'fecha de transaccion', 'fecha transaccion', 'fecha de la transaccion', 'fecha de operacion', 'fecha operacion',
      'fecha de la operacion', 'fecha de movimiento', 'fecha movimiento', 'fecha del movimiento', 'fecha de compra',
      'fecha de pago',
      // fr
      'date d operation', 'date operation', 'date de l operation', 'date de transaction', 'date de la transaction',
      'date d achat', 'date de l achat', 'date de paiement',
      // de
      'transaktionsdatum', 'umsatzdatum', 'belegdatum', 'kaufdatum', 'datum der transaktion', 'zahlungsdatum',
      // pt
      'data da transacao', 'data transacao', 'data do movimento', 'data movimento', 'data mov', 'data da compra',
      'data de compra', 'data da operacao', 'data operacao', 'data do pagamento',
      // it
      'data operazione', 'data dell operazione', 'data transazione', 'data della transazione', 'data acquisto',
      'data movimento', 'data pagamento',
      // zh
      '交易日期', '交易日', '交易时间', '消费日期', '发生日期', '支付时间', '付款时间', '交易日期时间',
      // ja
      '取引日', '取引日付', 'お取引日', '利用日', 'ご利用日', 'ご利用年月日', '利用年月日', '取引年月日', '支払日', 'お支払日',
      // ko
      '거래일', '거래일자', '거래일시', '이용일', '이용일자', '이용일시', '승인일', '승인일자',
    ],
  ],
  [
    'postedDate',
    [
      // en
      'posted date', 'post date', 'posting date', 'date posted', 'posted', 'settlement date', 'settled date',
      'settle date', 'value date', 'cleared date', 'clearing date', 'processed date', 'process date',
      'processing date', 'effective date', 'completed date',
      // es
      'fecha valor', 'fecha de valor', 'fecha de liquidacion',
      // fr
      'date de valeur', 'date valeur', 'date de reglement',
      // de
      'valuta', 'valutadatum', 'wertstellung', 'wertstellungstag', 'wertstellungsdatum', 'wert',
      // pt
      'data valor', 'data de valor', 'data de liquidacao', 'data de processamento',
      // it
      'data valuta', 'data di valuta',
      // zh
      '记账日期', '记账日', '入账日期', '入账日', '起息日', '清算日期', '过账日期',
      // ja
      '記帳日', '起算日', '決済日', '計上日',
      // ko
      '기장일', '기장일자', '결제일', '결제일자', '매입일', '매입일자',
    ],
  ],
  [
    'date',
    [
      // en
      'date', 'datetime', 'date time', 'timestamp', 'time stamp', 'time', 'day', 'booking date', 'booked date',
      'book date', 'entry date', 'operation date',
      // es
      'fecha', 'fecha y hora', 'dia', 'fecha contable', 'fecha de contabilizacion', 'fecha de registro',
      // fr
      'jour', 'date et heure', 'date comptable', 'date de comptabilisation',
      // de
      'datum', 'tag', 'buchungstag', 'buchungsdatum', 'buchung', 'datum der buchung',
      // pt
      'data', 'data e hora', 'data de lancamento', 'data do lancamento', 'data lancamento', 'data contabil',
      // it
      'giorno', 'data e ora', 'data contabile', 'data di contabilizzazione', 'data registrazione',
      // zh
      '日期', '时间', '日期时间',
      // ja
      '日付', '年月日', '日時',
      // ko
      '날짜', '일자', '일시',
    ],
  ],
  [
    'altDescription',
    ['original description', 'raw description', 'bank description', 'original name', 'full description'],
  ],
  [
    'description',
    [
      // en
      'description', 'transaction description', 'desc', 'details', 'transaction details', 'detail', 'narrative',
      'narration', 'particulars', 'transaction', 'text', 'item', 'transaction text', 'description of transaction',
      'activity', 'transaction name',
      // es
      'descripcion', 'concepto', 'detalle', 'detalles', 'movimiento', 'glosa', 'descripcion del movimiento',
      'descripcion de la transaccion',
      // fr
      'libelle', 'intitule', 'libelle de l operation', 'libelle operation', 'designation', 'nature de l operation',
      // de
      'beschreibung', 'verwendungszweck', 'buchungstext', 'vorgang', 'buchungsdetails', 'zweck', 'betreff',
      // pt
      'descricao', 'historico', 'lancamento', 'detalhes', 'descritivo', 'descricao do movimento',
      'descricao da transacao',
      // it
      'descrizione', 'causale', 'dettagli', 'descrizione operazione', 'descrizione dell operazione', 'operazione',
      // zh
      '摘要', '交易摘要', '描述', '说明', '交易说明', '交易描述', '用途', '交易内容', '交易名称', '商品', '商品说明', '详情',
      // ja
      '内容', 'お取引内容', '取引内容', '明細', 'ご利用内容', '利用内容', '取引明細',
      // ko
      '내용', '적요', '거래내용', '기재내용', '이용내역', '거래내역', '상세내용',
    ],
  ],
  [
    'payee',
    [
      // en
      'payee', 'merchant', 'merchant name', 'name', 'counterparty', 'counter party', 'beneficiary', 'payer', 'vendor',
      'recipient', 'paid to', 'to from', 'payee name', 'supplier', 'store', 'store name', 'shop', 'retailer',
      // es
      'beneficiario', 'comercio', 'establecimiento', 'nombre', 'ordenante', 'destinatario', 'proveedor',
      // fr
      'beneficiaire', 'tiers', 'commercant', 'nom', 'marchand', 'destinataire', 'emetteur',
      // de
      'empfänger', 'auftraggeber', 'begünstigter', 'zahlungsempfänger', 'zahlungspflichtiger',
      'begünstigter zahlungspflichtiger', 'auftraggeber empfänger', 'händler', 'name zahlungsbeteiligter',
      // pt
      'favorecido', 'estabelecimento', 'nome', 'comerciante', 'loja',
      // it
      'esercente', 'ordinante', 'controparte', 'negozio',
      // zh
      '对方户名', '对方名称', '对方账户名', '收款人', '付款人', '商户', '商户名称', '交易对方', '对方', '商家',
      // ja
      '支払先', '振込先', 'ご利用店名', '利用店名', '店名', '取引先', '相手先', '加盟店名', 'ご利用先',
      // ko
      '가맹점', '가맹점명', '받는분', '보낸분', '거래처', '상호', '이용하신곳', '상대방',
    ],
  ],
  [
    'memo',
    [
      // en
      'memo', 'notes', 'note', 'comment', 'comments', 'remarks', 'remark', 'additional info',
      'additional information', 'additional details', 'extended details', 'extended description', 'more details',
      'purpose', 'message', 'annotation',
      // es
      'nota', 'notas', 'observaciones', 'observacion', 'comentario', 'comentarios', 'informacion adicional', 'mensaje',
      // fr
      'commentaire', 'commentaires', 'remarque', 'remarques', 'informations complementaires',
      'information complementaire', 'motif',
      // de
      'notiz', 'notizen', 'bemerkung', 'bemerkungen', 'kommentar', 'zusatzinformationen', 'mitteilung', 'vermerk',
      // pt
      'observacao', 'observacoes', 'informacao adicional', 'informacoes adicionais', 'mensagem', 'complemento',
      // it
      'commento', 'commenti', 'osservazioni', 'informazioni aggiuntive', 'descrizione estesa', 'messaggio',
      'annotazioni',
      // zh
      '备注', '附言', '留言', '注释', '附加信息',
      // ja
      '備考', 'メモ', 'コメント', '注記',
      // ko
      '메모', '비고', '참고', '추가정보',
    ],
  ],
  [
    'amount',
    [
      // en
      'amount', 'transaction amount', 'amt', 'value', 'sum', 'total', 'billing amount', 'billed amount',
      'payment amount', 'amount paid', 'total payment', 'total paid', 'total amount', 'payment', 'net amount',
      'posted amount', 'local amount',
      // es
      'importe', 'monto', 'cantidad', 'valor', 'importe total', 'monto total',
      // fr
      'montant', 'somme', 'montant total', 'valeur',
      // de
      'betrag', 'umsatz', 'summe',
      // pt
      'montante', 'quantia', 'importancia', 'valor total',
      // it
      'importo', 'ammontare', 'somma', 'importo totale',
      // zh
      '金额', '交易金额', '发生额', '交易额', '收支金额',
      // ja
      '金額', '取引金額', 'ご利用金額', '利用金額', 'お取引金額', '支払金額', 'お支払金額',
      // ko
      '금액', '거래금액', '이용금액', '결제금액', '승인금액',
    ],
  ],
  [
    'debit',
    [
      // en
      'debit', 'debits', 'debit amount', 'amount debit', 'debit amt', 'withdrawal', 'withdrawals',
      'withdrawal amount', 'withdrawn', 'money out', 'paid out', 'payments out', 'outflow', 'outflows', 'charge',
      'charges', 'spent', 'expense', 'expenses', 'purchases', 'dr', 'out',
      // es
      'cargo', 'cargos', 'debito', 'debitos', 'debe', 'retiro', 'retiros', 'egreso', 'egresos', 'salida', 'salidas',
      'gasto', 'gastos',
      // fr
      'retrait', 'retraits', 'sortie', 'sorties', 'depense', 'depenses', 'montant debit',
      // de
      'soll', 'belastung', 'belastungen', 'ausgang', 'ausgänge', 'ausgaben', 'lastschrift', 'abgang', 'auszahlung',
      // pt
      'saida', 'saidas', 'despesa', 'despesas',
      // it
      'addebito', 'addebiti', 'dare', 'uscita', 'uscite', 'prelievo', 'prelievi',
      // zh
      '支出', '支出金额', '借方', '借方金额', '借方发生额', '取出', '转出', '付款金额',
      // ja
      '出金', '出金額', '出金金額', 'お引出し', 'お引出し金額', 'お支払い', '支払', '支払額', '支払金額', 'お支払金額',
      // ko
      '출금', '출금액', '출금금액', '찾으신금액', '지출', '지급',
    ],
  ],
  [
    'credit',
    [
      // en
      'credit', 'credits', 'credit amount', 'amount credit', 'credit amt', 'deposit', 'deposits', 'deposit amount',
      'money in', 'paid in', 'payments in', 'inflow', 'inflows', 'received', 'income', 'payments', 'payment', 'cr',
      'in',
      // es
      'abono', 'abonos', 'credito', 'creditos', 'haber', 'deposito', 'depositos', 'ingreso', 'ingresos', 'entrada',
      'entradas',
      // fr
      'depot', 'depots', 'entree', 'entrees', 'recette', 'recettes', 'versement', 'versements', 'montant credit',
      // de
      'haben', 'gutschrift', 'gutschriften', 'eingang', 'eingänge', 'einnahmen', 'zugang', 'einzahlung',
      // pt
      'receita', 'receitas',
      // it
      'accredito', 'accrediti', 'avere', 'entrata', 'entrate', 'versamento', 'versamenti',
      // zh
      '收入', '收入金额', '贷方', '贷方金额', '贷方发生额', '存入', '转入', '收款金额',
      // ja
      '入金', '入金額', '入金金額', 'お預入れ', 'お預入れ金額', 'お預り', 'お預り金額', '預入',
      // ko
      '입금', '입금액', '입금금액', '맡기신금액', '수입',
    ],
  ],
  [
    'direction',
    [
      // en
      'dr cr', 'cr dr', 'debit credit', 'credit debit', 'd c', 'c d', 'dc', 'indicator', 'debit credit indicator',
      'dr cr indicator', 'credit debit indicator', 'transaction type', 'type', 'trans type', 'tran type', 'txn type',
      'sign', 'direction', 'flow', 'entry type', 'debit or credit',
      // es
      'tipo', 'tipo de movimiento', 'tipo de transaccion', 'tipo movimiento', 'cargo abono', 'debe haber', 'signo',
      'naturaleza',
      // fr
      'sens', 'type d operation', 'type operation', 'signe', 'nature',
      // de
      'soll haben', 's h', 'soll haben kennzeichen', 'kennzeichen', 'art', 'umsatzart', 'buchungsart', 'typ',
      // pt
      'tipo de movimento', 'tipo de transacao', 'debito credito', 'natureza', 'sinal',
      // it
      'tipo operazione', 'tipo movimento', 'dare avere', 'segno',
      // zh
      '借贷标志', '借贷方向', '借贷', '收支', '收 支', '收支类型', '交易类型', '类型', '借贷标识',
      // ja
      '入出金', '入出金区分', '入払区分', '区分', '取引区分', '種別', '取引種別',
      // ko
      '구분', '거래구분', '입출금', '입출금구분', '거래유형', '유형',
    ],
  ],
  [
    'balance',
    [
      // en
      'balance', 'running balance', 'running bal', 'available balance', 'ledger balance', 'closing balance',
      'account balance', 'balance after', 'bal', 'remaining balance', 'principal balance', 'loan balance',
      'ending balance', 'current balance', 'new balance', 'balance after transaction', 'outstanding balance',
      // es / pt / it / de
      'saldo', 'saldo disponible', 'saldo final', 'saldo contable', 'saldo despues', 'saldo actual',
      'saldo disponivel', 'saldo apos', 'saldo atual', 'saldo contabile', 'saldo disponibile', 'saldo finale',
      'saldo nach buchung', 'neuer saldo', 'kontostand', 'kontostand nach buchung',
      // fr
      'solde', 'solde courant', 'solde apres operation', 'solde disponible', 'nouveau solde',
      // zh
      '余额', '账户余额', '交易后余额', '可用余额', '本次余额', '结余',
      // ja
      '残高', '差引残高', '取引後残高', 'お取引後残高', '現在残高',
      // ko
      '잔액', '거래후잔액', '거래후 잔액', '잔고',
    ],
  ],
  [
    'reference',
    [
      // en
      'reference', 'reference number', 'reference no', 'ref', 'ref no', 'ref number', 'reference id',
      'transaction id', 'transaction number', 'transaction no', 'transaction reference', 'transaction ref', 'txn id', 'trans id', 'id',
      'fitid', 'confirmation number', 'confirmation', 'trace number', 'receipt number', 'bank reference',
      'unique id', 'document number',
      // es
      'referencia', 'numero de referencia', 'numero referencia', 'num referencia', 'numero de operacion',
      'numero de documento', 'documento', 'folio', 'numero de transaccion', 'id transaccion',
      // fr
      'numero de reference', 'numero d operation', 'numero de transaction', 'identifiant', 'numero de piece',
      // de
      'referenz', 'referenznummer', 'transaktionsnummer', 'belegnummer', 'buchungsnummer', 'primanota',
      'transaktions id',
      // pt
      'numero do documento', 'numero da transacao', 'nsu', 'id da transacao',
      // it
      'riferimento', 'numero di riferimento', 'numero riferimento', 'numero operazione', 'numero transazione',
      'id transazione', 'codice riferimento', 'cro',
      // zh
      '流水号', '交易流水号', '参考号', '交易号', '凭证号', '交易单号', '订单号', '交易参考号', '流水',
      // ja
      '照会番号', '取引番号', '伝票番号', '受付番号', '整理番号', '取引id',
      // ko
      '거래번호', '참조번호', '승인번호', '거래고유번호', '전표번호', '일련번호',
    ],
  ],
  [
    'account',
    [
      // en
      'account number', 'account no', 'account', 'acct', 'acct number', 'acct no', 'account id', 'account name',
      'card number', 'card no', 'card', 'card ending', 'card last 4', 'last 4', 'last four', 'last 4 digits', 'iban',
      // es
      'numero de cuenta', 'cuenta', 'numero cuenta', 'num cuenta', 'tarjeta', 'numero de tarjeta', 'clabe',
      // fr
      'numero de compte', 'compte', 'numero compte', 'carte', 'numero de carte', 'rib',
      // de
      'kontonummer', 'konto', 'kontonr', 'konto nr', 'karte', 'kartennummer', 'auftragskonto',
      // pt
      'numero da conta', 'conta', 'numero conta', 'cartao', 'numero do cartao', 'nib',
      // it
      'numero conto', 'conto', 'numero di conto', 'carta', 'numero carta', 'numero di carta', 'rapporto',
      // zh
      '账号', '卡号', '账户', '帐号', '交易卡号', '账户号码', '银行卡号', '本方账号',
      // ja
      '口座番号', 'カード番号', '口座', '口座名', 'カード名称',
      // ko
      '계좌번호', '카드번호', '계좌', '카드', '계좌명',
    ],
  ],
  [
    'status',
    [
      // en
      'status', 'state', 'transaction status', 'posting status', 'cleared', 'pending',
      // es / pt / it
      'estado', 'estatus', 'situacion', 'situacao', 'stato', 'situazione',
      // fr
      'statut', 'etat', 'situation',
      // de
      'zustand', 'buchungsstatus',
      // zh
      '状态', '交易状态',
      // ja
      '状態', 'ステータス', '取引状態',
      // ko
      '상태', '거래상태', '처리상태',
    ],
  ],
  [
    'currency',
    [
      // en
      'currency', 'ccy', 'currency code', 'curr', 'cur', 'transaction currency', 'iso currency',
      // es / pt / it
      'moneda', 'divisa', 'moeda', 'valuta',
      // fr
      'devise', 'monnaie',
      // de
      'währung',
      // zh
      '币种', '货币', '币别',
      // ja
      '通貨', '通貨コード',
      // ko
      '통화', '통화코드',
    ],
  ],
  [
    'category',
    [
      // en
      'category', 'categories', 'subcategory', 'sub category', 'tags', 'tag', 'labels', 'label', 'classification',
      'budget category', 'spending category', 'transaction category',
      // es / pt / it
      'categoria', 'categorias', 'subcategoria', 'etiqueta', 'etiquetas', 'rubro', 'clasificacion', 'classificacao',
      'rubrica', 'categorie', 'sottocategoria', 'etichetta', 'etichette', 'classificazione',
      // fr
      'sous categorie', 'etiquette', 'etiquettes', 'rubrique',
      // de
      'kategorie', 'kategorien', 'unterkategorie', 'rubrik', 'klassifizierung', 'schlagwort', 'schlagworte',
      // zh
      '分类', '类别', '交易分类', '标签', '类目',
      // ja
      'カテゴリ', 'カテゴリー', '分類', '費目', 'タグ',
      // ko
      '분류', '카테고리', '태그', '업종',
    ],
  ],
  [
    'principal',
    [
      'principal', 'principal paid', 'principal amount', 'principal portion', 'to principal', 'principal payment',
      'principal applied', 'capital', 'amortizacion', 'abono a capital', 'amortissement', 'capital rembourse',
      'tilgung', 'tilgungsanteil', 'tilgungsbetrag', 'amortizacao', 'capitale', 'quota capitale', '本金', '还款本金',
      '应还本金', '元金', '元本', '元金充当額', '원금', '상환원금',
    ],
  ],
  [
    'interest',
    [
      'interest', 'interest paid', 'interest amount', 'interest portion', 'to interest', 'interest payment',
      'interest applied', 'interest charged', 'interes', 'intereses', 'interet', 'interets', 'zinsen', 'zins',
      'zinsanteil', 'zinsbetrag', 'juros', 'interessi', 'quota interessi', '利息', '还款利息', '应还利息', '利子',
      '利息充当額', '이자', '상환이자',
    ],
  ],
  [
    'escrow',
    [
      'escrow', 'escrow paid', 'escrow amount', 'to escrow', 'escrow payment', 'escrow applied', 'impound',
      'impounds', 'taxes and insurance', 'tax and insurance', 'deposito en garantia', 'impuestos y seguro',
      'sequestre', 'impots et assurance', 'treuhand', 'caucao', 'impostos e seguro', 'deposito a garanzia', '托管',
      'エスクロー', '에스크로',
    ],
  ],
  [
    'fees',
    [
      'fees', 'fee', 'late fee', 'late fees', 'late charge', 'late charges', 'other fees', 'fee amount',
      'service charge', 'comision', 'comisiones', 'recargo', 'mora', 'frais', 'commission', 'commissions', 'penalite',
      'gebühr', 'gebühren', 'entgelt', 'entgelte', 'spesen', 'taxa', 'taxas', 'comissao', 'comissoes', 'multa',
      'encargos', 'commissione', 'commissioni', 'spese', '手续费', '费用', '滞纳金', '手数料', '遅延損害金', '수수료', '연체료',
    ],
  ],
  [
    'checkNumber',
    [
      'check number', 'check no', 'check num', 'check', 'chk', 'chk no', 'cheque number', 'cheque no', 'cheque',
      'numero de cheque', 'num cheque', 'n cheque', 'schecknummer', 'scheck', 'numero do cheque', 'numero assegno',
      'assegno', '支票号', '支票号码', '小切手番号', '수표번호',
    ],
  ],
  [
    'type',
    // Words that name a kind of transaction when the column is not a money-in / money-out indicator.
    [
      'transaction type', 'type', 'trans type', 'tran type', 'txn type', 'entry type', 'tipo', 'tipo de movimiento',
      'tipo de transaccion', 'tipo movimiento', 'naturaleza', 'type d operation', 'type operation', 'nature', 'art',
      'umsatzart', 'buchungsart', 'typ', 'tipo de movimento', 'tipo de transacao', 'natureza', 'tipo operazione',
      'tipo movimento', '交易类型', '类型', '区分', '取引区分', '種別', '取引種別', '구분', '거래구분', '거래유형', '유형',
    ],
  ],
  [
    'ignored',
    [
      // People and places
      'card holder', 'cardholder', 'cardholder name', 'card holder name', 'account holder', 'account holder name',
      'customer name', 'customer', 'member', 'member name', 'user', 'owner', 'branch', 'address', 'city', 'state',
      'zip', 'zip code', 'postal code', 'country', 'location', 'phone', 'email', 'website',
      'sucursal', 'oficina', 'ciudad', 'agence', 'ville', 'filiale', 'ort', 'agencia', 'cidade', 'citta', '网点',
      '支店', '지점',
      // Codes and other numbers that are not the amount
      'mcc', 'mcc code', 'sic', 'sic code', 'routing number', 'sort code', 'bic', 'swift', 'blz', 'bankleitzahl',
      'bank', 'bank name', 'institution', 'account type', 'card type', 'original amount', 'foreign amount',
      'exchange rate', 'fx rate', 'rate', 'tax', 'vat', 'tip', 'quantity', 'qty', 'unit price',
      'gegenkonto', 'mandatsreferenz', 'gläubiger id', 'kundenreferenz', '对方账号', '对方开户行', '相手口座', '상대계좌',
      // Dates that are not when the transaction happened
      'due date', 'statement date', 'closing date', 'maturity date', 'next due date',
    ],
  ],
];

/** Too short to be trusted inside a longer header: "Dr" is a debit column, "Dr Smith Fee" is not. */
const EXACT_ONLY_MAX_LENGTH = 3;

/** German headers spell umlauts either way: "Währung" / "Waehrung", "Empfänger" / "Empfaenger". */
function umlautSpelledOut(alias: string): string | null {
  if (!/[äöü]/.test(alias)) return null;
  return alias.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
}

const ALIAS_INDEX: Map<string, HeaderClass[]> = (() => {
  const index = new Map<string, HeaderClass[]>();
  const add = (alias: string, headerClass: HeaderClass) => {
    const classes = index.get(alias);
    if (!classes) index.set(alias, [headerClass]);
    else if (!classes.includes(headerClass)) classes.push(headerClass);
  };
  for (const [headerClass, aliases] of ALIASES) {
    for (const raw of aliases) {
      add(normalizeHeader(raw), headerClass);
      const spelledOut = umlautSpelledOut(raw);
      if (spelledOut) add(normalizeHeader(spelledOut), headerClass);
    }
  }
  return index;
})();

/** Aliases that may match inside a longer header, longest first. */
const CONTAINED_ALIASES: Array<{ alias: string; cjk: boolean }> = [...ALIAS_INDEX.keys()]
  .filter((alias) => hasCjk(alias) || alias.length > EXACT_ONLY_MAX_LENGTH)
  .sort((a, b) => b.length - a.length)
  .map((alias) => ({ alias, cjk: hasCjk(alias) }));

export interface HeaderMatch {
  /** Candidate classes, most likely first. */
  classes: HeaderClass[];
  /** The whole header is the alias (as opposed to containing it). */
  exact: boolean;
  /** The alias that matched, normalised. */
  alias: string;
}

/** What a header name says the column is, or null when no alias of any language matches. */
export function matchHeader(name: string): HeaderMatch | null {
  const header = normalizeHeader(name);
  if (!header) return null;

  const exact = ALIAS_INDEX.get(header);
  if (exact) return { classes: exact, exact: true, alias: header };

  const padded = ` ${header} `;
  for (const { alias, cjk } of CONTAINED_ALIASES) {
    if (cjk ? header.includes(alias) : padded.includes(` ${alias} `)) {
      return { classes: ALIAS_INDEX.get(alias) as HeaderClass[], exact: false, alias };
    }
  }
  return null;
}
