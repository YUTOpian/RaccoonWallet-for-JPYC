import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Chip, CircularProgress, Divider, Typography } from '@mui/material';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { QRCodeCanvas } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import InvoiceSummary from '../../components/InvoiceSummary';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { AddressBookHelper, WalletsHelper } from '../../lib/storage';
import { CHAINS, getJpycDecimals } from '../../lib/chains';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import { decodeInvoiceToken, formatAmount, formatJapaneseDate, isSignatureValid, payloadTotals, todayString } from '../../lib/invoice';
import type { DecodedInvoice } from '../../lib/invoice';
import { chainKeyForId } from '../../lib/invoicePayment';
import { documentFilename, renderDocumentPdf, sharePdf } from '../../lib/invoiceDocument';
import { useAppStore } from '../../store/appStore';

type LoadState = 'loading' | 'invalid' | 'ok';

// What someone sees when they open a 請求リンク (#/pay?d=<token>). Works with no wallet at all
// (the invoice and a payment QR are shown so any other wallet can pay it); with a wallet, "支払う"
// pre-fills the normal Send flow exactly like scanning a payment QR does, so the usual confirmation
// screen and password check still stand between the link and any money moving.
export default function PayInvoice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('d') ?? '';

  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);
  const setCalculatorFormula = useAppStore((s) => s.setCalculatorFormula);
  const setCalculatorValue = useAppStore((s) => s.setCalculatorValue);

  const [state, setState] = useState<LoadState>('loading');
  const [invoice, setInvoice] = useState<DecodedInvoice | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const [contactName, setContactName] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [busyPdf, setBusyPdf] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const decoded = await decodeInvoiceToken(token);
      if (cancelled) return;
      if (decoded === null) {
        setState('invalid');
        return;
      }
      const [wallet, contact] = await Promise.all([WalletsHelper.getActive(), AddressBookHelper.findByAddress(decoded.payload.a)]);
      if (cancelled) return;
      setInvoice(decoded);
      setHasWallet(wallet !== null);
      setContactName(contact?.name ?? '');
      setState('ok');
    })();
    return () => { cancelled = true; };
  }, [token]);

  const payload = invoice?.payload ?? null;
  const chainKey = payload ? chainKeyForId(payload.cid) : null;
  const verified = useMemo(() => (invoice ? isSignatureValid(invoice.payload, invoice.payloadJson, invoice.signature) : false), [invoice]);

  useEffect(() => {
    if (!chainKey) return;
    getJpycDecimals(chainKey).then(setDecimals).catch(() => setDecimals(18));
  }, [chainKey]);

  const backToApp = () => navigate(hasWallet ? '/top?tab=home' : '/welcome', { replace: true });

  if (state === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>
    );
  }
  if (state === 'invalid' || !invoice || !payload) {
    return (
      <Box>
        <AppToolBar title={t('invoice.pay_title')} showBack={false} />
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Alert severity="error">{t('invoice.pay_invalid')}</Alert>
          <Button sx={{ mt: 3 }} variant="outlined" onClick={backToApp}>{t('invoice.pay_back')}</Button>
        </Box>
      </Box>
    );
  }

  const totals = payloadTotals(payload);
  const overdue = payload.due !== '' && payload.due < todayString();
  const chainName = chainKey ? CHAINS[chainKey].name : `chainId ${payload.cid}`;
  const qrValue = chainKey ? buildJpycPaymentUri(chainKey, payload.a, new Decimal(totals.total), decimals) : payload.a;
  const canPay = verified && chainKey !== null && hasWallet;

  const onPay = () => {
    if (!chainKey) return;
    setActiveChain(chainKey);
    setSendCustomChainId(null);
    setSendCurrency('jpyc');
    setSendTokenMeta(null);
    setReceiverAddress(payload.a);
    setCalculatorFormula(String(totals.total));
    setCalculatorValue(totals.total);
    navigate('/send/amount');
  };

  const onPdf = async () => {
    setBusyPdf(true);
    try {
      const options = { kind: 'invoice' as const, payload, signature: invoice.signature, chainName, qrCanvas: qrRef.current };
      const blob = await renderDocumentPdf(options);
      await sharePdf(blob, documentFilename(options), `${t('invoice.invoice')} ${payload.n}`);
    } catch (e) {
      console.error('Failed to build PDF', e);
      setErrorMessage(t('invoice.pdf_failed'));
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <Box>
      <AppToolBar title={t('invoice.pay_title')} showBack={hasWallet} back="/top?tab=home" onBack={backToApp} />
      <Box sx={{ p: 2 }}>
        {verified ? (
          <Alert icon={<VerifiedOutlinedIcon />} severity="success" sx={{ mb: 2 }}>{t('invoice.pay_signature_ok')}</Alert>
        ) : (
          <Alert severity="error" sx={{ mb: 2 }}>{t('invoice.pay_signature_bad')}</Alert>
        )}
        {chainKey === null && <Alert severity="warning" sx={{ mb: 2 }}>{t('invoice.pay_chain_unsupported', { chainId: payload.cid })}</Alert>}

        <Card sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">{t('invoice.pay_from')}</Typography>
          <Typography sx={{ fontWeight: 'bold', fontSize: 'large' }}>{payload.iss.name}</Typography>
          {payload.iss.reg !== '' && <Typography variant="caption" color="text.secondary" component="div">{`${t('invoice.registration_number')}: ${payload.iss.reg}`}</Typography>}
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="body2">{`${t('invoice.recipient')}: ${payload.to}`}</Typography>
          {payload.sub !== '' && <Typography variant="body2">{`${t('invoice.subject')}: ${payload.sub}`}</Typography>}
          <Typography variant="body2" color="text.secondary">{`${payload.n}  ·  ${formatJapaneseDate(payload.d)}`}</Typography>
          {payload.due !== '' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Typography variant="body2">{`${t('invoice.due_date')}: ${formatJapaneseDate(payload.due)}`}</Typography>
              {overdue && <Chip size="small" color="error" label={t('invoice.status_overdue')} />}
            </Box>
          )}
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          <InvoiceSummary payload={payload} />
          {payload.note.trim() !== '' && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary">{t('invoice.note')}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{payload.note}</Typography>
            </>
          )}
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography variant="caption" color="text.secondary">{t('invoice.pay_to_address')}</Typography>
          <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 14 }}>{payload.a}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">{`${t('invoice.chain')}: ${chainName}`}</Typography>
          {contactName !== '' && <Chip size="small" color="primary" variant="outlined" sx={{ mt: 1 }} label={t('invoice.pay_in_addressbook', { name: contactName })} />}
        </Card>

        <Alert severity="info" sx={{ mt: 2 }}>{t('invoice.pay_caution')}</Alert>

        <Box sx={{ mt: 2 }}>
          {hasWallet ? (
            <Button variant="contained" size="large" fullWidth disabled={!canPay} onClick={onPay}>
              {t('invoice.pay_button', { amount: formatAmount(totals.total) })}
            </Button>
          ) : (
            <Alert severity="warning">
              {t('invoice.pay_no_wallet')}
              <Box sx={{ mt: 1 }}>
                <Button variant="outlined" color="inherit" size="small" onClick={() => navigate('/welcome')}>{t('invoice.pay_create_wallet')}</Button>
              </Box>
            </Alert>
          )}
        </Box>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('invoice.pay_other_wallet')}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 1.5, bgcolor: '#fff', borderRadius: 1 }}>
            <QRCodeCanvas ref={qrRef} value={qrValue} size={168} />
          </Box>
          <Button variant="outlined" fullWidth startIcon={busyPdf ? <CircularProgress size={16} /> : <PictureAsPdfOutlinedIcon />} disabled={busyPdf} onClick={onPdf} sx={{ mt: 1.5 }}>
            {t('invoice.invoice_pdf')}
          </Button>
        </Card>
      </Box>
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
