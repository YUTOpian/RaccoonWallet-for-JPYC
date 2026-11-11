/**
 * アドレス詐欺対策の判定(画面・通信から切り離した純粋なロジック)。
 *
 * 想定している手口:
 *  - アドレスポイズニング: 攻撃者が、こちらがよく送る相手と「先頭と末尾の数文字が同じ」アドレスを
 *    作り、0円/少額を送りつけて履歴に紛れ込ませる。履歴からコピーすると偽アドレスに送ってしまう。
 *  - 初めての相手・打ち間違い・貼り間違い
 *  - 違うネットワークへの送金(アドレス帳に登録した相手のチェーンと、いま送ろうとしているチェーンが違う)
 *  - トークンのコントラクトや焼却アドレスへの送金(戻ってこない)
 *
 * 判定はすべて端末内のデータ(アドレス帳・このアプリから送った相手・取得済みの履歴)だけで行い、
 * 外部サービスには何も送らない。「安全」と断定はしない: 警告が出ないことは安全の保証ではない。
 */

export type SafetyLevel = 'safe' | 'notice' | 'warn' | 'danger';

export type SafetyReason =
  | 'invalid_address'
  | 'burn_address' // 0x000…0 / 0x…dEaD: 送ると回収できない
  | 'token_contract' // トークンのコントラクト自身: 送ると回収できない
  | 'lookalike' // 登録済み/送信済みのアドレスと先頭・末尾が似ているのに別のアドレス
  | 'chain_mismatch' // アドレス帳では別のネットワークで登録されている
  | 'dust_sender' // 0円/少額を送ってきただけの相手(ポイズニングの典型)
  | 'first_time' // アドレス帳にも送信履歴にもない
  | 'self'; // 自分のアドレス宛て

export interface SafetyContactWallet {
  chain: string; // 'polygon' や 'custom:xxx'
  address: string;
}

export interface SafetyContact {
  id: string;
  name: string;
  wallets: SafetyContactWallet[];
}

/** このアプリから送ったことのある宛先。 */
export interface SentRecipient {
  address: string;
  chain: string;
  count: number;
  lastAt: number;
}

/** 取得済みの履歴から切り出した、相手ごとの1件ぶん(端末内に保存される)。 */
export interface PeerEvent {
  address: string;
  direction: 'in' | 'out';
  /** 通貨の単位での数量(JPYC なら円)。 */
  amount: number;
  symbol: string;
  chain?: string;
  at: number; // ms
}

export interface LookalikeMatch {
  address: string;
  /** 似ている相手の名前(アドレス帳)。送信履歴だけの場合は null。 */
  label: string | null;
  source: 'contact' | 'sent';
}

export interface SafetyInput {
  to: string;
  /** 送ろうとしているネットワーク('polygon' / 'custom:xxx')。 */
  chain: string;
  /** 自分のアドレス(自分宛て判定用)。 */
  self?: string | null;
  contacts: SafetyContact[];
  sent: SentRecipient[];
  peers: PeerEvent[];
  /** 送ると戻らないアドレス(各鎖のトークンコントラクトなど)。小文字。 */
  tokenContracts?: ReadonlySet<string>;
}

export interface SafetyAssessment {
  level: SafetyLevel;
  reasons: SafetyReason[];
  /** アドレス帳に登録済みの相手(名前)。 */
  contactName: string | null;
  /** その相手がこのアドレスで登録しているネットワーク。 */
  contactChains: string[];
  /** 過去にこのアプリから送ったことがある(アドレス帳になくても)。 */
  sentBefore: boolean;
  /** このアドレスから受け取ったことがある。 */
  receivedBefore: boolean;
  lookalike: LookalikeMatch | null;
  /** 確認のチェックを入れないと送れないようにするか。 */
  requiresAck: boolean;
}

/** 先頭(0xの後)と末尾が何文字そろったら「似ている」とみなすか。多くのウォレットが 0x1234…abcd と省略表示する長さ。 */
export const LOOKALIKE_PREFIX = 4;
export const LOOKALIKE_SUFFIX = 4;
/** これ以下の受け取りしかない相手は「少額を送りつけてきただけ」とみなす(通貨の単位で)。 */
export const DUST_LIMIT = 1;

export const BURN_ADDRESSES: ReadonlySet<string> = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

const norm = (address: string) => address.trim().toLowerCase();
const isHexAddress = (address: string) => /^0x[0-9a-f]{40}$/.test(address);

/** 同じアドレスではないが、先頭と末尾が似ているか。 */
export function isLookalike(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!isHexAddress(x) || !isHexAddress(y) || x === y) return false;
  const body = (s: string) => s.slice(2);
  const bx = body(x);
  const by = body(y);
  return bx.slice(0, LOOKALIKE_PREFIX) === by.slice(0, LOOKALIKE_PREFIX) && bx.slice(-LOOKALIKE_SUFFIX) === by.slice(-LOOKALIKE_SUFFIX);
}

const SEVERITY: Record<SafetyLevel, number> = { safe: 0, notice: 1, warn: 2, danger: 3 };

