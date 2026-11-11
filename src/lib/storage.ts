
import * as CryptoJS from 'crypto-js';
import localForage from 'localforage';


import * as bcrypt from 'bcryptjs'
import { mergePeerEvents } from './addressSafety';
import type { PeerEvent, SentRecipient } from './addressSafety';

// A completed Uniswap V4 swap, recorded locally right after broadcast so the Home screen's
// Swap card can show "recent swaps" the same way its Transaction card shows recent JPYC
// transfers. There is no way to reconstruct this from public RPC logs the way JPYC transfer
// history is (see lib/chains.ts's block comment on that): a Uniswap pool's Swap event
// doesn't identify the pool itself as belonging to any particular pair without first
// knowing the pool address, and it reports raw token amounts rather than the human-readable
// in/out symbols this card wants to show - so this app tracks its own swap history locally
// instead, the same way NFTHelper's old manual watch-list worked.
export interface SwapRecord {
  id: string;
  chain: string; // ChainKey ('ethereum' | 'polygon') - kept as string so lib/storage.ts doesn't need to import lib/chains.ts
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  amountOut: string;
  hash: string;
  timestamp: number; // epoch ms
}

// An ERC-20 token the person registered by hand (chain + contract address) on the Token
// screen, for tokens that aren't on the curated per-chain list in lib/chains.ts. Symbol/
// name/decimals are captured once at add-time (see chains.ts's fetchTokenMetadata) so this
// list can be redisplayed instantly on the next visit without a contract call, and only the
// balance itself needs a fresh RPC read.
export interface CustomTokenRecord {
  chain: string; // ChainKey, kept as string for the same reason as SwapRecord.chain above
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  // CoinGecko logo URL captured at add-time, if CoinGecko had this token listed - see
  // chains.ts's fetchTokenIconUrl/fetchTokenMetadata. Undefined for tokens added before
  // this existed, or ones CoinGecko doesn't list; the token screen falls back to the chain
  // icon in that case.
  iconUrl?: string;
  // Photo the person picked by hand when registering this token (data: URL, same
  // read-as-base64 approach as AddressBookDetail's contact icon/cover picker - no server,
  // so there's nowhere else to host it). Only relevant for tokens on a custom EVM chain
  // (see CustomChainRecord below), where CoinGecko/iconUrl usually has nothing; takes
  // priority over iconUrl when both are present since the person chose it deliberately.
  iconDataUrl?: string;
}

// A network config the person entered by hand under 設定 > 通貨の取り出し ("asset recovery"),
// for checking and withdrawing assets accidentally sent to a chain this wallet doesn't
// otherwise support (e.g. Arbitrum, Optimism). Deliberately separate from ChainKey/CHAINS
// in lib/chains.ts - this is a one-off rescue lookup via lib/customChains.ts, not a chain
// the wallet is meant to operate on day to day (no curated token list, no RPC fallback list).
export interface CustomChainRecord {
  id: string;               // `custom-${chainId}` — re-adding the same chainId is rejected as a duplicate
  name: string;
  rpcUrl: string;
  chainId: number;
  currencySymbol: string;
  blockExplorerUrl: string; // '' when not provided
  // Photo the person picked by hand for this network (data: URL). Same idea as
  // CustomTokenRecord.iconDataUrl above - there's no curated logo for an arbitrary
  // hand-entered chain, so this is the only way to get anything besides the generic
  // カスタムEVM badge. Undefined for chains added before this existed.
  iconDataUrl?: string;
}

// One wallet address belonging to a contact in the address book (see AddressBookRecord
// below). `chain` records which of this app's networks (see lib/chains.ts's ChainKey) the
// friend told you this address is for — kept as a plain string for the same reason as
// SwapRecord.chain above (storage.ts doesn't need to import lib/chains.ts just for a label).
// Ported from RaccoonWallet's original NEM-era "アドレス帳" feature (2019-04 "新機能「アド
// レス帳」追加"): a contact can register several of their own wallets and mark exactly one
// as "Master" — their preferred/most-used wallet, shown first on the contact's wallet tab.
export interface ContactWallet {
  id: string;
  chain: string; // ChainKey
  name: string;
  address: string;
  isMaster: boolean;
}

// A friend/contact entry in the address book. Ported from RaccoonWallet's original
// "アドレス帳" feature, which was deliberately local-only/offline — no server round-trip,
// and the other party doesn't need to be a RaccoonWallet user either (see the original
// writeup) — so this is still just a localForage-backed list, same as before, just with
// a profile (name/reading/phone/email/icon) plus multiple tagged wallets per contact
// instead of a single flat name+address pair. `reading` is the small "なまえ" line shown
// under the bold name (a furigana-style reading in the original app), kept freeform here
// rather than validated as literal kana so it also works for non-Japanese names.
// The same record shape doubles as the person's own profile (id === AddressBookHelper.
// SELF_ID), which is how the original app's "自分のプロフィール設定" screen worked — see
// AddressBookHelper.getSelf() below. `coverDataUrl` is only ever used by that self profile
// (the drawer header's background photo); ordinary contacts leave it blank.
export interface AddressBookRecord {
  id: string;
  name: string;
  reading: string;
  phone: string;
  email: string;
  xAccount: string; // '' if not set — X (formerly Twitter) handle, without the leading '@'
  lineAccount: string; // '' if not set — LINE ID
  telegramAccount: string; // '' if not set — Telegram handle, without the leading '@'
  iconDataUrl: string; // '' if no custom icon was set
  coverDataUrl: string; // '' for ordinary contacts; self-profile cover photo only
  wallets: ContactWallet[];
}

// One item on the "売り物リスト" (things-for-sale list) — a simple personal inventory +
// manual bookkeeping feature. Price is a plain JPYC/JPY amount (this app is JPYC-focused,
// see lib/chains.ts), not a wei-scaled on-chain value, since nothing here touches the
// blockchain directly — selling just decrements `stock` and appends a SaleRecord below.
export interface ProductRecord {
  id: string;
  name: string;
  price: number;
  stock: number;
  description: string;
  // Free-form notes — cost price, supplier, sales channel, whatever the person wants to
  // track that doesn't have its own field (matches the feature request's "Note" column).
  memo: string;
  createdAt: number; // epoch ms
}

// One recorded sale ("手動会計" — tapping 販売 on MarketplaceDetail). productName/unitPrice
// are captured at sale time so history stays meaningful even if the product is later
// renamed, repriced, or deleted (see ProductsHelper.remove).
export interface SaleRecord {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  amount: number; // unitPrice * quantity, stored rather than recomputed so history is stable
  timestamp: number; // epoch ms
  note: string;
}

// 送受信履歴1件ごとの会計用メモ・タグ。履歴そのものはチェーンから都度取得するため保存せず、
// 取引を一意に識別するキー(TxAnnotationsHelper.makeKey)に対してメモとタグだけを持つ。
// tag: 'sales' = 売上 / 'expense' = 経費 / 'personal' = 私用 / '' = 未分類
export type TxAnnotationTag = '' | 'sales' | 'expense' | 'personal';
export interface TxAnnotationRecord {
  tag: TxAnnotationTag;
  memo: string;
  // 費目(勘定科目)。売上・経費のときだけ使う自由入力。無ければ未設定(以前の記録はこの項目を持たない)。
  category?: string;
}

// Reset checkpoint for the "今日の売上" total — see Storage.loadSalesReset. "今月の売上" was
// replaced by a user-selectable date range (SalesHelper.rangeTotal below), which is a plain
// historical query rather than a running counter, so it has no reset concept of its own.
export interface SalesResetState {
  dailyResetAt: number; // epoch ms; 0 = never reset
}

