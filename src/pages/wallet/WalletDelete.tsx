import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { Environment } from '../../lib/environment';
import cautionIcon from '../../assets/icon_caution.png';

export default function WalletDelete() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  useEffect(() => {
    (async () => {
      if (await PinCodeHelper.hasSavedCode()) {
        setShowPasswordDialog(true);
      }
    })();
  }, []);

  const goBackSettings = () => {
    if (Environment.isIos() && Environment.isInStandaloneMode()) {
      navigate(`/wallet/select?settings=${id}`);
    } else {
      navigate(-1);
    }
  };

  const goBackSelect = () => {
    if (Environment.isIos() && Environment.isInStandaloneMode()) {
      navigate('/wallet/select');
    } else {
      navigate(-2 as any);
    }
  };

  const deleteWallet = async () => {
    await WalletsHelper.delete(id);
    goBackSelect();
  };

  return (
    <Box sx={{ bgcolor: '#606060', minHeight: '100dvh' }}>
      <AppToolBar back={`/wallet/select?settings=${id}`} title={t('common.delete')} />
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <Typography sx={{ color: 'white' }}>{t('wallet.key_caution_title')}</Typography>
        </Box>

        <Typography align="center" sx={{ mt: 1, mx: 2, color: 'white' }}>
          {(t('wallet.delete_caution_message', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 8, pb: 4 }}>
        <Button variant="contained" color="primary" size="small" onClick={deleteWallet}>REMOVE</Button>
        <Button variant="contained" color="secondary" size="small" onClick={goBackSettings}>CANCEL</Button>
      </Box>

      <PasswordDialog open={showPasswordDialog} mode="check" onClose={() => setShowPasswordDialog(false)} onCancel={goBackSettings} onPass={() => setShowPasswordDialog(false)} />
    </Box>
  );
}
