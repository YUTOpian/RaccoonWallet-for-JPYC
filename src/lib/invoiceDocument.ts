import { buildPdf } from './pdf';
import type { PdfPage } from './pdf';
import { formatAmount, formatJapaneseDate, payloadTotals } from './invoice';
import type { InvoicePayload } from './invoice';

/**
 * Draws an invoice (請求書) or receipt (領収書) onto A4 canvases and packs them into a PDF.
 *
 * The document is always Japanese regardless of the app's UI language: it is a Japanese
 * business document (適格請求書 wording: issuer name + registration number, amounts and tax
 * broken out per tax rate, 軽減税率 marker) that gets handed to a counterparty. Text is
 * rendered by the browser's own fonts via canvas, so no font needs to be bundled; the result
 * is embedded as one JPEG per page (see pdf.ts).
 */

export type DocumentKind = 'invoice' | 'receipt';

export interface ReceiptInfo {
  number: string; // 領収書番号
  date: string; // 領収日 YYYY-MM-DD
  txHash?: string;
  from?: string; // 入金元アドレス
  manual: boolean; // true if the issuer marked it paid by hand (no matching transaction)
}

export interface RenderDocumentOptions {
  kind: DocumentKind;
  payload: InvoicePayload;
  signature: string;
  chainName: string;
  // The already-rendered payment QR (an EIP-681 URI). Invoices only; omitted -> no QR block.
  qrCanvas?: HTMLCanvasElement | null;
  receipt?: ReceiptInfo; // required for kind === 'receipt'
}

// A4 in points; every coordinate below is in points, scaled up when drawing.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SCALE = 3;
const MARGIN_X = 40;
const MARGIN_TOP = 44;
const MARGIN_BOTTOM = 56; // room for the footer
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = '#1c2f2d';
const MUTED = '#667a77';
const LINE = '#d6e2e0';
const FILL = '#eef6f5';
const ACCENT = '#00877b';

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",sans-serif';
const MONO = '"SFMono-Regular",Menlo,Consolas,"Liberation Mono","Noto Sans Mono CJK JP",monospace';

interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: CanvasTextAlign;
  mono?: boolean;
}

function fontString(o: TextOptions): string {
  return `${o.bold ? 'bold ' : ''}${o.size ?? 10}px ${o.mono ? MONO : FONT}`;
}

/** Character-wise wrap (Japanese has no spaces; hex addresses have no break points). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, o: TextOptions): string[] {
  ctx.font = fontString(o);
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of paragraph) {
      if (line !== '' && ctx.measureText(line + ch).width > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

class Page {
  readonly pages: HTMLCanvasElement[] = [];
  ctx!: CanvasRenderingContext2D;
  y = MARGIN_TOP;

  private readonly continuationTitle: string;

  constructor(continuationTitle: string) {
    this.continuationTitle = continuationTitle;
    this.addCanvas();
  }

  private addCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_W * SCALE);
    canvas.height = Math.round(PAGE_H * SCALE);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff'; // JPEG has no alpha
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'top';
    this.pages.push(canvas);
    this.ctx = ctx;
    this.y = MARGIN_TOP;
  }

  /** Starts a new page if `height` more points don't fit on this one. */
  ensure(height: number) {
    if (this.y + height <= PAGE_H - MARGIN_BOTTOM) return;
    this.addCanvas();
    this.text(this.continuationTitle, MARGIN_X, this.y, { size: 9, color: MUTED });
    this.y += 22;
  }

  text(str: string, x: number, y: number, o: TextOptions = {}) {
    this.ctx.font = fontString(o);
    this.ctx.fillStyle = o.color ?? INK;
    this.ctx.textAlign = o.align ?? 'left';
    this.ctx.fillText(str, x, y);
  }

  /** Draws wrapped text starting at (x, y); returns the y just below it. */
  paragraph(str: string, x: number, y: number, maxWidth: number, o: TextOptions = {}): number {
    const lineHeight = (o.size ?? 10) * 1.5;
    for (const line of wrapText(this.ctx, str, maxWidth, o)) {
      this.text(line, x, y, o);
      y += lineHeight;
    }
    return y;
  }

  hline(y: number, x1 = MARGIN_X, x2 = PAGE_W - MARGIN_X, color = LINE, width = 0.6) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y);
    this.ctx.lineTo(x2, y);
    this.ctx.stroke();
  }

  rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string) {
    if (fill) {
      this.ctx.fillStyle = fill;
      this.ctx.fillRect(x, y, w, h);
    }
    if (stroke) {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = 0.8;
      this.ctx.strokeRect(x, y, w, h);
    }
  }
}

