import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Box, Grid, Card, Typography, Checkbox, FormControlLabel, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { useBlockBackNavigation } from '../../lib/useBlockBackNavigation';
import cautionIcon from '../../assets/icon_caution.png';

export default function WalletCreationMnemonic() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  // Passed by WalletCreationName right after the PIN was set/confirmed (2 taps total),
  // so this screen never has to ask for it a third time - see that file's navigate() call.
  const pinFromCreation = (location.state as { pin?: string } | null)?.pin;

  const [mnemonic, setMnemonic] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  // The recovery phrase is shown here exactly once during wallet creation - block the
  // back button/gesture so a person can't accidentally leave before noting it down; the
  // only way off this screen is the "完了" checkbox+button below (a forward navigate()).
  useBlockBackNavigation(true);

  const getWallet = async () => {
    return id.length === 0 ? await WalletsHelper.getActive() : await WalletsHelper.get(id);
  };

  useEffect(() => {
    (async () => {
      const wallet = await getWallet();
      if (wallet == null) {
        setMnemonic('');
        return;
      }
      // The wallet this screen shows was created by WalletCreationName with the real PIN
      // just set/confirmed there (pinFromCreation) - by spec the PIN is only entered/
      // confirmed twice per creation, not a third time here. pinFromCreation can only be
      // missing if router state was lost (e.g. a page refresh on this exact screen); the
      // defaultPin fallback below exists solely so a pre-fix installation's leftover
      // default-PIN-encrypted wallet can still be read, not as a normal path for new
      // wallets (see PinCodeHelper.defaultPin's comment).
      const decrypted = pinFromCreation != null
        ? await WalletsHelper.decryptMnemonic(wallet.id, pinFromCreation)
        : await WalletsHelper.decryptMnemonic(wallet.id, PinCodeHelper.defaultPin);
      setMnemonic(decrypted || '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const words = mnemonic.length === 0 ? [] : mnemonic.split(' ');

  return (
    <div>
      <AppToolBar title={t('wallet.mnemonic_title')} showBack={false} />
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2, gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <span>{t('wallet.mnemonic_caution_title')}</span>
        </Box>

        <Typography align="center" sx={{ mt: 2, mx: 2 }}>{t('wallet.mnemonic_caution_message')}</Typography>

        <Typography align="center" sx={{ mt: 2, mx: 2, color: 'text.secondary', fontSize: 13 }}>
          {(t('wallet.mnemonic_interop_notice', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>

        <Grid container spacing={0.5} sx={{ justifyContent: 'center', mt: 3, px: 2 }}>
          {words.map((word, index) => (
            <Grid key={index} size={4} sx={{ p: 0.5 }}>
              <Card variant="outlined" sx={{ bgcolor: 'grey.100', p: 1, position: 'relative' }}>
                <Typography component="span" sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary', fontSize: 12 }}>{index + 1}</Typography>
                <Typography align="center" sx={{ fontSize: 'inherit' }}>{word}</Typography>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <FormControlLabel
            control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />}
            label={t('wallet.mnemonic_confirm_checkbox')}
          />
        </Box>
      </Box>

      <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
        <Button variant="contained" color="primary" size="small" disabled={!confirmed} onClick={() => navigate('/wallet/creation/new')}>
          {t('common.done')}
        </Button>
      </Box>
    </div>
  );
}
