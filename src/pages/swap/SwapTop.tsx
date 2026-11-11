import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, MenuItem, IconButton, Menu, Avatar, Slider,
  TextField, Button, CircularProgress,
} from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import iconWallet from '../../assets/icon_wallet.png';
import { CHAINS, fetchBalances, fetchSingleTokenBalance } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { getTokenIcon } from '../../lib/tokenIcons';
import { WalletsHelper } from '../../lib/storage';
import { SWAP_CHAINS, getSwapTokens, fetchSwapQuote, isSwapSupported, usesForcedHubFallback, resolveForcedHubCounterpart } from '../../lib/uniswap';
import type { SwapChain, SwapToken, SwapQuote } from '../../lib/uniswap';
import { useAppStore } from '../../store/appStore';

// Rounded "grey card" look used throughout this screen (chain selector, from/to token
// boxes) - pulled out once so every card shares the exact same background/radius/padding
// rather than repeating the sx object at each call site.
const CARD_SX = { bgcolor: 'grey.100', borderRadius: 3, px: 2, py: 1.5 } as const;

// 横に広がりすぎないよう、画面全体の内容幅の上限(PC・タブレットでも中央に収める)。
// スマホ幅では480pxの1カラム。PC・タブレット(md以上)では左右2カラムにして、横の空白を使う。
const CONTENT_MAX_WIDTH = 480;
const CONTENT_MAX_WIDTH_WIDE = 1040;
const COLUMN_SX = { display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 } as const;

// Preset slippage-tolerance options, in basis points (100 = 1%) - the recommended stops
// shown as tick marks on the 0.1%-3% gauge below, plus a free-text field for anything
// outside that range. Bounds guard against a value that would make the swap either
// revert-prone (too tight) or dangerously exposed to price movement (too loose).
const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 300];
const MIN_SLIPPAGE_BPS = 1; // 0.01%
const MAX_SLIPPAGE_BPS = 5000; // 50%
// The gauge itself only covers 0.1%-3% (SLIPPAGE_PRESETS_BPS' own min/max) in 0.1% steps -
// wide enough for everyday use and far easier to drag precisely than the old four small
// buttons. Anything outside this range (looser than 3%) still needs the custom field.
const SLIPPAGE_GAUGE_MIN_BPS = SLIPPAGE_PRESETS_BPS[0];
const SLIPPAGE_GAUGE_MAX_BPS = SLIPPAGE_PRESETS_BPS[SLIPPAGE_PRESETS_BPS.length - 1];
const SLIPPAGE_GAUGE_STEP_BPS = 10; // 0.1%
// The value new users land on before touching anything - matches useAppStore's own default
// for swapSlippageBps, so the gauge and the actual initial setting never disagree.
const RECOMMENDED_SLIPPAGE_BPS = 100; // 1%

