import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Card, Dialog, DialogActions, DialogTitle, IconButton, List, ListItemButton,
  ListItemText, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { ethers } from 'ethers';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import PasswordDialog from '../../components/PasswordDialog';
import {
  AddressBookHelper, InvoicesHelper, IssuerProfileHelper, ProductsHelper, WalletsHelper,
} from '../../lib/storage';
import type { IssuerProfile, ProductRecord } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import {
  MAX_ITEMS, TAX_RATES, addDaysString, computeTotals, encodeInvoiceToken, formatAmount, isSignatureValid,
  parseInvoicePayload, serializePayload, signInvoicePayload, todayString, validateInvoicePayload,
} from '../../lib/invoice';
import type { InvoiceItem, InvoicePayload, Rounding, TaxMode, TaxRate } from '../../lib/invoice';
import { chainKeyForId, readStartBlock } from '../../lib/invoicePayment';
import { chainTargetFromKey, getExternalSigner, isExternalWalletError } from '../../lib/externalWallet';
import type { SignerSource } from '../../lib/signer';
import { useAppStore } from '../../store/appStore';

interface Row {
  key: number;
  name: string;
  qty: string;
  price: string;
  rate: TaxRate;
}

let rowKeySeq = 0;
const newRow = (init: Partial<Row> = {}): Row => ({ key: ++rowKeySeq, name: '', qty: '1', price: '', rate: 10, ...init });

