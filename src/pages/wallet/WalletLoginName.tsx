import { useState } from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { WalletsHelper } from '../../lib/storage';
import heroLoginLarge from '../../assets/heroimage_login_large.png';

// ウォレット名の入力画面（WalletLoginImport のフローから到達）。
export default function WalletLoginName() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [name, setName] = useState('');

  const onClickedOk = async () => {
    const wallets = await WalletsHelper.gets();
    const id = wallets[wallets.length - 1].id;
    await WalletsHelper.setName(id, name);
    navigate('/wallet/login/end');
  };

  return (
    <div>
      <AppToolBar showBack={false} title={t('wallet.login_name_title')} />
      <Box component="img" src={heroLoginLarge} sx={{ width: '100%' }} />
      <Box sx={{ px: 2 }}>
        <Typography align="center" sx={{ mx: 2 }}>
          {(t('wallet.login_name_message', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <TextField id="name" label="Wallet name" value={name} onChange={(e) => setName(e.target.value)} sx={{ width: '66%' }} />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2 }}>
          <Button variant="contained" color="primary" disabled={name.length === 0} onClick={onClickedOk}>OK</Button>
        </Box>
      </Box>
    </div>
  );
}
