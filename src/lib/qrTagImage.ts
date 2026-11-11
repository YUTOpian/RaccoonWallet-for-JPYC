// Renders a product's QR tag (see lib/productTag.ts) plus its name and price into a
// standalone PNG, for 露天商・フリマ (flea market / street stall) use: the image can be
// saved to the phone's camera roll, printed, or shown full-screen on a second device as a
// price tag that QRレジスター (pages/qrlab/QRRegister.tsx) can scan directly.

interface QrTagImageOptions {
  /** The already-rendered QR canvas (e.g. a QRCodeCanvas ref) to draw into the tag. */
  qrCanvas: HTMLCanvasElement;
  productName: string;
  /** Already-formatted price line, e.g. "9,800 JPYC". */
  priceLabel: string;
}

// Physical print quality: the composed image is rendered at 2x the CSS pixel layout below
// so it still looks sharp printed or zoomed in on a phone screen.
const SCALE = 2;
const WIDTH = 320;
const PADDING = 20;
const QR_SIZE = 240;
const NAME_FONT = 'bold 20px sans-serif';
const PRICE_FONT = 'bold 26px sans-serif';
const LINE_GAP = 8;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) {
    return [text];
  }
  // Simple character-by-character wrap - safe for both Japanese (no spaces between words)
  // and English product names, since it never needs to find word boundaries.
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const candidate = line + ch;
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = ch;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.slice(0, 2); // cap at 2 lines so the tag can't grow unbounded
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'product';
}

/** Builds the composed tag image and returns it as a canvas (not yet downloaded). */
export function renderQrTagCanvas({ qrCanvas, productName, priceLabel }: QrTagImageOptions): HTMLCanvasElement {
  // Measure text first (on a throwaway context) to know how tall the name block needs to be.
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = NAME_FONT;
  const nameLines = wrapLines(measure, productName, WIDTH - PADDING * 2);
  const nameLineHeight = 24;
  const nameBlockHeight = nameLines.length * nameLineHeight;
  const priceLineHeight = 32;

  const headerHeight = nameBlockHeight + LINE_GAP + priceLineHeight + LINE_GAP;
  const height = PADDING + headerHeight + QR_SIZE + PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = NAME_FONT;
  let y = PADDING + nameLineHeight - 4;
  for (const line of nameLines) {
    ctx.fillText(line, WIDTH / 2, y, WIDTH - PADDING * 2);
    y += nameLineHeight;
  }

  ctx.font = PRICE_FONT;
  ctx.fillText(priceLabel, WIDTH / 2, y + priceLineHeight - 8, WIDTH - PADDING * 2);

  // Disable smoothing so the QR modules stay crisp (blurred edges can fail to scan when
  // printed small).
  ctx.imageSmoothingEnabled = false;
  const qrY = PADDING + headerHeight;
  const qrX = (WIDTH - QR_SIZE) / 2;
  ctx.drawImage(qrCanvas, qrX, qrY, QR_SIZE, QR_SIZE);

  return canvas;
}

/** Composes and downloads the tag image as a PNG file. */
export function downloadQrTagImage(options: QrTagImageOptions) {
  const canvas = renderQrTagCanvas(options);
  const link = document.createElement('a');
  link.download = `${sanitizeFilename(options.productName)}_qr.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
