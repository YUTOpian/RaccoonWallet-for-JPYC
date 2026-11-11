// A small QR "price tag" for a 売り物リスト product (see MarketplaceDetail's QRコード
// button), meant to be shown on a second screen or printed out next to the item, then
// scanned by QRレジスター (pages/qrlab/QRRegister.tsx) to add it to a checkout cart without
// retyping its name/price. This is a distinct JSON shape from lib/invoiceData.ts's
// InvoiceData (an address+amount payment request) - a product tag carries no address or
// amount at all, just a reference to a product record; the register looks up the current
// name/price/stock itself so a tag never goes stale even if the product is later repriced.
const PRODUCT_TAG_VERSION = 1;
const PRODUCT_TAG_TYPE = 'racoom_product';

export function buildProductTag(productId: string): string {
  return JSON.stringify({ v: PRODUCT_TAG_VERSION, type: PRODUCT_TAG_TYPE, productId });
}

export function parseProductTag(text: string): string | null {
  try {
    const json = JSON.parse(text);
    if (json.v !== PRODUCT_TAG_VERSION || json.type !== PRODUCT_TAG_TYPE) return null;
    if (typeof json.productId !== 'string' || json.productId.length === 0) return null;
    return json.productId;
  } catch {
    return null;
  }
}