// One line item in a QRレジスター cart, snapshotted so a pending checkout (see
// PendingCheckoutRecord below) can be redisplayed/resumed later even if the underlying
// product was since edited, restocked, or deleted. Mirrors QRRegister's own CartLine shape.
export interface PendingCartLine {
  key: string;
  productId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

// A QRレジスター checkout whose payment QR has already been generated and is waiting on
// on-chain confirmation, persisted so it survives navigating away from the register screen
// (see pages/qrlab/QRRegister.tsx and its 入金待ち一覧 list). Without this, leaving that
// screen (or the person's browser/PWA getting backgrounded) had no way to resume watching a
// checkout that was already shown to a customer - forcing the cashier to keep it on screen
// the whole time, or cancel and start over. `startBlock` anchors
// useJpycPaymentWatcher's polling window at the moment this record was created, so reopening
// it later still picks up a payment made while the app was away - see that hook's doc
// comment for why re-detecting the current block on resume would miss it.
export interface PendingCheckoutRecord {
  id: string;
  chain: string; // ChainKey, kept as string for the same reason as other chain fields above
  address: string;
  total: string; // Decimal amount due, kept as a string for exact precision
  startBlock: number;
  cart: PendingCartLine[];
  createdAt: number; // epoch ms
  // 'JPY' (or absent, for records created before 表示通貨 existed) means this checkout is a
  // JPYC payment, exactly as before; 'USD' means it was created while 表示通貨 was set to USD
  // and so is a USDC payment instead - see QRRegister.tsx. Stored per-record (rather than just
  // reading the *current* appStore setting on resume) so a checkout created under one setting
  // still resumes against the correct token even if 表示通貨 is changed before it's paid.
  currency?: 'JPY' | 'USD';
}

// QRラボ「指定金額を受け取る」(QRGeneratorAmount/QRGeneratorCollect) version of
// PendingCheckoutRecord above: a payment QR that's already been shown and is waiting on
// on-chain confirmation, persisted so leaving QRGeneratorCollect (its toolbar back arrow,
// browser/PWA back gesture, or switching tabs) doesn't lose track of it. There's no cart
// here — just the single amount picked on QRGeneratorAmount — so this is simpler than
// PendingCheckoutRecord, but otherwise follows the same shape/lifecycle: created once the
// QR is generated, resumable via QRGeneratorPending (?pendingId= on /qrlab/collect), and
// removed once the receive is finalized (payment detected or completed manually) or
// explicitly cancelled.
export interface PendingReceiveRecord {
  id: string;
  chain: string; // ChainKey, kept as string for the same reason as other chain fields above
  address: string;
  amount: string; // Decimal amount due, kept as a string for exact precision
  startBlock: number;
  createdAt: number; // epoch ms
  // See PendingCheckoutRecord.currency above - same meaning, for QRGeneratorCollect.tsx.
  currency?: 'JPY' | 'USD';
}

// --- 請求書 (Invoice) ---------------------------------------------------------------------
//
// An invoice the person issued from this wallet. The authoritative content is `payload`: the
// exact JSON string that was signed with the wallet's key (see lib/invoice.ts) - kept verbatim
// so the signature, the share link and the PDF can always be re-derived from it byte-for-byte.
// The remaining fields are either local bookkeeping (status, payment match) or a denormalized
// copy of payload fields so the list screen doesn't have to parse every record.
export type InvoiceStatus = 'issued' | 'paid' | 'cancelled';

export interface InvoiceRecord {
  id: string;
  number: string; // 請求書番号, e.g. INV-2026-0001
  payload: string; // signed JSON (InvoicePayload), verbatim
  signature: string; // EIP-191 signature over lib/invoice.ts's signing message
  token: string; // payload+signature encoded for the share link (see encodeInvoiceToken)
  status: InvoiceStatus;
  // Block height of the invoice's chain when it was issued; only transfers after it are
  // considered when looking for the payment. 0 if the RPC was unreachable at issue time.
  startBlock: number;
  createdAt: number; // epoch ms
  // Denormalized from payload for the list screen / sorting.
  recipient: string;
  total: number;
  issueDate: string; // YYYY-MM-DD
  due: string; // YYYY-MM-DD or ''
  chainId: number;
  // Set once marked paid (auto-detected + confirmed, or manually).
  paidAt?: number; // epoch ms
  paidTxHash?: string;
  paidFrom?: string;
  paidManually?: boolean;
  receiptNumber?: string; // 領収書番号, e.g. RCT-2026-0001
  receiptDate?: string; // YYYY-MM-DD
}

// 発行者情報 - printed on every invoice/receipt (適格請求書 requires the issuer's name and,
// if registered, its T-number), plus the defaults the invoice form starts from.
export interface IssuerProfile {
  name: string;
  registrationNumber: string; // 適格請求書発行事業者の登録番号 ("T" + 13 digits) or ''
  address: string;
  phone: string;
  email: string;
  numberPrefix: string; // 請求書番号の接頭辞
  receiptPrefix: string; // 領収書番号の接頭辞
  defaultTaxMode: 'excl' | 'incl';
  defaultRounding: 'floor' | 'round' | 'ceil';
  defaultDueDays: number;
  defaultNote: string;
  // Origin+path the share link is built on ('' = this app's own URL). Needed when the app is
  // run from a file:// build, where the page URL can't be opened by anyone else.
  baseUrl: string;
  // Last used serial per "<kind>:<year>" ("invoice:2026"), so numbers never repeat.
  seq: Record<string, number>;
}

// --- 予約送金 (scheduled / recurring payments) ---------------------------------------------
//
// A reminder that a JPYC payment is due on a date (and then again, if it repeats). Nothing is
// ever sent automatically: see lib/scheduledPayments.ts. Dates are local "YYYY-MM-DD" strings.
export type ScheduledStatus = 'active' | 'paused' | 'completed';

export interface ScheduledPaymentHistoryEntry {
  due: string; // the due date this entry settles
  at: number; // epoch ms when it was paid / skipped
  txHash?: string; // set when paid (broadcast hash)
  skipped?: boolean;
}

export interface ScheduledPaymentRecord {
  id: string;
  // The wallet this schedule belongs to - a schedule only shows up (and can only be approved)
  // while that wallet is the active one.
  walletAddress: string;
  label: string; // 家賃 / 月額サブスク / お小遣い ...
  toAddress: string;
  recipientName: string; // address-book name it was picked from, or ''
  amount: string; // JPYC, decimal string
  chainId: number;
  frequency: 'once' | 'weekly' | 'monthly' | 'yearly';
  anchorDay: number; // day-of-month of the first due date (monthly/yearly clamp to month length)
  nextDue: string; // the occurrence waiting to be paid
  endDate: string; // '' = no end
  remindDays: number; // also surface it this many days before the due date
  note: string;
  status: ScheduledStatus;
  createdAt: number;
  // Set while an approval has been handed to the send job but not yet broadcast, so a second
  // tap on the same occurrence can't send it twice.
  inFlightDue?: string;
  inFlightAt?: number;
  history: ScheduledPaymentHistoryEntry[];
}

class PinCode {
  hashedCode = '';
}

// Tracks consecutive wrong-PIN entries across dialog re-opens and app restarts, so a
// PIN check can't be brute-forced just by closing/reopening PasswordDialog (which used to
// reset its own in-memory counter every time). See PinCodeHelper.check() /
// PinCodeHelper.LOCKOUT_* below for how this is used.
class PinAttempts {
  failedCount = 0;
  lockedUntil = 0; // epoch ms; 0 means "not locked"
}

export class Wallet {
  id: string = Wallet.createId();
  name: string = "";
  address: string = "";
  publicKey: string = "";
  encryptedSecret: string = "";
  // Present only for wallets created/imported from a recovery phrase. Absent for
  // wallets imported from a raw private key, since there is no phrase to back up.
  encryptedMnemonic: string | null = null;
  // 同じリカバリーフレーズから導出した際の BIP44 アカウントインデックス(マイアカウントの
  // タイル表示用)。秘密鍵インポートや、この項目が無かった頃に作ったウォレットは null。
  derivationIndex: number | null = null;
  // MetaMask / Bitget Wallet(ブラウザ拡張)で接続したアカウントのときだけ入る。この場合は
  // 秘密鍵もリカバリーフレーズもこの端末には無く(encryptedSecret は空)、署名は都度拡張側で
  // 承認する。通常のウォレットは null。
  externalProvider: 'metamask' | 'bitget' | null = null;

  static createExternal(name: string, address: string, kind: 'metamask' | 'bitget') {
    const wallet = new Wallet();
    wallet.name = name;
    wallet.address = address;
    wallet.externalProvider = kind;
    return wallet;
  }

  static async createWithKeys(name: string, address: string, publicKey: string, secretKey: string, password: string) {
    const wallet = new Wallet();
    wallet.name = name;
    wallet.address = address;
    wallet.publicKey = publicKey;
    wallet.encryptedSecret = await encryptString(secretKey, password);
    return wallet;
  }

  static async createWithMnemonic(name: string, address: string, publicKey: string, secretKey: string, mnemonic: string, password: string) {
    const wallet = await Wallet.createWithKeys(name, address, publicKey, secretKey, password);
    wallet.encryptedMnemonic = await encryptString(mnemonic, password);
    return wallet;
  }

  static createId(): string {
    return new Date().getTime().toString(16)  + Math.floor(10000 * Math.random()).toString(16);
  }

  hasMnemonic(): boolean {
    return !!this.encryptedMnemonic;
  }

  async decryptSecret(password: string): Promise<string | null> {
    return decryptString(this.encryptedSecret, password);
  }

  async decryptMnemonic(password: string): Promise<string | null> {
    if (!this.encryptedMnemonic) {
      return null;
    }
    return decryptString(this.encryptedMnemonic, password);
  }

  async encryptSecret(oldPassword: string, newPassword: string): Promise<boolean> {
    if (this.externalProvider) {
      // 外部ウォレットは暗号化すべき秘密情報を持たないので、パスワード変更の対象外。
      return true;
    }
    const rawSecret = await this.decryptSecret(oldPassword);
    if (rawSecret === null) {
      return false;
    }
    this.encryptedSecret = await encryptString(rawSecret, newPassword);

    if (this.encryptedMnemonic) {
      const rawMnemonic = await this.decryptMnemonic(oldPassword);
      if (rawMnemonic === null) {
        return false;
      }
      this.encryptedMnemonic = await encryptString(rawMnemonic, newPassword);
    }
    return true;
  }
}

class Wallets {
  wallets: Wallet[] = [];
  activeId: string = '';

  get(id: String): Wallet | null {
    const wallet =  this.wallets.find((wallet) => wallet.id === id);
    if (wallet) {
      return wallet;
    } else {
      return null;
    }
  }
  gets(): Wallet[] {
    return this.wallets.slice();
  }

  getActive(): Wallet | null {
    return this.get(this.activeId);
  }

  getIndex(id: string): number {
    for (let index=0; index< this.wallets.length; index++) {
      if (this.wallets[index].id === id) {
        return index;
      }
    }
    return -1;
  }

  getActiveIndex(): number {
    return this.getIndex(this.activeId);
  }

  setActive(id: string) {
    this.activeId = id;
  }

  add(wallet: Wallet){
    this.wallets.push(wallet);
  }

