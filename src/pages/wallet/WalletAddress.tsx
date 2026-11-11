import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { WalletsHelper } from '../../lib/storage';

export default function WalletAddress() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  const [address, setAddress] = useState('');

  useEffect(() => {
    (async () => {
      const activeWallet = await WalletsHelper.getActive();
      setAddress(activeWallet?.address ?? '');
    })();
  }, []);

  return (
    <Box>
      <AppToolBar back={`/wallet/select?settings=${id}`} title={t('common.address')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2 }}>
          {address.length > 0 && <QRCodeSVG value={address} size={200} />}
          <Typography sx={{ mt: 4, color: 'primary.main' }}>{t('receive.your_address')}</Typography>
          <Typography align="center" sx={{ wordBreak: 'break-all', mx: 4 }}>{address}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
