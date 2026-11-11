/**
 * Minimal PDF writer: one JPEG image per A4 page, no dependencies.
 *
 * The invoice pages are drawn onto canvases (see invoiceDocument.ts), which lets the browser's
 * own Japanese fonts do the text rendering - embedding a CJK font into a PDF library would add
 * megabytes to a single-file PWA. The trade-off is that the text in the PDF is not selectable.
 */

export interface PdfPage {
  jpeg: Uint8Array;
  width: number; // pixels
  height: number; // pixels
}

// A4 in PDF points (1/72 inch).
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

const encoder = new TextEncoder();

// PDF text strings outside plain ASCII are UTF-16BE with a BOM, as hex.
function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

export function buildPdf(pages: PdfPage[], info: { title: string; author?: string }): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');

  const chunks: Uint8Array[] = [];
  const offsets: number[] = []; // offsets[n] = byte offset of object n+1
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (id: number) => {
    offsets[id - 1] = length;
    push(`${id} 0 obj\n`);
  };

  // Object ids: 1 catalog, 2 pages, 3 info, then (page, content, image) triples.
  const pageId = (i: number) => 4 + i * 3;
  const contentId = (i: number) => 5 + i * 3;
  const imageId = (i: number) => 6 + i * 3;
  const objectCount = 3 + pages.length * 3;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary-content marker comment

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObject(2);
  push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  beginObject(3);
  push(`<< /Title ${pdfTextString(info.title)} /Producer ${pdfTextString('Raccoon Wallet')}${info.author ? ` /Author ${pdfTextString(info.author)}` : ''} >>\nendobj\n`);

  pages.forEach((page, i) => {
    beginObject(pageId(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
      `/Resources << /XObject << /Im0 ${imageId(i)} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId(i)} 0 R >>\nendobj\n`,
    );

    const content = `q ${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm /Im0 Do Q`;
    beginObject(contentId(i));
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    beginObject(imageId(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let n = 0; n < objectCount; n++) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