  delete(id: string) {
    const index = this.getIndex(id);
    if (index < 0) {
      return;
    }
    this.wallets.splice(index, 1);

    if (this.activeId === id && this.wallets.length > 0) {
      this.activeId = this.wallets[0].id;
    }
  }

  setName(id: string, name: string) {
    const wallet = this.get(id);
    if (wallet) {
      wallet.name = name;
    }
  }
}


export class Storage {
  private static readonly PIN_CODE_KEY = "PIN_CODE";
  private static readonly PIN_ATTEMPTS_KEY = "PIN_ATTEMPTS";
  private static readonly WALLETS_KEY = "WALLETS";
  private static readonly SWAP_HISTORY_KEY = "SWAP_HISTORY";
  private static readonly CUSTOM_TOKENS_KEY = "CUSTOM_TOKENS";
  private static readonly CUSTOM_CHAINS_KEY = "CUSTOM_CHAINS";
  private static readonly ADDRESS_BOOK_KEY = "ADDRESS_BOOK";
  private static readonly PRODUCTS_KEY = "PRODUCTS";
  private static readonly SALES_KEY = "SALES";
  private static readonly SALES_RESET_KEY = "SALES_RESET";
  private static readonly PENDING_CHECKOUTS_KEY = "PENDING_CHECKOUTS";
  private static readonly PENDING_RECEIVES_KEY = "PENDING_RECEIVES";
  private static readonly INVOICES_KEY = "INVOICES";
  private static readonly SCHEDULED_PAYMENTS_KEY = "SCHEDULED_PAYMENTS";
  private static readonly SENT_RECIPIENTS_KEY = "SENT_RECIPIENTS";
  private static readonly PEER_EVENTS_KEY = "PEER_EVENTS";
  private static readonly ISSUER_PROFILE_KEY = "ISSUER_PROFILE";
  private static readonly RELAYER_URL_KEY = "RELAYER_URL";
  private static readonly TX_ANNOTATIONS_KEY = "TX_ANNOTATIONS";

  static setup() {
    // Driver order matters here. IndexedDB is listed first for normal http(s) hosting
    // (GitHub Pages) where it's fast and reliable, but when this file is opened directly
    // as file:///.../index.html, Chrome's IndexedDB implementation can throw
    // "Unsafe attempt to load URL ... 'file:' URLs are treated as unique security origins"
    // instead of cleanly failing — which broke the wallet-detection redirect entirely.
    // localForage tries each driver in order and falls back automatically if one throws
    // at setup time, but only if the earlier driver fails *before* being used for real
    // reads/writes. WEBSQL/LOCALSTORAGE both work fine under file://, so listing all three
    // means: use IndexedDB when it's actually usable, otherwise fall back safely.
    localForage.config({
      driver      : [localForage.INDEXEDDB, localForage.WEBSQL, localForage.LOCALSTORAGE],
      name        : 'RaccoonWallet',
      version     : 1.0,
      size        : 4980736, // Size of database, in bytes. WebSQL-only for now.
      storeName   : 'raccoon_wallet_data', // Should be alphanumeric, with underscores.
      description : 'Preferences of RaccoonWallet'
    });
  }

  static async loadPinCode(): Promise<PinCode | null> {
    const storageObject = await localForage.getItem(this.PIN_CODE_KEY);
    if (storageObject) {
      return Object.assign(new PinCode(), storageObject);
    } else {
      return null;
    }
  }

  static async savePinCode(pinCode: PinCode) {
    await localForage.setItem(this.PIN_CODE_KEY, pinCode);
  }

  static async removePinCode() {
    await localForage.removeItem(this.PIN_CODE_KEY);
  }

  static async loadPinAttempts(): Promise<PinAttempts> {
    const storageObject = await localForage.getItem(this.PIN_ATTEMPTS_KEY);
    return storageObject ? Object.assign(new PinAttempts(), storageObject) : new PinAttempts();
  }

  static async savePinAttempts(attempts: PinAttempts) {
    await localForage.setItem(this.PIN_ATTEMPTS_KEY, attempts);
  }

  static async removePinAttempts() {
    await localForage.removeItem(this.PIN_ATTEMPTS_KEY);
  }

  static async loadWallets(): Promise<Wallets> {
    const storageObject: any = await localForage.getItem(this.WALLETS_KEY) || "{}";
    const wallets = Object.assign(new Wallets(), storageObject);
    const newWallets: Wallet[] = [];
    for (let wallet of wallets.wallets as any[]) {
      // Drop the cached Symbol/NEM address/key fields older versions saved on a wallet
      // (those chains are no longer supported) so they don't linger in storage.
      const rest = Object.fromEntries(
        Object.entries(wallet).filter(([key]) => !/^(symbol|nem)(Address|PublicKey)/.test(key)),
      );
      const newWallet = Object.assign(new Wallet(), rest);
      newWallets.push(newWallet);
    }
    wallets.wallets = newWallets;
    return wallets;
  }

  static async saveWallets(wallets: Wallets) {
    await localForage.setItem(this.WALLETS_KEY, wallets);
  }

  static async loadSwapHistory(): Promise<SwapRecord[]> {
    return (await localForage.getItem(this.SWAP_HISTORY_KEY) as SwapRecord[] | null) || [];
  }

  static async saveSwapHistory(records: SwapRecord[]) {
    await localForage.setItem(this.SWAP_HISTORY_KEY, records);
  }

  static async loadCustomTokens(): Promise<CustomTokenRecord[]> {
    return (await localForage.getItem(this.CUSTOM_TOKENS_KEY) as CustomTokenRecord[] | null) || [];
  }

  static async saveCustomTokens(records: CustomTokenRecord[]) {
    await localForage.setItem(this.CUSTOM_TOKENS_KEY, records);
  }

  /** ガスレス送金のリレイヤーURL(設定)。未設定なら ''。 */
  static async loadRelayerUrl(): Promise<string> {
    const value = await localForage.getItem(this.RELAYER_URL_KEY);
    return typeof value === 'string' ? value : '';
  }

  static async saveRelayerUrl(url: string) {
    if (url === '') await localForage.removeItem(this.RELAYER_URL_KEY);
    else await localForage.setItem(this.RELAYER_URL_KEY, url);
  }

  static async loadCustomChains(): Promise<CustomChainRecord[]> {
    return (await localForage.getItem(this.CUSTOM_CHAINS_KEY) as CustomChainRecord[] | null) || [];
  }

  static async saveCustomChains(records: CustomChainRecord[]) {
    await localForage.setItem(this.CUSTOM_CHAINS_KEY, records);
  }

  static async loadAddressBook(): Promise<AddressBookRecord[]> {
    const records = (await localForage.getItem(this.ADDRESS_BOOK_KEY) as AddressBookRecord[] | null) || [];
    // Wallets saved on Symbol/NEM (chains that are no longer supported) are dropped.
    return records.map((record) => ({
      ...record,
      wallets: (record.wallets ?? []).filter((w) => w.chain !== 'symbol' && w.chain !== 'nem'),
    }));
  }

  static async saveAddressBook(records: AddressBookRecord[]) {
    await localForage.setItem(this.ADDRESS_BOOK_KEY, records);
  }

  static async loadProducts(): Promise<ProductRecord[]> {
    return (await localForage.getItem(this.PRODUCTS_KEY) as ProductRecord[] | null) || [];
  }

  static async saveProducts(records: ProductRecord[]) {
    await localForage.setItem(this.PRODUCTS_KEY, records);
  }

  static async loadSales(): Promise<SaleRecord[]> {
    return (await localForage.getItem(this.SALES_KEY) as SaleRecord[] | null) || [];
  }

  static async saveSales(records: SaleRecord[]) {
    await localForage.setItem(this.SALES_KEY, records);
  }

  static async loadTxAnnotations(): Promise<Record<string, TxAnnotationRecord>> {
    return (await localForage.getItem(this.TX_ANNOTATIONS_KEY) as Record<string, TxAnnotationRecord> | null) || {};
  }

  static async saveTxAnnotations(records: Record<string, TxAnnotationRecord>) {
    await localForage.setItem(this.TX_ANNOTATIONS_KEY, records);
  }

  // "今日の売上" reset checkpoint (see SalesHelper.resetTodayTotal below) - a plain
  // timestamp, not a deletion of SaleRecords, so the underlying 販売履歴 (and the stock
  // changes it caused) is never touched by a reset; only the summary figure on
  // MarketplaceList stops counting anything at or before that timestamp.
  static async loadSalesReset(): Promise<SalesResetState> {
    return (await localForage.getItem(this.SALES_RESET_KEY) as SalesResetState | null) || { dailyResetAt: 0 };
  }

  static async saveSalesReset(state: SalesResetState) {
    await localForage.setItem(this.SALES_RESET_KEY, state);
  }

  static async loadPendingCheckouts(): Promise<PendingCheckoutRecord[]> {
    return (await localForage.getItem(this.PENDING_CHECKOUTS_KEY) as PendingCheckoutRecord[] | null) || [];
  }

  static async savePendingCheckouts(records: PendingCheckoutRecord[]) {
    await localForage.setItem(this.PENDING_CHECKOUTS_KEY, records);
  }

  static async loadPendingReceives(): Promise<PendingReceiveRecord[]> {
    return (await localForage.getItem(this.PENDING_RECEIVES_KEY) as PendingReceiveRecord[] | null) || [];
  }

  static async savePendingReceives(records: PendingReceiveRecord[]) {
    await localForage.setItem(this.PENDING_RECEIVES_KEY, records);
  }

