import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import heroNewLarge from '../../assets/heroimage_new_large.png';

export default function WalletCreationEnd() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div>
      <AppToolBar showBack={false} title={t('wallet.end_title')} />
      <Box component="img" src={heroNewLarge} sx={{ width: '100%' }} />
      <Box sx={{ px: 2 }}>
        <Typography align="center">{t('wallet.end_message_0')}<br />{t('wallet.end_message_1')}</Typography>
        <Typography align="center" sx={{ mt: 2 }}>{t('wallet.end_message_2')}<br />{t('wallet.end_message_3')}</Typography>

        {/* By this point in the flow the PIN is already set (WalletCreationName) and the
            recovery phrase has already been shown/confirmed (WalletCreationMnemonic), so
            there's nothing left to nudge the person towards a lesson for - HOME is simply
            the next step, not an "escape hatch" that needs a security-shaming confirm
            dialog on the way out (see the old go_home_caution1/2 flow this replaced). */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2, gap: 1 }}>
          <Button variant="contained" color="primary" onClick={() => navigate('/top?tab=home')}>
            HOME
          </Button>
        </Box>
      </Box>
    </div>
  );
}
