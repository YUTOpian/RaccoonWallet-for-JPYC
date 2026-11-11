import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import heroLoginLarge from '../../assets/heroimage_login_large.png';

export default function WalletLoginEnd() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div>
      <AppToolBar showBack={false} title={t('wallet.login_end_title')} />
      <Box component="img" src={heroLoginLarge} sx={{ width: '100%' }} />
      <Box sx={{ px: 2 }}>
        <Typography align="center" sx={{ mx: 2 }}>
          {(t('wallet.login_end_message', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2, gap: 1 }}>
          {/* Getting here already means a recovery phrase/private key was just imported and
              a PIN was just set/checked - the two-step "are you sure, security matters"
              caution that WalletCreationEnd still shows exists to nudge someone who hasn't
              backed up or PIN-protected their *new* wallet yet. That doesn't apply on the
              way out of an *import*, so this just goes straight home. */}
          <Button variant="contained" sx={{ bgcolor: 'grey.600', color: 'white' }} onClick={() => navigate('/top?tab=home')}>
            HOME
          </Button>
        </Box>
      </Box>
    </div>
  );
}
