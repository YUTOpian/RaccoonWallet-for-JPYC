import { useState, useCallback } from 'react';
import { TransactionWrapper } from '../lib/transactionWrapper';
import { WalletsHelper, CustomTokensHelper, CustomChainsHelper, RecipientSafetyHelper } from '../lib/storage';
import { fetchRecentTokenTransfers, fetchRecentCustomTokenTransfers, getJpycDecimals, CHAINS, TOKEN_LISTS } from '../lib/chains';
import type { ChainKey } from '../lib/chains';

// Every EVM chain the wallet supports; history is fetched from all of them and merged so
// Home/TransactionList show one combined, chronologically-sorted feed regardless of which
// chain each transfer happened on.
const ALL_CHAINS: ChainKey[] = ['ethereum', 'polygon', 'kaia', 'avalanche'];

// A transfer, from any source (EVM token log scan, or a NEM/Symbol node's own transaction
// list), reduced to just enough to sort everything together and build a TransactionWrapper
// once the final cross-source order is known.
interface PendingTransfer {
  timestampMs: number;
  hash: string;
  isReception: boolean;
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  currencySymbol: string;
  feeAmount: string;
  chain: string;
}

// Ported from src/components/mixins/TransactionModule.ts, then extended beyond JPYC-only.
//
// History is read straight from public sources rather than a paid explorer/indexer API:
// - ERC-20 tokens (JPYC, curated tokens like USDC, and anything registered by hand on the
//   Token screen or under 設定 > カスタムEVM) are found via Transfer-event log scans - see
//   the block comment in chains.ts above scanTransferLogs for why this only works for
//   tokens, not native-coin (ETH/POL/AVAX/KAIA/custom-chain-native) sends - those aren't
//   attempted here at all; check a block explorer for those instead.
// - XEM (NEM) and XYM (Symbol) come straight from each network's own node REST API, which
//   already supports "every transaction this account was involved in" natively, so no
//   log-scanning trade-off applies to those two.
// Unconfirmed (pending/mempool) transactions aren't observable this way either, so that list
// always resolves empty; only confirmed history is populated.
export function useTransactions() {
  const [confirmedTransactions, setConfirmedTransactions] = useState<TransactionWrapper[]>([]);
  const [unconfirmedTransactions, setUnconfirmedTransactions] = useState<TransactionWrapper[]>([]);

  const fetchTransactions = useCallback(async (
    count: number = 10,
    _withUnconfirmedTransactions: boolean = false,
    onFetched: (confirmed: TransactionWrapper[], unconfirmed: TransactionWrapper[]) => void = () => {},
    // Restrict the merged result to a single currencySymbol (e.g. 'JPYC' or 'USDC') before
    // applying `count` - used by Home's card, which shows only whichever of JPYC/USDC the
    // person currently has 表示通貨 set to. undefined (TransactionList's full history) keeps
    // every chain/token/XEM/XYM entry, as before.
    currencyFilter?: string,
  ) => {
    const activeWallet = await WalletsHelper.getActive();
    if (activeWallet == null) {
      setConfirmedTransactions([]);
      setUnconfirmedTransactions([]);
      onFetched([], []);
      return;
    }
    // Home's card passes 'JPYC' or 'USDC' to show only that currency, fast: scanning every
    // curated/custom token plus NEM/Symbol (needed for the full /transaction/list view) took
    // noticeably longer than the person wanted for a card that only ever shows one currency
    // at a time. When the filter is one of these two, skip everything that currency can't
    // possibly be on: other curated tokens, every custom EVM token, and NEM/Symbol entirely.
    const isNarrowCuratedFilter = currencyFilter === 'JPYC' || currencyFilter === 'USDC';

    // 1) Curated EVM chains: every ERC-20 the wallet is known to hold (JPYC + curated
    // TOKEN_LISTS entries like USDC + anything registered by hand on the Token screen) - or,
    // for the narrow Home-card fetch above, just the one token asked for.
    const curatedResults = await Promise.all(ALL_CHAINS.map(async (chain): Promise<PendingTransfer[]> => {
      try {
        let tokens: { address: string; decimals: number; symbol: string }[];
        if (currencyFilter === 'JPYC') {
          tokens = [{ address: CHAINS[chain].jpycAddress, decimals: await getJpycDecimals(chain), symbol: 'JPYC' }];
        } else if (currencyFilter === 'USDC') {
          const usdc = TOKEN_LISTS[chain].find((t) => t.symbol === 'USDC');
          tokens = usdc ? [{ address: usdc.address, decimals: usdc.decimals, symbol: usdc.symbol }] : [];
        } else {
          const [jpycDecimals, customTokens] = await Promise.all([
            getJpycDecimals(chain),
            CustomTokensHelper.list(chain),
          ]);
          tokens = [
            { address: CHAINS[chain].jpycAddress, decimals: jpycDecimals, symbol: 'JPYC' },
            ...TOKEN_LISTS[chain].map((t) => ({ address: t.address, decimals: t.decimals, symbol: t.symbol })),
            ...customTokens.map((t) => ({ address: t.address, decimals: t.decimals, symbol: t.symbol })),
          ];
        }
        const perToken = await Promise.all(tokens.map((token) =>
          fetchRecentTokenTransfers(chain, token.address, token.decimals, token.symbol, activeWallet.address, count)
            .catch((e) => { console.warn(`Failed to load ${chain} ${token.symbol} transfer history`, e); return []; })
        ));
        return perToken.flat().map((transfer) => ({
          timestampMs: transfer.timestamp * 1000,
          hash: transfer.hash,
          isReception: transfer.isReception,
          senderAddress: transfer.senderAddress,
          receiverAddress: transfer.receiverAddress,
          amount: transfer.amount,
          currencySymbol: transfer.currencySymbol,
          feeAmount: '0',
          chain: transfer.chain,
        }));
      } catch (e) {
        console.warn(`Failed to load ${chain} transfer history`, e);
        return [];
      }
    }));

    // 2) Custom EVM chains (設定 > カスタムEVM): only manually-registered ERC-20 tokens can be
    // scanned this way - there's no curated token list for an arbitrary hand-added network.
    // Skipped for the narrow JPYC/USDC fetch above - neither is ever a custom-chain token.
    const customChains = isNarrowCuratedFilter ? [] : await CustomChainsHelper.list();
    const customResults = await Promise.all(customChains.map(async (chain): Promise<PendingTransfer[]> => {
      try {
        const customTokens = await CustomTokensHelper.list(chain.id);
        const perToken = await Promise.all(customTokens.map((token) =>
          fetchRecentCustomTokenTransfers(chain.rpcUrl, chain.id, token.address, token.decimals, token.symbol, activeWallet.address, count)
            .catch((e) => { console.warn(`Failed to load ${chain.name} ${token.symbol} transfer history`, e); return []; })
        ));
        return perToken.flat().map((transfer) => ({
          timestampMs: transfer.timestamp * 1000,
          hash: transfer.hash,
          isReception: transfer.isReception,
          senderAddress: transfer.senderAddress,
          receiverAddress: transfer.receiverAddress,
          amount: transfer.amount,
          currencySymbol: transfer.currencySymbol,
          feeAmount: '0',
          chain: transfer.chain,
        }));
      } catch (e) {
        console.warn(`Failed to load custom chain ${chain.name} transfer history`, e);
        return [];
      }
    }));

    const merged = [...curatedResults.flat(), ...customResults.flat()]
      .filter((transfer) => currencyFilter === undefined || transfer.currencySymbol === currencyFilter)
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, count)
      .map((transfer) => new TransactionWrapper({
        hash: transfer.hash,
        timestamp: new Date(transfer.timestampMs),
        isReception: transfer.isReception,
        isConfirmed: true,
        senderAddress: transfer.senderAddress,
        receiverAddress: transfer.receiverAddress,
        amount: transfer.amount,
        currencySymbol: transfer.currencySymbol,
        feeAmount: transfer.feeAmount,
        chain: transfer.chain,
      }));

    // 相手ごとの記録を端末内に残す(0円/少額を送りつけてきた相手など、アドレス詐欺対策の判定に使う)。
    // 表示通貨で絞った取得でも、取れた範囲をそのまま足していく。
    void RecipientSafetyHelper.rememberPeers(activeWallet.address, merged.map((tx) => ({
      address: tx.peer,
      direction: tx.isReception ? 'in' as const : 'out' as const,
      amount: Number(tx.amount.replace(/,/g, '')) || 0,
      symbol: tx.currencySymbol,
      chain: tx.chain,
      at: tx.timestamp.getTime(),
    }))).catch((e) => console.warn('rememberPeers failed', e));

    setConfirmedTransactions(merged);
    setUnconfirmedTransactions([]);
    onFetched(merged, []);
  }, []);

  return { confirmedTransactions, unconfirmedTransactions, fetchTransactions };
}
