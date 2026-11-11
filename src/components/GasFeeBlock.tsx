import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CHAINS, fetchBalances, fetchNativeJpyRate } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { assessGas, formatNative, formatYen, suggestedTopUp, toJpy } from '../lib/gas';
import { getSwapTokens, isSwapSupported } from '../lib/uniswap';
import { useAppStore } from '../store/appStore';

interface Props {
  /** カスタムEVMなど、残高・為替が取れない鎖では null(手数料の表示だけ行い、不足判定はしない)。 */
  chain: ChainKey | null;
  address: string | null;
  /** 見積り済みの手数料(ネイティブ通貨)。計算中は 'loading'、取れなければ null。 */
  fee: string | null | 'loading';
  nativeSymbol: string;
  /** ネイティブ通貨そのものを送る時の送金額(JPYC/トークンなら省略)。 */
  nativeSendAmount?: string;
  /** ガスレス送金を選べるか(JPYC送金で、リレイヤーがこの鎖に対応している時だけ true)。 */
  gaslessAvailable: boolean;
  gasless: boolean;
  onGaslessChange: (value: boolean) => void;
  /** ガス代が足りず送金できない状態かどうかを親に伝える(送信ボタンを止めるため)。 */
  onBlockedChange: (blocked: boolean) => void;
  label: string;
}

/**
 * 「ガス代」の行。手数料をネイティブ通貨と円で出し、残高が足りなければ理由と、
 * 次の一手(ガスレスで送る/スワップで調達/受け取る)を出す。
 */
export default function GasFeeBlock({ chain, address, fee, nativeSymbol, nativeSendAmount, gaslessAvailable, gasless, onGaslessChange, onBlockedChange, label }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    if (chain === null || address === null) return;
    const [balances, jpyRate] = await Promise.allSettled([fetchBalances(chain, address), fetchNativeJpyRate(chain)]);
    setBalance(balances.status === 'fulfilled' ? balances.value.native : null);
    setRate(jpyRate.status === 'fulfilled' ? jpyRate.value : null);
  }, [chain, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const feeValue = fee === 'loading' ? null : fee;
  const assessment = assessGas({ fee: feeValue, balance, nativeSendAmount });
  const short = chain !== null && (assessment.status === 'low' || assessment.status === 'empty');
  const blocked = short && !gasless;

  useEffect(() => {
    onBlockedChange(blocked);
  }, [blocked, onBlockedChange]);

  const yen = (native: string | null) => {
    const v = toJpy(native, rate);
    return v === null ? null : formatYen(v);
  };

  let feeText: string;
  if (gasless) {
    feeText = t('gas.fee_gasless', { symbol: nativeSymbol });
  } else if (fee === 'loading') {
    feeText = t('send.fee_estimating');
  } else if (fee === null) {
    feeText = t('send.fee_estimate_unavailable');
  } else {
    const fiat = yen(fee);
    feeText = fiat === null
      ? t('gas.fee_value_native', { fee: formatNative(fee), symbol: nativeSymbol })
      : t('gas.fee_value', { fee: formatNative(fee), symbol: nativeSymbol, yen: fiat });
  }

  const onReload = async () => {
    setReloading(true);
    try {
      await load();
    } finally {
      setReloading(false);
    }
  };

  const onSwap = async () => {
    if (chain === null || !isSwapSupported(chain)) return;
    const tokens = await getSwapTokens(chain);
    const jpyc = tokens.find((tk) => tk.address.toLowerCase() === CHAINS[chain].jpycAddress.toLowerCase()) ?? null;
    const native = tokens.find((tk) => tk.isNative) ?? null;
    const store = useAppStore.getState();
    store.setSwapChain(chain);
    store.setSwapTokenIn(jpyc);
    store.setSwapTokenOut(native);
    navigate('/swap');
  };

  const topUp = suggestedTopUp(feeValue);
  const topUpYen = yen(topUp);

  return (
    <>
      <Box sx={{ px: 3, py: 2 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.04em' }}>{label}</Typography>
        <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{feeText}</Typography>
        {gasless && <Typography variant="caption" color="text.secondary">{t('gas.gasless_hint')}</Typography>}
      </Box>

      {short && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Alert severity={gasless ? 'info' : 'warning'} sx={{ alignItems: 'flex-start' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.92rem' }}>{t('gas.short_title', { symbol: nativeSymbol })}</Typography>
            <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>
              {assessment.status === 'empty'
                ? t('gas.short_empty', { symbol: nativeSymbol })
                : t('gas.short_low', { symbol: nativeSymbol, need: formatNative(assessment.need ?? '0'), balance: formatNative(balance ?? '0') })}
            </Typography>
            {topUp !== null && (
              <Typography sx={{ fontSize: '0.8rem', mt: 0.5, color: 'text.secondary' }}>
                {topUpYen === null
                  ? t('gas.suggest_native', { amount: formatNative(topUp), symbol: nativeSymbol })
                  : t('gas.suggest', { amount: formatNative(topUp), symbol: nativeSymbol, yen: topUpYen })}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.5, alignItems: 'stretch' }}>
              {gaslessAvailable && (
                <Button
                  variant={gasless ? 'outlined' : 'contained'}
                  size="small"
                  onClick={() => onGaslessChange(!gasless)}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  {gasless ? t('gas.gasless_off') : t('gas.gasless_use')}
                </Button>
              )}
              {!gasless && assessment.status === 'low' && chain !== null && isSwapSupported(chain) && (
                <>
                  <Button variant="outlined" size="small" onClick={onSwap} sx={{ textTransform: 'none' }}>
                    {t('gas.swap_cta', { symbol: nativeSymbol })}
                  </Button>
                  <Typography variant="caption" color="text.secondary">{t('gas.swap_note', { symbol: nativeSymbol })}</Typography>
                </>
              )}
              {!gasless && (
                <Button variant="outlined" size="small" onClick={() => navigate('/top?tab=receive')} sx={{ textTransform: 'none' }}>
                  {t('gas.receive_cta', { symbol: nativeSymbol })}
                </Button>
              )}
              {!gasless && assessment.status === 'empty' && !gaslessAvailable && (
                <Typography variant="caption" color="text.secondary">
                  {t('gas.empty_note', { symbol: nativeSymbol })}{' '}
                  <Box component="span" onClick={() => navigate('/settings/top')} sx={{ color: 'primary.main', textDecoration: 'underline', cursor: 'pointer' }}>
                    {t('gas.setup_gasless')}
                  </Box>
                </Typography>
              )}
              {!gasless && (
                <Button size="small" onClick={onReload} disabled={reloading} sx={{ textTransform: 'none' }}>
                  {t('gas.recheck')}
                </Button>
              )}
            </Box>
          </Alert>
        </Box>
      )}
    </>
  );
}
