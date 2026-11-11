import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box, ButtonBase, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, IconButton, Alert, Avatar, Menu, MenuItem, Select,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EthereumSilhouetteIcon from '../../components/EthereumSilhouetteIcon';
import CustomChainIcon from '../../components/CustomChainIcon';
import {
  CHAINS, TOKEN_LISTS, fetchBalances, fetchTokenBalances, fetchTokenMetadata,
} from '../../lib/chains';
import type { ChainKey, Balances, TokenBalance } from '../../lib/chains';
import { WalletsHelper, CustomTokensHelper, CustomChainsHelper } from '../../lib/storage';
import type { CustomChainRecord } from '../../lib/storage';
import { fetchCustomChainNativeBalance, fetchCustomChainTokenBalance } from '../../lib/customChains';
import { useAppStore } from '../../store/appStore';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { getTokenIcon } from '../../lib/tokenIcons';
import { TILE_GRID_SX } from '../../lib/tileGrid';

// Price data (jpyRate) has been dropped from this shape entirely - see the note above
// fetchAll below for why the "held amount" price line was removed from this screen.
type ChainBalanceState = Balances & { tokens: TokenBalance[] };

// USDT/USDC on Ethereum, Polygon, Avalanche and Kaia used to be shown as their own row even
// with a zero balance. The screen now hides every asset the wallet doesn't hold (see
// DEFAULT_VISIBLE_ROW_ID / isHeld below), so these are only listed as a fallback source for
// a zero-balance row that then gets filtered out - they no longer force a row onto the screen.
const ALWAYS_SHOWN_TOKEN_SYMBOLS: Partial<Record<ChainKey, string[]>> = {
  ethereum: ['USDT', 'USDC'],
  polygon: ['USDT', 'USDC'],
  avalanche: ['USDT', 'USDC'],
  kaia: ['USDT', 'USDC'],
};

// Filter/grouping key for the network-picker menu and the "add token" dialog's chain
// select. Symbol and NEM aren't part of the EVM ChainKey union, so they get their own
// literal values here rather than being shoehorned into it. A network added by hand under
// 設定 > カスタムEVM (see CustomChainRecord in lib/storage.ts) gets its own `custom:${id}`
// key so several custom chains can each be filtered on individually, same as any of the
// officially-supported ones.
type FilterKey = 'all' | ChainKey | `custom:${string}`;

