import { Decimal } from 'decimal.js';
import { ethers } from 'ethers';
import type { SignerSource } from './signer';

/**
 * 請求書 (invoice) data model, totals, and the signed share-link format.
 *
 * This app has no server, so a "請求リンク" can't point at a database row. Instead the whole
 * invoice travels inside the URL fragment (`<app url>#/pay?d=<token>`), and the receiving side
 * (pages/invoice/PayInvoice.tsx) needs nothing but this app to open it. To keep a link that
 * anyone can edit by hand from being a way to swap in a different payee address, the issuer's
 * wallet signs the invoice (EIP-191) when issuing it; the payer's side re-verifies that the
 * signer *is* the address the invoice asks to be paid to. That does not prove who the issuer
 * is (anyone can issue an invoice to their own address) - only that the content wasn't altered
 * after issuing - so the pay screen also shows the address-book name when it recognises it.
 */

export type TaxRate = 10 | 8 | 0;
export type TaxMode = 'excl' | 'incl';
export type Rounding = 'floor' | 'round' | 'ceil';

export const TAX_RATES: TaxRate[] = [10, 8, 0];

export interface InvoiceItem {
  name: string;
  qty: number;
  price: number; // 単価 (JPYC = 円, integer; negative allowed for 値引き)
  rate: TaxRate;
}

export interface InvoiceIssuer {
  name: string;
  reg: string; // 登録番号 (T + 13 digits) or ''
  addr: string;
  tel: string;
  mail: string;
}

// Short keys keep the link (and therefore the LINE message) compact.
export interface InvoicePayload {
  v: 1;
  n: string; // 請求書番号
  d: string; // 発行日 YYYY-MM-DD
  due: string; // 支払期限 YYYY-MM-DD or ''
  cid: number; // chainId the payment is expected on
  a: string; // 支払先アドレス (checksummed)
  to: string; // 宛名
  sub: string; // 件名
  iss: InvoiceIssuer;
  it: InvoiceItem[];
  tm: TaxMode;
  rm: Rounding;
  note: string;
}

// --- limits (also enforced on untrusted input in parseInvoicePayload) ---------------------

export const MAX_ITEMS = 30;
export const MAX_TOKEN_LENGTH = 24000;
const MAX_AMOUNT = 1_000_000_000_000; // 1 兆円: far beyond any real invoice, well inside safe integers
const SHORT = 120;
const LONG = 1000;

// --- totals -------------------------------------------------------------------------------

export interface TaxGroup {
  rate: TaxRate;
  net: number; // 税抜合計
  tax: number; // 消費税額
  gross: number; // 税込合計
}

export interface InvoiceTotals {
  lineAmounts: number[]; // qty * price, rounded to whole yen, as entered (税抜 or 税込 per TaxMode)
  groups: TaxGroup[]; // only rates that actually appear, 10 → 8 → 0
  net: number;
  tax: number;
  total: number; // ご請求金額 (税込)
}

function roundingMode(rounding: Rounding): Decimal.Rounding {
  switch (rounding) {
    case 'ceil': return Decimal.ROUND_CEIL;
    case 'round': return Decimal.ROUND_HALF_UP;
    default: return Decimal.ROUND_FLOOR;
  }
}

/**
 * Totals the way 適格請求書 wants them: the consumption tax is computed once per tax rate on
 * the rate's subtotal (not per line), using the issuer's chosen rounding. In 内税 mode the
 * entered prices already include tax, so the tax is carved back out of the subtotal.
 */
export function computeTotals(items: InvoiceItem[], mode: TaxMode, rounding: Rounding): InvoiceTotals {
  const rm = roundingMode(rounding);
  const lineAmounts = items.map((item) => new Decimal(item.qty).mul(item.price).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());

  const groups: TaxGroup[] = [];
  for (const rate of TAX_RATES) {
    let sum = new Decimal(0);
    let used = false;
    items.forEach((item, i) => {
      if (item.rate === rate) {
        sum = sum.add(lineAmounts[i]);
        used = true;
      }
    });
    if (!used) continue;
    if (mode === 'excl') {
      const tax = sum.mul(rate).div(100).toDecimalPlaces(0, rm);
      groups.push({ rate, net: sum.toNumber(), tax: tax.toNumber(), gross: sum.add(tax).toNumber() });
    } else {
      const tax = sum.mul(rate).div(100 + rate).toDecimalPlaces(0, rm);
      groups.push({ rate, net: sum.sub(tax).toNumber(), tax: tax.toNumber(), gross: sum.toNumber() });
    }
  }
  const net = groups.reduce((acc, g) => acc + g.net, 0);
  const tax = groups.reduce((acc, g) => acc + g.tax, 0);
  const total = groups.reduce((acc, g) => acc + g.gross, 0);
  return { lineAmounts, groups, net, tax, total };
}

