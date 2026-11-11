import { useEffect, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { WalletsHelper } from '../../lib/storage';
import heroNewLarge from '../../assets/heroimage_new_large.png';

export default function WalletCreationNew() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeWalletAddress, setActiveWalletAddress] = useState('');

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      setActiveWalletAddress(wallet?.address ?? '');
    })();
  }, []);

  return (
    <div>
      <AppToolBar showBack={false} title={t('wallet.create_title')} />
      <Box component="img" src={heroNewLarge} sx={{ width: '100%' }} />
      <Box sx={{ px: 2 }}>
        <Typography align="center">
          {t('wallet.create_message_0')}<br />{t('wallet.create_message_1')}<br />{t('wallet.create_message_2')}
        </Typography>
        <Typography align="center" sx={{ color: 'primary.main', mt: 2 }}>{t('receive.your_address')}</Typography>
        <Typography align="center" sx={{ wordBreak: 'break-all', mx: 4 }}>{activeWalletAddress}</Typography>
        <Typography align="center" sx={{ mt: 2 }}>
          {t('wallet.create_message_3')}<br />{t('wallet.create_message_4')}<br />{t('wallet.create_message_5')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2 }}>
          <Button variant="contained" color="primary" onClick={() => navigate('/wallet/creation/end')}>OK</Button>
        </Box>
      </Box>
    </div>
  );
}
