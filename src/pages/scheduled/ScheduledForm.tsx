import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel,
  List, ListItemButton, ListItemText, MenuItem, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { ethers } from 'ethers';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { AddressBookHelper, ScheduledPaymentsHelper, WalletsHelper } from '../../lib/storage';
import type { AddressBookRecord, ScheduledPaymentRecord } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { FREQUENCIES, REMIND_DAY_OPTIONS, previewDates, validateDraft } from '../../lib/scheduledPayments';
import type { Frequency } from '../../lib/scheduledPayments';
import { addDaysString, formatJapaneseDate, todayString } from '../../lib/invoice';
import { chainKeyForId } from '../../lib/invoicePayment';
import { exportScheduleCalendar } from '../../lib/scheduledCalendar';
import { useAppStore } from '../../store/appStore';

const LABEL_PRESETS = ['rent', 'subscription', 'allowance'] as const;

// 予約送金の作成・編集。保存しても自動では送金されない(期日にアプリで承認する)。
import { AddressSafetyHint } from '../../components/AddressSafetyBlock';
import { useAddressSafety } from '../../hooks/useAddressSafety';

export default function ScheduledForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const activeChain = useAppStore((s) => s.activeChain);

  const [loaded, setLoaded] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [existing, setExisting] = useState<ScheduledPaymentRecord | null>(null);
  const [contacts, setContacts] = useState<AddressBookRecord[]>([]);

  const [label, setLabel] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [amount, setAmount] = useState('');
  const [chain, setChain] = useState<ChainKey>(activeChain);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [firstDue, setFirstDue] = useState(addDaysString(todayString(), 1));
  const [endDate, setEndDate] = useState('');
  const [remindDays, setRemindDays] = useState(0);
  const [note, setNote] = useState('');
  const [paused, setPaused] = useState(false);
  const addressSafety = useAddressSafety(toAddress, chain);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      if (!wallet) {
        navigate('/scheduled', { replace: true });
        return;
      }
      setWalletAddress(wallet.address);
      setContacts((await AddressBookHelper.list()).filter((c) => c.id !== AddressBookHelper.SELF_ID && c.wallets.length > 0));
      if (editId) {
        const record = await ScheduledPaymentsHelper.get(editId);
        if (record && record.walletAddress.toLowerCase() === wallet.address.toLowerCase()) {
          setExisting(record);
          setLabel(record.label);
          setToAddress(record.toAddress);
          setRecipientName(record.recipientName);
          setAmount(record.amount);
          const key = chainKeyForId(record.chainId);
          if (key) setChain(key);
          setFrequency(record.frequency);
          setFirstDue(record.nextDue);
          setEndDate(record.endDate);
          setRemindDays(record.remindDays);
          setNote(record.note);
          setPaused(record.status === 'paused');
        }
      }
      setLoaded(true);
    })();
  }, [editId, navigate]);

  const preview = useMemo(() => previewDates(firstDue, frequency, endDate), [firstDue, frequency, endDate]);
  const completed = existing?.status === 'completed';

  const onSave = async () => {
    const draft = { label, toAddress, amount, firstDue, endDate: frequency === 'once' ? '' : endDate, frequency, chainId: CHAINS[chain]?.chainId ?? null };
    const problem = validateDraft(draft, ethers.isAddress);
    if (problem) {
      setErrorMessage(t(`scheduled.error_${problem}`));
      return;
    }
    const fields = {
      label: label.trim(),
      toAddress: ethers.getAddress(toAddress.trim()),
      recipientName,
      amount: amount.trim(),
      chainId: CHAINS[chain].chainId,
      frequency,
      anchorDay: Number(firstDue.slice(8, 10)),
      nextDue: firstDue,
      endDate: draft.endDate,
      remindDays,
      note: note.trim(),
    };
    if (existing) {
      const changedOccurrence = existing.nextDue !== firstDue || existing.toAddress !== fields.toAddress || existing.amount !== fields.amount;
      await ScheduledPaymentsHelper.update(existing.id, {
        ...fields,
        // A finished schedule only comes back to life if it was given a new date; otherwise it stays finished.
        status: completed && firstDue === existing.nextDue ? 'completed' : paused ? 'paused' : 'active',
        ...(changedOccurrence ? { inFlightDue: undefined, inFlightAt: undefined } : {}),
      });
    } else {
      await ScheduledPaymentsHelper.add({ ...fields, walletAddress, status: 'active' });
    }
    navigate('/scheduled', { replace: true });
  };

  const onDelete = async () => {
    setDeleteOpen(false);
    if (existing) await ScheduledPaymentsHelper.remove(existing.id);
    navigate('/scheduled', { replace: true });
  };

  const onPickContact = (contact: AddressBookRecord, wallet: AddressBookRecord['wallets'][number]) => {
    setToAddress(wallet.address);
    setRecipientName(contact.name);
    if (wallet.chain in CHAINS) setChain(wallet.chain as ChainKey);
    if (label.trim() === '') setLabel(contact.name);
    setPickerOpen(false);
  };

  if (!loaded) return null;

  const freqLabel: Record<Frequency, string> = {
    monthly: t('scheduled.freq_monthly'), weekly: t('scheduled.freq_weekly'), yearly: t('scheduled.freq_yearly'), once: t('scheduled.freq_once'),
  };

  return (
    <Box>
      <AppToolBar back="/scheduled" title={existing ? t('scheduled.edit_title') : t('scheduled.form_title')} />
      <Box sx={{ p: 2 }}>
        <Alert severity="info" sx={{ mb: 2 }}>{t('scheduled.form_notice')}</Alert>
        {completed && <Alert severity="success" sx={{ mb: 2 }}>{t('scheduled.completed_note')}</Alert>}

        <Card sx={{ p: 2 }}>
          <TextField label={t('scheduled.label')} value={label} onChange={(e) => setLabel(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 60 } }} />
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            {LABEL_PRESETS.map((key) => (
              <Chip key={key} size="small" variant="outlined" label={t(`scheduled.preset_${key}`)} onClick={() => setLabel(t(`scheduled.preset_${key}`))} />
            ))}
          </Box>

          <TextField label={t('scheduled.to_address')} value={toAddress} onChange={(e) => { setToAddress(e.target.value); setRecipientName(''); }} fullWidth margin="normal" placeholder="0x…" slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'off' } }} />
          {recipientName !== '' && <Typography variant="caption" color="primary" component="div" sx={{ mt: -1, mb: 1 }}>{t('scheduled.recipient_from_book', { name: recipientName })}</Typography>}
          <AddressSafetyHint assessment={addressSafety} />
          <Button size="small" disabled={contacts.length === 0} onClick={() => setPickerOpen(true)}>{t('scheduled.pick_from_addressbook')}</Button>

          <TextField label={t('scheduled.amount')} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth margin="normal" slotProps={{ htmlInput: { min: 0, step: 'any', inputMode: 'decimal' }, input: { endAdornment: <Typography color="text.secondary">JPYC</Typography> } }} />
          <TextField select label={t('invoice.chain')} value={chain} onChange={(e) => setChain(e.target.value as ChainKey)} fullWidth margin="normal">
            {(Object.keys(CHAINS) as ChainKey[]).map((key) => <MenuItem key={key} value={key}>{CHAINS[key].name}</MenuItem>)}
          </TextField>
        </Card>

        <Card sx={{ p: 2, mt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('scheduled.frequency')}</Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" color="primary" value={frequency} onChange={(_, v: Frequency | null) => v && setFrequency(v)}>
            {FREQUENCIES.map((f) => <ToggleButton key={f} value={f}>{freqLabel[f]}</ToggleButton>)}
          </ToggleButtonGroup>
          <TextField label={existing ? t('scheduled.next_due') : t('scheduled.first_due')} type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} fullWidth margin="normal" slotProps={{ inputLabel: { shrink: true } }} />
          {frequency !== 'once' && (
            <TextField label={t('scheduled.end_date')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} fullWidth margin="normal" helperText={t('scheduled.end_date_hint')} slotProps={{ inputLabel: { shrink: true } }} />
          )}
          {frequency === 'monthly' && Number(firstDue.slice(8, 10)) >= 29 && (
            <Typography variant="caption" color="text.secondary" component="p">{t('scheduled.month_end_note')}</Typography>
          )}
          <TextField select label={t('scheduled.remind')} value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))} fullWidth margin="normal">
            {REMIND_DAY_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d === 0 ? t('scheduled.remind_same_day') : t('scheduled.remind_days_before', { count: d })}</MenuItem>)}
          </TextField>
          <TextField label={t('scheduled.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth margin="normal" multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
          {preview.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">{t('scheduled.preview')}</Typography>
              {preview.map((d) => <Typography key={d} variant="body2">{formatJapaneseDate(d)}</Typography>)}
              {frequency !== 'once' && <Typography variant="body2" color="text.secondary">…</Typography>}
            </Box>
          )}
        </Card>

        {existing && !completed && (
          <FormControlLabel sx={{ mt: 2 }} control={<Switch checked={paused} onChange={(e) => setPaused(e.target.checked)} />} label={t('scheduled.pause')} />
        )}

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button variant="contained" size="large" onClick={onSave} sx={{ minWidth: 200 }}>{t('common.done')}</Button>
        </Box>

        {existing && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
            {existing.history.length > 0 && (
              <Card sx={{ p: 2 }}>
                <Typography sx={{ fontWeight: 'bold', mb: 0.5 }}>{t('scheduled.history')}</Typography>
                {existing.history.map((h) => (
                  <Box key={`${h.due}:${h.at}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="body2">{formatJapaneseDate(h.due)}</Typography>
                    <Typography variant="body2" color="text.secondary">{h.skipped ? t('scheduled.history_skipped') : t('scheduled.history_paid')}</Typography>
                  </Box>
                ))}
              </Card>
            )}
            <Button onClick={() => exportScheduleCalendar([existing], t)}>{t('scheduled.export_one')}</Button>
            <Button color="error" onClick={() => setDeleteOpen(true)}>{t('scheduled.delete')}</Button>
          </Box>
        )}
      </Box>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth>
        <DialogTitle>{t('scheduled.pick_from_addressbook')}</DialogTitle>
        <List sx={{ pt: 0, maxHeight: 400, overflowY: 'auto' }}>
          {contacts.flatMap((c) => c.wallets.map((w) => (
            <ListItemButton key={`${c.id}:${w.id}`} onClick={() => onPickContact(c, w)}>
              <ListItemText
                primary={c.name}
                secondary={`${w.chain in CHAINS ? CHAINS[w.chain as ChainKey].name : w.chain} · ${w.address.slice(0, 8)}…${w.address.slice(-6)}`}
              />
            </ListItemButton>
          )))}
        </List>
        <DialogActions><Button onClick={() => setPickerOpen(false)}>{t('common.cancel')}</Button></DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>{t('scheduled.delete')}</DialogTitle>
        <DialogContent><DialogContentText>{t('scheduled.delete_confirm')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
          <Button color="error" onClick={onDelete}>{t('scheduled.delete')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
