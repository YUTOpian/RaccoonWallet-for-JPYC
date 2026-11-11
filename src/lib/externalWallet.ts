import { ethers } from 'ethers';
import { CHAINS } from './chains';
import type { ChainKey } from './chains';

// MetaMask / Bitget Wallet の「ブラウザ拡張」(EIP-1193 の window.ethereum 系プロバイダー)
// に接続するための薄いラッパー。秘密鍵はこのアプリに一切渡らず、署名は都度ウォレット側の
// ポップアップで承認される。

export type ExternalWalletKind = 'metamask' | 'bitget';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  isMetaMask?: boolean;
  isBitKeep?: boolean;
  isBitget?: boolean;
  providers?: Eip1193Provider[];
}

interface Eip6963Detail {
  info: { rdns: string; name: string };
  provider: Eip1193Provider;
}

export type ExternalWalletErrorCode =
  | 'not_installed'
  | 'rejected'
  | 'account_mismatch'
  | 'switch_failed'
  | 'unknown';

export class ExternalWalletError extends Error {
  code: ExternalWalletErrorCode;
  constructor(code: ExternalWalletErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

function isBitget(p: Eip1193Provider): boolean {
  return !!(p.isBitKeep || p.isBitget);
}

// Bitget Wallet は互換性のために isMetaMask=true を名乗ることがあるため、Bitget 系の
// フラグが立っているものは MetaMask 扱いしない。
function isRealMetaMask(p: Eip1193Provider): boolean {
  return !!p.isMetaMask && !isBitget(p);
}

function discoverEip6963(timeoutMs = 300): Promise<Eip6963Detail[]> {
  return new Promise((resolve) => {
    const found: Eip6963Detail[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.provider && detail.info) {
        found.push(detail);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(found);
    }, timeoutMs);
  });
}

/** 指定のウォレット拡張のプロバイダーを探す。見つからなければ null。 */
export async function findExternalProvider(kind: ExternalWalletKind): Promise<Eip1193Provider | null> {
  const announced = await discoverEip6963();
  if (kind === 'metamask') {
    const hit = announced.find((d) => /^io\.metamask/i.test(d.info.rdns));
    if (hit) return hit.provider;
  } else {
    const hit = announced.find((d) => /bitget|bitkeep/i.test(d.info.rdns));
    if (hit) return hit.provider;
  }

  // EIP-6963 に未対応の拡張向けのフォールバック。
  const w = window as unknown as {
    ethereum?: Eip1193Provider;
    bitget?: { ethereum?: Eip1193Provider };
    bitkeep?: { ethereum?: Eip1193Provider };
  };
  if (kind === 'bitget') {
    const direct = w.bitget?.ethereum ?? w.bitkeep?.ethereum;
    if (direct) return direct;
  }
  const candidates = [...(w.ethereum?.providers ?? []), ...(w.ethereum ? [w.ethereum] : [])];
  return candidates.find((p) => (kind === 'bitget' ? isBitget(p) : isRealMetaMask(p))) ?? null;
}

function toWalletError(e: unknown): ExternalWalletError {
  if (e instanceof ExternalWalletError) return e;
  const code = (e as { code?: number | string } | null)?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') {
    return new ExternalWalletError('rejected');
  }
  return new ExternalWalletError('unknown', (e as Error | null)?.message);
}

/** ウォレット拡張に接続を求め、選択されたアカウントのアドレス(チェックサム形式)を返す。 */
export async function connectExternalWallet(kind: ExternalWalletKind): Promise<string> {
  const provider = await findExternalProvider(kind);
  if (!provider) {
    throw new ExternalWalletError('not_installed');
  }
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new ExternalWalletError('rejected');
    }
    return ethers.getAddress(accounts[0]);
  } catch (e) {
    throw toWalletError(e);
  }
}

export interface ChainTarget {
  chainId: number;
  name: string;
  rpcUrl: string;
  symbol: string;
  decimals: number;
  blockExplorerUrl?: string;
}

export function chainTargetFromKey(chain: ChainKey): ChainTarget {
  const c = CHAINS[chain];
  return {
    chainId: c.chainId,
    name: c.name,
    rpcUrl: c.rpcUrls[0],
    symbol: c.nativeCurrency.symbol,
    decimals: c.nativeCurrency.decimals,
    blockExplorerUrl: c.blockExplorerUrl,
  };
}

async function switchChain(provider: Eip1193Provider, target: ChainTarget): Promise<void> {
  const hexChainId = ethers.toQuantity(target.chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
  } catch (e) {
    const err = e as { code?: number; data?: { originalError?: { code?: number } } } | null;
    const unknownChain = err?.code === 4902 || err?.data?.originalError?.code === 4902;
    if (!unknownChain) {
      throw toWalletError(e);
    }
    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexChainId,
          chainName: target.name,
          rpcUrls: [target.rpcUrl],
          nativeCurrency: { name: target.symbol, symbol: target.symbol, decimals: target.decimals },
          ...(target.blockExplorerUrl ? { blockExplorerUrls: [target.blockExplorerUrl] } : {}),
        }],
      });
    } catch (addError) {
      const wrapped = toWalletError(addError);
      throw wrapped.code === 'rejected' ? wrapped : new ExternalWalletError('switch_failed', wrapped.message);
    }
  }
}

/**
 * 送金・スワップ用の署名者を用意する: ①拡張側で保存済みアドレスと同じアカウントが選ばれて
 * いるか確認 → ②必要なネットワークへ切り替え → ③ethers の Signer を返す。
 * 署名・送信のたびにウォレット側で承認ポップアップが出る。
 */
export async function getExternalSigner(
  kind: ExternalWalletKind,
  expectedAddress: string,
  target: ChainTarget,
): Promise<ethers.Signer> {
  const provider = await findExternalProvider(kind);
  if (!provider) {
    throw new ExternalWalletError('not_installed');
  }
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts?.some((a) => a.toLowerCase() === expectedAddress.toLowerCase())) {
      throw new ExternalWalletError('account_mismatch');
    }
    await switchChain(provider, target);
    // ネットワーク切り替えの後に作り直す(切り替え前の BrowserProvider は古いチェーンを覚えている)。
    const browserProvider = new ethers.BrowserProvider(provider as ethers.Eip1193Provider);
    return await browserProvider.getSigner(expectedAddress);
  } catch (e) {
    throw toWalletError(e);
  }
}

/**
 * ウォレット拡張側に残っている「このサイトへの接続許可」を取り消す(EIP-2255 の
 * wallet_revokePermissions)。ログアウト時に呼ぶ。
 *
 * - 取り消しに対応していない拡張・古いバージョンでは何も起きない(エラーは握りつぶす)。
 * - 拡張のポップアップが応答しなくてもログアウト自体が止まらないよう、タイムアウトを設ける。
 * - 戻り値は「拡張側の接続許可を取り消せたか」。false の場合は拡張の
 *   「接続済みサイト」から手動で外してもらう必要がある。
 */
export async function disconnectExternalWallet(kind: ExternalWalletKind, timeoutMs = 3000): Promise<boolean> {
  try {
    const provider = await findExternalProvider(kind);
    if (!provider) return false;
    const revoke = provider
      .request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
      .then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return await Promise.race([revoke, timeout]);
  } catch {
    return false;
  }
}

export function isExternalWalletError(e: unknown): e is ExternalWalletError {
  return e instanceof ExternalWalletError;
}