  static async loadInvoices(): Promise<InvoiceRecord[]> {
    return (await localForage.getItem(this.INVOICES_KEY) as InvoiceRecord[] | null) || [];
  }

  static async saveInvoices(records: InvoiceRecord[]) {
    await localForage.setItem(this.INVOICES_KEY, records);
  }

  static async loadScheduledPayments(): Promise<ScheduledPaymentRecord[]> {
    return (await localForage.getItem(this.SCHEDULED_PAYMENTS_KEY) as ScheduledPaymentRecord[] | null) || [];
  }

  static async saveScheduledPayments(records: ScheduledPaymentRecord[]) {
    await localForage.setItem(this.SCHEDULED_PAYMENTS_KEY, records);
  }

  static async loadSentRecipients(): Promise<SentRecipient[]> {
    return (await localForage.getItem(this.SENT_RECIPIENTS_KEY) as SentRecipient[] | null) || [];
  }

  static async saveSentRecipients(records: SentRecipient[]) {
    await localForage.setItem(this.SENT_RECIPIENTS_KEY, records);
  }

  /** 履歴から切り出した相手ごとの記録。ウォレットのアドレス(小文字)ごとに分けて持つ。 */
  static async loadPeerEvents(walletAddress: string): Promise<PeerEvent[]> {
    const all = (await localForage.getItem(this.PEER_EVENTS_KEY) as Record<string, PeerEvent[]> | null) || {};
    return all[walletAddress.toLowerCase()] ?? [];
  }

  static async savePeerEvents(walletAddress: string, events: PeerEvent[]) {
    const all = (await localForage.getItem(this.PEER_EVENTS_KEY) as Record<string, PeerEvent[]> | null) || {};
    all[walletAddress.toLowerCase()] = events;
    await localForage.setItem(this.PEER_EVENTS_KEY, all);
  }

  static async loadIssuerProfile(): Promise<Partial<IssuerProfile> | null> {
    return (await localForage.getItem(this.ISSUER_PROFILE_KEY) as Partial<IssuerProfile> | null) || null;
  }

  static async saveIssuerProfile(profile: IssuerProfile) {
    await localForage.setItem(this.ISSUER_PROFILE_KEY, profile);
  }
}


export class PinCodeHelper {
  // Legacy placeholder password used - in older builds - to encrypt a wallet's secret
  // before a real PIN had been set. It is a fixed, publicly-known value (visible in the
  // shipped source), so any wallet still encrypted with it offers no real protection.
  // It is kept only so PasswordDialog's register/change flows can migrate a pre-existing
  // installation's wallet (one created before this fix, still encrypted with this
  // constant) onto the person's real PIN. Nothing new should ever be encrypted with
  // this value - see LessonBeginner.tsx and WalletCreationName.tsx, which now require a
  // real PIN before a wallet is ever created/persisted.
  static readonly defaultPin = "093156";

  // After LOCKOUT_THRESHOLD consecutive wrong entries, checking a PIN is blocked for an
  // increasing cool-down instead of allowing unlimited retries. This is tracked in
  // storage (see PinAttempts) rather than component state, so it survives closing and
  // reopening PasswordDialog, and app restarts - closing the dialog no longer resets an
  // attacker's attempt count back to zero.
  private static readonly LOCKOUT_THRESHOLD = 3;
  private static readonly LOCKOUT_BASE_MS = 30 * 1000; // 30 seconds
  private static readonly LOCKOUT_MAX_MS = 30 * 60 * 1000; // capped at 30 minutes

  static async hasSavedCode(): Promise<boolean> {
    return await Storage.loadPinCode() != null;
  }

  static async update(rawCode: string) {
    const hashedCode = await bcrypt.hash(rawCode, 10);
    const pinCode = new PinCode();
    pinCode.hashedCode = hashedCode;
    await Storage.savePinCode(pinCode);
    // A (re)registered PIN is a fresh secret - past failures against the old PIN (or
    // against no PIN at all) shouldn't count against it.
    await Storage.removePinAttempts();
  }

  /**
   * Milliseconds remaining before a PIN check is allowed again, or 0 if not currently
   * locked out. Callers (PasswordDialog) should check this before letting the person type,
   * rather than only discovering the lockout after a check() call.
   */
  static async getLockoutRemainingMs(): Promise<number> {
    const attempts = await Storage.loadPinAttempts();
    if (attempts.lockedUntil === 0) {
      return 0;
    }
    const remaining = attempts.lockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  static async check(pinCode: string): Promise<boolean> {
    // Still cooling down from previous failures - refuse the check outright (even if
    // `pinCode` happens to be correct) instead of letting every attempt through and
    // only rate-limiting the UI layer.
    if ((await this.getLockoutRemainingMs()) > 0) {
      return false;
    }

    const savedCode = await Storage.loadPinCode();
    if (!savedCode) {
      return false;
    }

    const isCorrect = await bcrypt.compare(pinCode, savedCode.hashedCode);
    if (isCorrect) {
      await Storage.removePinAttempts();
      return true;
    }

    const attempts = await Storage.loadPinAttempts();
    const failedCount = attempts.failedCount + 1;
    let lockedUntil = 0;
    if (failedCount >= this.LOCKOUT_THRESHOLD) {
      // Exponential backoff for every failure at/after the threshold: 30s, 60s, 120s, ...
      // capped at LOCKOUT_MAX_MS, so continued guessing gets slower rather than free.
      const overBy = failedCount - this.LOCKOUT_THRESHOLD;
      const delay = Math.min(this.LOCKOUT_BASE_MS * (2 ** overBy), this.LOCKOUT_MAX_MS);
      lockedUntil = Date.now() + delay;
    }
    await Storage.savePinAttempts(Object.assign(new PinAttempts(), { failedCount, lockedUntil }));
    return false;
  }

  static async remove() {
    await Storage.removePinCode();
    await Storage.removePinAttempts();
  }
}


export class WalletsHelper {
  /**
   * Gets wallet.
   * @param {string} id Wallet ID
   * @returns {Promise<Wallet | null>} Wallet which has the given ID or null if there is no wallet which has the ID.
   */
  static async get(id: string): Promise<Wallet | null> {
    return (await Storage.loadWallets()).get(id);
  }

  /**
   * Gets wallets.
   * @returns {Wallet[]} All wallets.
   */
  static async gets(): Promise<Wallet[]> {
    return (await Storage.loadWallets()).gets();
  }

  /**
   * Gets active wallet.
   * @returns {Wallet | null} Active wallet or null if there is no active wallet.
   */
  static async getActive(): Promise<Wallet | null> {
    return (await Storage.loadWallets()).getActive();
  }

  /**
   * Sets active wallet.
   * @param {string} id Wallet ID.
   */
  static async setActive(id: string) {
    const wallets = await Storage.loadWallets();
    wallets.setActive(id);
    await Storage.saveWallets(wallets);
  }

  /**
   * Adds Wallet.
   * @param {Wallet} wallet New Wallet.
   * @param {boolean} activate If the wallet is activated now or not.
   */
  static async add(wallet: Wallet, activate: boolean = false) {
    const wallets = await Storage.loadWallets();
    wallets.add(wallet);
    if (activate) {
      wallets.setActive(wallet.id);
    }
    await Storage.saveWallets(wallets);
  }

  /**
   * Deletes wallet.
   * @param {string} id Wallet ID
   */
  static async delete(id: string) {
    const wallets = await Storage.loadWallets();
    const wallet = wallets.get(id);
    if (wallet == null) {
      return;
    }
    wallets.delete(id);
    await Storage.saveWallets(wallets);
  }

  /**
   * Deletes every wallet on this device - every recovery phrase and private key stored
   * locally is gone once this resolves. There's no way back short of re-importing from an
   * external backup. Used by Settings > Logout; every other flow removes one wallet at a
   * time (see delete()).
   */
  static async deleteAll() {
    await Storage.saveWallets(new Wallets());
  }

  static async decryptKey(id: string, password: string): Promise<string | null> {
    const wallet = await this.get(id);
    if (!wallet) {
      return null;
    }
    const secret = await wallet.decryptSecret(password);
    if (secret !== null) {
      await this.migrateLegacyEncryptionIfNeeded(wallet, password);
    }
    return secret;
  }

  /**
   * Decrypts the recovery phrase (BIP39 mnemonic) for the given wallet, for the app-wide
   * Settings > バックアップ flow (see WalletBackup). Returns null if the wallet doesn't
   * exist, the password is wrong, or the wallet has no mnemonic (imported by private key).
   */
  static async decryptMnemonic(id: string, password: string): Promise<string | null> {
    const wallet = await this.get(id);
    if (!wallet) {
      return null;
    }
    const mnemonic = await wallet.decryptMnemonic(password);
    if (mnemonic !== null) {
      await this.migrateLegacyEncryptionIfNeeded(wallet, password);
    }
    return mnemonic;
  }

