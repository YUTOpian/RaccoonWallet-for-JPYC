import Decimal from 'decimal.js';
import { toCsvRow } from './csvExport';
import type { TxAnnotationTag } from './storage';

// 送受信履歴を会計ソフト向けのCSVにする。JPYCは電子決済手段(1JPYC=1円)なので、損益ではなく
// 入出金の記録が主役: 1送受信 = 1行(freee: 明細アップロード形式 / マネーフォワード: 仕訳帳インポート形式)。
// freee・マネーフォワード向けは円建てで記録できるJPYCだけを対象にし、「私用」タグの行は含めない。
// 汎用CSVは全通貨・全タグを含める。

export type ExportFormat = 'generic' | 'freee' | 'moneyforward';

export interface ExportRow {
  timestamp: Date;
  chainName: string;
  hash: string;
  isReception: boolean;
  senderAddress: string;
  receiverAddress: string;
  peerName: string; // アドレス帳に登録済みの相手先名。無ければ ''
  amount: string;
  currencySymbol: string;
  tag: TxAnnotationTag;
  category: string; // 費目(勘定科目)。無ければ ''
  memo: string;
}

export interface MoneyForwardSettings {
  walletAccount: string;  // 例: 電子決済手段
  expenseAccount: string; // 「経費」タグの相手勘定科目 例: 雑費
}

export const DEFAULT_MONEYFORWARD_SETTINGS: MoneyForwardSettings = {
  walletAccount: '電子決済手段',
  expenseAccount: '雑費',
};

const TAG_LABEL: Record<TxAnnotationTag, string> = { '': '未分類', sales: '売上', expense: '経費', personal: '私用' };

export function tagLabel(tag: TxAnnotationTag): string {
  return TAG_LABEL[tag];
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateOnly = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const dateTime = (d: Date) => `${dateOnly(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Rows whose local date falls within [from, to] (both inclusive, 'YYYY-MM-DD' from <input type="date">). */
export function filterByPeriod(rows: ExportRow[], from: string, to: string): ExportRow[] {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  return rows.filter((r) => {
    const ms = r.timestamp.getTime();
    return ms >= start && ms <= end;
  });
}

/** Rows that end up in a freee / マネーフォワード file: JPYC only, 私用 excluded. */
export function filterForAccountingSoftware(rows: ExportRow[]): ExportRow[] {
  return rows.filter((r) => r.currencySymbol === 'JPYC' && r.tag !== 'personal');
}

function sortOldestFirst(rows: ExportRow[]): ExportRow[] {
  return rows.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

// freee / MF は整数の円しか受け付けないため小数部は切り捨てる。切り捨てが起きた行は、
// 元の正確な数量を「内容」「摘要」の末尾に残す。
function toYen(amount: string): { yen: string; exact: string } {
  const d = new Decimal(amount || '0');
  const yen = d.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return { yen: yen.toFixed(0), exact: yen.equals(d) ? '' : `(正確な数量 ${d.toFixed()} JPYC)` };
}

// MFの仕訳帳インポートは「"」を含む摘要を読み込めない。freee/MF両方の自由記述欄から取り除く。
const stripQuotes = (s: string) => s.replace(/["\u201C\u201D]/g, '');

function describe(row: ExportRow, exact: string): string {
  const peer = row.peerName || (row.isReception ? row.senderAddress : row.receiverAddress);
  const parts = [row.tag === '' ? '' : tagLabel(row.tag), row.category, row.memo, peer, exact];
  return stripQuotes(parts.filter((p) => p !== '').join(' '));
}

export function buildGenericCsv(rows: ExportRow[]): string {
  const header = ['日時', 'チェーン', '区分', '通貨', '金額', '送信元', '送信先', '相手先', '分類', '費目', 'メモ', 'Txハッシュ'];
  const body = sortOldestFirst(rows).map((r) => toCsvRow([
    dateTime(r.timestamp), r.chainName, r.isReception ? '入金' : '出金', r.currencySymbol, r.amount,
    r.senderAddress, r.receiverAddress, r.peerName, tagLabel(r.tag), r.category, r.memo, r.hash,
  ]));
  return [toCsvRow(header), ...body].join('\r\n');
}

/** freee 「明細アップロード」用: 取引日 / 出金額 / 入金額 / 内容 (JPYC・私用以外)。 */
export function buildFreeeCsv(rows: ExportRow[]): string {
  const header = ['取引日', '出金額', '入金額', '内容'];
  const body = sortOldestFirst(filterForAccountingSoftware(rows)).map((r) => {
    const { yen, exact } = toYen(r.amount);
    return toCsvRow([dateOnly(r.timestamp), r.isReception ? '' : yen, r.isReception ? yen : '', describe(r, exact)]);
  });
  return [toCsvRow(header), ...body].join('\r\n');
}

const MF_HEADER = [
  '取引No', '取引日',
  '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額',
  '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額',
  '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳', '作成日時', '作成者', '最終更新日時', '最終更新者',
];

/**
 * マネーフォワード クラウド会計 「仕訳帳インポート」用 (JPYC・私用以外)。
 * ウォレット側の勘定科目は settings.walletAccount。相手勘定は 売上→費目 or 売上高 / 経費→費目 or settings.expenseAccount /
 * 未分類→仮受金(入金)・仮払金(出金)。ウォレット側の税区分は「対象外」、相手勘定側は空欄(科目の既定値)。
 */
export function buildMoneyForwardCsv(rows: ExportRow[], settings: MoneyForwardSettings): string {
  const body = sortOldestFirst(filterForAccountingSoftware(rows)).map((r, i) => {
    const { yen, exact } = toYen(r.amount);
    // 費目を付けていれば、それを相手勘定科目にする。無ければ従来どおり(売上→売上高 / 経費→設定の科目)。
    const counter = r.tag === 'sales' ? (r.category || '売上高')
      : r.tag === 'expense' ? (r.category || settings.expenseAccount)
        : r.isReception ? '仮受金' : '仮払金';
    const wallet = settings.walletAccount;
    const debit = r.isReception ? [wallet, '', '', '', '対象外', '', yen, ''] : [counter, '', '', '', '', '', yen, ''];
    const credit = r.isReception ? [counter, '', '', '', '', '', yen, ''] : [wallet, '', '', '', '対象外', '', yen, ''];
    return toCsvRow([
      String(i + 1), dateOnly(r.timestamp), ...debit, ...credit,
      describe(r, exact), stripQuotes(r.memo), r.tag === '' ? '' : tagLabel(r.tag), '', '', '', '', '', '',
    ]);
  });
  return [toCsvRow(MF_HEADER), ...body].join('\r\n');
}

export function buildExportCsv(format: ExportFormat, rows: ExportRow[], mf: MoneyForwardSettings): string {
  if (format === 'freee') return buildFreeeCsv(rows);
  if (format === 'moneyforward') return buildMoneyForwardCsv(rows, mf);
  return buildGenericCsv(rows);
}

/** Number of rows the chosen format will actually contain (freee/MF drop non-JPYC and 私用). */
export function countRowsForFormat(format: ExportFormat, rows: ExportRow[]): number {
  return format === 'generic' ? rows.length : filterForAccountingSoftware(rows).length;
}

export function downloadCsv(csv: string, filenamePrefix: string) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date();
  link.href = url;
  link.download = `${filenamePrefix}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