function withHonorific(name: string): string {
  return /(様|御中|殿)$/.test(name.trim()) ? name.trim() : `${name.trim()} 様`;
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
}

function shortHex(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function rateText(rate: number): string {
  return rate === 8 ? '8%※' : rate === 0 ? '非課税' : `${rate}%`;
}

/** Renders the document and returns one canvas per A4 page. */
export function renderDocumentPages(opts: RenderDocumentOptions): HTMLCanvasElement[] {
  const { kind, payload, signature, chainName, qrCanvas, receipt } = opts;
  const isReceipt = kind === 'receipt';
  const title = isReceipt ? '領収書' : '請求書';
  const totals = payloadTotals(payload);
  const issuer = payload.iss;
  const numberLabel = isReceipt ? '領収書番号' : '請求書番号';
  const docNumber = isReceipt && receipt ? receipt.number : payload.n;

  const p = new Page(`${title}  ${docNumber}  （続き）`);
  const colRightX = 340;

  // --- title ---------------------------------------------------------------------------
  p.text(title, PAGE_W / 2, p.y, { size: 26, bold: true, align: 'center' });
  p.y += 40;
  p.hline(p.y, MARGIN_X, PAGE_W - MARGIN_X, ACCENT, 1.4);
  p.y += 16;

  // --- recipient (left) / meta + issuer (right) ---------------------------------------
  const top = p.y;
  let leftY = top;
  leftY = p.paragraph(withHonorific(payload.to), MARGIN_X, leftY, colRightX - MARGIN_X - 20, { size: 17, bold: true });
  p.hline(leftY + 2, MARGIN_X, colRightX - 20, INK, 0.8);
  leftY += 12;
  if (payload.sub.trim() !== '') {
    leftY = p.paragraph(`件名：${payload.sub}`, MARGIN_X, leftY, colRightX - MARGIN_X - 20, { size: 10.5 });
  }

  let rightY = top;
  const meta: [string, string][] = [[numberLabel, docNumber]];
  if (isReceipt && receipt) {
    meta.push(['領収日', formatJapaneseDate(receipt.date)]);
    meta.push(['請求書番号', payload.n]);
  } else {
    meta.push(['発行日', formatJapaneseDate(payload.d)]);
  }
  for (const [label, value] of meta) {
    p.text(label, colRightX, rightY, { size: 9, color: MUTED });
    p.text(value, PAGE_W - MARGIN_X, rightY, { size: 10, align: 'right' });
    rightY += 15;
  }
  rightY += 8;
  rightY = p.paragraph(issuer.name, colRightX, rightY, PAGE_W - MARGIN_X - colRightX, { size: 12, bold: true });
  if (issuer.reg !== '') {
    p.text(`登録番号：${issuer.reg}`, colRightX, rightY, { size: 9 });
    rightY += 14;
  }
  for (const line of [issuer.addr, issuer.tel !== '' ? `TEL：${issuer.tel}` : '', issuer.mail !== '' ? `Mail：${issuer.mail}` : '']) {
    if (line !== '') rightY = p.paragraph(line, colRightX, rightY, PAGE_W - MARGIN_X - colRightX, { size: 9, color: '#33403e' });
  }
  p.y = Math.max(leftY, rightY) + 12;

  // --- amount box ----------------------------------------------------------------------
  p.rect(MARGIN_X, p.y, CONTENT_W, 40, FILL);
  p.text(isReceipt ? '領収金額' : 'ご請求金額', MARGIN_X + 14, p.y + 13, { size: 12, bold: true });
  p.text(`${formatAmount(totals.total)} JPYC`, PAGE_W - MARGIN_X - 82, p.y + 8, { size: 21, bold: true, align: 'right' });
  p.text('（税込）', PAGE_W - MARGIN_X - 12, p.y + 17, { size: 9, color: MUTED, align: 'right' });
  p.y += 52;
  if (isReceipt) {
    p.text('上記の金額を、JPYC にて正に領収いたしました。', MARGIN_X, p.y, { size: 10.5 });
    p.y += 22;
  } else if (payload.due !== '') {
    p.text('お支払期限', MARGIN_X, p.y, { size: 9, color: MUTED });
    p.text(formatJapaneseDate(payload.due), MARGIN_X + 60, p.y - 1, { size: 11, bold: true });
    p.y += 22;
  } else {
    p.y += 4;
  }

  // --- line items ------------------------------------------------------------------------
  const colQtyR = 336;
  const colPriceR = 410;
  const colRateC = 436;
  const colAmountR = PAGE_W - MARGIN_X - 6;
  const nameWidth = colQtyR - MARGIN_X - 44;
  const drawTableHeader = () => {
    p.rect(MARGIN_X, p.y, CONTENT_W, 20, FILL);
    p.text('品名', MARGIN_X + 6, p.y + 6, { size: 9, bold: true });
    p.text('数量', colQtyR, p.y + 6, { size: 9, bold: true, align: 'right' });
    p.text('単価', colPriceR, p.y + 6, { size: 9, bold: true, align: 'right' });
    p.text('税率', colRateC, p.y + 6, { size: 9, bold: true, align: 'center' });
    p.text(payload.tm === 'incl' ? '金額（税込）' : '金額（税抜）', colAmountR, p.y + 6, { size: 9, bold: true, align: 'right' });
    p.y += 20;
  };
  p.ensure(20 + 30);
  drawTableHeader();
  let hasReduced = false;
  payload.it.forEach((item, i) => {
    const lines = wrapText(p.ctx, item.name, nameWidth, { size: 10 });
    const rowH = Math.max(lines.length, 1) * 14 + 10;
    const before = p.pages.length;
    p.ensure(rowH);
    if (p.pages.length !== before) drawTableHeader();
    lines.forEach((line, li) => p.text(line, MARGIN_X + 6, p.y + 5 + li * 14, { size: 10 }));
    p.text(formatQty(item.qty), colQtyR, p.y + 5, { size: 10, align: 'right' });
    p.text(formatAmount(item.price), colPriceR, p.y + 5, { size: 10, align: 'right' });
    p.text(rateText(item.rate), colRateC, p.y + 5, { size: 10, align: 'center' });
    p.text(formatAmount(totals.lineAmounts[i]), colAmountR, p.y + 5, { size: 10, align: 'right' });
    if (item.rate === 8) hasReduced = true;
    p.y += rowH;
    p.hline(p.y);
  });
  if (hasReduced) {
    p.y += 6;
    p.text('※は軽減税率（8%）対象', MARGIN_X + 6, p.y, { size: 8.5, color: MUTED });
    p.y += 12;
  }
  p.y += 10;

  // --- totals per tax rate -------------------------------------------------------------
  const totalsX = 300;
  const totalsRows = totals.groups.reduce((n, g) => n + (g.rate === 0 ? 1 : 2), 0);
  p.ensure(totalsRows * 16 + 44);
  for (const g of totals.groups) {
    const label = g.rate === 0 ? '非課税・不課税対象' : `${g.rate}%対象（税抜）`;
    p.text(label, totalsX, p.y, { size: 9.5, color: '#33403e' });
    p.text(formatAmount(g.net), PAGE_W - MARGIN_X - 6, p.y, { size: 9.5, align: 'right' });
    p.y += 16;
    if (g.rate !== 0) {
      p.text(`消費税（${g.rate}%）`, totalsX, p.y, { size: 9.5, color: '#33403e' });
      p.text(formatAmount(g.tax), PAGE_W - MARGIN_X - 6, p.y, { size: 9.5, align: 'right' });
      p.y += 16;
    }
  }
  p.hline(p.y + 2, totalsX, PAGE_W - MARGIN_X, INK, 0.8);
  p.y += 8;
  p.text('合計（税込）', totalsX, p.y + 2, { size: 11, bold: true });
  p.text(`${formatAmount(totals.total)} JPYC`, PAGE_W - MARGIN_X - 6, p.y, { size: 14, bold: true, align: 'right' });
  p.y += 34;

  // --- payment info (invoice) / payment record (receipt) --------------------------------
  if (!isReceipt) {
    const qrSize = qrCanvas ? 92 : 0;
    const textW = CONTENT_W - 24 - (qrSize > 0 ? qrSize + 24 : 0);
    const addressLines = wrapText(p.ctx, payload.a, textW, { size: 9, mono: true });
    const boxH = Math.max(qrSize > 0 ? qrSize + 36 : 0, 84 + addressLines.length * 13);
    p.ensure(boxH + 12);
    const boxY = p.y;
    p.rect(MARGIN_X, boxY, CONTENT_W, boxH, undefined, LINE);
    let ty = boxY + 12;
    p.text('お支払い方法', MARGIN_X + 12, ty, { size: 9, color: MUTED });
    ty += 13;
    p.text(`JPYC（${chainName}）`, MARGIN_X + 12, ty, { size: 11, bold: true });
    ty += 20;
    p.text('お支払先アドレス', MARGIN_X + 12, ty, { size: 9, color: MUTED });
    ty += 13;
    for (const line of addressLines) {
      p.text(line, MARGIN_X + 12, ty, { size: 9, mono: true });
      ty += 13;
    }
    ty += 4;
    p.paragraph('送金時のネットワーク手数料（ガス代）はお支払者のご負担となります。', MARGIN_X + 12, ty, textW, { size: 8, color: MUTED });
    if (qrCanvas) {
      const qx = PAGE_W - MARGIN_X - qrSize - 12;
      p.rect(qx - 4, boxY + 8, qrSize + 8, qrSize + 8, '#ffffff', LINE);
      p.ctx.imageSmoothingEnabled = false;
      p.ctx.drawImage(qrCanvas, qx, boxY + 12, qrSize, qrSize);
      p.text('ウォレットで読み取り', qx + qrSize / 2, boxY + 12 + qrSize + 8, { size: 7.5, color: MUTED, align: 'center' });
    }
    p.y = boxY + boxH + 14;
  } else if (receipt) {
    const rows: [string, string, boolean][] = [['お支払い方法', `JPYC（${chainName}）`, false]];
    if (receipt.manual) {
      rows.push(['入金確認', '発行者による確認（オンチェーン取引との照合なし）', false]);
    } else {
      if (receipt.from) rows.push(['入金元アドレス', receipt.from, true]);
      if (receipt.txHash) rows.push(['取引ハッシュ', receipt.txHash, true]);
    }
    let h = 16;
    for (const [, value, mono] of rows) {
      h += 13 + wrapText(p.ctx, value, CONTENT_W - 24, { size: mono ? 8.5 : 10, mono }).length * 13 + 6;
    }
    p.ensure(h + 12);
    p.rect(MARGIN_X, p.y, CONTENT_W, h, undefined, LINE);
    let ty = p.y + 10;
    for (const [label, value, mono] of rows) {
      p.text(label, MARGIN_X + 12, ty, { size: 9, color: MUTED });
      ty += 13;
      ty = p.paragraph(value, MARGIN_X + 12, ty, CONTENT_W - 24, { size: mono ? 8.5 : 10, mono }) + 6;
    }
    p.y += h + 14;
  }

  // --- note ----------------------------------------------------------------------------
  if (payload.note.trim() !== '') {
    const noteLines = wrapText(p.ctx, payload.note, CONTENT_W, { size: 9.5 });
    p.ensure(16 + noteLines.length * 14);
    p.text('備考', MARGIN_X, p.y, { size: 9, bold: true, color: MUTED });
    p.y += 14;
    p.y = p.paragraph(payload.note, MARGIN_X, p.y, CONTENT_W, { size: 9.5 });
  }

  // --- footer on every page ------------------------------------------------------------
  const footerLeft = `${isReceipt ? '領収書' : '請求書'}は Raccoon Wallet で発行／電子署名 ${shortHex(signature)}／署名者 ${shortHex(payload.a)}`;
  p.pages.forEach((canvas, i) => {
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, PAGE_H - 40);
    ctx.lineTo(PAGE_W - MARGIN_X, PAGE_H - 40);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = fontString({ size: 7.5 });
    ctx.textAlign = 'left';
    ctx.fillText(footerLeft, MARGIN_X, PAGE_H - 32);
    ctx.textAlign = 'right';
    ctx.fillText(`${i + 1} / ${p.pages.length}`, PAGE_W - MARGIN_X, PAGE_H - 32);
    ctx.restore();
  });

  return p.pages;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode page image'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      'image/jpeg',
      0.92,
    );
  });
}