export function payloadTotals(payload: InvoicePayload): InvoiceTotals {
  return computeTotals(payload.it, payload.tm, payload.rm);
}

// --- validation ---------------------------------------------------------------------------

/** "T" + 13 digits. Empty is allowed (not a registered issuer). */
export function isValidRegistrationNumber(value: string): boolean {
  return value === '' || /^T\d{13}$/.test(value);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toDateString(d) === value;
}

export type InvoiceValidationError =
  | 'recipient_required'
  | 'issuer_required'
  | 'items_required'
  | 'too_many_items'
  | 'item_name_required'
  | 'item_qty_invalid'
  | 'item_price_invalid'
  | 'total_invalid'
  | 'due_before_issue'
  | 'registration_invalid';

/** Returns the first problem with a payload about to be issued, or null if it's fine. */
export function validateInvoicePayload(payload: InvoicePayload): InvoiceValidationError | null {
  if (payload.to.trim() === '') return 'recipient_required';
  if (payload.iss.name.trim() === '') return 'issuer_required';
  if (!isValidRegistrationNumber(payload.iss.reg)) return 'registration_invalid';
  if (payload.it.length === 0) return 'items_required';
  if (payload.it.length > MAX_ITEMS) return 'too_many_items';
  for (const item of payload.it) {
    if (item.name.trim() === '') return 'item_name_required';
    if (!Number.isFinite(item.qty) || item.qty <= 0) return 'item_qty_invalid';
    if (!Number.isInteger(item.price) || Math.abs(item.price) > MAX_AMOUNT) return 'item_price_invalid';
  }
  const totals = payloadTotals(payload);
  if (!Number.isSafeInteger(totals.total) || totals.total <= 0 || totals.total > MAX_AMOUNT) return 'total_invalid';
  if (payload.due !== '' && payload.due < payload.d) return 'due_before_issue';
  return null;
}

function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

/**
 * Parses and strictly validates an invoice that arrived from outside (a link). Anything that
 * doesn't match the exact expected shape and limits is rejected, since it gets rendered on
 * screen and, if the person agrees, used to pre-fill a real payment.
 */
export function parseInvoicePayload(json: string): InvoicePayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!isStr(o.n, SHORT) || !isStr(o.to, SHORT) || !isStr(o.sub, SHORT) || !isStr(o.note, LONG)) return null;
  if (!isStr(o.d, 10) || !isValidDate(o.d)) return null;
  if (!isStr(o.due, 10) || (o.due !== '' && !isValidDate(o.due))) return null;
  if (typeof o.cid !== 'number' || !Number.isInteger(o.cid) || o.cid <= 0) return null;
  if (typeof o.a !== 'string' || !ethers.isAddress(o.a)) return null;
  if (o.tm !== 'excl' && o.tm !== 'incl') return null;
  if (o.rm !== 'floor' && o.rm !== 'round' && o.rm !== 'ceil') return null;

  const iss = o.iss as Record<string, unknown> | null;
  if (typeof iss !== 'object' || iss === null) return null;
  if (!isStr(iss.name, SHORT) || !isStr(iss.reg, 14) || !isStr(iss.addr, 300) || !isStr(iss.tel, 40) || !isStr(iss.mail, 120)) return null;
  if (!isValidRegistrationNumber(iss.reg)) return null;

  if (!Array.isArray(o.it) || o.it.length === 0 || o.it.length > MAX_ITEMS) return null;
  const items: InvoiceItem[] = [];
  for (const entry of o.it) {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (!isStr(e.name, SHORT) || typeof e.qty !== 'number' || typeof e.price !== 'number' || typeof e.rate !== 'number') return null;
    if (!Number.isFinite(e.qty) || e.qty <= 0 || !Number.isInteger(e.price) || Math.abs(e.price) > MAX_AMOUNT) return null;
    if (!TAX_RATES.includes(e.rate as TaxRate)) return null;
    items.push({ name: e.name, qty: e.qty, price: e.price, rate: e.rate as TaxRate });
  }

  const payload: InvoicePayload = {
    v: 1,
    n: o.n,
    d: o.d,
    due: o.due,
    cid: o.cid,
    a: ethers.getAddress(o.a),
    to: o.to,
    sub: o.sub,
    iss: { name: iss.name, reg: iss.reg, addr: iss.addr, tel: iss.tel, mail: iss.mail },
    it: items,
    tm: o.tm,
    rm: o.rm,
    note: o.note,
  };
  const total = payloadTotals(payload).total;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_AMOUNT) return null;
  return payload;
}