export function assessAddress(input: SafetyInput): SafetyAssessment {
  const to = norm(input.to);
  const result: SafetyAssessment = {
    level: 'safe',
    reasons: [],
    contactName: null,
    contactChains: [],
    sentBefore: false,
    receivedBefore: false,
    lookalike: null,
    requiresAck: false,
  };
  const raise = (level: SafetyLevel, reason: SafetyReason) => {
    result.reasons.push(reason);
    if (SEVERITY[level] > SEVERITY[result.level]) result.level = level;
  };

  if (!isHexAddress(to)) {
    raise('danger', 'invalid_address');
    result.requiresAck = true;
    return result;
  }

  // 戻ってこない宛先は、ほかの判定より先に最優先で止める。
  if (BURN_ADDRESSES.has(to)) raise('danger', 'burn_address');
  if (input.tokenContracts?.has(to)) raise('danger', 'token_contract');

  if (input.self && norm(input.self) === to) raise('notice', 'self');

  // アドレス帳
  const matched = input.contacts.filter((c) => c.wallets.some((w) => norm(w.address) === to));
  if (matched.length > 0) {
    result.contactName = matched[0].name;
    result.contactChains = [...new Set(matched.flatMap((c) => c.wallets.filter((w) => norm(w.address) === to).map((w) => w.chain)))];
    // アドレスは同じでもネットワークごとに受け取れるかは別(取引所・カストディ等)。登録と違う鎖なら確認させる。
    if (!result.contactChains.includes(input.chain)) raise('warn', 'chain_mismatch');
  }

  const sentRecord = input.sent.find((s) => norm(s.address) === to);
  // 0円の「送信」は本人が送ったものではない(transferFrom で偽装できる)ので、送ったことの証拠にしない。
  const outgoing = input.peers.filter((p) => p.direction === 'out' && p.amount > 0 && norm(p.address) === to);
  const incoming = input.peers.filter((p) => p.direction === 'in' && norm(p.address) === to);
  result.sentBefore = sentRecord !== undefined || outgoing.length > 0;
  result.receivedBefore = incoming.length > 0;
  const known = result.contactName !== null || result.sentBefore;

  // 似たアドレス: アドレス帳の相手とは常に比べる。送信履歴の相手とは、宛先がまだ未知の時だけ比べる
  // (すでに送ったことのある宛先そのものを「似ている」と言わないため)。
  const candidates: LookalikeMatch[] = [];
  for (const c of input.contacts) {
    for (const w of c.wallets) if (isLookalike(to, w.address)) candidates.push({ address: w.address, label: c.name, source: 'contact' });
  }
  if (result.contactName === null) {
    const trusted = new Set<string>([...input.sent.map((s) => norm(s.address)), ...input.peers.filter((p) => p.direction === 'out' && p.amount > 0).map((p) => norm(p.address))]);
    for (const a of trusted) if (isLookalike(to, a)) candidates.push({ address: a, label: null, source: 'sent' });
  }
  if (candidates.length > 0) {
    // 名前のある相手を優先して見せる。
    result.lookalike = candidates.find((c) => c.source === 'contact') ?? candidates[0];
    raise('danger', 'lookalike');
  }

  // 0円/少額を送ってきただけで、こちらからは送ったことがない相手。
  const spoofedOut = input.peers.some((p) => p.direction === 'out' && p.amount <= 0 && norm(p.address) === to);
  if (!known && ((incoming.length > 0 && incoming.every((p) => p.amount <= DUST_LIMIT)) || spoofedOut)) raise('warn', 'dust_sender');

  if (!known) raise('warn', 'first_time');

  result.requiresAck = result.level === 'warn' || result.level === 'danger';
  return result;
}

/** 2つのアドレスを文字位置で比べ、違う文字に印を付けた区切りで返す(見比べやすくするため)。 */
export function diffSegments(base: string, other: string): { text: string; differs: boolean }[] {
  const a = base.trim();
  const b = other.trim();
  const out: { text: string; differs: boolean }[] = [];
  for (let i = 0; i < a.length; i++) {
    const differs = a[i].toLowerCase() !== (b[i] ?? '').toLowerCase();
    const last = out[out.length - 1];
    if (last && last.differs === differs) last.text += a[i];
    else out.push({ text: a[i], differs });
  }
  return out;
}

/** 4文字ずつに区切る(0x は別扱い)。読み合わせ・見比べ用。 */
export function chunkAddress(address: string): string[] {
  const a = address.trim();
  const body = a.startsWith('0x') || a.startsWith('0X') ? a.slice(2) : a;
  const chunks = body.match(/.{1,4}/g) ?? [];
  return [a.slice(0, a.length - body.length), ...chunks].filter((c) => c !== '');
}

/** 履歴から相手ごとの記録を作る時に、保存しすぎないための上限。 */
export const MAX_PEER_EVENTS = 400;

/** 新しい履歴を既存の記録にまとめ、新しい順に上限まで残す(同じ取引は重複させない)。 */
export function mergePeerEvents(existing: PeerEvent[], fresh: PeerEvent[], limit: number = MAX_PEER_EVENTS): PeerEvent[] {
  const key = (e: PeerEvent) => `${norm(e.address)}|${e.direction}|${e.at}|${e.amount}|${e.symbol}|${e.chain ?? ''}`;
  const seen = new Set<string>();
  const merged: PeerEvent[] = [];
  for (const e of [...fresh, ...existing]) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({ ...e, address: norm(e.address) });
  }
  return merged.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * 履歴の1行が怪しいか: 未登録・未送信の相手からの少額/0円の受け取り、自分から出たことになっている0円の送信
 * (偽装できる)、または登録済みの相手に似たアドレス。
 */
export function isSuspiciousTransfer(
  event: Pick<PeerEvent, 'address' | 'direction' | 'amount'>,
  context: { contacts: SafetyContact[]; sent: SentRecipient[]; peers: PeerEvent[] },
): boolean {
  const a = assessAddress({ to: event.address, chain: '', contacts: context.contacts, sent: context.sent, peers: context.peers });
  if (a.contactName !== null || a.sentBefore) return false;
  if (a.lookalike !== null) return true;
  return event.amount <= DUST_LIMIT;
}
