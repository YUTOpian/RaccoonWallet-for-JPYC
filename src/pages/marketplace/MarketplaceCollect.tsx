import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, Typography, Button, TextField, ToggleButton, ToggleButtonGroup,
  CircularProgress, Dialog, DialogTitle, DialogActions, LinearProgress,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { ProductsHelper, SalesHelper, InsufficientStockError, WalletsHelper } from '../../lib/storage';
import type { ProductRecord } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import { useJpycPaymentWatcher } from '../../hooks/useJpycPaymentWatcher';
import PaymentReceivedBanner from '../../components/PaymentReceivedBanner';
import { useAppStore } from '../../store/appStore';

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

type Phase = 'setup' | 'waiting' | 'done';

// 販売ボタンから直接ここに来る: 数量を入力 → その場でJPYC支払いQRを発行 → 対象アドレスへの
// 入金をチェーン上で監視し、請求額分のJPYCが確認でき次第、自動で SalesHelper.sell() を呼んで
// 在庫と売上を確定する。分割払い（例: 4000円を2000円×2回）で合計が一致するケースにも対応する
// ため、受信額は「QR発行時点から現在までの入金の合計」として都度積み上げる方式にしている。
// 現金払いや、合計が微妙にずれた場合などのために「手動で完了にする」も用意する。
export default function MarketplaceCollect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const activeChain = useAppStore((s) => s.activeChain);

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [phase, setPhase] = useState<Phase>('setup');
  const [qty, setQty] = useState('1');
  const [chain, setChain] = useState<ChainKey>(activeChain);
  const [address, setAddress] = useState('');

  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const finalizingRef = useRef(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [p, wallet] = await Promise.all([ProductsHelper.get(id), WalletsHelper.getActive()]);
      setProduct(p);
      setAddress(wallet?.address ?? '');
      setLoading(false);
    })();
  }, [id]);

  const qtyNumber = Math.floor(Number(qty));
  const qtyValid = product != null && isFinite(qtyNumber) && qtyNumber > 0 && qtyNumber <= product.stock;
  const amountDue = product != null && qtyValid ? new Decimal(product.price).mul(qtyNumber) : new Decimal(0);

  const finalizeSale = useCallback(async (note: string) => {
    if (!product || finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      await SalesHelper.sell(product.id, qtyNumber, note);
      setPhase('done');
    } catch (e) {
      finalizingRef.current = false;
      if (e instanceof InsufficientStockError) {
        setErrorMessage(t('marketplace.insufficient_stock'));
      } else {
        setErrorMessage(String(e));
      }
    }
  }, [product, qtyNumber, t]);

  // Watches `address` on `chain` for incoming JPYC while phase === 'waiting', and finalizes
  // the sale automatically once the running total reaches amountDue. Shared with
  // QRGeneratorCollect and QRRegister — see hooks/useJpycPaymentWatcher.ts.
  const { receivedAmount, pollError, jpycDecimals, startWatching } = useJpycPaymentWatcher(
    chain,
    address,
    amountDue,
    phase === 'waiting',
    () => finalizeSale(t('marketplace.payment_detected_message')),
  );

  const onGenerateQr = async () => {
    if (!product || !qtyValid) {
      setErrorMessage(t('marketplace.invalid_quantity'));
      return;
    }
    await startWatching();
    setPhase('waiting');
  };

  const onBackToQuantity = () => {
    setPhase('setup');
  };

  const onManualComplete = () => {
    finalizeSale(t('marketplace.complete_manually'));
    setManualConfirmOpen(false);
  };

  const onCancelCollect = () => {
    setCancelConfirmOpen(false);
    navigate(`/marketplace/detail?id=${id}`);
  };

  const onFinishDone = () => {
    navigate(`/marketplace/detail?id=${id}`);
  };

  if (loading) {
    return null;
  }

  if (!product) {
    return (
      <Box>
        <AppToolBar back="/marketplace" title={t('marketplace.collect_title')} />
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('marketplace.product_not_found')}</Typography>
        </Box>
      </Box>
    );
  }

  // qrValue: EIP-681 ERC-20 transfer request (ethereum:<contract>@<chainId>/transfer?
  // address=<to>&uint256=<rawAmount>). Wallets that understand this (MetaMask Mobile,
  // Trust Wallet, imToken, etc.) auto-fill both the destination and the exact JPYC amount;
  // the plain-text amount/address shown below the QR covers wallets that don't.

  return (
    <Box>
      <AppToolBar
        back={phase === 'setup' ? `/marketplace/detail?id=${id}` : undefined}
        onBack={phase !== 'setup' ? () => setCancelConfirmOpen(true) : undefined}
        title={`${t('marketplace.collect_title')} - ${product.name}`}
      />

      <Box sx={{ p: 2 }}>
        {phase === 'setup' && (
          <Card sx={{ p: 2 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{product.name}</Typography>
            <Typography sx={{ fontSize: 'large', mb: 2 }}>
              {product.price.toLocaleString()} {t('marketplace.price_unit')} / {t('marketplace.stock_unit')}
            </Typography>

            <Typography sx={{ color: 'primary.main', mb: 0.5 }}>{t('marketplace.collect_quantity_label')}</Typography>
            <TextField
              type="number"
              autoFocus
              fullWidth
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              slotProps={{ htmlInput: { min: 1, max: product.stock, step: 1 } }}
              helperText={`${t('marketplace.stock')}: ${product.stock}${t('marketplace.stock_unit')}`}
            />

            <Typography sx={{ color: 'primary.main', mt: 3, mb: 1 }}>{t('marketplace.collect_chain_label')}</Typography>
            <ToggleButtonGroup
              value={chain}
              exclusive
              fullWidth
              onChange={(_e, v) => v && setChain(v)}
            >
              {CHAIN_KEYS.map((key) => (
                <ToggleButton key={key} value={key}>{CHAINS[key].name}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            {qtyValid && (
              <Typography sx={{ mt: 3, fontSize: 'x-large', fontWeight: 'bold' }}>
                {t('marketplace.collect_amount_label')}: {amountDue.toString()} {t('marketplace.price_unit')}
              </Typography>
            )}

            <Button
              variant="contained"
              fullWidth
              sx={{ mt: 3 }}
              disabled={!qtyValid}
              onClick={onGenerateQr}
            >
              {t('marketplace.generate_qr')}
            </Button>
          </Card>
        )}

        {phase === 'waiting' && (
          <Card sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <QRCodeSVG
                value={buildJpycPaymentUri(chain, address, amountDue, jpycDecimals)}
                size={200}
              />
              <Typography sx={{ mt: 2, color: 'text.secondary', fontSize: 12, textAlign: 'center' }}>
                {t('marketplace.qr_hint')}
              </Typography>

              <Typography sx={{ mt: 3, fontSize: 'x-large', fontWeight: 'bold' }}>
                {amountDue.toString()} {t('marketplace.price_unit')}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{CHAINS[chain].name}</Typography>
              <Typography align="center" sx={{ wordBreak: 'break-all', mx: 2, mt: 1, fontSize: 12 }}>{address}</Typography>

              <Box sx={{ width: '100%', mt: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('marketplace.received_amount_label')}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('marketplace.required_amount_label')}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: 'large' }}>{receivedAmount.toString()}</Typography>
                  <Typography sx={{ fontSize: 'large' }}>{amountDue.toString()}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, amountDue.greaterThan(0) ? receivedAmount.div(amountDue).mul(100).toNumber() : 0)}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('marketplace.waiting_for_payment')}</Typography>
              </Box>
              {pollError && (
                <Typography sx={{ fontSize: 12, color: 'error.main', mt: 1 }}>
                  {t('marketplace.poll_error')}
                </Typography>
              )}
            </Box>

            <Button variant="text" fullWidth sx={{ mt: 2 }} onClick={onBackToQuantity}>
              {t('marketplace.back_to_quantity')}
            </Button>
            <Button
              variant="outlined"
              fullWidth
              sx={{ mt: 1 }}
              onClick={() => setManualConfirmOpen(true)}
            >
              {t('marketplace.complete_manually')}
            </Button>
            <Button
              variant="text"
              color="error"
              fullWidth
              sx={{ mt: 1 }}
              onClick={() => setCancelConfirmOpen(true)}
            >
              {t('common.cancel')}
            </Button>
          </Card>
        )}

        {phase === 'done' && (
          <Card sx={{ p: 3, textAlign: 'center' }}>
            <PaymentReceivedBanner />
            <Typography sx={{ fontSize: 'large', fontWeight: 'bold', mb: 1 }}>
              {qtyNumber}{t('marketplace.stock_unit')} × {product.price.toLocaleString()} {t('marketplace.price_unit')} = {amountDue.toString()} {t('marketplace.price_unit')}
            </Typography>
            <Typography color="text.secondary">{t('marketplace.payment_detected_message')}</Typography>
            <Button variant="contained" fullWidth sx={{ mt: 3 }} onClick={onFinishDone}>
              OK
            </Button>
          </Card>
        )}
      </Box>

      <Dialog open={manualConfirmOpen} onClose={() => setManualConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.complete_manually_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setManualConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onManualComplete} variant="contained">{t('marketplace.complete_manually')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelConfirmOpen} onClose={() => setCancelConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.cancel_collect_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setCancelConfirmOpen(false)}>{t('marketplace.keep_waiting')}</Button>
          <Button onClick={onCancelCollect} color="error">{t('marketplace.confirm_cancel_collect')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