// 請求書の作成。"発行" signs the invoice with the active wallet's key (password required), takes
// the next 請求書番号, and stores it; the share link and PDF are made from the stored record on
// InvoiceDetail. ?copy=<id> starts from an earlier invoice's content (new number/date).
export default function InvoiceForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copyId = searchParams.get('copy');
  const activeChain = useAppStore((s) => s.activeChain);

  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<IssuerProfile | null>(null);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');

  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [issueDate, setIssueDate] = useState(todayString());
  const [dueDate, setDueDate] = useState('');
  const [chain, setChain] = useState<ChainKey>(activeChain);
  const [taxMode, setTaxMode] = useState<TaxMode>('excl');
  const [rounding, setRounding] = useState<Rounding>('floor');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [note, setNote] = useState('');

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      const [p, contacts, productList] = await Promise.all([
        IssuerProfileHelper.get(),
        AddressBookHelper.list(),
        ProductsHelper.list(),
      ]);
      setProfile(p);
      setContactNames(contacts.filter((c) => c.id !== AddressBookHelper.SELF_ID && c.name.trim() !== '').map((c) => c.name));
      setProducts(productList);
      setTaxMode(p.defaultTaxMode);
      setRounding(p.defaultRounding);
      setDueDate(addDaysString(todayString(), p.defaultDueDays));
      setNote(p.defaultNote);

      if (copyId) {
        const source = await InvoicesHelper.get(copyId);
        const payload = source ? parseInvoicePayload(source.payload) : null;
        if (payload) {
          setRecipient(payload.to);
          setSubject(payload.sub);
          setTaxMode(payload.tm);
          setRounding(payload.rm);
          setNote(payload.note);
          const key = chainKeyForId(payload.cid);
          if (key) setChain(key);
          setRows(payload.it.map((item) => newRow({ name: item.name, qty: String(item.qty), price: String(item.price), rate: item.rate })));
        }
      }
      setLoaded(true);
    })();
  }, [copyId]);

  // The number is allocated from the issue date's year, so keep the preview in step with it.
  useEffect(() => {
    const year = Number(issueDate.slice(0, 4));
    if (!Number.isInteger(year) || year < 1970) return;
    let cancelled = false;
    IssuerProfileHelper.peekNumber('invoice', year).then((n) => { if (!cancelled) setPreviewNumber(n); });
    return () => { cancelled = true; };
  }, [issueDate]);

  const parsedItems: InvoiceItem[] = useMemo(
    () => rows.map((r) => ({ name: r.name, qty: Number(r.qty), price: r.price.trim() === '' ? NaN : Number(r.price), rate: r.rate })),
    [rows],
  );

  const preview = useMemo(() => {
    const usable = parsedItems.filter((i) => Number.isFinite(i.qty) && Number.isFinite(i.price));
    return computeTotals(usable, taxMode, rounding);
  }, [parsedItems, taxMode, rounding]);

  const updateRow = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const buildPayload = (number: string, payee: string): InvoicePayload => ({
    v: 1,
    n: number,
    d: issueDate,
    due: dueDate,
    cid: CHAINS[chain].chainId,
    a: payee,
    to: recipient.trim(),
    sub: subject.trim(),
    iss: {
      name: profile?.name.trim() ?? '',
      reg: profile?.registrationNumber ?? '',
      addr: profile?.address ?? '',
      tel: profile?.phone ?? '',
      mail: profile?.email ?? '',
    },
    it: parsedItems.map((i) => ({ ...i, name: i.name.trim() })),
    tm: taxMode,
    rm: rounding,
    note: note.trim(),
  });

  const onIssueClick = async () => {
    const wallet = await WalletsHelper.getActive();
    if (!wallet) {
      setErrorMessage(t('invoice.error_no_wallet'));
      return;
    }
    const problem = validateInvoicePayload(buildPayload(previewNumber || 'INV-0', ethers.getAddress(wallet.address)));
    if (problem) {
      setErrorMessage(t(`invoice.error_${problem}`));
      return;
    }
    if (wallet.externalProvider) {
      // MetaMask / Bitget Wallet: no password here - the extension asks for approval instead.
      await onPassed(null);
    } else {
      setPasswordOpen(true);
    }
  };

  // password === null: a wallet connected through MetaMask / Bitget Wallet, which signs in the extension.
  const onPassed = async (password: string | null) => {
    setIssuing(true);
    try {
      const wallet = await WalletsHelper.getActive();
      if (!wallet) {
        setErrorMessage(t('invoice.error_no_wallet'));
        return;
      }
      let privateKey: SignerSource;
      if (wallet.externalProvider) {
        privateKey = await getExternalSigner(wallet.externalProvider, wallet.address, chainTargetFromKey(chain));
      } else {
        const decrypted = password == null ? null : await WalletsHelper.decryptKey(wallet.id, password);
        if (decrypted == null) {
          setErrorMessage(t('wallet.invalid_key'));
          return;
        }
        privateKey = decrypted;
      }
      const payee = ethers.getAddress(wallet.address);
      const year = Number(issueDate.slice(0, 4));
      const number = await IssuerProfileHelper.reserveNumber('invoice', year);
      const payload = buildPayload(number, payee);
      const json = serializePayload(payload);
      const signature = await signInvoicePayload(json, privateKey);
      if (!isSignatureValid(payload, json, signature)) {
        // The stored key doesn't belong to the wallet's address - never issue such an invoice.
        setErrorMessage(t('invoice.error_sign'));
        return;
      }
      const token = await encodeInvoiceToken(json, signature);
      const startBlock = await readStartBlock(chain);
      const record = await InvoicesHelper.add({
        number,
        payload: json,
        signature,
        token,
        status: 'issued',
        startBlock,
        recipient: payload.to,
        total: preview.total,
        issueDate: payload.d,
        due: payload.due,
        chainId: payload.cid,
      });
      navigate(`/invoice/detail?id=${record.id}`, { replace: true });
    } catch (e) {
      if (isExternalWalletError(e)) {
        setErrorMessage(t(`external.error_${e.code}`));
        return;
      }
      if ((e as { code?: string } | null)?.code === 'ACTION_REJECTED') {
        setErrorMessage(t('external.error_rejected'));
        return;
      }
      console.error('Failed to issue invoice', e);
      setErrorMessage(t('invoice.error_issue_failed'));
    } finally {
      setIssuing(false);
    }
  };

  if (!loaded) return null;

  const issuerMissing = (profile?.name.trim() ?? '') === '';

  return (
    <Box>
      <AppToolBar back="/invoice" title={t('invoice.form_title')} />
      <Box sx={{ p: 2 }}>
        {issuerMissing && (
          <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => navigate('/invoice/settings')}>{t('invoice.set_up')}</Button>}>
            {t('invoice.issuer_missing')}
          </Alert>
        )}

        <Card sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">{t('invoice.number_label')}: {previewNumber}</Typography>
          <Autocomplete
            freeSolo
            options={contactNames}
            inputValue={recipient}
            onInputChange={(_, value) => setRecipient(value)}
            renderInput={(params) => <TextField {...params} label={t('invoice.recipient')} margin="normal" helperText={t('invoice.recipient_hint')} />}
          />
          <TextField label={t('invoice.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth margin="normal" slotProps={{ htmlInput: { maxLength: 120 } }} />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label={t('invoice.issue_date')} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} fullWidth margin="normal" slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label={t('invoice.due_date')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} fullWidth margin="normal" slotProps={{ inputLabel: { shrink: true } }} />
          </Box>
          <TextField select label={t('invoice.chain')} value={chain} onChange={(e) => setChain(e.target.value as ChainKey)} fullWidth margin="normal" helperText={t('invoice.chain_hint')}>
            {(Object.keys(CHAINS) as ChainKey[]).map((key) => (
              <MenuItem key={key} value={key}>{CHAINS[key].name}</MenuItem>
            ))}
          </TextField>
        </Card>

        <Typography sx={{ fontWeight: 'bold', mt: 3, mb: 1 }}>{t('invoice.items')}</Typography>
        {rows.map((row, index) => (
          <Card key={row.key} sx={{ p: 2, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label={`${t('invoice.item_name')} ${index + 1}`}
                value={row.name}
                onChange={(e) => updateRow(row.key, { name: e.target.value })}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <IconButton aria-label={t('common.delete')} disabled={rows.length === 1} onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
                <DeleteOutlineOutlinedIcon />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
              <TextField label={t('invoice.item_qty')} type="number" size="small" value={row.qty} onChange={(e) => updateRow(row.key, { qty: e.target.value })} sx={{ width: '22%' }} slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
              <TextField label={t('invoice.item_price')} type="number" size="small" value={row.price} onChange={(e) => updateRow(row.key, { price: e.target.value })} sx={{ flex: 1 }} slotProps={{ htmlInput: { step: 1 } }} />
              <TextField select label={t('invoice.item_tax')} size="small" value={row.rate} onChange={(e) => updateRow(row.key, { rate: Number(e.target.value) as TaxRate })} sx={{ width: '34%' }}>
                {TAX_RATES.map((rate) => (
                  <MenuItem key={rate} value={rate}>{rate === 0 ? t('invoice.tax_exempt_short') : rate === 8 ? t('invoice.tax_reduced_option') : `${rate}%`}</MenuItem>
                ))}
              </TextField>
            </Box>
          </Card>
        ))}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<AddIcon />} disabled={rows.length >= MAX_ITEMS} onClick={() => setRows((prev) => [...prev, newRow()])}>{t('invoice.add_item')}</Button>
          {products.length > 0 && (
            <Button disabled={rows.length >= MAX_ITEMS} onClick={() => setProductDialogOpen(true)}>{t('invoice.add_from_products')}</Button>
          )}
        </Box>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('invoice.tax_mode')}</Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" color="primary" value={taxMode} onChange={(_, v: TaxMode | null) => v && setTaxMode(v)}>
            <ToggleButton value="excl">{t('invoice.tax_mode_excl')}</ToggleButton>
            <ToggleButton value="incl">{t('invoice.tax_mode_incl')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField select label={t('invoice.rounding')} value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)} fullWidth margin="normal" size="small">
            <MenuItem value="floor">{t('invoice.rounding_floor')}</MenuItem>
            <MenuItem value="round">{t('invoice.rounding_round')}</MenuItem>
            <MenuItem value="ceil">{t('invoice.rounding_ceil')}</MenuItem>
          </TextField>
          <TextField label={t('invoice.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth margin="normal" multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          {preview.groups.map((g) => (
            <Box key={g.rate} sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">
                {g.rate === 0 ? t('invoice.tax_exempt_target') : `${t('invoice.rate_target_net', { rate: g.rate })} / ${t('invoice.consumption_tax', { rate: g.rate })}`}
              </Typography>
              <Typography variant="body2">{g.rate === 0 ? formatAmount(g.net) : `${formatAmount(g.net)} / ${formatAmount(g.tax)}`}</Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 1 }}>
            <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.total_incl_tax')}</Typography>
            <Typography sx={{ fontWeight: 'bold', fontSize: 'x-large' }}>{`${formatAmount(preview.total)} JPYC`}</Typography>
          </Box>
        </Card>

        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>{t('invoice.issue_hint')}</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button variant="contained" size="large" disabled={issuing || issuerMissing} onClick={onIssueClick} sx={{ minWidth: 200 }}>
            {t('invoice.issue')}
          </Button>
        </Box>
      </Box>

      <Dialog open={productDialogOpen} onClose={() => setProductDialogOpen(false)} fullWidth>
        <DialogTitle>{t('invoice.add_from_products')}</DialogTitle>
        <List sx={{ pt: 0, maxHeight: 360, overflowY: 'auto' }}>
          {products.map((product) => (
            <ListItemButton
              key={product.id}
              onClick={() => {
                setRows((prev) => {
                  const row = newRow({ name: product.name, price: String(product.price) });
                  // Replace the untouched starter row instead of leaving an empty line above.
                  const onlyBlank = prev.length === 1 && prev[0].name === '' && prev[0].price === '';
                  return onlyBlank ? [row] : [...prev, row];
                });
                setProductDialogOpen(false);
              }}
            >
              <ListItemText primary={product.name} secondary={`${formatAmount(product.price)} JPYC`} />
            </ListItemButton>
          ))}
        </List>
        <DialogActions>
          <Button onClick={() => setProductDialogOpen(false)}>{t('common.cancel')}</Button>
        </DialogActions>
      </Dialog>

      <PasswordDialog open={passwordOpen} mode="check" onClose={() => setPasswordOpen(false)} onPass={onPassed} />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
