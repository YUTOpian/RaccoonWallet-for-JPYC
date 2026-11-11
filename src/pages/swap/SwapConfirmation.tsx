import { useState } from 'react';
import { Box, Typography, IconButton, AppBar, Toolbar } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import MessageDialog from '../../components/MessageDialog';
import PasswordDialog from '../../components/PasswordDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { WalletsHelper, SwapHistoryHelper } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import { chainTargetFromKey, getExternalSigner, isExternalWalletError } from '../../lib/externalWallet';
import type { SignerSource } from '../../lib/signer';
import { executeSwap, parseSwapError } from '../../lib/uniswap';
import { useAppStore } from '../../store/appStore';
import heroSwapSmall from '../../assets/heroimage_send_small.png';
import iconPinSmall from '../../assets/icon_pin_small.png';

export default function SwapConfirmation() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const swapChain = useAppStore((s) => s.swapChain);
  const swapTokenIn = useAppStore((s) => s.swapTokenIn);
  const swapTokenOut = useAppStore((s) => s.swapTokenOut);
  const swapAmountIn = useAppStore((s) => s.swapAmountIn);
  const swapQuote = useAppStore((s) => s.swapQuote);
  const swapSlippageBps = useAppStore((s) => s.swapSlippageBps);
  const setLastSwapHash = useAppStore((s) => s.setLastSwapHash);

  const [showCaution, setShowCaution] = useState(true);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [swapErrorDetail, setSwapErrorDetail] = useState<string | null>(null);

  const chainConfig = CHAINS[swapChain];

  // Should never actually render without these (SwapTop only allows /swap/confirmation
  // once tokenIn/tokenOut/quote are all set), but guards against a direct URL visit.
  if (!swapTokenIn || !swapTokenOut || !swapQuote) {
    return (
      <Box sx={{ height: '100%' }}>
        <AppToolBar back="/swap" title={t('swap.confirmation_title')} />
        <Box sx={{ px: 2, mt: 4 }}>
          <Typography>{t('swap.quote_unavailable')}</Typography>
        </Box>
      </Box>
    );
  }

  // pin === null: MetaMask / Bitget Wallet で接続中のウォレット。PIN は使わず、署名は拡張側で承認する。
  const onPassed = async (pin: string | null) => {
    setSwapping(true);
    try {
      const activeWallet = await WalletsHelper.getActive();
      if (!activeWallet) {
        return;
      }
      let privateKey: SignerSource;
      if (activeWallet.externalProvider) {
        privateKey = await getExternalSigner(
          activeWallet.externalProvider, activeWallet.address, chainTargetFromKey(swapChain),
        );
      } else {
        const decrypted = pin == null ? null : await WalletsHelper.decryptKey(activeWallet.id, pin);
        if (decrypted == null) {
          setErrorMessage(t('wallet.invalid_key'));
          return;
        }
        privateKey = decrypted;
      }

      const result = await executeSwap(
        swapChain,
        privateKey,
        swapTokenIn,
        swapTokenOut,
        swapAmountIn,
        swapQuote,
        activeWallet.address,
        swapSlippageBps,
      );

      await SwapHistoryHelper.add({
        id: `${result.hash}`,
        chain: swapChain,
        tokenInSymbol: swapTokenIn.symbol,
        tokenOutSymbol: swapTokenOut.symbol,
        amountIn: swapAmountIn,
        amountOut: result.amountOut,
        hash: result.hash,
        timestamp: Date.now(),
      });

      setLastSwapHash(result.hash);
      navigate('/swap/complete');
    } catch (error) {
      if (isExternalWalletError(error)) {
        setErrorMessage(t(`external.error_${error.code}`));
        return;
      }
      if ((error as { code?: string } | null)?.code === 'ACTION_REJECTED') {
        setErrorMessage(t('external.error_rejected'));
        return;
      }
      console.error('Swap failed', error);
      const parsed = parseSwapError(error);
      setSwapErrorDetail(t(`swap.error_detail_${parsed.kind}`));
    } finally {
      setSwapping(false);
    }
  };

  return (
    <Box sx={{ height: '100dvh' }}>
      <AppToolBar back="/swap" title={t('swap.confirmation_title')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box component="img" src={heroSwapSmall} sx={{ width: '100%' }} />

        <Box sx={{ px: 2 }}>
          <Typography sx={{ color: 'primary.main' }}>{t('swap.from')}</Typography>
          <Typography sx={{ fontSize: 'large' }}>{swapAmountIn} {swapTokenIn.symbol}</Typography>

          <Typography sx={{ color: 'primary.main', mt: 1 }}>{t('swap.to')}</Typography>
          <Typography sx={{ fontSize: 'large' }}>
            {t('common.approx')} {swapQuote.amountOut} {swapTokenOut.symbol}
          </Typography>

          <Typography sx={{ color: 'primary.main', mt: 1 }}>{t('swap.network')}</Typography>
          <Typography>{chainConfig.name} (Uniswap V4)</Typography>

          {swapQuote.route && (
            <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 1 }}>
              {t('swap.route_via', { symbol: swapQuote.route.intermediary.symbol })}
            </Typography>
          )}

          <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 1 }}>
            {t('swap.slippage_note_dynamic', { percent: swapSlippageBps / 100 })}
          </Typography>
        </Box>
      </Box>

      <MessageDialog
        open={showCaution}
        title={t('swap.confirmation_title')}
        texts={t('swap.confirmation_dialog_message', { returnObjects: true }) as string[]}
        onClose={() => setShowCaution(false)}
      />

      <Box sx={{ position: 'sticky', bottom: 0, maxWidth: 480 }}>
        <AppBar position="static" color="default">
          <Toolbar sx={{ justifyContent: 'center' }}>
            <Typography>{swapping ? t('swap.swapping') : t('swap.confirmation_ready')}</Typography>
            <IconButton
              disabled={swapping}
              onClick={async () => {
                if ((await WalletsHelper.getActive())?.externalProvider) {
                  await onPassed(null);
                } else {
                  setShowPasswordDialog(true);
                }
              }}
              sx={{ bgcolor: 'white', mx: 1, width: 40, height: 40 }}
            >
              <Box component="img" src={iconPinSmall} sx={{ width: '100%' }} />
            </IconButton>
            <Typography>{t('swap.confirmation_pin')}</Typography>
          </Toolbar>
        </AppBar>
        <Box sx={{ width: '100%', height: 4, bgcolor: 'primary.main' }} />
      </Box>

      <PasswordDialog open={showPasswordDialog} mode="check" onClose={() => setShowPasswordDialog(false)} onPass={onPassed} />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
      <MessageDialog
        open={swapErrorDetail != null}
        title={t('swap.error_title')}
        texts={swapErrorDetail != null ? [swapErrorDetail] : []}
        onClose={() => setSwapErrorDetail(null)}
      />
    </Box>
  );
}
