// Renders a QRレジスター checkout's payment QR into a standalone receipt-style PNG: the QR
// itself plus the receiving address and an itemized breakdown, so it can be handed to a
// customer on a second screen, printed, or otherwise shown independently of the cashier's
// own device (which may move on to 入金待ち一覧/the next sale) — the amount/address it's
// paying stays verifiable from the image alone even after the app has navigated away.

interface PaymentReceiptImageOptions {
  /** The already-rendered QR canvas (e.g. a QRCodeCanvas ref) showing the payment URI. */
  qrCanvas: HTMLCanvasElement;
  title: string;
  totalLabel: string;
  chainLabel: string;
  addressLabel: string;
  address: string;
  /**
   * Both omitted (or itemLines left empty) for flows with nothing to itemize, e.g.
   * QRGeneratorCollect's plain "指定金額を受け取る" — the breakdown section is skipped
   * entirely rather than rendered with a label and no rows under it.
   */
  itemsLabel?: string;
  /** Pre-formatted lines, e.g. "ゲームボーイアドバンス × 2 = 19,600 JPYC". */
  itemLines?: string[];
}

const SCALE = 2;
const WIDTH = 360;
const PADDING = 24;
const QR_SIZE = 220;
const TITLE_FONT = 'bold 18px sans-serif';
const TOTAL_FONT = 'bold 26px sans-serif';
const LABEL_FONT = 'bold 13px sans-serif';
const BODY_FONT = '14px sans-serif';
const MONO_FONT = '13px monospace';
const LINE_HEIGHT = 20;
const SECTION_GAP = 16;

function wrapByWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) {
    return [text];
  }
  // Character-by-character wrap - works for both Japanese text (no spaces between words)
  // and hex addresses (no natural break points at all).
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const candidate = line + ch;
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0 && lines.length < maxLines) lines.push(line);
  return lines;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'payment';
}

function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Builds the composed receipt image and returns it as a canvas (not yet downloaded). */
export function renderPaymentReceiptCanvas(options: PaymentReceiptImageOptions): HTMLCanvasElement {
  const { qrCanvas, title, totalLabel, chainLabel, addressLabel, address, itemsLabel, itemLines = [] } = options;
  const contentWidth = WIDTH - PADDING * 2;

  const measure = document.createElement('canvas').getContext('2d')!;

  measure.font = MONO_FONT;
  const addressLines = wrapByWidth(measure, address, contentWidth, 3);

  const hasItems = !!itemsLabel && itemLines.length > 0;

  measure.font = BODY_FONT;
  const wrappedItemLines = itemLines.flatMap((line) => wrapByWidth(measure, line, contentWidth, 2));

  let height = PADDING;
  height += 24; // title
  height += SECTION_GAP;
  height += QR_SIZE;
  height += SECTION_GAP;
  height += 32; // total
  height += 20; // chain label
  height += SECTION_GAP;
  height += 16; // address label
  height += addressLines.length * LINE_HEIGHT;
  if (hasItems) {
    height += SECTION_GAP;
    height += 16; // items label
    height += Math.max(wrappedItemLines.length, 1) * LINE_HEIGHT;
  }
  height += PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = '#000000';

  let y = PADDING;

  ctx.textAlign = 'center';
  ctx.font = TITLE_FONT;
  ctx.fillText(title, WIDTH / 2, y + 18, contentWidth);
  y += 24 + SECTION_GAP;

  ctx.imageSmoothingEnabled = false;
  const qrX = (WIDTH - QR_SIZE) / 2;
  ctx.drawImage(qrCanvas, qrX, y, QR_SIZE, QR_SIZE);
  y += QR_SIZE + SECTION_GAP;

  ctx.font = TOTAL_FONT;
  ctx.fillText(totalLabel, WIDTH / 2, y + 22, contentWidth);
  y += 32;

  ctx.font = BODY_FONT;
  ctx.fillStyle = '#555555';
  ctx.fillText(chainLabel, WIDTH / 2, y + 14, contentWidth);
  ctx.fillStyle = '#000000';
  y += 20 + SECTION_GAP;

  ctx.textAlign = 'left';
  ctx.font = LABEL_FONT;
  ctx.fillText(addressLabel, PADDING, y + 12);
  y += 16;
  ctx.font = MONO_FONT;
  for (const line of addressLines) {
    ctx.fillText(line, PADDING, y + 12);
    y += LINE_HEIGHT;
  }
  if (hasItems) {
    y += SECTION_GAP;

    ctx.font = LABEL_FONT;
    ctx.fillText(itemsLabel!, PADDING, y + 12);
    y += 16;
    ctx.font = BODY_FONT;
    if (wrappedItemLines.length === 0) {
      y += LINE_HEIGHT;
    } else {
      for (const line of wrappedItemLines) {
        ctx.fillText(line, PADDING, y + 12);
        y += LINE_HEIGHT;
      }
    }
  }

  return canvas;
}

/** Composes and downloads the payment receipt image as a PNG file. */
export function downloadPaymentReceiptImage(options: PaymentReceiptImageOptions) {
  const canvas = renderPaymentReceiptCanvas(options);
  const link = document.createElement('a');
  link.download = `${sanitizeFilename(options.title)}_${timestampForFilename(new Date())}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
