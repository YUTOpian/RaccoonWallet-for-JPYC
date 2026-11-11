import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Box, Card, Typography, CircularProgress, Button, Snackbar, IconButton } from '@mui/material';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import CurrencyYenIcon from '@mui/icons-material/CurrencyYen';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import CardRibbon from '../../components/CardRibbon';
import { useEvmBalance } from '../../hooks/useEvmBalance';
import { useAppStore } from '../../store/appStore';
import { WalletsHelper } from '../../lib/storage';
import { CHAINS, fetchBalances, fetchUsdcBalance, fetchTotalAssetsJpy, fetchTotalAssetsUsd } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { getTokenIcon } from '../../lib/tokenIcons';
import { getHomeCache, setHomeCache } from '../../lib/homeCache';
import Receive from './Receive';
import Scan from './Scan';
import TransactionHistory from '../../components/TransactionHistory';
import ScheduledDueBanner from '../../components/ScheduledDueBanner';
import SendForm from '../../components/SendForm';
import iconReceive from '../../assets/icon_home_receive_green.png';
import iconSend from '../../assets/icon_home_send_green.png';
import iconScan from '../../assets/icon_home_scan_green.png';
import balanceCardBackground from '../../assets/image_home_balance_background.png';
import { TILE_GRID_SX } from '../../lib/tileGrid';

interface HomeProps {
  needsUpdate: boolean;
  // Panel to open under the button row when arriving via ?tab=receive / ?tab=send.
  openPanel?: 'receive' | 'send' | 'scan' | null;
}

