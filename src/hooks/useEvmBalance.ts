import { useState, useCallback } from 'react';
import { CHAINS } from '../lib/chains';
import type { ChainKey, ChainConfig } from '../lib/chains';
import { fetchBalances, fetchNativeJpyRate, fetchUsdcBalance } from '../lib/chains';
import { WalletsHelper } from '../lib/storage';
import { useAppStore } from '../store/appStore';

// Ported from src/components/mixins/EvmBalanceModule.ts.
export function useEvmBalance() {
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;
  const networkMode = useAppStore((s) => s.networkMode);
  const setActiveChainInStore = useAppStore((s) => s.setActiveChain);
  const [nativeBalance, setNativeBalance] = useState('0');
  const [jpycBalance, setJpycBalance] = useState('0');
  // USDC balance on the active chain - only shown on the Home screen when 表示通貨 (display
  // currency, see appStore.ts) is set to USD, in place of jpycBalance above. Fetched
  // unconditionally alongside native/JPYC below so switching 表示通貨 while already on Home
  // doesn't need its own separate fetch path.
  const [usdcBalance, setUsdcBalance] = useState('0');
  // Native balance + JPYC balance, both converted to JPY and summed — the single
  // "total assets" figure shown on the Home screen's Balance card.
  const [totalJpyBalance, setTotalJpyBalance] = useState(0);

  const activeChainConfig: ChainConfig = CHAINS[activeChain];

  const fetchEvmBalance = useCallback(async (): Promise<{ native: string; jpyc: string; usdc: string; totalJpy: number } | null> => {
    const activeWallet = await WalletsHelper.getActive();
    if (activeWallet == null) {
      setNativeBalance('0');
      setJpycBalance('0');
      setUsdcBalance('0');
      setTotalJpyBalance(0);
      return { native: '0', jpyc: '0', usdc: '0', totalJpy: 0 };
    }
    try {
      const [balances, jpyRate, usdc] = await Promise.all([
        fetchBalances(activeChain, activeWallet.address),
        fetchNativeJpyRate(activeChain),
        fetchUsdcBalance(activeChain, activeWallet.address),
      ]);
      setNativeBalance(balances.native);
      setJpycBalance(balances.jpyc);
      setUsdcBalance(usdc);
      // JPYC is JPY-pegged 1:1, so it's added as-is; the native coin is converted using
      // the fetched rate (0 if the rate fetch failed, so it just doesn't contribute).
      const totalJpy = Number(balances.jpyc) + Number(balances.native) * jpyRate;
      setTotalJpyBalance(totalJpy);
      return { native: balances.native, jpyc: balances.jpyc, usdc, totalJpy };
    } catch (e) {
      // Keep the previous values on a transient RPC failure rather than flashing to zero -
      // null tells the caller (Home's homeCache write) nothing here actually changed.
      console.error('Failed to fetch balances', e);
      return null;
    }
    // networkMode is included so toggling debug mode (mainnet <-> testnets) gives this
    // callback a new identity, causing any effect keyed on it (e.g. Home's `update`) to
    // refetch against the newly active network instead of showing stale balances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChain, networkMode]);

  // Lets Home paint last-known balances instantly from lib/homeCache.ts before fetchEvmBalance
  // (network-bound) has a chance to run, rather than every mount starting from '0'/spinners.
  const hydrateBalances = useCallback((entry: { native: string; jpyc: string; usdc: string; totalJpy: number }) => {
    setNativeBalance(entry.native);
    setJpycBalance(entry.jpyc);
    setUsdcBalance(entry.usdc);
    setTotalJpyBalance(entry.totalJpy);
  }, []);

  const setActiveChain = useCallback((chain: ChainKey) => {
    setActiveChainInStore(chain);
  }, [setActiveChainInStore]);

  return { nativeBalance, jpycBalance, usdcBalance, totalJpyBalance, activeChain, activeChainConfig, fetchEvmBalance, hydrateBalances, setActiveChain };
}