// 保有していない(残高0の)アセットは非表示にする。ただし何も保有していなくても画面が
// 空にならないよう、Ethereumのネイティブ通貨(ETH)だけは残高0でも常に表示する(デフォルト表示)。
const DEFAULT_VISIBLE_ROW_ID = 'ethereum-native';
const isHeld = (amount: string) => {
  const n = Number(amount.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0;
};

// One row of the flat asset list below - a native currency, JPYC, a held ERC-20 token,
// or the Symbol/NEM balance - normalized to a single shape so they can all render through
// the same <AssetRow>, mirroring how a MetaMask-style token list shows every asset (across
// every network) as one continuous list rather than grouped, per-network cards.
interface AssetRow {
  id: string;
  filterKey: FilterKey;
  // Undefined for a custom token with no curated/CoinGecko icon - Avatar then falls back
  // to the symbol-initial child below instead of showing a chain icon that could be
  // mistaken for the token's own logo (see the comment on the Avatar below).
  icon?: string;
  // 未設定(icon省略時)のカスタムEVMネイティブ通貨に、文字イニシャルの代わりに
  // イーサリアムのシルエットアイコンを出すためのフラグ。
  iconIsEthFallback?: boolean;
  // Small network-logo overlay in the icon's bottom-right corner, shown only for assets
  // that can exist on more than one chain (JPYC/USDT/USDC/custom tokens) - same idea as
  // the reference screenshot's Polygon badge on its "(PoS) Tether USD" row. A native
  // currency (ETH/POL/etc.) or the Symbol/NEM balance IS its own network identity, so
  // those get no badge, same as the screenshot's un-badged Bitcoin/TRON/BNB rows.
  badgeIcon?: string;
  // カスタムEVMチェーンに独自アイコンが設定されていない場合、バッジもイーサリアムの
  // シルエットで表示する(badgeIconは未設定のまま)。
  badgeIsEthFallback?: boolean;
  name: string;
  symbol: string;
  amount: string;
  onSend: () => void;
  onRemove?: () => void;
}

function AssetRowItem({ row }: { row: AssetRow }) {
  // 1アセット = 1つの正方形タイル(タップで送金)。
  return (
    <ButtonBase
      component="div"
      onClick={row.onSend}
      sx={{
        position: 'relative', aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 0.75, p: 1.5, borderRadius: 2,
        border: 1, borderColor: 'divider', bgcolor: 'background.paper', textAlign: 'center',
      }}
    >
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        {/* Most rows' icons are bundled assets that never fail to load, and several of
            those PNGs have transparent corners (Kaia/Avalanche/USDT/USDC/Symbol/NEM) - so
            the avatar backing is always plain white. A custom token's icon can instead be a
            remote CoinGecko URL that may fail to load, or be omitted entirely
            (row.icon undefined) - Avatar falls back to the symbol-initial child in both
            cases, with its own explicit text color (the default is white-on-white here).
            A custom-EVM native currency with no user-picked icon (iconIsEthFallback) gets
            the grey Ethereum silhouette instead of a plain letter. */}
        <Avatar
          src={row.icon}
          sx={{
            width: 48, height: 48,
            bgcolor: row.iconIsEthFallback ? 'grey.200' : '#fff',
            color: 'text.primary',
          }}
        >
          {row.iconIsEthFallback ? <EthereumSilhouetteIcon size={24} /> : row.symbol.slice(0, 1)}
        </Avatar>
        {row.badgeIsEthFallback ? (
          <Box
            sx={{
              position: 'absolute', right: -2, bottom: -2, width: 20, height: 20,
              borderRadius: '50%', border: '2px solid', borderColor: 'background.paper',
              bgcolor: 'grey.200', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <EthereumSilhouetteIcon size={10} />
          </Box>
        ) : row.badgeIcon && (
          <Box
            component="img"
            src={row.badgeIcon}
            sx={{
              position: 'absolute', right: -2, bottom: -2, width: 20, height: 20,
              borderRadius: '50%', border: '2px solid', borderColor: 'background.paper',
            }}
          />
        )}
      </Box>

      <Typography noWrap sx={{ fontWeight: 'bold', width: '100%' }}>{row.name}</Typography>
      <Typography sx={{ color: 'text.primary', fontSize: { xs: '1.3rem', sm: '1.45rem' }, fontWeight: 700, lineHeight: 1.2, width: '100%', overflowWrap: 'anywhere' }}>{row.amount}</Typography>

      {row.onRemove && (
        <IconButton
          size="small"
          aria-label="remove"
          onClick={(e) => { e.stopPropagation(); row.onRemove?.(); }}
          sx={{ position: 'absolute', top: 2, right: 2 }}
        >
          <CloseIcon fontSize="small" sx={{ color: '#929292' }} />
        </IconButton>
      )}
    </ButtonBase>
  );
}

export default function Balance() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);
  const clearReceiverAddress = useAppStore((s) => s.clearReceiverAddress);
  // Re-read on every render (not hoisted to module scope) so a debug-mode toggle is
  // reflected immediately next time this screen renders, instead of being frozen at
  // whatever CHAINS resolved to the first time this module was loaded.
  const networkMode = useAppStore((s) => s.networkMode);
  const balanceCache = useAppStore((s) => s.balanceCache);
  const setBalanceCache = useAppStore((s) => s.setBalanceCache);
  // Cache only counts if it was fetched under the network mode currently in effect - a
  // mainnet/testnet toggle shouldn't briefly show the other mode's stale balances (see
  // appStore.ts's balanceCache doc comment).
  const cachedForCurrentMode = balanceCache?.networkMode === networkMode ? balanceCache : null;
  const chains = Object.keys(CHAINS).map((key) => CHAINS[key as ChainKey]);

  // Seed from the cached result of the previous visit (if any, and if fetched under the
  // same networkMode) so returning to this screen shows the last-known balances instantly
  // instead of a blank spinner. The background refetch in fetchAll below (which always
  // runs, regardless of whether a cache existed) then replaces both this state and the
  // store cache once fresh data arrives, so anything that changed on-chain since the last
  // visit still shows up "in real time" - just without the loading flash.
  const [loading, setLoading] = useState(cachedForCurrentMode == null);
  // Every chain's balance (native + JPYC + any known ERC-20 token held, plus tokens the
  // person registered by hand below), fetched and shown together - no network picker
  // gating what's visible.
  const [balances, setBalances] = useState<Record<ChainKey, ChainBalanceState>>(
    cachedForCurrentMode?.balances ?? ({} as Record<ChainKey, ChainBalanceState>),
  );
  // Contract addresses (lowercased) the person has manually registered per chain, so the
  // token rows below know which ones to offer a remove button on.
  const [customAddresses, setCustomAddresses] = useState<Record<ChainKey, Set<string>>>(
    cachedForCurrentMode?.customAddresses ?? ({} as Record<ChainKey, Set<string>>),
  );
  // Networks added by hand under 設定 > カスタムEVM (see AssetRecoveryList.tsx), plus their
  // native + manually-registered token balances - shown here as their own rows/filter
  // entries so a custom network's holdings aren't only visible from the settings screen.
  const [customChains, setCustomChains] = useState<CustomChainRecord[]>(cachedForCurrentMode?.customChains ?? []);
  const [customChainStates, setCustomChainStates] = useState<Record<string, ChainBalanceState>>(
    cachedForCurrentMode?.customChainStates ?? {},
  );

  const fetchAll = useCallback(async () => {
    const activeWallet = await WalletsHelper.getActive();
    if (activeWallet == null) {
      setLoading(false);
      return;
    }
    // Only show the spinner when there's nothing cached for this networkMode to display
    // yet - if a previous result is already on screen, this fetch happens quietly in the
    // background and simply swaps the balances once it resolves (see balanceCache in
    // appStore.ts), rather than hiding the existing content behind a spinner every time
    // this screen is opened. Read straight from the store rather than the cachedForCurrentMode
    // closure above so a networkMode change right before this runs is picked up correctly.
    if (useAppStore.getState().balanceCache?.networkMode !== networkMode) {
      setLoading(true);
    }
    try {
      // This screen no longer shows a JPY/USD price next to each balance - it was backed
      // by a client-side call straight to CoinGecko's free/keyless API, which is rate-
      // limited to roughly 5-15 requests/minute and had no reliable way around that from
      // inside the browser (CoinMarketCap, the other option considered, blocks browser
      // calls outright via CORS to protect its API key and requires a backend proxy this
      // app doesn't have). Several rounds of consolidating requests and decoupling the
      // price fetch from the balance fetch narrowed the failure but never eliminated it,
      // so rather than continuing to show an unreliable number, this screen now shows
      // only the amount held for every asset, same as before but without a price column.
      const [entries, customChainList] = await Promise.all([
        Promise.all(chains.map(async (chain) => {
          const customTokens = await CustomTokensHelper.list(chain.key);
          const [chainBalances, tokens] = await Promise.all([
            fetchBalances(chain.key, activeWallet.address),
            fetchTokenBalances(chain.key, activeWallet.address, customTokens),
          ]);
          return {
            key: chain.key,
            chainBalances,
            tokens,
            customSet: new Set(customTokens.map((t) => t.address.toLowerCase())),
          };
        })),
        CustomChainsHelper.list(),
      ]);
      setBalances(Object.fromEntries(entries.map((e) => [
        e.key,
        { ...e.chainBalances, tokens: e.tokens } as ChainBalanceState,
      ])) as Record<ChainKey, ChainBalanceState>);
      setCustomAddresses(Object.fromEntries(entries.map((e) => [e.key, e.customSet])) as Record<ChainKey, Set<string>>);
      setCustomChains(customChainList);
      const customEntries = await Promise.all(customChainList.map(async (chain) => {
        const customTokens = await CustomTokensHelper.list(chain.id);
        const [nativeBalance, tokenBalances] = await Promise.all([
          fetchCustomChainNativeBalance(chain.rpcUrl, activeWallet.address).catch(() => '0'),
          Promise.all(customTokens.map((t) =>
            fetchCustomChainTokenBalance(chain.rpcUrl, t, activeWallet.address).catch(() => ({ ...t, balance: '0' })),
          )),
        ]);
        return [chain.id, { native: nativeBalance, jpyc: '0.0', tokens: tokenBalances }] as const;
      }));
      const resolvedBalances = Object.fromEntries(entries.map((e) => [
        e.key,
        { ...e.chainBalances, tokens: e.tokens } as ChainBalanceState,
      ])) as Record<ChainKey, ChainBalanceState>;
      const resolvedCustomAddresses = Object.fromEntries(entries.map((e) => [e.key, e.customSet])) as Record<ChainKey, Set<string>>;
      const resolvedCustomChainStates = Object.fromEntries(customEntries) as Record<string, ChainBalanceState>;
      setCustomChainStates(resolvedCustomChainStates);

      // Save this fetch's result so the next time this screen is opened (without a full
      // reload) it can render immediately from cache while a fresh fetch runs underneath.
      setBalanceCache({
        networkMode,
        balances: resolvedBalances,
        customAddresses: resolvedCustomAddresses,
        customChains: customChainList,
        customChainStates: resolvedCustomChainStates,
      });
    } catch (e) {
      console.error('Failed to fetch balances', e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkMode]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Jumps into the destination-entry step (JPYC: Home の送る / その他: /send/amount) rather than straight into
  // /send/amount - receiverAddress is only ever set there (see pages/top/Send.tsx), so
  // skipping it left the previous/empty address in place and produced an
  // "invalid hexlify value" on estimateGas once send actually tried to broadcast to "".
  // Clearing it first also stops a stale address from a previous send silently carrying
  // over to this one.
  const onSendJpycOrNative = (chain: ChainKey, currency: 'jpyc' | 'native') => {
    setActiveChain(chain);
    setSendCurrency(currency);
    setSendTokenMeta(null);
    setSendCustomChainId(null);
    clearReceiverAddress();
    // JPYC は Home の「送る」(JPYC専用)から、それ以外(ネイティブ通貨)はこの画面から開く
    // 汎用の送金画面(/send/amount)から送る。
    navigate(currency === 'jpyc' ? '/top?tab=send' : '/send/amount?from=token');
  };

  const onSendToken = (chain: ChainKey, token: TokenBalance) => {
    setActiveChain(chain);
    setSendCurrency(token.address);
    setSendTokenMeta({ address: token.address, symbol: token.symbol, decimals: token.decimals });
    setSendCustomChainId(null);
    clearReceiverAddress();
    navigate('/send/amount?from=token');
  };

  // A custom chain (設定 > カスタムEVM) now goes through the same SEND-tab flow as every
  // curated chain above (onSendJpycOrNative/onSendToken) - it used to jump straight to the
  // settings screen's rescue-send screen instead, which made it the odd one out. Setting
  // sendCustomChainId (see appStore.ts) is what tells SendAmount/SendConfirmation this
  // asset lives on a hand-added network rather than one of CHAINS's - everything else
  // about the flow (destination entry, amount keypad, PIN confirmation) is identical.
  const onSendCustomChainNative = (chain: CustomChainRecord) => {
    setSendCustomChainId(chain.id);
    setSendCurrency('native');
    setSendTokenMeta(null);
    clearReceiverAddress();
    navigate('/send/amount?from=token');
  };

  const onSendCustomChainToken = (chain: CustomChainRecord, token: TokenBalance) => {
    setSendCustomChainId(chain.id);
    setSendCurrency(token.address);
    setSendTokenMeta({ address: token.address, symbol: token.symbol, decimals: token.decimals });
    clearReceiverAddress();
    navigate('/send/amount?from=token');
  };

  // --- Add-custom-token dialog --------------------------------------------------------
  //
  // JPYC/USDT/native/USDC etc. come from the curated list in lib/chains.ts, so any other
  // token (a new airdrop, a niche project, something region-specific) simply never shows
  // up - there's no way to ask a plain RPC node "list every token this address holds"
  // without a paid indexer. This dialog lets the person register one by hand. Now that
  // the list below is a single flat feed rather than one card per chain, the dialog's
  // chain is picked with a Select inside it (defaulting to whichever network is currently
  // filtered on, if any) instead of being fixed to whichever card's "Add token" button
  // was tapped.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formChain, setFormChain] = useState<ChainKey>(chains[0].key);
  const [formAddress, setFormAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openDialog = (chain?: ChainKey) => {
    setFormChain(chain ?? chains[0].key);
    setFormAddress('');
    setFormError(null);
    setDialogOpen(true);
  };
  const closeDialog = () => {
    if (submitting) return;
    setDialogOpen(false);
  };

  const onSubmitToken = async () => {
    const address = formAddress.trim();
    if (address.length === 0) {
      setFormError(t('balance.error_empty_address'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const activeWallet = await WalletsHelper.getActive();
      if (activeWallet == null) {
        setFormError(t('balance.error_no_wallet'));
        return;
      }
      const meta = await fetchTokenMetadata(formChain, address);
      await CustomTokensHelper.add({ chain: formChain, ...meta });
      setDialogOpen(false);
      await fetchAll();
    } catch (e) {
      console.error('Failed to add custom token', e);
      setFormError(t('balance.error_fetch_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onRemoveToken = async (chain: ChainKey, token: TokenBalance) => {
    await CustomTokensHelper.remove(chain, token.address);
    await fetchAll();
  };

  // Same idea, for a token registered under a custom chain (設定 > カスタムEVM) - chain is
  // that chain's CustomChainRecord.id rather than a ChainKey.
  const onRemoveCustomToken = async (chainId: string, token: TokenBalance) => {
    await CustomTokensHelper.remove(chainId, token.address);
    await fetchAll();
  };

  const isCustomToken = useMemo(
    () => (chain: ChainKey, token: TokenBalance) => customAddresses[chain]?.has(token.address.toLowerCase()) ?? false,
    [customAddresses],
  );

  // --- Network filter ------------------------------------------------------------------
  //
  // Visual + functional counterpart to the reference screenshot's "人気のネットワーク"
  // pill: "all" shows every asset across every chain (the default, and the closest match
  // to how this screen worked before), or picking one network narrows the flat list down
  // to just that chain's (or Symbol's/NEM's) assets.
  const [networkFilter, setNetworkFilter] = useState<FilterKey>('all');
  const [networkMenuAnchor, setNetworkMenuAnchor] = useState<HTMLElement | null>(null);
  const networkFilterLabel = useMemo(() => {
    if (networkFilter === 'all') return t('balance.all_networks');
    if (networkFilter.startsWith('custom:')) {
      const id = networkFilter.slice('custom:'.length);
      return customChains.find((c) => c.id === id)?.name ?? id;
    }
    return CHAINS[networkFilter as ChainKey].name;
  }, [networkFilter, t, customChains]);

  // Builds the single flat row list every asset renders through - one entry per native
  // currency, per JPYC balance, per held ERC-20 token (curated or custom), plus Symbol
  // and NEM - instead of the grouped-by-chain cards this screen used to render. No row
  // carries a price anymore - see the note in fetchAll above for why.
  const allRows = useMemo<AssetRow[]>(() => {
    const rows: AssetRow[] = [];
    for (const chain of chains) {
      const balance = balances[chain.key];
      const chainIcon = CHAIN_ICONS[chain.key];

      rows.push({
        id: `${chain.key}-native`,
        filterKey: chain.key,
        icon: chainIcon,
        name: chain.nativeCurrency.symbol,
        symbol: chain.nativeCurrency.symbol,
        amount: balance?.native ?? '0.0',
        onSend: () => onSendJpycOrNative(chain.key, 'native'),
      });

      rows.push({
        id: `${chain.key}-jpyc`,
        filterKey: chain.key,
        icon: getTokenIcon('JPYC') ?? chainIcon,
        badgeIcon: chainIcon,
        name: 'JPYC',
        symbol: 'JPYC',
        amount: balance?.jpyc ?? '0.0',
        onSend: () => onSendJpycOrNative(chain.key, 'jpyc'),
      });

      const alwaysShownSymbols = ALWAYS_SHOWN_TOKEN_SYMBOLS[chain.key] ?? [];
      const heldTokens = balance?.tokens ?? [];

      // Icon fallback order: curated bundled icon (USDT/USDC/JPYC - consistent, never
      // fails to load) -> CoinGecko logo captured at add-time -> the chain icon, but only
      // for a curated/known token. A custom token with neither gets no icon at all
      // (undefined) rather than the chain icon, so Avatar shows the symbol-initial letter
      // instead of a chain logo that could be mistaken for the token's own artwork (e.g.
      // an Ethereum diamond shown for an unrelated "BGB" token just because it happens to
      // live on Ethereum).
      const resolveTokenIcon = (token: TokenBalance): string | undefined =>
        getTokenIcon(token.symbol) ?? token.iconUrl ?? (isCustomToken(chain.key, token) ? undefined : chainIcon);

      alwaysShownSymbols.forEach((symbol) => {
        const held = heldTokens.find((t) => t.symbol === symbol);
        const curated = TOKEN_LISTS[chain.key].find((t) => t.symbol === symbol);
        if (!curated) return;
        const token: TokenBalance = held ?? { ...curated, balance: '0.0' };
        rows.push({
          id: `${chain.key}-${token.address}`,
          filterKey: chain.key,
          icon: resolveTokenIcon(token),
          badgeIcon: chainIcon,
          name: token.symbol,
          symbol: token.symbol,
          amount: token.balance,
          onSend: () => onSendToken(chain.key, token),
          onRemove: isCustomToken(chain.key, token) ? () => onRemoveToken(chain.key, token) : undefined,
        });
      });

      heldTokens.filter((token) => !alwaysShownSymbols.includes(token.symbol)).forEach((token) => {
        rows.push({
          id: `${chain.key}-${token.address}`,
          filterKey: chain.key,
          icon: resolveTokenIcon(token),
          badgeIcon: chainIcon,
          name: token.symbol,
          symbol: token.symbol,
          amount: token.balance,
          onSend: () => onSendToken(chain.key, token),
          onRemove: isCustomToken(chain.key, token) ? () => onRemoveToken(chain.key, token) : undefined,
        });
      });
    }

    // Networks added under 設定 > カスタムEVM (see AssetRecoveryList.tsx). No curated icon
    // exists for an arbitrary hand-entered chain, so unless the person picked a photo of
    // their own for the chain/token (chain.iconDataUrl / token.iconDataUrl - see
    // storage.ts), every row here falls back to the generic カスタムEVM badge.
    for (const chain of customChains) {
      const state = customChainStates[chain.id];
      const filterKey: FilterKey = `custom:${chain.id}`;
      const chainIconIsFallback = !chain.iconDataUrl;

      rows.push({
        id: `${chain.id}-native`,
        filterKey,
        icon: chain.iconDataUrl,
        iconIsEthFallback: chainIconIsFallback,
        name: chain.currencySymbol,
        symbol: chain.currencySymbol,
        amount: state?.native ?? '0.0',
        onSend: () => onSendCustomChainNative(chain),
      });

      (state?.tokens ?? []).forEach((token) => {
        rows.push({
          id: `${chain.id}-${token.address}`,
          filterKey,
          icon: token.iconDataUrl ?? token.iconUrl,
          badgeIcon: chain.iconDataUrl,
          badgeIsEthFallback: chainIconIsFallback,
          name: token.symbol,
          symbol: token.symbol,
          amount: token.balance,
          onSend: () => onSendCustomChainToken(chain, token),
          onRemove: () => onRemoveCustomToken(chain.id, token),
        });
      });
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances, isCustomToken, customChains, customChainStates]);

  // 保有しているもの(残高 > 0)と、ETH(デフォルト表示)、自分で登録したカスタムトークン
  // (onRemove付き。残高0でも消えると削除できなくなるため)だけを表示する。
  const heldRows = allRows.filter((r) => r.id === DEFAULT_VISIBLE_ROW_ID || r.onRemove !== undefined || isHeld(r.amount));
  const visibleRows = networkFilter === 'all' ? heldRows : heldRows.filter((r) => r.filterKey === networkFilter);

  return (
    <Box sx={{ width: '100%' }}>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ px: 2, mt: 3, pb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box
              onClick={(e) => setNetworkMenuAnchor(e.currentTarget)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                bgcolor: 'grey.100', borderRadius: 5, px: 1.5, py: 0.75,
              }}
            >
              <Typography sx={{ fontWeight: 'bold', fontSize: 14 }}>{networkFilterLabel}</Typography>
              <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </Box>
            {!networkFilter.startsWith('custom:') && (
              <IconButton
                aria-label={t('balance.add_token')}
                onClick={() => openDialog(
                  networkFilter !== 'all'
                    ? (networkFilter as ChainKey)
                    : undefined,
                )}
              >
                <AddIcon />
              </IconButton>
            )}
          </Box>

          <Menu anchorEl={networkMenuAnchor} open={!!networkMenuAnchor} onClose={() => setNetworkMenuAnchor(null)}>
            <MenuItem selected={networkFilter === 'all'} onClick={() => { setNetworkFilter('all'); setNetworkMenuAnchor(null); }}>
              {t('balance.all_networks')}
            </MenuItem>
            {chains.map((chain) => (
              <MenuItem
                key={chain.key}
                selected={networkFilter === chain.key}
                onClick={() => { setNetworkFilter(chain.key); setNetworkMenuAnchor(null); }}
              >
                <Avatar src={CHAIN_ICONS[chain.key]} sx={{ width: 22, height: 22, mr: 1.5 }} />
                {chain.name}
              </MenuItem>
            ))}
            {customChains.map((chain) => (
              <MenuItem
                key={chain.id}
                selected={networkFilter === `custom:${chain.id}`}
                onClick={() => { setNetworkFilter(`custom:${chain.id}`); setNetworkMenuAnchor(null); }}
              >
                <CustomChainIcon iconDataUrl={chain.iconDataUrl} size={22} sx={{ mr: 1.5 }} />
                {chain.name}
              </MenuItem>
            ))}
          </Menu>

          {visibleRows.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', mt: 4 }}>{t('balance.no_assets')}</Typography>
          ) : (
            <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5 }}>
              {visibleRows.map((row) => (
                <AssetRowItem key={row.id} row={row} />
              ))}
            </Box>
          )}
        </Box>
      )}


      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>{t('balance.add_token_dialog_title')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary', fontSize: 'small', mb: 2 }}>
            {t('balance.add_token_dialog_message')}
          </Typography>
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ color: '#929292', fontSize: 12, mb: 0.5 }}>{t('balance.chain_label')}</Typography>
            <Select
              fullWidth
              size="small"
              value={formChain}
              onChange={(e) => setFormChain(e.target.value as ChainKey)}
              disabled={submitting}
            >
              {chains.map((chain) => (
                <MenuItem key={chain.key} value={chain.key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box component="img" src={CHAIN_ICONS[chain.key]} sx={{ width: 20, height: 20, borderRadius: '50%' }} />
                    {chain.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>
          <TextField
            label={t('balance.contract_address_label')}
            placeholder="0x..."
            fullWidth
            margin="dense"
            value={formAddress}
            onChange={(e) => setFormAddress(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={submitting}>{t('common.cancel')}</Button>
          <Button onClick={onSubmitToken} variant="contained" disabled={submitting}>
            {submitting ? <CircularProgress size={20} /> : t('common.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