// --- signing ------------------------------------------------------------------------------

// Domain-separates the signature from any other message the same key might be asked to sign.
const SIGN_PREFIX = 'RaccoonWallet Invoice v1\n';

export function serializePayload(payload: InvoicePayload): string {
  return JSON.stringify(payload);
}

/**
 * Signs the serialized invoice. `signer` is either the wallet's raw private key (signed here)
 * or an ethers.Signer from a connected MetaMask / Bitget Wallet (signed inside the extension,
 * which asks the person to approve the message). Both produce a standard EIP-191 signature.
 */
export async function signInvoicePayload(payloadJson: string, signer: SignerSource): Promise<string> {
  const message = SIGN_PREFIX + payloadJson;
  return typeof signer === 'string' ? new ethers.Wallet(signer).signMessage(message) : signer.signMessage(message);
}

/** The address that signed `payloadJson` with `signature`, or null if the signature is malformed. */
export function recoverInvoiceSigner(payloadJson: string, signature: string): string | null {
  try {
    return ethers.verifyMessage(SIGN_PREFIX + payloadJson, signature);
  } catch {
    return null;
  }
}

/** True if the invoice was signed by the very address it asks to be paid to. */
export function isSignatureValid(payload: InvoicePayload, payloadJson: string, signature: string): boolean {
  const signer = recoverInvoiceSigner(payloadJson, signature);
  return signer !== null && signer.toLowerCase() === payload.a.toLowerCase();
}

// --- share link token ---------------------------------------------------------------------
//
// token = <format char><base64url(bytes)>, bytes = signature (132 chars: "0x" + 65 bytes hex)
// immediately followed by the payload JSON, UTF-8, optionally raw-deflated ('z' = deflated,
// 'j' = plain, used when CompressionStream isn't available).

const SIGNATURE_LENGTH = 132;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function pipeBytes(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeInvoiceToken(payloadJson: string, signature: string): Promise<string> {
  const bytes = new TextEncoder().encode(signature + payloadJson);
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + toBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    } catch {
      // fall through to the uncompressed format
    }
  }
  return 'j' + toBase64Url(bytes);
}

export interface DecodedInvoice {
  payload: InvoicePayload;
  payloadJson: string;
  signature: string;
}

/** Decodes a link token back into a validated invoice, or null if it's malformed. */
export async function decodeInvoiceToken(token: string): Promise<DecodedInvoice | null> {
  if (token.length < 2 || token.length > MAX_TOKEN_LENGTH) return null;
  const bytes = fromBase64Url(token.slice(1));
  if (bytes === null) return null;
  let plain: Uint8Array;
  try {
    if (token[0] === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      plain = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    } else if (token[0] === 'j') {
      plain = bytes;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  // The decompressed size is bounded too, so a tiny "zip bomb" token can't balloon in memory.
  if (plain.length > MAX_TOKEN_LENGTH * 4) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return null;
  }
  if (text.length <= SIGNATURE_LENGTH) return null;
  const signature = text.slice(0, SIGNATURE_LENGTH);
  const payloadJson = text.slice(SIGNATURE_LENGTH);
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const payload = parseInvoicePayload(payloadJson);
  if (payload === null) return null;
  return { payload, payloadJson, signature };
}

/** The page URL a link built here should open, or '' if this page can't be opened by others. */
export function defaultLinkBase(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, origin, pathname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return '';
  return `${origin}${pathname}`;
}

/** Normalises a user-entered base URL: trims, drops any #fragment/query, keeps http(s) only. */
export function normalizeLinkBase(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function buildInvoiceLink(base: string, token: string): string {
  return `${base}#/pay?d=${token}`;
}

// --- small formatting helpers -------------------------------------------------------------

export function formatAmount(value: number): string {
  return value.toLocaleString('ja-JP');
}

export function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayString(): string {
  return toDateString(new Date());
}

export function addDaysString(dateString: string, days: number): string {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/** 2026-11-10 → 2026年11月10日 */
export function formatJapaneseDate(dateString: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : dateString;
}

export function taxRateLabel(rate: TaxRate): string {
  return rate === 0 ? '非課税・不課税' : `${rate}%`;
}