/** Renders the document and packs it into a PDF file. */
export async function renderDocumentPdf(opts: RenderDocumentOptions): Promise<Blob> {
  const canvases = renderDocumentPages(opts);
  const pages: PdfPage[] = [];
  for (const canvas of canvases) {
    pages.push({ jpeg: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
  }
  const isReceipt = opts.kind === 'receipt';
  const number = isReceipt && opts.receipt ? opts.receipt.number : opts.payload.n;
  const bytes = buildPdf(pages, {
    title: `${isReceipt ? '領収書' : '請求書'} ${number}`,
    author: opts.payload.iss.name,
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function documentFilename(opts: Pick<RenderDocumentOptions, 'kind' | 'payload' | 'receipt'>): string {
  const number = opts.kind === 'receipt' && opts.receipt ? opts.receipt.number : opts.payload.n;
  // ASCII only (the numbers come from [A-Za-z0-9_-] prefixes): non-ASCII names get mangled by
  // some browsers' download/share handling, and a plain name is easier to file and search.
  const safe = `${opts.kind === 'receipt' ? 'receipt' : 'invoice'}_${number}`.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safe}.pdf`;
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Opens the OS share sheet with the PDF when the browser supports it, else downloads it. */
export async function sharePdf(blob: Blob, filename: string, title: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // any other failure: fall back to a plain download below
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