export default function Home({ needsUpdate, openPanel = null }: HomeProps) {
  const { t } = useTranslation();
  const { jpycBalance, usdcBalance, fetchEvmBalance, hydrateBalances } = useEvmBalance();
  // 設定 > 表示通貨 (appStore.ts's DisplayCurrency). 'JPY' (default) keeps this screen exactly
  // as it always was; 'USD' swaps the balance-card slot below over to a USDC balance and the
  // total-assets figure over to a dollar amount (see fetchTotalAssetsUsd).
  const displayCurrency = useAppStore((s) => s.displayCurrency);

  // Loading flags default to false (not true): whether a spinner is warranted for this
  // particular mount is only known once `update` below has checked lib/homeCache.ts for a
  // hit, so they're set explicitly there rather than assumed up front.
  // Which detail panel the 取引履歴 / 残高 buttons have opened under the button row (null =
  // none). Tapping the open button again closes it.
  const [panel, setPanel] = useState<'receive' | 'send' | 'scan' | 'transaction' | 'balance' | null>(openPanel);
  useEffect(() => {
    if (openPanel) setPanel(openPanel);
  }, [openPanel]);
  const togglePanel = (key: 'receive' | 'send' | 'scan' | 'transaction' | 'balance') => setPanel((cur) => (cur === key ? null : key));

  const [loadingBalance, setLoadingBalance] = useState(false);
  const [address, setAddress] = useState('');
  const [addressCopied, setAddressCopied] = useState(false);
  // Whether the Balance card shows the total-assets figure (every held chain's native
  // coin + curated tokens + JPYC, all converted to JPY) instead of the default
  // active-chain JPYC balance - toggled via the icon button on the card. Defaults to
  // JPYC since that's the figure that doesn't depend on a price feed being reachable.
  const [showTotalAssets, setShowTotalAssets] = useState(false);
  const [loadingTotalAssets, setLoadingTotalAssets] = useState(false);
  // Holds whichever currency's total is currently relevant (JPY or USD, per displayCurrency) -
  // which one is fetched/shown is decided in `update` below.
  const [totalAssetsDisplay, setTotalAssetsDisplay] = useState(0);
  // Per-chain JPYC/USDC breakdown shown in the new card below Transaction - every chain is
  // fetched regardless of which one is active, unlike the Balance card above which only
  // shows the active chain's figure.
  const [loadingChainBalances, setLoadingChainBalances] = useState(false);
  const [chainBalances, setChainBalances] = useState<Record<ChainKey, { jpyc: string; usdc: string }>>({} as Record<ChainKey, { jpyc: string; usdc: string }>);
  const chainKeys = Object.keys(CHAINS) as ChainKey[];

  const onCopyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
    } catch (e) {
      console.error('Failed to copy address', e);
    }
  }, [address]);

  const update = useCallback(async () => {
    // WalletsHelper.getActive() is a local (non-network) read, so this resolves fast - the
    // slow part is everything inside Promise.all below, which is what the cache below is
    // for.
    const activeWallet = await WalletsHelper.getActive();
    if (activeWallet == null) {
      setAddress('');
      setLoadingBalance(false);
      setTotalAssetsDisplay(0);
      setLoadingTotalAssets(false);
      setChainBalances({} as Record<ChainKey, { jpyc: string; usdc: string }>);
      setLoadingChainBalances(false);
      return;
    }
    setAddress(activeWallet.address);

    // Show whatever this wallet+表示通貨 combination last loaded, instantly and without
    // spinners, while the Promise.all below refreshes everything in the background and
    // silently corrects the screen (and the cache) once it resolves - see lib/homeCache.ts.
    // No cache hit (first visit this session, or a different wallet/表示通貨 than last time)
    // falls back to the original spinner-while-loading behavior.
    const cached = getHomeCache(activeWallet.address, displayCurrency);
    if (cached) {
      hydrateBalances({ native: cached.nativeBalance, jpyc: cached.jpycBalance, usdc: cached.usdcBalance, totalJpy: cached.totalJpyBalance });
      setTotalAssetsDisplay(cached.totalAssetsDisplay);
      setChainBalances(cached.chainBalances);
    } else {
      setLoadingBalance(true);
      setLoadingTotalAssets(true);
      setLoadingChainBalances(true);
    }

    // Balance, recent transactions, the total-assets figure and the per-chain JPYC/USDC
    // breakdown are all independent - the screen's total load time is bounded by the
    // single slowest of the four, not their sum. Each branch below both updates the screen
    // as it resolves (as before) and hands back its fresh value so the final Promise.all
    // result can be written to homeCache in one piece, without re-reading React state that
    // may not have settled yet.
    const [balanceResult, totalAssetsResult, chainBalancesResult] = await Promise.all([
      fetchEvmBalance().finally(() => setLoadingBalance(false)),
      (displayCurrency === 'USD' ? fetchTotalAssetsUsd(activeWallet.address) : fetchTotalAssetsJpy(activeWallet.address))
        .then((value) => { setTotalAssetsDisplay(value); return value; })
        .catch((e) => { console.error('Failed to fetch total assets', e); return cached?.totalAssetsDisplay ?? 0; })
        .finally(() => setLoadingTotalAssets(false)),
      Promise.all(chainKeys.map(async (key) => {
        const [balances, usdc] = await Promise.all([
          fetchBalances(key, activeWallet.address),
          fetchUsdcBalance(key, activeWallet.address),
        ]);
        return [key, { jpyc: balances.jpyc, usdc }] as const;
      }))
        .then((entries) => {
          const record = Object.fromEntries(entries) as Record<ChainKey, { jpyc: string; usdc: string }>;
          setChainBalances(record);
          return record;
        })
        .catch((e) => { console.error('Failed to fetch per-chain balances', e); return cached?.chainBalances ?? ({} as Record<ChainKey, { jpyc: string; usdc: string }>); })
        .finally(() => setLoadingChainBalances(false)),
    ]);

    // balanceResult is null only on a transient fetchEvmBalance failure (see
    // useEvmBalance.ts) - keep whatever was cached/shown before rather than writing zeros.
    setHomeCache(activeWallet.address, displayCurrency, {
      nativeBalance: balanceResult?.native ?? cached?.nativeBalance ?? '0',
      jpycBalance: balanceResult?.jpyc ?? cached?.jpycBalance ?? '0',
      usdcBalance: balanceResult?.usdc ?? cached?.usdcBalance ?? '0',
      totalJpyBalance: balanceResult?.totalJpy ?? cached?.totalJpyBalance ?? 0,
      // The transaction list is loaded by the 取引履歴 panel itself, not cached here.
      recentTransactions: [],
      peerNames: {},
      totalAssetsDisplay: totalAssetsResult,
      chainBalances: chainBalancesResult,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEvmBalance, hydrateBalances, displayCurrency]);

  useEffect(() => {
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (needsUpdate) {
      update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsUpdate]);

  // Re-fetch when 表示通貨 changes while Home is already mounted (e.g. switched in Settings
  // and then navigated back), so the balance-card slot and total-assets figure reflect the
  // newly selected currency right away instead of only on the next full reload.
  useEffect(() => {
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayCurrency]);

  const iconSx = { fontSize: { xs: 28, sm: 34 }, color: 'primary.main' };
  const actionButtons: {
    key: string; label: string; icon: ReactNode; onClick: () => void; panel?: 'receive' | 'send' | 'scan' | 'transaction' | 'balance';
  }[] = [
    { key: 'receive', label: t('home.receive'), icon: <Box component="img" src={iconReceive} sx={{ height: { xs: 28, sm: 34 } }} />, onClick: () => togglePanel('receive'), panel: 'receive' },
    { key: 'send', label: t('home.send'), icon: <Box component="img" src={iconSend} sx={{ height: { xs: 28, sm: 34 } }} />, onClick: () => togglePanel('send'), panel: 'send' },
    { key: 'scan', label: t('home.scan'), icon: <Box component="img" src={iconScan} sx={{ height: { xs: 28, sm: 34 } }} />, onClick: () => togglePanel('scan'), panel: 'scan' },
    { key: 'transaction', label: t('home.transaction_ribbon'), icon: <ReceiptLongOutlinedIcon sx={iconSx} />, onClick: () => togglePanel('transaction'), panel: 'transaction' },
    {
      key: 'balance',
      label: displayCurrency === 'USD' ? t('home.usdc_balance_label') : t('home.jpyc_balance_label'),
      icon: displayCurrency === 'USD' ? <AttachMoneyIcon sx={iconSx} /> : <CurrencyYenIcon sx={iconSx} />,
      onClick: () => togglePanel('balance'),
      panel: 'balance',
    },
  ];

  return (
    <Box sx={{ width: '100%', px: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', mt: 5 }}>
        <Card sx={{ background: 'linear-gradient(135deg, #92D6CD 0%, #3E867D 100%)', position: 'relative', overflow: 'hidden' }}>
          {/* Balance no longer doubles as a link to the transaction history (that's the
              Transaction card below), nor to the per-chain asset list (that's the トークン
              slot in the bottom nav, see Top.tsx) - it just shows the wallet's address and
              the JPYC total. Laid out address-then-balance, on a teal gradient (matching
              the uploaded reference color) with the same diamond illustration this card
              used to carry before it was briefly swapped for the send/swap complete
              screens' crystal illustration - the "Balance" ribbon
              itself is kept as-is (still orange). */}
          <Box
            component="img"
            src={balanceCardBackground}
            sx={{ position: 'absolute', right: 0, bottom: 0, maxWidth: 220, width: '60%', pointerEvents: 'none' }}
          />
          <Box sx={{ position: 'relative', px: 2, pt: 1.5, pb: 2 }}>
            <IconButton
              size="small"
              onClick={() => setShowTotalAssets((v) => !v)}
              aria-label={showTotalAssets
                ? (displayCurrency === 'USD' ? t('home.switch_to_usdc_balance') : t('home.switch_to_jpyc_balance'))
                : t('home.switch_to_total_assets')}
              sx={{ position: 'absolute', top: 4, right: 4, color: 'white' }}
            >
              {showTotalAssets
                ? (displayCurrency === 'USD' ? <AttachMoneyIcon fontSize="small" /> : <CurrencyYenIcon fontSize="small" />)
                : <AccountBalanceWalletIcon fontSize="small" />}
            </IconButton>

            {/* This card's content (address/balance) already sits inside a Box with px:2
                padding (see above), so ml:0 here keeps the ribbon's left edge flush with
                that padding instead of adding CardRibbon's default ml:2 on top of it - the
                same 16px-from-card-edge alignment as the Transaction/JPYC ribbons below,
                which have no such padding and so keep the default ml:2. */}
            <CardRibbon text={t('home.balance_ribbon')} bgcolor="nemOrange" icon={<AccountBalanceWalletOutlinedIcon sx={{ fontSize: 14, color: 'white' }} />} sx={{ ml: 0 }} />

            <Box sx={{ mt: 2 }}>
              <Typography sx={{ fontSize: { xs: '0.85rem', sm: '1rem' }, color: 'rgba(255,255,255,0.9)' }}>{t('home.address_label')}</Typography>
              <Box
                onClick={onCopyAddress}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: address ? 'pointer' : 'default', width: 'fit-content' }}
              >
                <Typography sx={{ fontSize: { xs: '0.95rem', sm: '1.2rem' }, color: 'white', fontWeight: 'bold', wordBreak: 'break-all' }}>
                  {address || '-'}
                </Typography>
                {address && <ContentCopyIcon sx={{ fontSize: { xs: 18, sm: 22 }, color: 'rgba(255,255,255,0.9)', flexShrink: 0 }} />}
              </Box>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography sx={{ fontSize: { xs: '0.85rem', sm: '1rem' }, color: 'rgba(255,255,255,0.9)' }}>
                {showTotalAssets
                  ? t('home.total_assets_label')
                  : (displayCurrency === 'USD' ? t('home.usdc_balance_label') : t('home.jpyc_balance_label'))}
              </Typography>
              {(showTotalAssets ? loadingTotalAssets : loadingBalance) ? (
                <CircularProgress size={22} sx={{ color: 'white', mt: 0.5 }} />
              ) : (
                <Typography sx={{ fontSize: { xs: '2.25rem', sm: '3rem' }, color: 'white', fontWeight: 'bold', lineHeight: 1.2 }}>
                  {showTotalAssets
                    ? new Intl.NumberFormat(displayCurrency === 'USD' ? 'en-US' : 'ja-JP', { style: 'currency', currency: displayCurrency === 'USD' ? 'USD' : 'JPY' }).format(totalAssetsDisplay)
                    : Number(displayCurrency === 'USD' ? usdcBalance : jpycBalance).toLocaleString()}
                </Typography>
              )}
            </Box>
          </Box>
        </Card>

        {/* 期日が来た予約送金(1タップで承認画面へ)。無ければ何も出ない */}
        <ScheduledDueBanner refreshKey={needsUpdate} />

        <Card sx={{ mt: 2 }}>
          {/* Five buttons under the balance card. 受け取る/送る/スキャン re-select the
              matching in-page tab (via the same ?tab= query param Top.tsx's own tab switcher
              uses, so cross-tab state such as an in-progress Send address is preserved).
              取引履歴/残高 instead open their content in a panel directly below this row
              (these used to be two always-visible cards with ribbon headers); the button
              itself now acts as the header, and is highlighted while its panel is open. */}
          <Box sx={{ display: 'flex' }}>
            {actionButtons.map((btn, i) => {
              const selected = btn.panel !== undefined && panel === btn.panel;
              return (
                <Button
                  key={btn.key}
                  onClick={btn.onClick}
                  aria-pressed={btn.panel !== undefined ? selected : undefined}
                  sx={{
                    flex: 1, minWidth: 0, flexDirection: 'column', gap: 0.5, py: 2, px: 0.25, borderRadius: 0,
                    color: selected ? 'primary.main' : 'text.primary', textTransform: 'none',
                    bgcolor: selected ? 'rgba(0, 195, 178, 0.1)' : 'transparent',
                    borderLeft: i === 0 ? 'none' : '0.5px solid', borderColor: 'divider',
                  }}
                >
                  {btn.icon}
                  <Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.95rem' }, lineHeight: 1.3, textAlign: 'center', overflowWrap: 'anywhere', maxWidth: '100%', letterSpacing: 0, fontWeight: selected ? 'bold' : 'normal' }}>{btn.label}</Typography>
                </Button>
              );
            })}
          </Box>
        </Card>

        {panel === 'receive' && (
        <Box sx={{ mt: 2, mb: 2 }}><Receive /></Box>
        )}

        {panel === 'send' && (
        <Box sx={{ mt: 2, mb: 2 }}><SendForm jpycOnly /></Box>
        )}

        {panel === 'scan' && (
        // カメラは、スキャンのパネルが開いている間だけ起動する(閉じると Scan ごとアンマウントされる)。
        <Box sx={{ mt: 2, mb: 2, borderRadius: 2, overflow: 'hidden' }}><Scan isActive /></Box>
        )}

        {panel === 'transaction' && (
        <Box sx={{ mt: 2, mb: 2 }}><TransactionHistory /></Box>
        )}

        {panel === 'balance' && (
        <Box sx={{ mt: 2, mb: 2 }}>
          {/* Chain-by-chain breakdown of whichever stablecoin the Balance card is
              currently keyed to (JPYC normally, USDC when 表示通貨 is set to USD) - shows
              every supported chain's tile, even a zero balance, same convention as the
              always-shown rows on the Balance/トークン screen. 1チェーン=1つの正方形タイル。 */}
          {loadingChainBalances ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 64 }}>
              <CircularProgress color="primary" />
            </Box>
          ) : (
            <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5 }}>
              {chainKeys.map((key) => (
                <Box
                  key={key}
                  sx={{
                    aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 0.75, p: 1.5, borderRadius: 2, textAlign: 'center',
                    border: 1, borderColor: 'divider', bgcolor: 'background.paper',
                  }}
                >
                  {/* Leading icon is the JPYC/USDC logo itself (not the chain's native-coin
                      logo) with the chain badge in the corner - same "token icon + network
                      badge" convention as the Balance/トークン screen - so this tile can't
                      be mistaken for a native-currency (ETH/POL/AVAX/KAIA) balance. */}
                  <Box sx={{ position: 'relative', flexShrink: 0 }}>
                    <Box
                      component="img"
                      src={getTokenIcon(displayCurrency === 'USD' ? 'USDC' : 'JPYC') ?? undefined}
                      sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#fff', display: 'block' }}
                    />
                    <Box
                      component="img"
                      src={CHAIN_ICONS[key]}
                      sx={{
                        position: 'absolute', right: -2, bottom: -2, width: 20, height: 20,
                        borderRadius: '50%', border: '2px solid', borderColor: 'background.paper',
                      }}
                    />
                  </Box>
                  <Typography noWrap sx={{ fontSize: '1rem', fontWeight: 'bold', width: '100%' }}>{CHAINS[key].name}</Typography>
                  <Typography sx={{ fontSize: { xs: '1.4rem', sm: '1.55rem' }, fontWeight: 700, lineHeight: 1.2, width: '100%', overflowWrap: 'anywhere' }}>
                    {Number(displayCurrency === 'USD' ? chainBalances[key]?.usdc ?? '0' : chainBalances[key]?.jpyc ?? '0').toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: -0.5 }}>
                    {displayCurrency === 'USD' ? 'USDC' : 'JPYC'}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
        )}
      </Box>

      <Snackbar
        open={addressCopied}
        autoHideDuration={2000}
        onClose={() => setAddressCopied(false)}
        message={t('home.address_copied')}
      />
    </Box>
  );
}