export default function SwapTop() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const swapChain = useAppStore((s) => s.swapChain);
  const setSwapChain = useAppStore((s) => s.setSwapChain);
  const swapTokenIn = useAppStore((s) => s.swapTokenIn);
  const setSwapTokenIn = useAppStore((s) => s.setSwapTokenIn);
  const swapTokenOut = useAppStore((s) => s.swapTokenOut);
  const setSwapTokenOut = useAppStore((s) => s.setSwapTokenOut);
  const swapAmountIn = useAppStore((s) => s.swapAmountIn);
  const setSwapAmountIn = useAppStore((s) => s.setSwapAmountIn);
  const setSwapQuote = useAppStore((s) => s.setSwapQuote);
  const swapSlippageBps = useAppStore((s) => s.swapSlippageBps);
  const setSwapSlippageBps = useAppStore((s) => s.setSwapSlippageBps);

  // activeChain may be Kaia (from the send/balance flows) which doesn't support swapping -
  // fall back to the first supported chain rather than land on an invalid selection.
  const [chain, setChain] = useState<SwapChain>(isSwapSupported(swapChain) ? swapChain : 'ethereum');
  const [tokens, setTokens] = useState<SwapToken[]>([]);
  const [tokenIn, setTokenIn] = useState<SwapToken | null>(swapTokenIn);
  const [tokenOut, setTokenOut] = useState<SwapToken | null>(swapTokenOut);
  const [amount, setAmount] = useState(swapAmountIn === '0' ? '' : swapAmountIn);
  const [balance, setBalance] = useState('0.0');
  const [balanceOut, setBalanceOut] = useState('0.0');

  // Anchor elements for the three dropdown menus this screen now uses (chain / from-token /
  // to-token) - each rendered as a tappable card/pill instead of a native <Select>, to match
  // the reference layout, but still backed by the same chain/tokenIn/tokenOut state.
  const [chainMenuAnchor, setChainMenuAnchor] = useState<null | HTMLElement>(null);
  const [tokenInMenuAnchor, setTokenInMenuAnchor] = useState<null | HTMLElement>(null);
  const [tokenOutMenuAnchor, setTokenOutMenuAnchor] = useState<null | HTMLElement>(null);

  // Quick "% of balance" slider shown above the from-card, same idea as most swap UIs'
  // 25/50/75/MAX shortcuts. Purely a convenience for filling the amount field - it only
  // writes into `amount` when dragged; it does not try to stay in sync when the person
  // edits the amount field directly afterward.
  const [balancePct, setBalancePct] = useState(0);
  const onBalancePctChange = (pct: number) => {
    setBalancePct(pct);
    const bal = Number(balance);
    if (!tokenIn || !isFinite(bal) || bal <= 0) return;
    const next = (bal * pct) / 100;
    // Avoid float noise like "12.340000000000002" - trim to the token's own decimals.
    setAmount(next.toFixed(Math.min(tokenIn.decimals, 8)).replace(/\.?0+$/, ''));
  };

  // Which of `tokens` can actually be swapped for which other — no longer used to filter the
  // Selects (see toOptions/fromOptions below): now that fetchSwapQuote/executeSwap can route
  // any pair through USDT/USDC when there's no direct pool (see lib/uniswap.ts), every
  // currency is offered on both sides up front, and the quote step itself is what determines
  // whether a route actually exists for the pair the person picked.
  const [loadingTokens, setLoadingTokens] = useState(true);

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(false);

  // Which side (from/to) the person actually picked - the OTHER side is the one that gets
  // auto-corrected by the forced-hub fallback below when no pool exists for the chosen pair.
  // Sticks to whichever Select the person most recently changed; only updated by the two
  // onChangeTokenIn/onChangeTokenOut handlers below, never by the fallback's own setTokenIn/
  // setTokenOut calls, so a chain of auto-corrections doesn't itself change who's "in charge".
  const [lastPicked, setLastPicked] = useState<'in' | 'out'>('in');
  // Set when the forced-hub fallback (Ethereum/Avalanche only - see usesForcedHubFallback in
  // lib/uniswap.ts) has just swapped in JPYC or USDC on the side the person didn't pick,
  // because no pool existed for their original selection. Shown as a small notice near the
  // quote so the substitution isn't silently invisible.
  const [autoCorrected, setAutoCorrected] = useState<'in' | 'out' | null>(null);

  // Slippage tolerance, edited here as a percentage string (e.g. "1", "0.5") and converted
  // to basis points for the store/executeSwap. A preset chip is "selected" when its bps
  // value matches the current one; picking a preset also clears any stale custom input so
  // the two controls never show conflicting values.
  const [slippageBps, setSlippageBps] = useState(swapSlippageBps);
  const [customSlippage, setCustomSlippage] = useState(() =>
    SLIPPAGE_PRESETS_BPS.includes(swapSlippageBps) ? '' : String(swapSlippageBps / 100)
  );
  const slippageOutOfRange = slippageBps < MIN_SLIPPAGE_BPS || slippageBps > MAX_SLIPPAGE_BPS;

  // Every currency is offered on both sides now that a pair with no direct pool can still be
  // routed through USDT/USDC (see fetchSwapQuote in lib/uniswap.ts), and swapping *into* the
  // native coin is supported too (see executeSwap's multicall+unwrapWETH9 path) - so tokenOut
  // isn't restricted to non-native tokens any more. Whether a route actually exists for the
  // chosen pair is discovered by the quote step below, not by pre-filtering the list.
  const toOptions = tokens;
  const fromOptions = tokens;

  // Load this chain's swap token list whenever the chain changes. Both sides default to
  // unselected (blank) so every supported currency (native coin, JPYC, USDT, USDC, ...) is
  // shown up front - see getSwapTokens/STABLECOINS in lib/uniswap.ts for the full candidate
  // set. Only restore a previous selection (e.g. the person picked tokens, then navigated
  // back from the confirmation screen); never auto-pick a default token ourselves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTokens(true);
      const list = await getSwapTokens(chain);
      if (cancelled) return;
      setTokens(list);

      const findByAddress = (addr: string) => list.find((tk) => tk.address.toLowerCase() === addr.toLowerCase());
      setTokenIn((swapTokenIn && findByAddress(swapTokenIn.address)) ?? null);
      setTokenOut((swapTokenOut && findByAddress(swapTokenOut.address)) ?? null);
      setBalancePct(0);
      setLoadingTokens(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);

  // Available balance of whichever token is currently selected as tokenIn, for reference
  // next to the amount field (same idea as SendAmount's available-balance line).
  useEffect(() => {
    if (!tokenIn) return;
    let cancelled = false;
    (async () => {
      const activeWallet = await WalletsHelper.getActive();
      if (!activeWallet || cancelled) return;
      try {
        if (tokenIn.isNative) {
          const balances = await fetchBalances(chain, activeWallet.address);
          if (!cancelled) setBalance(balances.native);
        } else {
          const raw = await fetchSingleTokenBalance(chain, tokenIn.address, tokenIn.decimals, activeWallet.address);
          if (!cancelled) setBalance(raw);
        }
      } catch (e) {
        console.error('Failed to fetch swap token balance', e);
      }
    })();
    return () => { cancelled = true; };
  }, [chain, tokenIn]);

  // Same as above, for whichever token is currently selected as tokenOut - shown under
  // the 受取 (receive) card so both sides display "what you already hold", not just the
  // side you're spending from.
  useEffect(() => {
    if (!tokenOut) return;
    let cancelled = false;
    (async () => {
      const activeWallet = await WalletsHelper.getActive();
      if (!activeWallet || cancelled) return;
      try {
        if (tokenOut.isNative) {
          const balances = await fetchBalances(chain, activeWallet.address);
          if (!cancelled) setBalanceOut(balances.native);
        } else {
          const raw = await fetchSingleTokenBalance(chain, tokenOut.address, tokenOut.decimals, activeWallet.address);
          if (!cancelled) setBalanceOut(raw);
        }
      } catch (e) {
        console.error('Failed to fetch swap token balance', e);
      }
    })();
    return () => { cancelled = true; };
  }, [chain, tokenOut]);

  // Debounced live quote: re-quotes 400ms after the person stops typing/changing tokens,
  // rather than on every keystroke - V4Quoter calls are real (if free) RPC round trips.
  useEffect(() => {
    setQuote(null);
    setQuoteError(false);
    setAutoCorrected(null);
    if (!tokenIn || !tokenOut || tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
      return;
    }
    const parsed = Number(amount);
    if (!amount || !isFinite(parsed) || parsed <= 0) {
      return;
    }
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const result = await fetchSwapQuote(chain, tokenIn, tokenOut, amount);
        if (result) {
          setQuote(result);
          setQuoteError(false);
          return;
        }

        // No direct pool and no routed (via USDT/USDC) pool either. On Ethereum/Avalanche,
        // where in practice only JPYC<->USDC is reliably liquid, fall back to substituting
        // JPYC or USDC in on whichever side the person DIDN'T just pick (see
        // resolveForcedHubCounterpart) rather than just reporting "no route" - the trade
        // then settles in JPYC when the person picked their "from" token first, or is funded
        // from JPYC when they picked their "to" token first.
        if (usesForcedHubFallback(chain)) {
          const fixedToken = lastPicked === 'in' ? tokenIn : tokenOut;
          const currentOther = lastPicked === 'in' ? tokenOut : tokenIn;
          const counterpart = resolveForcedHubCounterpart(tokens, fixedToken);
          if (counterpart && counterpart.address.toLowerCase() !== currentOther.address.toLowerCase()) {
            setAutoCorrected(lastPicked === 'in' ? 'out' : 'in');
            if (lastPicked === 'in') {
              setTokenOut(counterpart);
            } else {
              setTokenIn(counterpart);
            }
            return; // the token change above re-triggers this effect with the new pair
          }
        }

        setQuoteError(true);
      } catch (e) {
        console.error('Failed to fetch swap quote', e);
        setQuoteError(true);
      } finally {
        setQuoteLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [chain, tokenIn, tokenOut, amount, tokens, lastPicked]);

  // Swapping into or out of the native coin is both supported now (see executeSwap in
  // lib/uniswap.ts), so flipping just needs both sides selected - no native-specific
  // restriction any more.
  const canFlip = !!tokenIn && !!tokenOut;

  const onFlip = useCallback(() => {
    if (!tokenIn || !tokenOut) return;
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setLastPicked((prev) => (prev === 'in' ? 'out' : 'in'));
  }, [tokenIn, tokenOut]);

  // Every currency can be swapped for every other (routing through USDT/USDC covers pairs
  // with no direct pool - see toOptions/fromOptions above), so picking one side no longer
  // needs to narrow or clear the other; whether a route exists is surfaced by the quote step.
  const onChangeTokenIn = (address: string) => {
    setLastPicked('in');
    setTokenIn(tokens.find((tk) => tk.address === address) ?? null);
  };

  const onChangeTokenOut = (address: string) => {
    setLastPicked('out');
    setTokenOut(tokens.find((tk) => tk.address === address) ?? null);
  };

  const sameToken = !!tokenIn && !!tokenOut && tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase();
  const canContinue = !loadingTokens && !!tokenIn && !!tokenOut && !sameToken && !!quote && !quoteLoading && !slippageOutOfRange;

  // Logo for a token pill: the chain's own logo for its native coin, a curated logo for the
  // stablecoins that logo actually depicts (USDT/USDC/JPYC), or null - callers fall back to
  // a plain letter avatar for anything else, rather than guessing at artwork we don't have.
  const tokenIcon = (tk: SwapToken | null): string | null => {
    if (!tk) return null;
    if (tk.isNative) return CHAIN_ICONS[chain];
    return getTokenIcon(tk.symbol);
  };

  const onContinue = () => {
    if (!tokenIn || !tokenOut || !quote || slippageOutOfRange) return;
    setSwapChain(chain);
    setSwapTokenIn(tokenIn);
    setSwapTokenOut(tokenOut);
    setSwapAmountIn(amount);
    setSwapQuote(quote);
    setSwapSlippageBps(slippageBps);
    navigate('/swap/confirmation');
  };

  return (
    <Box sx={{ height: '100%' }}>

      <Box sx={{
        px: 2, mt: 2, pb: 3, mx: 'auto', width: '100%', boxSizing: 'border-box',
        maxWidth: { xs: CONTENT_MAX_WIDTH, md: CONTENT_MAX_WIDTH_WIDE },
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        columnGap: { md: 6 }, rowGap: 2.5, alignItems: 'start',
      }}>
        {/* 左カラム: チェーン + トークン */}
        <Box sx={COLUMN_SX}>
        {/* チェーン - a single tappable card showing the selected chain, opening a menu of
            every swappable chain, in place of the old ToggleButtonGroup row. */}
        <Box>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('swap.chain_label')}</Typography>
          <Box
            onClick={(e) => setChainMenuAnchor(e.currentTarget)}
            sx={{
              bgcolor: 'grey.100', borderRadius: 6, pl: 1, pr: 1.5, height: 44, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 1,
            }}
          >
            <Avatar src={CHAIN_ICONS[chain]} sx={{ width: 28, height: 28 }} />
            <Typography sx={{ fontWeight: 'bold' }}>{CHAINS[chain].name}</Typography>
            <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          </Box>
          <Menu anchorEl={chainMenuAnchor} open={!!chainMenuAnchor} onClose={() => setChainMenuAnchor(null)}>
            {SWAP_CHAINS.map((key) => (
              <MenuItem
                key={key}
                selected={key === chain}
                onClick={() => { setChain(key); setChainMenuAnchor(null); }}
              >
                <Avatar src={CHAIN_ICONS[key]} sx={{ width: 24, height: 24, mr: 1.5 }} />
                {CHAINS[key].name}
              </MenuItem>
            ))}
          </Menu>
          <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>
            {t('swap.kaia_unsupported')}
          </Typography>
        </Box>

        {/* トークン - from/to cards with a swap-direction button overlapping both, matching
            the reference layout. The from-card's slider is a "% of my balance" shortcut for
            filling the amount field; the to-card just mirrors the live quote read-only. */}
        <Box>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('swap.token_label')}</Typography>
          {loadingTokens && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          <Box sx={CARD_SX}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Typography sx={{ color: 'text.secondary' }}>{t('swap.from')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, maxWidth: '65%' }}>
                <Slider
                  size="small"
                  value={balancePct}
                  onChange={(_e, v) => onBalancePctChange(v as number)}
                  disabled={!tokenIn || Number(balance) <= 0}
                />
                <Typography sx={{ color: 'primary.main', fontWeight: 'bold', minWidth: 36, textAlign: 'right' }}>
                  {balancePct}%
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5, gap: 1 }}>
              <Box
                onClick={(e) => !loadingTokens && setTokenInMenuAnchor(e.currentTarget)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'background.paper',
                  borderRadius: 5, pl: 0.5, pr: 1, py: 0.5, cursor: 'pointer', flexShrink: 0,
                }}
              >
                <Avatar src={tokenIcon(tokenIn) ?? undefined} sx={{ width: 28, height: 28, bgcolor: 'primary.light', fontSize: 13 }}>
                  {tokenIn?.symbol.charAt(0) ?? '?'}
                </Avatar>
                <Typography sx={{ fontWeight: 'bold' }}>{tokenIn?.symbol ?? t('swap.select_token')}</Typography>
                <ArrowDropDownIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </Box>
              <TextField
                variant="standard"
                type="number"
                slotProps={{
                  htmlInput: { min: 0, step: 'any', style: { textAlign: 'right', fontSize: 28, fontWeight: 700 } },
                  input: { disableUnderline: true },
                }}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setBalancePct(0); }}
                placeholder="0"
                sx={{ minWidth: 0 }}
              />
            </Box>
            <Menu anchorEl={tokenInMenuAnchor} open={!!tokenInMenuAnchor} onClose={() => setTokenInMenuAnchor(null)}>
              {fromOptions.map((tk) => (
                <MenuItem
                  key={tk.address}
                  selected={tk.address === tokenIn?.address}
                  onClick={() => { onChangeTokenIn(tk.address); setTokenInMenuAnchor(null); }}
                >
                  <Avatar src={tokenIcon(tk) ?? undefined} sx={{ width: 24, height: 24, mr: 1.5, fontSize: 12 }}>
                    {tk.symbol.charAt(0)}
                  </Avatar>
                  {tk.symbol}
                </MenuItem>
              ))}
            </Menu>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
              <Box component="img" src={iconWallet} alt="" sx={{ width: 16, height: 16 }} />
              <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>{balance}</Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'center', mt: -2.5, mb: -2.5, position: 'relative', zIndex: 1 }}>
            <IconButton
              onClick={onFlip}
              disabled={!canFlip}
              sx={{
                bgcolor: 'background.paper', border: '4px solid', borderColor: 'background.default',
                boxShadow: 2, '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <SwapVertIcon color={canFlip ? 'primary' : 'disabled'} />
            </IconButton>
          </Box>

          <Box sx={CARD_SX}>
            <Typography sx={{ color: 'text.secondary' }}>{t('swap.to')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5, gap: 1 }}>
              <Box
                onClick={(e) => !loadingTokens && setTokenOutMenuAnchor(e.currentTarget)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'background.paper',
                  borderRadius: 5, pl: 0.5, pr: 1, py: 0.5, cursor: 'pointer', flexShrink: 0,
                }}
              >
                <Avatar src={tokenIcon(tokenOut) ?? undefined} sx={{ width: 28, height: 28, bgcolor: 'secondary.light', fontSize: 13 }}>
                  {tokenOut?.symbol.charAt(0) ?? '?'}
                </Avatar>
                <Typography sx={{ fontWeight: 'bold' }}>{tokenOut?.symbol ?? t('swap.select_token')}</Typography>
                <ArrowDropDownIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </Box>
              <Typography sx={{ fontSize: 28, fontWeight: 700, color: quote ? 'text.primary' : 'text.disabled' }}>
                {quote ? quote.amountOut : '0'}
              </Typography>
            </Box>
            <Menu anchorEl={tokenOutMenuAnchor} open={!!tokenOutMenuAnchor} onClose={() => setTokenOutMenuAnchor(null)}>
              {toOptions.map((tk) => (
                <MenuItem
                  key={tk.address}
                  selected={tk.address === tokenOut?.address}
                  onClick={() => { onChangeTokenOut(tk.address); setTokenOutMenuAnchor(null); }}
                >
                  <Avatar src={tokenIcon(tk) ?? undefined} sx={{ width: 24, height: 24, mr: 1.5, fontSize: 12 }}>
                    {tk.symbol.charAt(0)}
                  </Avatar>
                  {tk.symbol}
                </MenuItem>
              ))}
            </Menu>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
              <Box component="img" src={iconWallet} alt="" sx={{ width: 16, height: 16 }} />
              <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>{balanceOut}</Typography>
            </Box>
          </Box>

          <Box sx={{ mt: 1.5, minHeight: 48 }}>
            {sameToken ? (
              <Typography sx={{ color: 'error.main', fontSize: 14 }}>{t('swap.same_token_error')}</Typography>
            ) : quoteLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('swap.quote_loading')}</Typography>
              </Box>
            ) : quoteError ? (
              <Typography sx={{ color: 'error.main', fontSize: 14 }}>{t('swap.quote_unavailable')}</Typography>
            ) : quote ? (
              <Box>
                {autoCorrected && (
                  <Typography sx={{ color: 'warning.main', fontSize: 12, mb: 0.5 }}>
                    {t('swap.forced_hub_notice', {
                      symbol: autoCorrected === 'out' ? tokenOut?.symbol : tokenIn?.symbol,
                    })}
                  </Typography>
                )}
                <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                  {quote.route
                    ? t('swap.route_via', { symbol: quote.route.intermediary.symbol })
                    : t('swap.rate_via')}
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Box>

        </Box>

        {/* 右カラム: 最大スリッページ + 確認ボタン(スマホ幅では左カラムの下に続く) */}
        <Box sx={COLUMN_SX}>
        {/* 最大スリッページ - a 0.1%-3% gauge (tick marks at the same four values the old
            buttons offered) replaces those buttons, which were too small a hit-target on
            mobile. Anything looser than the gauge's 3% ceiling still goes through the
            custom field below. */}
        <Box>
          <Typography sx={{ fontWeight: 'bold', mb: 0.5 }}>{t('swap.slippage_label')}</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 12, mb: 1 }}>
            {t('swap.slippage_recommended_note', { percent: RECOMMENDED_SLIPPAGE_BPS / 100 })}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1 }}>
            <Slider
              sx={{ flexGrow: 1 }}
              min={SLIPPAGE_GAUGE_MIN_BPS}
              max={SLIPPAGE_GAUGE_MAX_BPS}
              step={SLIPPAGE_GAUGE_STEP_BPS}
              marks={SLIPPAGE_PRESETS_BPS.map((bps) => ({ value: bps, label: `${bps / 100}%` }))}
              value={customSlippage === '' ? Math.min(Math.max(slippageBps, SLIPPAGE_GAUGE_MIN_BPS), SLIPPAGE_GAUGE_MAX_BPS) : SLIPPAGE_GAUGE_MIN_BPS}
              disabled={customSlippage !== ''}
              valueLabelDisplay="off"
              onChange={(_e, v) => {
                setSlippageBps(v as number);
                setCustomSlippage('');
              }}
            />
            <Typography sx={{ minWidth: 44, textAlign: 'right', fontWeight: 'bold', color: customSlippage === '' ? 'primary.main' : 'text.disabled' }}>
              {customSlippage === '' ? `${slippageBps / 100}%` : '-'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            <TextField
              size="small"
              type="number"
              sx={{ width: 120, flexShrink: 0 }}
              slotProps={{ htmlInput: { min: 0.01, max: 50, step: 0.01 } }}
              placeholder={t('swap.slippage_custom_placeholder')}
              value={customSlippage}
              onChange={(e) => {
                const raw = e.target.value;
                setCustomSlippage(raw);
                const pct = Number(raw);
                if (raw !== '' && isFinite(pct)) {
                  setSlippageBps(Math.round(pct * 100));
                }
              }}
            />
            <Typography sx={{ fontSize: 14 }}>%</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{t('swap.slippage_custom_hint')}</Typography>
          </Box>

          {slippageOutOfRange ? (
            <Typography sx={{ color: 'error.main', fontSize: 12, mt: 0.5 }}>
              {t('swap.slippage_out_of_range', { min: MIN_SLIPPAGE_BPS / 100, max: MAX_SLIPPAGE_BPS / 100 })}
            </Typography>
          ) : (
            <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>{t('swap.slippage_help')}</Typography>
          )}
        </Box>

        <Button
          variant="contained"
          fullWidth
          size="large"
          disabled={!canContinue}
          onClick={onContinue}
          sx={{ borderRadius: 3, py: 1.25 }}
        >
          {t('swap.continue')}
        </Button>
        </Box>
      </Box>

    </Box>
  );
}
