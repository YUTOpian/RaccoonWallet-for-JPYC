import { useEffect, useState } from 'react';
import { Box, Button, Card, MenuItem, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { AddressBookHelper, IssuerProfileHelper } from '../../lib/storage';
import { defaultLinkBase, isValidRegistrationNumber, normalizeLinkBase } from '../../lib/invoice';
import type { Rounding, TaxMode } from '../../lib/invoice';

const PREFIX_RE = /^[A-Za-z0-9_-]{0,12}$/;

// 発行者情報: who the invoices/receipts say they come from, plus the defaults the invoice form
// starts with. The serial counters (seq) are intentionally not editable here.
export default function InvoiceSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [numberPrefix, setNumberPrefix] = useState('INV-');
  const [receiptPrefix, setReceiptPrefix] = useState('RCT-');
  const [taxMode, setTaxMode] = useState<TaxMode>('excl');
  const [rounding, setRounding] = useState<Rounding>('floor');
  const [dueDays, setDueDays] = useState('14');
  const [note, setNote] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      const profile = await IssuerProfileHelper.get();
      let initialName = profile.name;
      let initialPhone = profile.phone;
      let initialEmail = profile.email;
      if (initialName === '') {
        // First visit: borrow the name/phone/email from "my profile" in the address book.
        const self = await AddressBookHelper.getSelf();
        if (self.name !== 'GUEST') initialName = self.name;
        if (initialPhone === '') initialPhone = self.phone;
        if (initialEmail === '') initialEmail = self.email;
      }
      setName(initialName);
      setRegistrationNumber(profile.registrationNumber);
      setAddress(profile.address);
      setPhone(initialPhone);
      setEmail(initialEmail);
      setNumberPrefix(profile.numberPrefix);
      setReceiptPrefix(profile.receiptPrefix);
      setTaxMode(profile.defaultTaxMode);
      setRounding(profile.defaultRounding);
      setDueDays(String(profile.defaultDueDays));
      setNote(profile.defaultNote);
      setBaseUrl(profile.baseUrl);
      setLoaded(true);
    })();
  }, []);

  const onSave = async () => {
    const reg = registrationNumber.trim().toUpperCase();
    if (!isValidRegistrationNumber(reg)) {
      setErrorMessage(t('invoice.error_registration'));
      return;
    }
    if (!PREFIX_RE.test(numberPrefix) || !PREFIX_RE.test(receiptPrefix)) {
      setErrorMessage(t('invoice.error_prefix'));
      return;
    }
    const days = Number(dueDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setErrorMessage(t('invoice.error_due_days'));
      return;
    }
    if (baseUrl.trim() !== '' && normalizeLinkBase(baseUrl) === '') {
      setErrorMessage(t('invoice.error_base_url'));
      return;
    }
    await IssuerProfileHelper.save({
      name: name.trim(),
      registrationNumber: reg,
      address: address.trim(),
      phone: phone.trim(),
      email: email.trim(),
      numberPrefix,
      receiptPrefix,
      defaultTaxMode: taxMode,
      defaultRounding: rounding,
      defaultDueDays: days,
      defaultNote: note,
      baseUrl: normalizeLinkBase(baseUrl),
    });
    navigate(-1);
  };

  if (!loaded) return null;

  return (
    <Box>
      <AppToolBar back="/invoice" title={t('invoice.settings_title')} />
      <Box sx={{ p: 2 }}>
        <Card sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">{t('invoice.settings_issuer_hint')}</Typography>
          <TextField label={t('invoice.issuer_name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth margin="normal" slotProps={{ htmlInput: { maxLength: 120 } }} />
          <TextField
            label={t('invoice.registration_number')}
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            helperText={t('invoice.registration_number_hint')}
            placeholder="T1234567890123"
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { maxLength: 14 } }}
          />
          <TextField label={t('invoice.issuer_address')} value={address} onChange={(e) => setAddress(e.target.value)} fullWidth margin="normal" multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
          <TextField label={t('invoice.issuer_phone')} value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth margin="normal" slotProps={{ htmlInput: { maxLength: 40 } }} />
          <TextField label={t('invoice.issuer_email')} value={email} onChange={(e) => setEmail(e.target.value)} fullWidth margin="normal" slotProps={{ htmlInput: { maxLength: 120 } }} />
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.settings_defaults')}</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label={t('invoice.number_prefix')} value={numberPrefix} onChange={(e) => setNumberPrefix(e.target.value)} fullWidth margin="normal" />
            <TextField label={t('invoice.receipt_prefix')} value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} fullWidth margin="normal" />
          </Box>
          <TextField select label={t('invoice.tax_mode')} value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)} fullWidth margin="normal">
            <MenuItem value="excl">{t('invoice.tax_mode_excl')}</MenuItem>
            <MenuItem value="incl">{t('invoice.tax_mode_incl')}</MenuItem>
          </TextField>
          <TextField select label={t('invoice.rounding')} value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)} fullWidth margin="normal">
            <MenuItem value="floor">{t('invoice.rounding_floor')}</MenuItem>
            <MenuItem value="round">{t('invoice.rounding_round')}</MenuItem>
            <MenuItem value="ceil">{t('invoice.rounding_ceil')}</MenuItem>
          </TextField>
          <TextField
            label={t('invoice.default_due_days')}
            type="number"
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { min: 0, max: 365, step: 1 } }}
          />
          <TextField label={t('invoice.default_note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth margin="normal" multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.link_settings')}</Typography>
          <TextField
            label={t('invoice.link_base_url')}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={defaultLinkBase() || 'https://example.com/wallet/'}
            helperText={defaultLinkBase() === '' ? t('invoice.link_base_url_required') : t('invoice.link_base_url_hint')}
            fullWidth
            margin="normal"
          />
        </Card>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button variant="contained" onClick={onSave} sx={{ minWidth: 160 }}>{t('common.done')}</Button>
        </Box>
      </Box>
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
