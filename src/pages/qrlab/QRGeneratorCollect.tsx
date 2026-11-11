import { useEffect, useRef, useState } from 'react';
import {
  Box, Card, Typography, Button, CircularProgress, Dialog, DialogTitle, DialogActions, LinearProgress,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { QRCodeCanvas } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { WalletsHelper, PendingReceivesHelper } from '../../lib/storage';
import { CHAINS, getUsdcTokenInfo } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import { useJpycPaymentWatcher } from '../../hooks/useJpycPaymentWatcher';
import PaymentReceivedBanner from '../../components/PaymentReceivedBanner';
import type { WatchedToken } from '../../hooks/useJpycPaymentWatcher';
import { downloadPaymentReceiptImage } from '../../lib/paymentReceiptImage';

type Phase = 'waiting' | 'done';
type ReceiveCurrency = 'JPY' | 'USD';

/**
 * Reached from QRGeneratorAmount with the chosen amount/chain already in the query string:
 * shows the JPYC payment QR immediately and watches the chain for it, same mechanics as
 * MarketplaceCollect's waiting/done phases (see hooks/useJpycPaymentWatcher.ts) but without
 * a product or stock to update — this screen is just "receive this amount", full stop, so
 * there's nothing to record on completion beyond letting the person know it arrived.
 *
 * Once the payment QR has been generated, this is persisted as a PendingReceiveRecord (see
 * lib/storage.ts), mirroring QRRegister's own PendingCheckoutRecord — so leaving this screen
 * (the toolbar back arrow, browser/PWA back gesture, or switching tabs) does NOT lose the
 * QR's address/amount/chain. It shows up in 入金待ち一覧 (QRGeneratorPending.tsx, reachable
 * from QRGeneratorAmount) and can be reopened from there (via ?pendingId=) to keep checking
 * for payment right where it left off. Only completing manually or explicitly cancelling
 * removes the saved record.
 */
export default function QRGeneratorCollect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeId = searchParams.get('pendingId');

  const [amountDue, setAmountDue] = useState(() => new Decimal(searchParams.get('amount') || '0'));
  const [chain, setChain] = useState<ChainKey>((searchParams.get('chain') as ChainKey) || 'avalanche');
  // 'JPY' (default, JPYC) unless QRGeneratorAmount passed ?currency=USD - i.e. 設定 > 表示
  // 通貨 was USD at the moment this receive was created. Read once here (not re-read from
  // the live appStore setting) and persisted into the PendingReceiveRecord below, so a
  // receive keeps generating/watching for the same token even if 表示通貨 is changed again
  // before it's paid.
  const [currency, setCurrency] = useState<ReceiveCurrency>((searchParams.get('currency') as ReceiveCurrency) || 'JPY');

  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Set once this receive's payment QR has been generated and saved as a
  // PendingReceiveRecord (or loaded back from one via ?pendingId=) - see the class doc
  // comment above. Non-null exactly while there's a persisted record to clean up (removed
  // once the payment finalizes or is explicitly cancelled).
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Set by the ?pendingId= resume path once the record's chain/amount/address are loaded,
  // to hand its saved starting block to useJpycPaymentWatcher on the next render.
  const [resumeStartBlock, setResumeStartBlock] = useState<number | null>(null);

  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // USDC token info for `chain`, when currency is USD - undefined (JPYC default) otherwise,
  // or if this chain has no known USDC contract (e.g. debug/testnet mode - see
  // TESTNET_TOKEN_LISTS in lib/chains.ts).
  const usdcInfo = currency === 'USD' ? getUsdcTokenInfo(chain) : undefined;
  const watchedToken: WatchedToken | undefined = usdcInfo
    ? { address: usdcInfo.address, decimals: usdcInfo.decimals, symbol: usdcInfo.symbol }
    : undefined;
  const currencyUnit = usdcInfo ? usdcInfo.symbol : 'JPYC';

  const onFullyPaid = () => {
    setPendingId((id) => {
      if (id) PendingReceivesHelper.remove(id);
      return null;
    });
    setPhase('done');
  };

  const { receivedAmount, pollError, jpycDecimals, startWatching } = useJpycPaymentWatcher(
    chain,
    address,
    amountDue,
    phase === 'waiting',
    onFullyPaid,
    watchedToken,
  );

  // Runs once on mount: reads the active wallet's address, and either resumes a persisted
  // receive (via ?pendingId=, from 入金待ち一覧) or generates a fresh one for the
  // amount/chain passed in the query string, saving it right away so it survives leaving
  // this screen.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const wallet = await WalletsHelper.getActive();
      const walletAddress = wallet?.address ?? '';
      setAddress(walletAddress);

      if (resumeId) {
        const record = await PendingReceivesHelper.get(resumeId);
        if (!record) {
          setErrorMessage(t('qrlab.pending_not_found'));
          setLoading(false);
          return;
        }
        setAmountDue(new Decimal(record.amount));
        setChain(record.chain as ChainKey);
        setAddress(record.address);
        setCurrency(record.currency ?? 'JPY');
        setPendingId(record.id);
        setResumeStartBlock(record.startBlock);
        setLoading(false);
        return;
      }

      const startBlock = await startWatching();
      const record = await PendingReceivesHelper.add({
        chain,
        address: walletAddress,
        amount: amountDue.toString(),
        startBlock,
        currency,
      });
      setPendingId(record.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resumes watching a receive reopened from 入金待ち一覧, once its chain/address/amount
  // have been loaded into state by the mount effect above and reflected in this render
  // (startWatching is bound to the `chain`/`amountDue` this render was called with, so this
  // can't run any earlier).
  useEffect(() => {
    if (resumeStartBlock === null) return;
    startWatching(resumeStartBlock);
    setResumeStartBlock(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeStartBlock, chain, amountDue]);

  const onManualComplete = () => {
    setPendingId((id) => {
      if (id) PendingReceivesHelper.remove(id);
      return null;
    });
    setPhase('done');
    setManualConfirmOpen(false);
  };

  const onCancelCollect = async () => {
    setCancelConfirmOpen(false);
    if (pendingId) {
      await PendingReceivesHelper.remove(pendingId);
      setPendingId(null);
    }
    navigate('/top?tab=qrlab');
  };

  const onFinishDone = () => {
    navigate('/top?tab=qrlab');
  };

  const onDownloadQr = () => {
    if (!qrCanvasRef.current) return;
    downloadPaymentReceiptImage({
      qrCanvas: qrCanvasRef.current,
      title: t('qrlab.receipt_title'),
      totalLabel: `${amountDue.toString()} ${currencyUnit}`,
      chainLabel: CHAINS[chain].name,
      addressLabel: t('qrlab.receipt_address_label'),
      address,
    });
  };

  if (loading) {
    return null;
  }

  return (
    <Box sx={{ height: '100%' }}>
      <AppToolBar
        back="/qrlab/amount"
        onBack={phase === 'done' ? onFinishDone : undefined}
        title={t('qrlab.amount_title')}
      />

      <Box sx={{ p: 2 }}>
        {phase === 'waiting' && (
          <Card sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <QRCodeCanvas
                ref={qrCanvasRef}
                value={buildJpycPaymentUri(chain, address, amountDue, jpycDecimals, usdcInfo?.address)}
                size={200}
              />
              <Typography sx={{ mt: 2, color: 'text.secondary', fontSize: 12, textAlign: 'center' }}>
                {t('marketplace.qr_hint')}
              </Typography>

              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                sx={{ mt: 2 }}
                onClick={onDownloadQr}
              >
                {t('qrlab.download_qr')}
              </Button>

              <Typography sx={{ mt: 3, fontSize: 'x-large', fontWeight: 'bold' }}>
                {amountDue.toString()} {currencyUnit}
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

            <Button
              variant="outlined"
              fullWidth
              sx={{ mt: 3 }}
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
            <Typography sx={{ fontSize: 'x-large', fontWeight: 'bold', mb: 1 }}>
              {amountDue.toString()} {currencyUnit}
            </Typography>
            <Typography color="text.secondary">{t('qrlab.payment_received_message')}</Typography>
            <Button variant="contained" fullWidth sx={{ mt: 3 }} onClick={onFinishDone}>
              OK
            </Button>
          </Card>
        )}
      </Box>

      <Dialog open={manualConfirmOpen} onClose={() => setManualConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('qrlab.complete_manually_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setManualConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onManualComplete} variant="contained">{t('marketplace.complete_manually')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelConfirmOpen} onClose={() => setCancelConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('qrlab.cancel_collect_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setCancelConfirmOpen(false)}>{t('marketplace.keep_waiting')}</Button>
          <Button onClick={onCancelCollect} color="error">{t('marketplace.confirm_cancel_collect')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
