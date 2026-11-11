import { useCallback, useEffect, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { getProvider, getJpycDecimals, fetchRecentJpycTransfers, fetchRecentTokenTransfers } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { playCompletedSound, unlockSounds } from '../lib/sounds';

// Identifies a non-JPYC ERC-20 to watch instead of the default JPYC contract - currently only
// used to watch for USDC (QR Lab's 指定金額を受け取る / QRレジスター, when 表示通貨 is USD).
// Decimals is passed in rather than re-derived here since callers already have it from the
// curated TOKEN_LISTS entry (see lib/chains.ts's getUsdcTokenInfo).
export interface WatchedToken {
  address: string;
  decimals: number;
  symbol: string;
}

const POLL_INTERVAL_MS = 8000;

interface UseJpycPaymentWatcherResult {
  receivedAmount: Decimal;
  pollError: boolean;
  jpycDecimals: number;
  /**
   * Call once right before you start showing the payment QR (e.g. from a "発行" button
   * handler) to record the current block as this checkout's starting point and read the
   * JPYC contract's decimals. Resets receivedAmount/pollError and the counted-transfer set,
   * so a screen can be reused for a second checkout after the first one finishes. Returns
   * the starting block number, so a caller that needs to resume watching later (e.g. a
   * persisted "入金待ち" checkout reopened after navigating away — see
   * lib/storage.ts's PendingCheckoutRecord) can save it and pass it back in via
   * `resumeFromBlock` below instead of losing everything received while it was away.
   */
  startWatching: (resumeFromBlock?: number) => Promise<number>;
}

/**
 * Shared polling logic behind every "generate a JPYC payment QR, then watch the chain until
 * it's paid" screen in the app (MarketplaceCollect for 売り物リスト, QRGeneratorCollect for
 * QR Lab's 指定金額を受け取る, and QRRegister). Polls fetchRecentJpycTransfers on
 * `chain`/`address` while `active` is true, summing every reception seen since
 * startWatching() was last called, and calls `onFullyPaid` once the running total reaches
 * `amountDue`.
 *
 * Sums receptions across every poll (rather than looking for one single matching transfer)
 * so a buyer paying in installments (e.g. 4000円 as 2000円 × 2) is still detected correctly.
 */
export function useJpycPaymentWatcher(
  chain: ChainKey,
  address: string,
  amountDue: Decimal,
  active: boolean,
  onFullyPaid: () => void,
  // Omit/undefined (every pre-existing caller) watches JPYC, exactly as before.
  watchedToken?: WatchedToken,
): UseJpycPaymentWatcherResult {
  const [receivedAmount, setReceivedAmount] = useState(new Decimal(0));
  const [pollError, setPollError] = useState(false);
  const [jpycDecimals, setJpycDecimals] = useState(18);
  const tokenAddress = watchedToken?.address;
  const tokenDecimals = watchedToken?.decimals;
  const tokenSymbol = watchedToken?.symbol;

  // Tracked across polls without triggering re-renders themselves - the block the QR was
  // generated at (only transfers strictly after this count towards this checkout), the tx
  // hashes already counted (so a transfer already summed in isn't double-counted on the
  // next poll, since fetchRecentJpycTransfers always returns the recent window rather than
  // just what's new), and whether onFullyPaid has already fired for this checkout.
  const startBlockRef = useRef(0);
  const countedHashesRef = useRef<Set<string>>(new Set());
  const paidRef = useRef(false);

  const startWatching = useCallback(async (resumeFromBlock?: number) => {
    // 入金の検知は、この操作の何十秒~何分も後になる。ブラウザが後から音を鳴らせるよう、
    // 操作の中で今のうちに再生の許可を取っておく(iPhone の Safari 対策)。
    unlockSounds();
    if (resumeFromBlock !== undefined) {
      // Resuming a checkout created earlier (see PendingCheckoutRecord) - deliberately do
      // NOT re-read the current block here, since that would silently skip any payment
      // made while this screen wasn't mounted. Re-anchoring at the original start block
      // means the poll below naturally re-sums everything received since the checkout was
      // first shown, recovering the correct total from scratch.
      startBlockRef.current = resumeFromBlock;
    } else {
      try {
        startBlockRef.current = await getProvider(chain).getBlockNumber();
      } catch (e) {
        console.error('Failed to read starting block, watching from now with block 0', e);
        startBlockRef.current = 0;
      }
    }
    if (tokenDecimals !== undefined) {
      // Already known (from the curated token list) - no contract read needed.
      setJpycDecimals(tokenDecimals);
    } else {
      try {
        setJpycDecimals(await getJpycDecimals(chain));
      } catch (e) {
        console.error('Failed to read JPYC decimals, defaulting to 18', e);
        setJpycDecimals(18);
      }
    }
    countedHashesRef.current = new Set();
    paidRef.current = false;
    setReceivedAmount(new Decimal(0));
    setPollError(false);
    return startBlockRef.current;
  }, [chain, tokenDecimals]);

  useEffect(() => {
    if (!active || !address) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const transfers = tokenAddress && tokenDecimals !== undefined && tokenSymbol
          ? await fetchRecentTokenTransfers(chain, tokenAddress, tokenDecimals, tokenSymbol, address, 30)
          : await fetchRecentJpycTransfers(chain, address, 30);
        if (cancelled) return;
        let newlyReceived = new Decimal(0);
        for (const transfer of transfers) {
          if (!transfer.isReception) continue;
          if (transfer.blockNumber <= startBlockRef.current) continue;
          if (countedHashesRef.current.has(transfer.hash)) continue;
          countedHashesRef.current.add(transfer.hash);
          newlyReceived = newlyReceived.add(new Decimal(transfer.amount));
        }
        setPollError(false);
        if (newlyReceived.greaterThan(0)) {
          setReceivedAmount((prev) => {
            const next = prev.add(newlyReceived);
            if (!paidRef.current && next.greaterThanOrEqualTo(amountDue) && amountDue.greaterThan(0)) {
              paidRef.current = true;
              // 入金を検知したら、音と振動(対応端末のみ)でも知らせる。
              playCompletedSound();
              try { navigator.vibrate?.([200, 100, 200]); } catch { /* 振動できなくても影響しない */ }
              onFullyPaid();
            }
            return next;
          });
        }
      } catch (e) {
        console.error('Failed to poll for JPYC payment', e);
        if (!cancelled) setPollError(true);
      }
    };

    poll();
    const handle = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, chain, address, amountDue.toString(), tokenAddress, tokenDecimals, tokenSymbol]);

  return { receivedAmount, pollError, jpycDecimals, startWatching };
}
