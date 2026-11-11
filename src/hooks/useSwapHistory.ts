import { useState, useCallback } from 'react';
import { SwapHistoryHelper } from '../lib/storage';
import type { SwapRecord } from '../lib/storage';

/**
 * Recent Uniswap V4 swaps this wallet has made through this app, most-recent-first.
 * Unlike useTransactions/useNfts (formerly), this has no on-chain discovery step - see the
 * block comment on SwapRecord in lib/storage.ts for why swap history is tracked locally
 * instead of reconstructed from RPC logs.
 */
export function useSwapHistory() {
  const [history, setHistory] = useState<SwapRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSwapHistory = useCallback(async (): Promise<SwapRecord[]> => {
    setLoading(true);
    try {
      const records = await SwapHistoryHelper.list();
      setHistory(records);
      return records;
    } finally {
      setLoading(false);
    }
  }, []);

  return { history, loading, fetchSwapHistory };
}
