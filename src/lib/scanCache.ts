import localForage from 'localforage';

/**
 * Persistent incremental-scan cache for the eth_getLogs-based history/discovery scans in
 * lib/chains.ts (JPYC transfer history) and lib/nft.ts (NFT auto-discovery).
 *
 * Without this, every screen load re-walks the same multi-thousand-block lookback window
 * from scratch, even when nothing has changed since the last visit. Caching the block range
 * already covered plus what was found in it means a normal "reopen the app" load only has to
 * scan the (usually tiny) number of blocks produced since the last visit, instead of the full
 * lookback window every time.
 */
export interface ScanCacheEntry<T> {
  /** Chain tip at the time of the last completed scan. The next scan resumes forward from here. */
  lastScannedBlock: number;
  /**
   * Deepest block this cache has walked backward to. 0 means the walk reached genesis (or as
   * far back as this app will ever look in one go). A value >0 means there may still be
   * older, not-yet-seen data further back, for a caller that ever needs more than what's
   * currently cached (e.g. TransactionList asking for more rows than Home ever needed).
   */
  oldestScannedBlock: number;
  items: T[];
}

const CACHE_PREFIX = 'RACCOON_SCAN_CACHE_';

export async function loadScanCache<T>(key: string): Promise<ScanCacheEntry<T> | null> {
  try {
    return (await localForage.getItem<ScanCacheEntry<T>>(CACHE_PREFIX + key)) ?? null;
  } catch {
    // A corrupt/unreadable cache entry should never block a fresh scan.
    return null;
  }
}

export async function saveScanCache<T>(key: string, entry: ScanCacheEntry<T>): Promise<void> {
  try {
    await localForage.setItem(CACHE_PREFIX + key, entry);
  } catch {
    // Best-effort — a failed cache write shouldn't fail the scan that produced it.
  }
}