  /**
   * Upgrades a wallet's secret/mnemonic to the current AES-GCM format (see decryptString's
   * block comment near V2_PREFIX) if either is still in the legacy CryptoJS format.
   * Previously this only happened when the person went through Settings > PIN変更 (which
   * re-encrypts via encryptWallets); a wallet that was never touched there could stay on
   * the weaker legacy format indefinitely. Called from decryptKey/decryptMnemonic above so
   * ordinary use (unlocking Symbol/NEM, viewing a backup) upgrades it in the background.
   * Best-effort: never throws, and does nothing if the wallet is already current or if
   * re-encryption fails for any reason - the caller already has the plaintext it asked
   * for either way, so a failed migration attempt shouldn't disrupt it.
   */
  private static async migrateLegacyEncryptionIfNeeded(wallet: Wallet, password: string) {
    const secretIsLegacy = wallet.encryptedSecret.length > 0 && !wallet.encryptedSecret.startsWith(V2_PREFIX);
    const mnemonicIsLegacy = !!wallet.encryptedMnemonic && !wallet.encryptedMnemonic.startsWith(V2_PREFIX);
    if (!secretIsLegacy && !mnemonicIsLegacy) {
      return;
    }
    try {
      // Re-encrypting with the same password on both sides just rewrites the ciphertext
      // in the current format without actually changing what unlocks it.
      if (!(await wallet.encryptSecret(password, password))) {
        return;
      }
      const wallets = await Storage.loadWallets();
      const stored = wallets.get(wallet.id);
      if (stored) {
        stored.encryptedSecret = wallet.encryptedSecret;
        stored.encryptedMnemonic = wallet.encryptedMnemonic;
        await Storage.saveWallets(wallets);
      }
    } catch (e) {
      // Best-effort migration only - swallow and leave the wallet on the legacy format
      // for next time rather than surfacing an error for what the caller sees as a
      // successful decrypt.
    }
  }

  static async createWithKeys(name: string, address: string, publicKey: string, secretKey: string, password: string) {
    let wallet: Wallet;
    do {
      wallet = await Wallet.createWithKeys(name, address, publicKey, secretKey, password);
    } while ((await this.get(wallet.id)) != null);

    return wallet;
  }

  /**
   * Creates a wallet backed by a BIP39 recovery phrase (new wallet creation, or mnemonic import).
   * The mnemonic itself is stored encrypted alongside the private key so it can be re-shown
   * for backup later (see WalletBackup).
   */
  static async createWithMnemonic(name: string, address: string, publicKey: string, secretKey: string, mnemonic: string, password: string) {
    let wallet: Wallet;
    do {
      wallet = await Wallet.createWithMnemonic(name, address, publicKey, secretKey, mnemonic, password);
    } while ((await this.get(wallet.id)) != null);

    return wallet;
  }

  /**
   * Encrypts all registered wallets again.
   * @param {string} oldPassword Current password for encryption.
   * @param {string} newPassword New password for encryption.
   */
  static async encryptWallets(oldPassword: string, newPassword: string): Promise<boolean> {
    const wallets = await Storage.loadWallets();
    for (const wallet of wallets.gets()) {
      if (!(await wallet.encryptSecret(oldPassword, newPassword))) {
        return false;
      }
    }
    await Storage.saveWallets(wallets);
    return true;
  }

  /**
   * Gets wallet name.
   * @param {string} id Wallet ID.
   * @returns {string} Wallet Name.
   */
  static async getName(id: string): Promise<string> {
    const wallet = await this.get(id);
    if (!wallet) {
      return '';
    }
    return wallet.name;
  }

