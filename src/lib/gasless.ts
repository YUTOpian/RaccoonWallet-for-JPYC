import { ethers } from 'ethers';
import { CHAINS, getJpycDecimals, getProvider, withRpcFallback } from './chains';
import type { ChainKey } from './chains';
import type { SignerSource } from './signer';

/**
 * ガスレス送金 (EIP-3009 transferWithAuthorization)。
 *
 * JPYC v2 は、送る人が「この宛先へこの金額を送ってよい」という EIP-712 署名を作り、
 * 誰か(リレイヤー)がその署名を持ってコントラクトを呼べば送金できる仕組みを持っている。
 * 送る人はガス代用のETH/POL/AVAXが不要になり、ガス代はリレイヤーが払う。
 *
 * このアプリにサーバは無いので、リレイヤーは別途用意するもの(relayer/ にサンプルあり)。
 * 署名には宛先・金額・有効期限・nonce が含まれるため、リレイヤー(や通信路)が宛先や金額を
 * 書き換えることはできない。できるのは「送る」か「送らない/遅らせる」だけ。
 */

export type GaslessErrorCode =
  | 'unsupported' // この鎖のJPYCがEIP-3009の署名形式に対応していない(ドメイン不一致など)
  | 'relayer_unreachable'
  | 'relayer_rejected'
  | 'timeout'
  | 'reverted';

export class GaslessError extends Error {
  code: GaslessErrorCode;
  detail: string;
  constructor(code: GaslessErrorCode, detail = '') {
    super(detail || code);
    this.code = code;
    this.detail = detail;
  }
}

export function isGaslessError(e: unknown): e is GaslessError {
  return e instanceof GaslessError;
}

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
];

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** 署名の有効時間。短くして、使われないまま残る署名のリスクを小さくする。 */
export const AUTHORIZATION_TTL_SECONDS = 60 * 60;

export interface AuthorizationPayload {
  chainId: number;
  token: string;
  from: string;
  to: string;
  value: string; // 最小単位(wei)の10進文字列
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
}

const domainCache = new Map<ChainKey, ethers.TypedDataDomain>();

/**
 * EIP-712 ドメインをコントラクトから読み、DOMAIN_SEPARATOR と一致することを確かめてから返す。
 * 一致しない(想定と違う署名形式)なら、署名を作らずに 'unsupported' で止める。
 */
export async function getJpycDomain(chain: ChainKey): Promise<ethers.TypedDataDomain> {
  const cached = domainCache.get(chain);
  if (cached) return cached;
  const config = CHAINS[chain];
  try {
    const { name, version, separator } = await withRpcFallback(chain, async (provider) => {
      const token = new ethers.Contract(config.jpycAddress, TOKEN_ABI, provider);
      const [name, separator] = await Promise.all([token.name() as Promise<string>, token.DOMAIN_SEPARATOR() as Promise<string>]);
      let version = '1';
      try {
        version = (await token.version()) as string;
      } catch {
        // version() が無い実装では、慣例どおり "1" を試す(下で DOMAIN_SEPARATOR と照合する)。
      }
      return { name, version, separator };
    });
    const domain: ethers.TypedDataDomain = { name, version, chainId: config.chainId, verifyingContract: config.jpycAddress };
    if (ethers.TypedDataEncoder.hashDomain(domain).toLowerCase() !== separator.toLowerCase()) {
      throw new GaslessError('unsupported', 'DOMAIN_SEPARATOR mismatch');
    }
    domainCache.set(chain, domain);
    return domain;
  } catch (e) {
    if (isGaslessError(e)) throw e;
    throw new GaslessError('unsupported', e instanceof Error ? e.message : String(e));
  }
}

export interface TransferAuthorizationInput {
  domain: ethers.TypedDataDomain;
  from: string;
  to: string;
  value: bigint;
  /** 秒。省略時は now から AUTHORIZATION_TTL_SECONDS 後。 */
  validBefore?: number;
  nonce?: string;
  nowSeconds?: number;
}

export function buildAuthorizationMessage(input: TransferAuthorizationInput) {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    from: input.from,
    to: input.to,
    value: input.value,
    validAfter: 0,
    validBefore: input.validBefore ?? now + AUTHORIZATION_TTL_SECONDS,
    nonce: input.nonce ?? ethers.hexlify(ethers.randomBytes(32)),
  };
}

/** 署名者(秘密鍵 or MetaMask等の Signer)で TransferWithAuthorization に署名する。 */
export async function signTransferAuthorization(
  chain: ChainKey,
  source: SignerSource,
  to: string,
  amount: string,
): Promise<AuthorizationPayload> {
  const config = CHAINS[chain];
  const domain = await getJpycDomain(chain);
  const decimals = await getJpycDecimals(chain);
  const value = ethers.parseUnits(amount, decimals);
  const signer = typeof source === 'string' ? new ethers.Wallet(source) : source;
  const from = await signer.getAddress();
  const message = buildAuthorizationMessage({ domain, from, to, value });
  const signature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, message);
  return {
    chainId: config.chainId,
    token: config.jpycAddress,
    from,
    to,
    value: value.toString(),
    validAfter: message.validAfter,
    validBefore: message.validBefore,
    nonce: message.nonce,
    signature,
  };
}

// --- リレイヤーとの通信 ---------------------------------------------------------------------

/** 設定欄に入力されたURLを整える。https(開発用に localhost だけ http)以外は null。 */
export function normalizeRelayerUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  return url.toString().replace(/\/+$/, '');
}

async function fetchJson(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    throw new GaslessError((e as { name?: string } | null)?.name === 'AbortError' ? 'timeout' : 'relayer_unreachable', e instanceof Error ? e.message : '');
  } finally {
    clearTimeout(timer);
  }
}

export interface RelayerInfo {
  /** リレイヤーが扱えるチェーンID。 */
  chains: number[];
}

const infoCache = new Map<string, { at: number; info: RelayerInfo | null }>();
const INFO_TTL_MS = 60_000;

/** リレイヤーの対応状況。つながらない/形式が違う場合は null。 */
export async function fetchRelayerInfo(relayerUrl: string, force = false): Promise<RelayerInfo | null> {
  const cached = infoCache.get(relayerUrl);
  if (!force && cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info;
  let info: RelayerInfo | null = null;
  try {
    const { status, body } = await fetchJson(`${relayerUrl}/info`, undefined, 8000);
    if (status === 200 && Array.isArray(body?.chains) && body.chains.every((c: unknown) => Number.isInteger(c))) {
      info = { chains: body.chains as number[] };
    }
  } catch {
    info = null;
  }
  infoCache.set(relayerUrl, { at: Date.now(), info });
  return info;
}

/** 署名をリレイヤーに渡して送金してもらい、送信された取引のハッシュを返す。 */
export async function submitToRelayer(relayerUrl: string, payload: AuthorizationPayload): Promise<string> {
  const { status, body } = await fetchJson(
    `${relayerUrl}/relay`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    30_000,
  );
  if (status === 200 && typeof body?.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return body.txHash;
  }
  throw new GaslessError('relayer_rejected', typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
}

/** リレイヤーが出した取引が取り込まれるのを待つ。失敗(revert)なら例外。 */
export async function waitForRelayedTx(chain: ChainKey, txHash: string) {
  const receipt = await getProvider(chain).waitForTransaction(txHash, 1, 180_000);
  if (receipt === null) throw new GaslessError('timeout');
  if (receipt.status === 0) throw new GaslessError('reverted', txHash);
  return receipt;
}
