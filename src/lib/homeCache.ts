import type { ChainKey } from './chains';
import type { TransactionWrapper } from './transactionWrapper';

/**
 * In-memory (not persisted to localStorage - a full app reload/relaunch is expected to
 * refetch from scratch, same as before) cache of everything Home.tsx renders, keyed by
 * wallet address + 表示通貨 (JPY/USD). Lets Home show its last-known data immediately when
 * navigating back to it - no loading spinners - while Home's `update` still kicks off a
 * fresh fetch in the background every time it mounts and silently corrects the screen (and
 * this cache) once that resolves, so the person still sees real-time data, just without
 * waiting for it first.
 */
export interface HomeCacheEntry {
  nativeBalance: string;
  jpycBalance: string;
  usdcBalance: string;
  totalJpyBalance: number;
  recentTransactions: TransactionWrapper[];
  peerNames: Record<string, string>;
  totalAssetsDisplay: number;
  chainBalances: Record<ChainKey, { jpyc: string; usdc: string }>;
}

let cache: { key: string; entry: HomeCacheEntry } | null = null;

function cacheKey(walletAddress: string, displayCurrency: string): string {
  return `${walletAddress}:${displayCurrency}`;
}

export function getHomeCache(walletAddress: string, displayCurrency: string): HomeCacheEntry | null {
  if (cache == null || cache.key !== cacheKey(walletAddress, displayCurrency)) return null;
  return cache.entry;
}

export function setHomeCache(walletAddress: string, displayCurrency: string, entry: HomeCacheEntry): void {
  cache = { key: cacheKey(walletAddress, displayCurrency), entry };
}
