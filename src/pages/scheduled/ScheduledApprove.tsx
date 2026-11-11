import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Paper, Typography,
} from '@mui/material';
import { ethers } from 'ethers';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import PasswordDialog from '../../components/PasswordDialog';
import GasFeeBlock from '../../components/GasFeeBlock';
import AddressSafetyBlock, { AddressBadges, AddressChunks } from '../../components/AddressSafetyBlock';
import { useAddressSafety } from '../../hooks/useAddressSafety';
import { useGaslessOption } from '../../hooks/useGaslessOption';
import { ScheduledPaymentsHelper, WalletsHelper } from '../../lib/storage';
import type { ScheduledPaymentRecord, Wallet } from '../../lib/storage';
import { CHAINS, estimateSendFee } from '../../lib/chains';
import { chainTargetFromKey, getExternalSigner, isExternalWalletError } from '../../lib/externalWallet';
import type { SignerSource } from '../../lib/signer';
import { startSend } from '../../lib/sendJob';
import { unlockSounds } from '../../lib/sounds';
import { advance, classify, daysBetween } from '../../lib/scheduledPayments';
import { formatAmount, formatJapaneseDate, todayString } from '../../lib/invoice';
import { chainKeyForId } from '../../lib/invoicePayment';

// 予約送金の承認。期日が来た支払いの内容を確認して、PIN(または MetaMask/Bitget の承認)で
// 送金する。送金は既存の裏送金(lib/sendJob.ts)に渡し、ネットワークへ送信できた時点で
// この予定を「支払い済み」にして次回の日付へ進める。
export default function ScheduledApprove() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';

  const [record, setRecord] = useState<ScheduledPaymentRecord | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [dialog, setDialog] = useState<'skip' | 'again' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      setWallet(await WalletsHelper.getActive());
      setRecord(await ScheduledPaymentsHelper.get(id));
      setLoading(false);
    })();
  }, [id]);

  // ガス代の見積り・不足判定・ガスレス送金(送金確認画面と同じ部品)。
  const earlyChain = record ? chainKeyForId(record.chainId) : null;
  const [estimatedFee, setEstimatedFee] = useState<string | null | 'loading'>('loading');
  const [gasBlocked, setGasBlocked] = useState(false);
  const [useGasless, setUseGasless] = useState(false);
  const gaslessOption = useGaslessOption(earlyChain);
  const gaslessOn = useGasless && gaslessOption.available;

  // アドレス詐欺対策(送金確認画面と同じ判定)。定期支払いは同じ相手に何度も送るので、
  // 一度送れば「送ったことのある相手」になり、警告は初回と、似たアドレスに変わった時だけ出る。
  const safety = useAddressSafety(record?.toAddress ?? '', earlyChain);
  const [safetyAck, setSafetyAck] = useState(false);
  useEffect(() => setSafetyAck(false), [record?.toAddress]);
  const safetyBlocked = safety === null || (safety.requiresAck && !safetyAck);

  useEffect(() => {
    if (!record || !wallet || earlyChain === null || !ethers.isAddress(record.toAddress)) {
      setEstimatedFee(null);
      return;
    }
    let cancelled = false;
    setEstimatedFee('loading');
    void estimateSendFee(earlyChain, wallet.address, record.toAddress, 'jpyc', record.amount).then((fee) => {
      if (!cancelled) setEstimatedFee(fee);
    });
    return () => { cancelled = true; };
  }, [record, wallet, earlyChain]);

  if (loading) return null;
  if (!record) {
    return (
      <Box>
        <AppToolBar back="/scheduled" title={t('scheduled.title')} />
        <Typography align="center" color="text.secondary" sx={{ mt: 6 }}>{t('scheduled.not_found')}</Typography>
      </Box>
    );
  }

  const chainKey = chainKeyForId(record.chainId);
  const sameWallet = wallet !== null && wallet.address.toLowerCase() === record.walletAddress.toLowerCase();
  const today = todayString();
  const { state, days } = classify(record, today);
  const inFlight = ScheduledPaymentsHelper.isInFlight(record);
  const canApprove = record.status === 'active' && chainKey !== null && sameWallet && ethers.isAddress(record.toAddress) && !gasBlocked;
  const due = record.nextDue;

  const goHome = () => navigate('/top?tab=home', { replace: true });

  // password === null: wallet connected through MetaMask / Bitget Wallet (approval happens in the extension).
  const send = async (password: string | null) => {
    if (!chainKey || !wallet) return;
    setSending(true);
    try {
      let signer: SignerSource;
      if (wallet.externalProvider) {
        signer = await getExternalSigner(wallet.externalProvider, wallet.address, chainTargetFromKey(chainKey));
      } else {
        const key = password == null ? null : await WalletsHelper.decryptKey(wallet.id, password);
        if (key == null) {
          setErrorMessage(t('wallet.invalid_key'));
          return;
        }
        signer = key;
      }
      await ScheduledPaymentsHelper.markInFlight(record.id);
      startSend({
        signer,
        to: record.toAddress,
        amount: record.amount,
        symbol: 'JPYC',
        activeChain: chainKey,
        sendCurrency: 'jpyc',
        sendTokenMeta: null,
        customChain: null,
        explorerBase: CHAINS[chainKey].blockExplorerUrl || null,
        gasless: gaslessOn ? { relayerUrl: gaslessOption.relayerUrl } : undefined,
        // Settled only once the transaction is really out; the occurrence is pinned by its due date,
        // so a late callback can never advance a schedule that already moved on.
        onBroadcast: (txHash) => { void ScheduledPaymentsHelper.settle(record.id, due, { txHash }, advance); },
        onFailed: () => { void ScheduledPaymentsHelper.clearInFlight(record.id); },
      });
      goHome();
    } catch (e) {
      await ScheduledPaymentsHelper.clearInFlight(record.id);
      if (isExternalWalletError(e)) {
        setErrorMessage(t(`external.error_${e.code}`));
      } else if ((e as { code?: string } | null)?.code === 'ACTION_REJECTED') {
        setErrorMessage(t('external.error_rejected'));
      } else {
        console.error('Scheduled payment failed to start', e);
        setErrorMessage(t('scheduled.error_start'));
      }
    } finally {
      setSending(false);
    }
  };

  const onApproveClick = async () => {
    unlockSounds();
    setDialog(null);
    if (wallet?.externalProvider) await send(null);
    else setPasswordOpen(true);
  };

  const onSkip = async () => {
    setDialog(null);
    await ScheduledPaymentsHelper.settle(record.id, due, { skipped: true }, advance);
    navigate('/scheduled', { replace: true });
  };

  const labelSx = { color: 'text.secondary', fontSize: '0.8rem', fontWeight: 500 } as const;

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#f7f9f9' }}>
      <AppToolBar back="/scheduled" title={t('scheduled.approve_title')} />
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!sameWallet && <Alert severity="warning">{t('scheduled.other_wallet')}</Alert>}
        {chainKey === null && <Alert severity="warning">{t('scheduled.chain_unsupported', { chainId: record.chainId })}</Alert>}
        {record.status === 'paused' && <Alert severity="info">{t('scheduled.paused_note')}</Alert>}
        {record.status === 'completed' && <Alert severity="success">{t('scheduled.completed_note')}</Alert>}
        {inFlight && <Alert severity="warning">{t('scheduled.in_flight')}</Alert>}

        <Paper sx={{ p: 3, textAlign: 'center', borderRadius: 4 }}>
          <Typography sx={{ fontWeight: 'bold' }}>{record.label}</Typography>
          <Typography sx={{ mt: 0.5, fontSize: '2.2rem', fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {formatAmount(Number(record.amount))}
            <Typography component="span" sx={{ ml: 1, fontSize: '1.1rem', fontWeight: 600, color: 'primary.main' }}>JPYC</Typography>
          </Typography>
          {record.status === 'active' && (
            <Box sx={{ mt: 1 }}>
              {state === 'due' && <Chip color="warning" label={days < 0 ? t('scheduled.days_overdue', { count: -days }) : t('scheduled.due_today')} />}
              {state !== 'due' && <Chip variant="outlined" color="primary" label={t('scheduled.in_days', { count: daysBetween(today, record.nextDue) })} />}
            </Box>
          )}
        </Paper>

        <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <Box sx={{ px: 3, py: 2 }}>
            <Typography sx={labelSx}>{t('scheduled.due_date')}</Typography>
            <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{formatJapaneseDate(record.nextDue)}</Typography>
          </Box>
          <Divider />
          <Box sx={{ px: 3, py: 2 }}>
            <Typography sx={labelSx}>{t('send.network')}</Typography>
            <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{chainKey ? CHAINS[chainKey].name : `chainId ${record.chainId}`}</Typography>
          </Box>
          <Divider />
          <Box sx={{ px: 3, py: 2 }}>
            <Typography sx={labelSx}>{t('common.destination')}</Typography>
            {record.recipientName !== '' && <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{record.recipientName}</Typography>}
            <Box sx={{ mt: 0.5 }}>
              <AddressChunks address={record.toAddress} />
            </Box>
            <AddressBadges assessment={safety} />
          </Box>
          {record.note !== '' && (
            <>
              <Divider />
              <Box sx={{ px: 3, py: 2 }}>
                <Typography sx={labelSx}>{t('scheduled.note')}</Typography>
                <Typography sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{record.note}</Typography>
              </Box>
            </>
          )}
        </Paper>

        {chainKey !== null && (
          <AddressSafetyBlock
            assessment={safety}
            to={record.toAddress}
            networkName={CHAINS[chainKey].name}
            tokenLabel="JPYC"
            ack={safetyAck}
            onAckChange={setSafetyAck}
          />
        )}

        {chainKey !== null && (
          <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
            <GasFeeBlock
              chain={chainKey}
              address={wallet?.address ?? null}
              fee={estimatedFee}
              nativeSymbol={CHAINS[chainKey].nativeCurrency.symbol}
              gaslessAvailable={gaslessOption.available}
              gasless={gaslessOn}
              onGaslessChange={setUseGasless}
              onBlockedChange={setGasBlocked}
              label={t('send.gas_fee')}
            />
          </Paper>
        )}

        <Button
          fullWidth variant="contained" size="large" disabled={!canApprove || sending || safetyBlocked}
          onClick={() => (inFlight ? setDialog('again') : onApproveClick())}
          sx={{ borderRadius: 999, py: 1.4, fontWeight: 700, textTransform: 'none' }}
        >
          {sending ? t('send.sending') : t('scheduled.approve')}
        </Button>
        {record.status === 'active' && (
          <Button fullWidth onClick={() => setDialog('skip')} disabled={sending}>{t('scheduled.skip')}</Button>
        )}
        <Button fullWidth onClick={() => navigate(`/scheduled/form?id=${record.id}`)}>{t('scheduled.edit')}</Button>
      </Box>

      <Dialog open={dialog === 'skip'} onClose={() => setDialog(null)}>
        <DialogTitle>{t('scheduled.skip')}</DialogTitle>
        <DialogContent><DialogContentText>{t('scheduled.skip_confirm', { date: formatJapaneseDate(record.nextDue) })}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button onClick={onSkip}>{t('scheduled.skip')}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={dialog === 'again'} onClose={() => setDialog(null)}>
        <DialogTitle>{t('scheduled.approve')}</DialogTitle>
        <DialogContent><DialogContentText>{t('scheduled.in_flight_confirm')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button color="error" onClick={onApproveClick}>{t('scheduled.approve_anyway')}</Button>
        </DialogActions>
      </Dialog>

      <PasswordDialog open={passwordOpen} mode="check" onClose={() => setPasswordOpen(false)} onPass={(pin) => { setPasswordOpen(false); void send(pin); }} />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