  /**
   * Sets wallet name.
   * @param {string} id Wallet ID.
   * @param {string} name New wallet ID.
   */
  static async setName(id: string, name: string) {
    const wallets = await Storage.loadWallets();
    wallets.setName(id, name);
    await Storage.saveWallets(wallets);
  }
}


// --- PIN-based encryption for encryptedSecret/encryptedMnemonic --------------------------
//
// The PIN the person types (4-6 raw digits) is never used directly as an AES key/passphrase.
// It's first stretched through PBKDF2-HMAC-SHA256 with a random per-secret salt and a high
// iteration count, so an attacker who extracts the encrypted blob from IndexedDB still has
// to brute-force the PIN through 210,000 PBKDF2 rounds per guess rather than a single cheap
// AES decrypt - closing the gap described in the security review above (a raw 4-6 digit
// keyspace is otherwise exhaustible almost instantly). This uses the browser's native
// Web Crypto API (SubtleCrypto) rather than crypto-js's pure-JS PBKDF2: crypto-js took
// ~2 seconds for one derivation at this iteration count in testing (would mean a
// multi-second freeze on every PIN unlock/send/backup), while SubtleCrypto's native
// implementation does the same work in the low tens of milliseconds. AES-GCM (authenticated
// encryption) also replaces AES-CBC here, so a wrong PIN fails the auth tag immediately
// instead of relying on "did this decrypt to plausible-looking UTF-8?" as a proxy.
//
// New format (written by every encryptString call from now on):
//   "v2:" + base64(salt) + ":" + base64(iv) + ":" + base64(ciphertext+authTag)
// Old format (still readable, never written): CryptoJS.AES.encrypt(message, pin).toString()
//   - i.e. CryptoJS's own passphrase mode (EVP_BytesToKey/MD5, embedded salt, AES-CBC).
//   Kept decryptable so wallets created before this change don't lose their secret/
//   mnemonic; they're transparently upgraded to the new format the next time
//   encryptSecret() runs (Settings > PIN変更 flow), since that always re-encrypts through
//   encryptString().
const V2_PREFIX = 'v2:';
const PBKDF2_ITERATIONS = 210000; // OWASP 2023 minimum for PBKDF2-HMAC-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12; // recommended nonce length for AES-GCM

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesGcmKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptString(message: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesGcmKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(message));
  return `${V2_PREFIX}${bytesToBase64(salt)}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decryptString(encrypted: string, password: string): Promise<string | null> {
  try {
    if (encrypted.startsWith(V2_PREFIX)) {
      const [saltB64, ivB64, cipherB64] = encrypted.slice(V2_PREFIX.length).split(':');
      if (!saltB64 || !ivB64 || !cipherB64) {
        return null;
      }
      const salt = base64ToBytes(saltB64);
      const iv = base64ToBytes(ivB64);
      const key = await deriveAesGcmKey(password, salt);
      // AES-GCM throws if the auth tag doesn't match (wrong password or tampered data) -
      // caught below, so a wrong PIN reliably yields null rather than garbage plaintext.
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, base64ToBytes(cipherB64) as BufferSource);
      return new TextDecoder().decode(plainBuf);
    }

    // Legacy format from before this change - see block comment above.
    const decrypted = CryptoJS.AES.decrypt(encrypted, password);
    const text = decrypted.toString(CryptoJS.enc.Utf8);
    return text.length > 0 ? text : null;
  } catch (e) {
    return null;
  }
}

export class SwapHistoryHelper {
  // Bounds local storage size; comfortably covers every caller (Home only ever wants the
  // most recent 3).
  private static readonly CAP = 50;

  /** All recorded swaps, most recent first. */
  static async list(): Promise<SwapRecord[]> {
    const records = await Storage.loadSwapHistory();
    return records.slice().sort((a, b) => b.timestamp - a.timestamp);
  }

  static async add(record: SwapRecord) {
    const records = await Storage.loadSwapHistory();
    records.push(record);
    records.sort((a, b) => b.timestamp - a.timestamp);
    await Storage.saveSwapHistory(records.slice(0, this.CAP));
  }
}

export class CustomTokensHelper {
  /** Every custom token registered on the given chain. */
  static async list(chain: string): Promise<CustomTokenRecord[]> {
    const all = await Storage.loadCustomTokens();
    return all.filter((t) => t.chain === chain);
  }

  /** All custom tokens across every chain. */
  static async listAll(): Promise<CustomTokenRecord[]> {
    return Storage.loadCustomTokens();
  }

  /**
   * Registers a token by contract address. No-ops (rather than adding a duplicate) if the
   * same chain+address is already registered.
   */
  static async add(record: CustomTokenRecord) {
    const all = await Storage.loadCustomTokens();
    const exists = all.some((t) => t.chain === record.chain && t.address.toLowerCase() === record.address.toLowerCase());
    if (!exists) {
      all.push(record);
      await Storage.saveCustomTokens(all);
    }
  }

  static async remove(chain: string, address: string) {
    const all = await Storage.loadCustomTokens();
    const next = all.filter((t) => !(t.chain === chain && t.address.toLowerCase() === address.toLowerCase()));
    await Storage.saveCustomTokens(next);
  }

  /** Drops every custom token registered under the given chain id, e.g. when that chain
   * (a CustomChainRecord from the asset-recovery feature) itself gets deleted - an orphaned
   * token entry pointing at a chain no longer in the list would just be dead data. */
  static async removeAllForChain(chain: string) {
    const all = await Storage.loadCustomTokens();
    await Storage.saveCustomTokens(all.filter((t) => t.chain !== chain));
  }
}

// Chains the person added by hand under 設定 > 通貨の取り出し (see CustomChainRecord above).
export class CustomChainsHelper {
  static async list(): Promise<CustomChainRecord[]> {
    return Storage.loadCustomChains();
  }

  static async get(id: string): Promise<CustomChainRecord | null> {
    const all = await Storage.loadCustomChains();
    return all.find((c) => c.id === id) ?? null;
  }

  /** Throws Error('duplicate_chain_id') if this chainId was already added. */
  static async add(record: Omit<CustomChainRecord, 'id'>): Promise<CustomChainRecord> {
    const all = await Storage.loadCustomChains();
    const id = `custom-${record.chainId}`;
    if (all.some((c) => c.id === id)) {
      throw new Error('duplicate_chain_id');
    }
    const full: CustomChainRecord = { id, ...record };
    all.push(full);
    await Storage.saveCustomChains(all);
    return full;
  }

  static async remove(id: string) {
    const all = await Storage.loadCustomChains();
    await Storage.saveCustomChains(all.filter((c) => c.id !== id));
    await CustomTokensHelper.removeAllForChain(id);
  }
}

// Just-created-record shape for AddressBookHelper.add/updateProfile — everything except
// id and wallets, which the helper manages itself.
type ContactProfileInput = Omit<AddressBookRecord, 'id' | 'wallets'>;
type ContactWalletInput = Omit<ContactWallet, 'id'>;

export class AddressBookHelper {
  // Fixed id for the person's own profile record (see AddressBookRecord's doc comment
  // above) — a real localForage record like any other contact, just filtered out of
  // list() and defaulted to "GUEST"/"GUEST" (matching the original app's guest state,
  // see logo_pyoko + "GUEST" in the nav drawer) until the person edits it.
  static readonly SELF_ID = 'self';

  private static defaultSelf(): AddressBookRecord {
    return { id: AddressBookHelper.SELF_ID, name: 'GUEST', reading: 'GUEST', phone: '', email: '', xAccount: '', lineAccount: '', telegramAccount: '', iconDataUrl: '', coverDataUrl: '', wallets: [] };
  }

  static async list(): Promise<AddressBookRecord[]> {
    const all = await Storage.loadAddressBook();
    // Shown alphabetically (locale-aware) so a growing list stays scannable rather than
    // just reflecting the order entries happened to be added in. The self profile lives
    // in the same table but is never shown in the friend list itself.
    return all
      .filter((r) => r.id !== AddressBookHelper.SELF_ID)
      .map(AddressBookHelper.withDefaults)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  static async get(id: string): Promise<AddressBookRecord | null> {
    const all = await Storage.loadAddressBook();
    const found = all.find((r) => r.id === id);
    if (found) return AddressBookHelper.withDefaults(found);
    // Self profile hasn't been edited/saved yet - hand back the same GUEST defaults the
    // drawer shows, rather than null, so the detail screen has something to render.
    return id === AddressBookHelper.SELF_ID ? AddressBookHelper.defaultSelf() : null;
  }

  // Fills in fields added to AddressBookRecord after some records were already saved to
  // localForage (e.g. xAccount) - loading an older record without them would otherwise
  // hand back `undefined` instead of the expected ''.
  private static withDefaults(record: AddressBookRecord): AddressBookRecord {
    return { ...record, xAccount: record.xAccount ?? '', lineAccount: record.lineAccount ?? '', telegramAccount: record.telegramAccount ?? '' };
  }

  static async getSelf(): Promise<AddressBookRecord> {
    return (await AddressBookHelper.get(AddressBookHelper.SELF_ID))!;
  }

  static async add(profile: ContactProfileInput): Promise<AddressBookRecord> {
    const all = await Storage.loadAddressBook();
    const record: AddressBookRecord = { id: Wallet.createId(), wallets: [], ...profile };
    all.push(record);
    await Storage.saveAddressBook(all);
    return record;
  }

  // Upserts, since the self profile may not have a stored record yet (see get() above).
  static async updateProfile(id: string, profile: ContactProfileInput) {
    const all = await Storage.loadAddressBook();
    const index = all.findIndex((r) => r.id === id);
    if (index >= 0) {
      all[index] = { ...all[index], ...profile };
    } else if (id === AddressBookHelper.SELF_ID) {
      all.push({ ...AddressBookHelper.defaultSelf(), ...profile });
    } else {
      return;
    }
    await Storage.saveAddressBook(all);
  }

  static async remove(id: string) {
    const all = await Storage.loadAddressBook();
    await Storage.saveAddressBook(all.filter((r) => r.id !== id));
  }

  // Looks up the contact (if any) who has `address` registered under one of their
  // wallets, for display purposes (e.g. showing "田中さん" instead of a raw address on
  // Home/TransactionList). Compared case-insensitively since EVM addresses are
  // checksum-cased inconsistently depending on where they were copied from. Self is
  // excluded from list() already, but is intentionally included here so a transaction
  // to/from the user's own other wallet still resolves to a name rather than an address.
  static async findByAddress(address: string): Promise<AddressBookRecord | null> {
    const all = await Storage.loadAddressBook();
    const target = address.toLowerCase();
    const found = all.find((r) => r.wallets.some((w) => w.address.toLowerCase() === target));
    return found ? AddressBookHelper.withDefaults(found) : null;
  }

  private static findOrCreateContact(all: AddressBookRecord[], contactId: string): AddressBookRecord {
    let contact = all.find((r) => r.id === contactId);
    if (!contact) {
      if (contactId !== AddressBookHelper.SELF_ID) {
        throw new Error('Contact not found');
      }
      contact = AddressBookHelper.defaultSelf();
      all.push(contact);
    }
    return contact;
  }

  // Adds a wallet to the given contact. Setting `isMaster` true demotes any previous
  // master wallet on the same contact — the original feature only ever allowed one
  // "most-used" wallet per friend at a time (see the "Masterウォレット設定" section of
  // the original feature writeup), so this mirrors that rather than allowing several.
  static async addWallet(contactId: string, wallet: ContactWalletInput): Promise<ContactWallet> {
    const all = await Storage.loadAddressBook();
    const contact = AddressBookHelper.findOrCreateContact(all, contactId);
    const record: ContactWallet = { id: Wallet.createId(), ...wallet };
    if (record.isMaster) {
      contact.wallets.forEach((w) => { w.isMaster = false; });
    }
    contact.wallets.push(record);
    await Storage.saveAddressBook(all);
    return record;
  }

  static async updateWallet(contactId: string, walletId: string, wallet: ContactWalletInput) {
    const all = await Storage.loadAddressBook();
    const contact = all.find((r) => r.id === contactId);
    if (!contact) return;
    const index = contact.wallets.findIndex((w) => w.id === walletId);
    if (index < 0) return;
    if (wallet.isMaster) {
      contact.wallets.forEach((w) => { w.isMaster = false; });
    }
    contact.wallets[index] = { id: walletId, ...wallet };
    await Storage.saveAddressBook(all);
  }

  static async removeWallet(contactId: string, walletId: string) {
    const all = await Storage.loadAddressBook();
    const contact = all.find((r) => r.id === contactId);
    if (!contact) return;
    contact.wallets = contact.wallets.filter((w) => w.id !== walletId);
    await Storage.saveAddressBook(all);
  }
}

// "売り物リスト" — manual inventory management (登録 / 入荷 / 在庫表示).
// Sales themselves go through SalesHelper below, which is the only thing allowed to
// change `stock` after registration, so every stock change is traceable to a SaleRecord
// (a sale) or a restock() call (a manual "入荷").
export class ProductsHelper {
  /** Every registered product, newest-registered first. */
  static async list(): Promise<ProductRecord[]> {
    const all = await Storage.loadProducts();
    return all.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  static async get(id: string): Promise<ProductRecord | null> {
    const all = await Storage.loadProducts();
    return all.find((p) => p.id === id) ?? null;
  }

  static async add(input: { name: string; price: number; stock: number; description: string; memo: string }): Promise<ProductRecord> {
    const all = await Storage.loadProducts();
    const record: ProductRecord = {
      id: Wallet.createId(),
      name: input.name,
      price: input.price,
      stock: input.stock,
      description: input.description,
      memo: input.memo,
      createdAt: new Date().getTime(),
    };
    all.push(record);
    await Storage.saveProducts(all);
    return record;
  }

  /** Updates the registration fields. Does NOT touch `stock` — use restock() for 入荷. */
  static async update(id: string, input: { name: string; price: number; description: string; memo: string }) {
    const all = await Storage.loadProducts();
    const index = all.findIndex((p) => p.id === id);
    if (index >= 0) {
      all[index] = { ...all[index], name: input.name, price: input.price, description: input.description, memo: input.memo };
      await Storage.saveProducts(all);
    }
  }

  /** 入荷: adds `quantity` to the current stock. */
  static async restock(id: string, quantity: number) {
    const all = await Storage.loadProducts();
    const index = all.findIndex((p) => p.id === id);
    if (index >= 0) {
      all[index] = { ...all[index], stock: all[index].stock + quantity };
      await Storage.saveProducts(all);
    }
  }

  /**
   * Quick manual stock correction (e.g. an item sold in person without going through
   * QRレジスター). Unlike SalesHelper.sell(), this does NOT record a SaleRecord — it just
   * adjusts the count — and it deliberately never drops stock below 1, so a mistaken tap
   * can't zero out or negative out inventory by accident. To record an actual sale, or to
   * bring stock down to 0, use QRレジスター or 削除 instead.
   */
  static async decrementStock(id: string, quantity: number) {
    const all = await Storage.loadProducts();
    const index = all.findIndex((p) => p.id === id);
    if (index >= 0) {
      const nextStock = Math.max(1, all[index].stock - quantity);
      all[index] = { ...all[index], stock: nextStock };
      await Storage.saveProducts(all);
    }
  }

  /**
   * Deletes the product itself. Past SaleRecords are kept as-is (they hold their own
   * snapshot of productName/unitPrice) so 売上集計 (sales totals) stay accurate even for
   * products that are no longer listed.
   */
  static async remove(id: string) {
    const all = await Storage.loadProducts();
    await Storage.saveProducts(all.filter((p) => p.id !== id));
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Thrown by SalesHelper.sell() when there isn't enough stock left to fulfil the sale, so
// callers can show a specific "在庫が不足しています" message instead of a generic failure.
export class InsufficientStockError extends Error {
  constructor() {
    super('Insufficient stock');
    this.name = 'InsufficientStockError';
  }
}

// "手動会計" — recording a sale is the one action that both books revenue (a SaleRecord)
// and moves inventory (decrementing the product's stock) in one step, mirroring the
// feature request's "販売ボタンを押すと在庫と売上が両方更新される" behavior.
export class SalesHelper {
  /** Every recorded sale, most recent first. */
  static async list(): Promise<SaleRecord[]> {
    const all = await Storage.loadSales();
    return all.slice().sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Sales for a single product, most recent first. */
  static async listByProduct(productId: string): Promise<SaleRecord[]> {
    return (await this.list()).filter((s) => s.productId === productId);
  }

  /**
   * Records a sale of `quantity` units of the given product at its current price, and
   * decrements that product's stock by the same amount. Throws InsufficientStockError
   * (leaving stock/sales untouched) if `quantity` exceeds the current stock.
   */
  static async sell(productId: string, quantity: number, note: string = ''): Promise<SaleRecord> {
    const products = await Storage.loadProducts();
    const index = products.findIndex((p) => p.id === productId);
    if (index < 0) {
      throw new Error('Product not found');
    }
    const product = products[index];
    if (quantity <= 0 || quantity > product.stock) {
      throw new InsufficientStockError();
    }

    products[index] = { ...product, stock: product.stock - quantity };
    await Storage.saveProducts(products);

    const record: SaleRecord = {
      id: Wallet.createId(),
      productId,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      amount: product.price * quantity,
      timestamp: new Date().getTime(),
      note,
    };
    const sales = await Storage.loadSales();
    sales.push(record);
    await Storage.saveSales(sales);
    return record;
  }

  /**
   * Records a sale that isn't tied to any registered product — e.g. a one-off item rung up
   * on QRレジスター that was never added to 売り物リスト. Unlike sell(), this never touches
   * `stock` (there's no product to decrement) and can't fail with InsufficientStockError;
   * it just appends a SaleRecord with an empty productId so 売上集計 still counts it.
   */
  static async sellMisc(name: string, unitPrice: number, quantity: number, note: string = ''): Promise<SaleRecord> {
    const record: SaleRecord = {
      id: Wallet.createId(),
      productId: '',
      productName: name,
      unitPrice,
      quantity,
      amount: unitPrice * quantity,
      timestamp: new Date().getTime(),
      note,
    };
    const sales = await Storage.loadSales();
    sales.push(record);
    await Storage.saveSales(sales);
    return record;
  }

  /**
   * Undoes a mistaken sale entry: removes the SaleRecord and, if the product it referred
   * to still exists, restores its stock by the sold quantity.
   */
  static async remove(id: string) {
    const sales = await Storage.loadSales();
    const record = sales.find((s) => s.id === id);
    if (!record) {
      return;
    }
    await Storage.saveSales(sales.filter((s) => s.id !== id));

    const products = await Storage.loadProducts();
    const index = products.findIndex((p) => p.id === record.productId);
    if (index >= 0) {
      products[index] = { ...products[index], stock: products[index].stock + record.quantity };
      await Storage.saveProducts(products);
    }
  }

  /** 📊 売上集計: total amount + quantity sold so far today (since the last reset, if any). */
  static async todayTotal(): Promise<{ amount: number; quantity: number }> {
    const now = new Date();
    const [all, reset] = await Promise.all([Storage.loadSales(), Storage.loadSalesReset()]);
    return all
      .filter((s) => isSameDay(new Date(s.timestamp), now) && s.timestamp > reset.dailyResetAt)
      .reduce((acc, s) => ({ amount: acc.amount + s.amount, quantity: acc.quantity + s.quantity }), { amount: 0, quantity: 0 });
  }

  /**
   * 📊 期間集計: total amount + quantity sold within an arbitrary, caller-chosen
   * [startMs, endMs] window (both inclusive) — replaces the old fixed "今月の売上", which
   * couldn't be pointed at anything but the current calendar month. This is a plain
   * historical query over 販売履歴, not a running counter, so unlike todayTotal() it has no
   * reset checkpoint of its own — pick a different range instead of "resetting".
   */
  static async rangeTotal(startMs: number, endMs: number): Promise<{ amount: number; quantity: number }> {
    const all = await Storage.loadSales();
    return all
      .filter((s) => s.timestamp >= startMs && s.timestamp <= endMs)
      .reduce((acc, s) => ({ amount: acc.amount + s.amount, quantity: acc.quantity + s.quantity }), { amount: 0, quantity: 0 });
  }

  /**
   * Zeroes out "今日の売上" from now on. This only moves the daily checkpoint forward to
   * the current time — it never deletes SaleRecords or touches stock, so 販売履歴 is
   * unaffected.
   */
  static async resetTodayTotal() {
    const reset = await Storage.loadSalesReset();
    await Storage.saveSalesReset({ ...reset, dailyResetAt: new Date().getTime() });
  }

  /**
   * Permanently erases every SaleRecord (販売履歴) — a log-clearing action, not an undo:
   * unlike remove() above, this does NOT restore any product's stock, since a bulk clear
   * can span records from long ago and blindly crediting stock back for all of them would
   * likely corrupt inventory counts that have moved on since. Used by the "すべての履歴を
   * 削除" action on the sales history screen; callers should warn accordingly before
   * calling this.
   */
  static async clearAllHistory() {
    await Storage.saveSales([]);
  }
}

// QRレジスターの「入金待ち一覧」— checkouts whose payment QR has been shown to a customer
// but not yet confirmed on-chain. Letting the cashier navigate away from the register
// screen without losing this means they don't have to keep staring at one QR code while
// waiting; they can ring up the next customer and come back later to check whether this one
// has paid (see pages/qrlab/QRRegister.tsx). Nothing here touches stock or 販売履歴 — those
// only change once the sale is actually finalized (payment detected, or completed manually).
export class PendingCheckoutsHelper {
  /** Every pending checkout, most recently created first. */
  static async list(): Promise<PendingCheckoutRecord[]> {
    const all = await Storage.loadPendingCheckouts();
    return all.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  static async get(id: string): Promise<PendingCheckoutRecord | null> {
    const all = await Storage.loadPendingCheckouts();
    return all.find((p) => p.id === id) ?? null;
  }

  static async add(input: Omit<PendingCheckoutRecord, 'id' | 'createdAt'>): Promise<PendingCheckoutRecord> {
    const all = await Storage.loadPendingCheckouts();
    const record: PendingCheckoutRecord = { id: Wallet.createId(), createdAt: new Date().getTime(), ...input };
    all.push(record);
    await Storage.savePendingCheckouts(all);
    return record;
  }

  static async remove(id: string) {
    const all = await Storage.loadPendingCheckouts();
    await Storage.savePendingCheckouts(all.filter((p) => p.id !== id));
  }
}

// QRラボ「指定金額を受け取る」の「入金待ち一覧」— see PendingReceiveRecord above and
// pages/qrlab/QRGeneratorCollect.tsx/QRGeneratorPending.tsx. Mirrors PendingCheckoutsHelper
// but for the simpler, cart-less "receive this amount" flow.
export class PendingReceivesHelper {
  /** Every pending receive, most recently created first. */
  static async list(): Promise<PendingReceiveRecord[]> {
    const all = await Storage.loadPendingReceives();
    return all.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  static async get(id: string): Promise<PendingReceiveRecord | null> {
    const all = await Storage.loadPendingReceives();
    return all.find((p) => p.id === id) ?? null;
  }

  static async add(input: Omit<PendingReceiveRecord, 'id' | 'createdAt'>): Promise<PendingReceiveRecord> {
    const all = await Storage.loadPendingReceives();
    const record: PendingReceiveRecord = { id: Wallet.createId(), createdAt: new Date().getTime(), ...input };
    all.push(record);
    await Storage.savePendingReceives(all);
    return record;
  }

  static async remove(id: string) {
    const all = await Storage.loadPendingReceives();
    await Storage.savePendingReceives(all.filter((p) => p.id !== id));
  }
}

// 送受信履歴(TransactionWrapper)に付ける会計用のメモ・タグ。同じtxハッシュに複数の転送が
// 含まれることがあるため、チェーン・ハッシュ・通貨・送受信の向きの組でキーを作る。
export class TxAnnotationsHelper {
  static makeKey(chain: string, hash: string, currencySymbol: string, isReception: boolean): string {
    return `${chain}:${hash}:${currencySymbol}:${isReception ? 'in' : 'out'}`.toLowerCase();
  }

  static async getAll(): Promise<Record<string, TxAnnotationRecord>> {
    return Storage.loadTxAnnotations();
  }

  /** Saves the tag/memo for one transaction; an empty tag + empty memo removes the entry. */
  static async set(key: string, record: TxAnnotationRecord) {
    const all = await Storage.loadTxAnnotations();
    if (record.tag === '' && record.memo === '' && !record.category) {
      delete all[key];
    } else {
      all[key] = record;
    }
    await Storage.saveTxAnnotations(all);
  }
}

export const DEFAULT_ISSUER_PROFILE: IssuerProfile = {
  name: '',
  registrationNumber: '',
  address: '',
  phone: '',
  email: '',
  numberPrefix: 'INV-',
  receiptPrefix: 'RCT-',
  defaultTaxMode: 'excl',
  defaultRounding: 'floor',
  defaultDueDays: 14,
  defaultNote: '',
  baseUrl: '',
  seq: {},
};

export class IssuerProfileHelper {
  /** The saved profile merged over the defaults, so callers never see a missing field. */
  static async get(): Promise<IssuerProfile> {
    const saved = await Storage.loadIssuerProfile();
    return { ...DEFAULT_ISSUER_PROFILE, ...saved, seq: { ...saved?.seq } };
  }

  /** Saves everything except the serial counters, which only reserveNumber() may advance. */
  static async save(input: Omit<IssuerProfile, 'seq'>) {
    const current = await IssuerProfileHelper.get();
    await Storage.saveIssuerProfile({ ...current, ...input, seq: current.seq });
  }

  private static format(profile: IssuerProfile, kind: 'invoice' | 'receipt', year: number, serial: number): string {
    const prefix = kind === 'invoice' ? profile.numberPrefix : profile.receiptPrefix;
    return `${prefix}${year}-${String(serial).padStart(4, '0')}`;
  }

  /** The number the next invoice/receipt would get, without consuming it (for form previews). */
  static async peekNumber(kind: 'invoice' | 'receipt', year: number): Promise<string> {
    const profile = await IssuerProfileHelper.get();
    return IssuerProfileHelper.format(profile, kind, year, (profile.seq[`${kind}:${year}`] ?? 0) + 1);
  }

  /** Consumes and returns the next invoice/receipt number. Call only once it will really be used. */
  static async reserveNumber(kind: 'invoice' | 'receipt', year: number): Promise<string> {
    const profile = await IssuerProfileHelper.get();
    const key = `${kind}:${year}`;
    const serial = (profile.seq[key] ?? 0) + 1;
    profile.seq[key] = serial;
    await Storage.saveIssuerProfile(profile);
    return IssuerProfileHelper.format(profile, kind, year, serial);
  }
}

export class InvoicesHelper {
  /** Every invoice, most recently issued first. */
  static async list(): Promise<InvoiceRecord[]> {
    const all = await Storage.loadInvoices();
    return all.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  static async get(id: string): Promise<InvoiceRecord | null> {
    const all = await Storage.loadInvoices();
    return all.find((r) => r.id === id) ?? null;
  }

  static async add(input: Omit<InvoiceRecord, 'id' | 'createdAt'>): Promise<InvoiceRecord> {
    const all = await Storage.loadInvoices();
    const record: InvoiceRecord = { id: Wallet.createId(), createdAt: new Date().getTime(), ...input };
    all.push(record);
    await Storage.saveInvoices(all);
    return record;
  }

  static async update(id: string, patch: Partial<Omit<InvoiceRecord, 'id'>>): Promise<InvoiceRecord | null> {
    const all = await Storage.loadInvoices();
    const index = all.findIndex((r) => r.id === id);
    if (index < 0) return null;
    all[index] = { ...all[index], ...patch };
    await Storage.saveInvoices(all);
    return all[index];
  }

  static async remove(id: string) {
    const all = await Storage.loadInvoices();
    await Storage.saveInvoices(all.filter((r) => r.id !== id));
  }

  /**
   * Marks an invoice paid and assigns it a receipt number. Idempotent: an already-paid
   * invoice keeps its original receipt number/date rather than being re-numbered.
   */
  static async markPaid(
    id: string,
    payment: { txHash?: string; from?: string; manual: boolean; timestampMs?: number },
  ): Promise<InvoiceRecord | null> {
    const current = await InvoicesHelper.get(id);
    if (!current) return null;
    if (current.status === 'paid') return current;
    const paidAt = payment.timestampMs ?? new Date().getTime();
    const paidDate = new Date(paidAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const receiptNumber = await IssuerProfileHelper.reserveNumber('receipt', paidDate.getFullYear());
    return InvoicesHelper.update(id, {
      status: 'paid',
      paidAt,
      paidTxHash: payment.txHash,
      paidFrom: payment.from,
      paidManually: payment.manual,
      receiptNumber,
      receiptDate: `${paidDate.getFullYear()}-${pad(paidDate.getMonth() + 1)}-${pad(paidDate.getDate())}`,
    });
  }
}

const MAX_SCHEDULE_HISTORY = 36;
// An approval that was handed to the send job but never reported back (tab closed mid-send, ...)
// stops blocking the occurrence after this long.
const IN_FLIGHT_TTL_MS = 10 * 60 * 1000;

export class ScheduledPaymentsHelper {
  /** All schedules of one wallet, soonest due first (paused/completed ones last). */
  static async listFor(walletAddress: string): Promise<ScheduledPaymentRecord[]> {
    const all = await Storage.loadScheduledPayments();
    const mine = all.filter((r) => r.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    const rank = (r: ScheduledPaymentRecord) => (r.status === 'active' ? 0 : r.status === 'paused' ? 1 : 2);
    return mine.sort((a, b) => rank(a) - rank(b) || a.nextDue.localeCompare(b.nextDue));
  }

  static async get(id: string): Promise<ScheduledPaymentRecord | null> {
    const all = await Storage.loadScheduledPayments();
    return all.find((r) => r.id === id) ?? null;
  }

  static async add(input: Omit<ScheduledPaymentRecord, 'id' | 'createdAt' | 'history'>): Promise<ScheduledPaymentRecord> {
    const all = await Storage.loadScheduledPayments();
    const record: ScheduledPaymentRecord = { id: Wallet.createId(), createdAt: new Date().getTime(), history: [], ...input };
    all.push(record);
    await Storage.saveScheduledPayments(all);
    return record;
  }

  static async update(id: string, patch: Partial<Omit<ScheduledPaymentRecord, 'id'>>): Promise<ScheduledPaymentRecord | null> {
    const all = await Storage.loadScheduledPayments();
    const index = all.findIndex((r) => r.id === id);
    if (index < 0) return null;
    all[index] = { ...all[index], ...patch };
    await Storage.saveScheduledPayments(all);
    return all[index];
  }

  static async remove(id: string) {
    const all = await Storage.loadScheduledPayments();
    await Storage.saveScheduledPayments(all.filter((r) => r.id !== id));
  }

  /** True while an approval of this occurrence is still being sent (see inFlightDue). */
  static isInFlight(record: ScheduledPaymentRecord, now: number = new Date().getTime()): boolean {
    return record.inFlightDue === record.nextDue && record.inFlightAt !== undefined && now - record.inFlightAt < IN_FLIGHT_TTL_MS;
  }

  /** Marks the current occurrence as handed to the send job. */
  static async markInFlight(id: string): Promise<ScheduledPaymentRecord | null> {
    const record = await ScheduledPaymentsHelper.get(id);
    if (!record) return null;
    return ScheduledPaymentsHelper.update(id, { inFlightDue: record.nextDue, inFlightAt: new Date().getTime() });
  }

  /** The send never got out: let the occurrence be approved again straight away. */
  static async clearInFlight(id: string) {
    await ScheduledPaymentsHelper.update(id, { inFlightDue: undefined, inFlightAt: undefined });
  }

  /**
   * Settles the occurrence due on `due` (paid, or skipped) and moves the schedule on. Does
   * nothing if `due` is no longer the schedule's current occurrence, so a late/duplicate
   * callback can't advance it twice.
   */
  static async settle(
    id: string,
    due: string,
    result: { txHash?: string; skipped?: boolean },
    advance: (r: ScheduledPaymentRecord) => { nextDue: string; status: 'active' | 'completed' },
  ): Promise<ScheduledPaymentRecord | null> {
    const record = await ScheduledPaymentsHelper.get(id);
    if (!record || record.nextDue !== due || record.status === 'completed') return record;
    const next = advance(record);
    const entry: ScheduledPaymentHistoryEntry = { due, at: new Date().getTime(), ...result };
    return ScheduledPaymentsHelper.update(id, {
      nextDue: next.nextDue,
      status: next.status,
      inFlightDue: undefined,
      inFlightAt: undefined,
      history: [entry, ...record.history].slice(0, MAX_SCHEDULE_HISTORY),
    });
  }
}

const MAX_SENT_RECIPIENTS = 500;

/**
 * このアプリから送金した宛先の記録(アドレス詐欺対策の「送ったことがある相手」)と、
 * 取得済みの履歴から切り出した相手ごとの記録(0円/少額を送りつけてきた相手の判定用)。
 * どちらも端末内だけに保存し、外には送らない。
 */
export class RecipientSafetyHelper {
  static async listSent(): Promise<SentRecipient[]> {
    return Storage.loadSentRecipients();
  }

  /** 送金がネットワークへ出た時に呼ぶ。同じ宛先・同じ鎖なら回数と日時だけ更新する。 */
  static async recordSent(address: string, chain: string) {
    const target = address.toLowerCase();
    const all = await Storage.loadSentRecipients();
    const now = new Date().getTime();
    const found = all.find((r) => r.address.toLowerCase() === target && r.chain === chain);
    if (found) {
      found.count += 1;
      found.lastAt = now;
    } else {
      all.push({ address: target, chain, count: 1, lastAt: now });
    }
    all.sort((a, b) => b.lastAt - a.lastAt);
    await Storage.saveSentRecipients(all.slice(0, MAX_SENT_RECIPIENTS));
  }

  static async listPeers(walletAddress: string): Promise<PeerEvent[]> {
    return Storage.loadPeerEvents(walletAddress);
  }

  static async rememberPeers(walletAddress: string, fresh: PeerEvent[]) {
    if (fresh.length === 0) return;
    const existing = await Storage.loadPeerEvents(walletAddress);
    await Storage.savePeerEvents(walletAddress, mergePeerEvents(existing, fresh));
  }
}
