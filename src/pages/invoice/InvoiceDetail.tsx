import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
  Snackbar, Typography,
} from '@mui/material';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { QRCodeCanvas } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import InvoiceSummary from '../../components/InvoiceSummary';
import { InvoicesHelper, IssuerProfileHelper } from '../../lib/storage';
import type { InvoiceRecord } from '../../lib/storage';
import { CHAINS, getJpycDecimals } from '../../lib/chains';
import type { ChainTransfer } from '../../lib/chains';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import {
  buildInvoiceLink, defaultLinkBase, formatAmount, formatJapaneseDate, normalizeLinkBase, parseInvoicePayload, payloadTotals, todayString,
} from '../../lib/invoice';
import { chainKeyForId, findInvoicePayment } from '../../lib/invoicePayment';
import { documentFilename, renderDocumentPdf, sharePdf } from '../../lib/invoiceDocument';
import type { DocumentKind } from '../../lib/invoiceDocument';

const POLL_INTERVAL_MS = 20_000;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (non-secure context / denied): fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

// One invoice: status, share link (LINE / copy / OS share sheet), PDFs, payment check, receipt.
export default function InvoiceDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ?? '';

  const [record, setRecord] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkBase, setLinkBase] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [candidate, setCandidate] = useState<ChainTransfer | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [busyPdf, setBusyPdf] = useState<DocumentKind | null>(null);
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'manual' | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const reload = useCallback(async () => {
    setRecord(await InvoicesHelper.get(id));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    reload();
    (async () => {
      const profile = await IssuerProfileHelper.get();
      setLinkBase(normalizeLinkBase(profile.baseUrl) || defaultLinkBase());
    })();
  }, [reload]);

  const payload = useMemo(() => (record ? parseInvoicePayload(record.payload) : null), [record]);
  const chainKey = payload ? chainKeyForId(payload.cid) : null;
  const totals = payload ? payloadTotals(payload) : null;
  const link = record && linkBase !== '' ? buildInvoiceLink(linkBase, record.token) : '';

  useEffect(() => {
    if (!chainKey) return;
    getJpycDecimals(chainKey).then(setDecimals).catch(() => setDecimals(18));
  }, [chainKey]);

  // Payment check: once on open, then every POLL_INTERVAL_MS while the invoice is still open.
  const isOpen = record?.status === 'issued';
  const check = useCallback(async () => {
    if (!record || !payload || !chainKey) return;
    setChecking(true);
    try {
      const others = await InvoicesHelper.list();
      const used = new Set(others.filter((r) => r.id !== record.id && r.paidTxHash).map((r) => r.paidTxHash!.toLowerCase()));
      setCandidate(await findInvoicePayment(record, payload, chainKey, used));
      setCheckFailed(false);
    } catch (e) {
      console.error('Invoice payment check failed', e);
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }, [record, payload, chainKey]);

  useEffect(() => {
    if (!isOpen) return;
    check();
    const handle = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [isOpen, check]);

  if (loading) return null;
  if (!record || !payload || !totals) {
    return (
      <Box>
        <AppToolBar back="/invoice" title={t('invoice.detail_title')} />
        <Typography align="center" color="text.secondary" sx={{ mt: 6 }}>{t('invoice.not_found')}</Typography>
      </Box>
    );
  }

  const chainName = chainKey ? CHAINS[chainKey].name : `chainId ${payload.cid}`;
  const overdue = record.status === 'issued' && record.due !== '' && record.due < todayString();
  const qrValue = chainKey ? buildJpycPaymentUri(chainKey, payload.a, new Decimal(totals.total), decimals) : payload.a;

  const shareMessage = [
    t('invoice.share_message_head', { issuer: payload.iss.name, number: record.number }),
    t('invoice.share_message_amount', { amount: formatAmount(totals.total) }),
    ...(payload.due !== '' ? [t('invoice.share_message_due', { due: formatJapaneseDate(payload.due) })] : []),
    '',
    t('invoice.share_message_pay'),
    link,
  ].join('\n');

  const onCopyLink = async () => {
    setNotice((await copyText(link)) ? { severity: 'success', text: t('invoice.link_copied') } : { severity: 'error', text: t('invoice.copy_failed') });
  };
  const onLine = () => {
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(shareMessage)}`, '_blank', 'noopener');
  };
  const onShareLink = async () => {
    try {
      await navigator.share({ title: t('invoice.share_title', { number: record.number }), text: shareMessage });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice({ severity: 'error', text: t('invoice.share_failed') });
    }
  };

  const onPdf = async (kind: DocumentKind) => {
    setBusyPdf(kind);
    try {
      const receipt = kind === 'receipt' && record.receiptNumber
        ? { number: record.receiptNumber, date: record.receiptDate ?? todayString(), txHash: record.paidTxHash, from: record.paidFrom, manual: !!record.paidManually }
        : undefined;
      const options = { kind, payload, signature: record.signature, chainName, qrCanvas: kind === 'invoice' ? qrRef.current : null, receipt };
      const blob = await renderDocumentPdf(options);
      const result = await sharePdf(blob, documentFilename(options), `${kind === 'receipt' ? t('invoice.receipt') : t('invoice.invoice')} ${receipt?.number ?? record.number}`);
      if (result === 'downloaded') setNotice({ severity: 'success', text: t('invoice.pdf_saved') });
    } catch (e) {
      console.error('Failed to build PDF', e);
      setNotice({ severity: 'error', text: t('invoice.pdf_failed') });
    } finally {
      setBusyPdf(null);
    }
  };

  const confirmCandidate = async () => {
    if (!candidate) return;
    await InvoicesHelper.markPaid(record.id, {
      txHash: candidate.hash,
      from: candidate.senderAddress,
      manual: false,
      timestampMs: candidate.timestamp > 0 ? candidate.timestamp * 1000 : undefined,
    });
    setCandidate(null);
    await reload();
  };
  const confirmManual = async () => {
    setDialog(null);
    await InvoicesHelper.markPaid(record.id, { manual: true });
    setCandidate(null);
    await reload();
  };
  const confirmCancel = async () => {
    setDialog(null);
    await InvoicesHelper.update(record.id, { status: 'cancelled' });
    await reload();
  };
  const confirmDelete = async () => {
    setDialog(null);
    await InvoicesHelper.remove(record.id);
    navigate('/invoice', { replace: true });
  };

  return (
    <Box>
      <AppToolBar back="/invoice" onBack={() => navigate('/invoice')} title={record.number} />
      <Box sx={{ p: 2 }}>
        <Card sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 'bold', wordBreak: 'break-word' }}>{payload.to}</Typography>
            {record.status === 'paid' && <Chip color="success" label={t('invoice.status_paid')} />}
            {record.status === 'cancelled' && <Chip label={t('invoice.status_cancelled')} />}
            {record.status === 'issued' && <Chip color={overdue ? 'error' : 'warning'} label={overdue ? t('invoice.status_overdue') : t('invoice.status_open')} />}
          </Box>
          {payload.sub !== '' && <Typography variant="body2" color="text.secondary">{payload.sub}</Typography>}
          <Typography sx={{ fontSize: 'xx-large', fontWeight: 'bold', mt: 1 }}>{`${formatAmount(totals.total)} JPYC`}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {`${t('invoice.issue_date')}: ${formatJapaneseDate(payload.d)}${payload.due !== '' ? `  /  ${t('invoice.due_date')}: ${formatJapaneseDate(payload.due)}` : ''}`}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">{`${t('invoice.chain')}: ${chainName}`}</Typography>
        </Card>

        {isOpen && (
          <Card sx={{ p: 2, mt: 2 }}>
            <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('invoice.send_section')}</Typography>
            {link === '' ? (
              <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => navigate('/invoice/settings')}>{t('invoice.set_up')}</Button>}>
                {t('invoice.link_base_missing')}
              </Alert>
            ) : (
              <>
                <Button variant="contained" fullWidth startIcon={<ChatBubbleOutlineOutlinedIcon />} onClick={onLine} sx={{ bgcolor: '#06c755', '&:hover': { bgcolor: '#05a847' } }}>
                  {t('invoice.send_line')}
                </Button>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <Button variant="outlined" fullWidth startIcon={<ContentCopyIcon />} onClick={onCopyLink}>{t('invoice.copy_link')}</Button>
                  {typeof navigator.share === 'function' && (
                    <Button variant="outlined" fullWidth startIcon={<ShareOutlinedIcon />} onClick={onShareLink}>{t('invoice.share_other')}</Button>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>{t('invoice.link_note')}</Typography>
              </>
            )}
          </Card>
        )}

        {isOpen && (
          <Card sx={{ p: 2, mt: 2 }}>
            <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.payment_section')}</Typography>
            {candidate ? (
              <Alert severity="success" sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{t('invoice.payment_found')}</Typography>
                <Typography variant="caption" component="div" sx={{ wordBreak: 'break-all' }}>{`${t('invoice.payment_from')}: ${candidate.senderAddress}`}</Typography>
                <Typography variant="caption" component="div" sx={{ wordBreak: 'break-all' }}>{`tx: ${candidate.hash}`}</Typography>
                <Button variant="contained" size="small" sx={{ mt: 1 }} onClick={confirmCandidate}>{t('invoice.payment_confirm')}</Button>
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                {checking && <CircularProgress size={16} />}
                <Typography variant="body2" color="text.secondary">{checkFailed ? t('invoice.check_failed') : t('invoice.waiting_payment')}</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
              <Button variant="outlined" fullWidth disabled={checking} onClick={check}>{t('invoice.check_now')}</Button>
              <Button variant="outlined" fullWidth onClick={() => setDialog('manual')}>{t('invoice.mark_paid_manually')}</Button>
            </Box>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>{t('invoice.payment_note')}</Typography>
          </Card>
        )}

        {record.status === 'paid' && (
          <Card sx={{ p: 2, mt: 2 }}>
            <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.receipt')}</Typography>
            <Typography variant="body2" color="text.secondary">{`${record.receiptNumber ?? ''}  ·  ${formatJapaneseDate(record.receiptDate ?? '')}`}</Typography>
            {record.paidManually ? (
              <Typography variant="caption" color="text.secondary" component="div">{t('invoice.paid_manually_note')}</Typography>
            ) : (
              record.paidTxHash && <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-all' }}>{`tx: ${record.paidTxHash}`}</Typography>
            )}
            <Button variant="contained" fullWidth startIcon={busyPdf === 'receipt' ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdfOutlinedIcon />} disabled={busyPdf !== null} onClick={() => onPdf('receipt')} sx={{ mt: 1.5 }}>
              {t('invoice.receipt_pdf')}
            </Button>
          </Card>
        )}

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('invoice.items')}</Typography>
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
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('invoice.payment_qr')}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 1.5, bgcolor: '#fff', borderRadius: 1 }}>
            <QRCodeCanvas ref={qrRef} value={qrValue} size={168} />
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, wordBreak: 'break-all' }}>{payload.a}</Typography>
          <Button variant="outlined" fullWidth startIcon={busyPdf === 'invoice' ? <CircularProgress size={16} /> : <PictureAsPdfOutlinedIcon />} disabled={busyPdf !== null} onClick={() => onPdf('invoice')} sx={{ mt: 1.5 }}>
            {t('invoice.invoice_pdf')}
          </Button>
        </Card>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
          <Button onClick={() => navigate(`/invoice/form?copy=${record.id}`)}>{t('invoice.duplicate')}</Button>
          {isOpen && <Button color="error" onClick={() => setDialog('cancel')}>{t('invoice.cancel_invoice')}</Button>}
          <Button color="error" onClick={() => setDialog('delete')}>{t('invoice.delete_invoice')}</Button>
        </Box>
      </Box>

      <Dialog open={dialog === 'manual'} onClose={() => setDialog(null)}>
        <DialogTitle>{t('invoice.mark_paid_manually')}</DialogTitle>
        <DialogContent><DialogContentText sx={{ whiteSpace: 'pre-line' }}>{t('invoice.manual_confirm')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={confirmManual}>{t('invoice.mark_paid_manually')}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={dialog === 'cancel'} onClose={() => setDialog(null)}>
        <DialogTitle>{t('invoice.cancel_invoice')}</DialogTitle>
        <DialogContent><DialogContentText sx={{ whiteSpace: 'pre-line' }}>{t('invoice.cancel_confirm')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button color="error" onClick={confirmCancel}>{t('invoice.cancel_invoice')}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={dialog === 'delete'} onClose={() => setDialog(null)}>
        <DialogTitle>{t('invoice.delete_invoice')}</DialogTitle>
        <DialogContent><DialogContentText sx={{ whiteSpace: 'pre-line' }}>{t('invoice.delete_confirm')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button color="error" onClick={confirmDelete}>{t('invoice.delete_invoice')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={notice !== null} autoHideDuration={3500} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)} sx={{ width: '100%' }}>{notice?.text}</Alert>
      </Snackbar>
    </Box>
  );
}
