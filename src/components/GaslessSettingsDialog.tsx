import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { CHAINS } from '../lib/chains';
import { fetchRelayerInfo, normalizeRelayerUrl } from '../lib/gasless';
import { Storage } from '../lib/storage';

/** ガスレス送金のリレイヤーURLを設定する。保存前にそのリレイヤーへ問い合わせて、対応チェーンを確かめる。 */
export default function GaslessSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok'; chains: string } | { kind: 'invalid' } | { kind: 'unreachable' } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void Storage.loadRelayerUrl().then((url) => {
      setValue(url);
      setSaved(url);
    });
  }, [open]);

  const onSave = async () => {
    const url = normalizeRelayerUrl(value);
    if (url === null) {
      setResult({ kind: 'invalid' });
      return;
    }
    setBusy(true);
    try {
      const info = await fetchRelayerInfo(url, true);
      if (info === null) {
        setResult({ kind: 'unreachable' });
        return;
      }
      await Storage.saveRelayerUrl(url);
      setSaved(url);
      setValue(url);
      const names = Object.values(CHAINS)
        .filter((c) => info.chains.includes(c.chainId))
        .map((c) => c.name)
        .join(' / ');
      setResult({ kind: 'ok', chains: names });
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    await Storage.saveRelayerUrl('');
    setSaved('');
    setValue('');
    setResult(null);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('gas.settings_title')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2, fontSize: '0.9rem' }}>{t('gas.settings_description')}</DialogContentText>
        <TextField
          fullWidth size="small" label={t('gas.settings_url')} placeholder="https://relayer.example.com"
          value={value} onChange={(e) => { setValue(e.target.value); setResult(null); }}
          slotProps={{ htmlInput: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, inputMode: 'url' } }}
        />
        {result?.kind === 'ok' && <Alert severity="success" sx={{ mt: 2 }}>{t('gas.settings_ok', { chains: result.chains || '-' })}</Alert>}
        {result?.kind === 'invalid' && <Alert severity="error" sx={{ mt: 2 }}>{t('gas.settings_invalid')}</Alert>}
        {result?.kind === 'unreachable' && <Alert severity="error" sx={{ mt: 2 }}>{t('gas.settings_unreachable')}</Alert>}
        <DialogContentText sx={{ mt: 2, fontSize: '0.8rem' }}>{t('gas.settings_trust')}</DialogContentText>
      </DialogContent>
      <DialogActions>
        {saved !== '' && <Button color="error" onClick={onClear} disabled={busy}>{t('gas.settings_clear')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={onSave} disabled={busy || value.trim() === ''}>{t('gas.settings_save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
