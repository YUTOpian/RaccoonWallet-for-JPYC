import { useEffect, useState } from 'react';
import { Box, Button, Card, IconButton, Snackbar, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { WalletsHelper } from '../../lib/storage';
import { JPYC_CORPORATE_URL, JPYC_EX_URL } from '../../lib/jpycLinks';

function Steps({ items }: { items: string[] }) {
  return (
    <Box component="ol" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {items.map((text, i) => (
        <Typography key={i} component="li" variant="body2">{text}</Typography>
      ))}
    </Box>
  );
}

// JPYCの発行(入口)・償還(出口)への案内画面。発行・償還そのものはJPYC株式会社のJPYC EXで
// 行うため、ここでは手順のガイド、JPYC EXへのリンク、(発行時にJPYC EXへ登録する)このウォレットの
// アドレス、償還後に使う送金画面への導線だけを置く。
export default function JpycExchange() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [snackbar, setSnackbar] = useState('');

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      setAddress(wallet?.address ?? '');
    })();
  }, []);

  const onCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setSnackbar(t('jpyc_ex.address_copied'));
    } catch (e) {
      console.warn('Failed to copy address', e);
    }
  };

  const openExButton = (
    <Button
      variant="contained" fullWidth endIcon={<OpenInNewIcon />}
      component="a" href={JPYC_EX_URL} target="_blank" rel="noopener noreferrer"
    >
      {t('jpyc_ex.open_ex')}
    </Button>
  );

  return (
    <Box>
      <AppToolBar back="/top?tab=home" title={t('jpyc_ex.title')} />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">{t('jpyc_ex.intro')}</Typography>

        <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 'bold', fontSize: 'large' }}>{t('jpyc_ex.issue_heading')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('jpyc_ex.issue_sub')}</Typography>
          <Steps items={[
            t('jpyc_ex.issue_step1'), t('jpyc_ex.issue_step2'), t('jpyc_ex.issue_step3'), t('jpyc_ex.issue_step4'),
          ]} />
          {address && (
            <Box sx={{ bgcolor: 'grey.100', borderRadius: 2, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{t('jpyc_ex.my_address_label')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ wordBreak: 'break-all', fontSize: 13, flexGrow: 1 }}>{address}</Typography>
                <IconButton size="small" color="primary" aria-label={t('jpyc_ex.copy_address')} onClick={onCopyAddress}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}
          {openExButton}
        </Card>

        <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 'bold', fontSize: 'large' }}>{t('jpyc_ex.redeem_heading')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('jpyc_ex.redeem_sub')}</Typography>
          <Steps items={[
            t('jpyc_ex.redeem_step1'), t('jpyc_ex.redeem_step2'), t('jpyc_ex.redeem_step3'), t('jpyc_ex.redeem_step4'),
          ]} />
          <Typography variant="caption" color="text.secondary">{t('jpyc_ex.redeem_caution')}</Typography>
          {openExButton}
          <Button variant="outlined" fullWidth onClick={() => navigate('/top?tab=send')}>
            {t('jpyc_ex.open_send')}
          </Button>
        </Card>

        <Typography variant="caption" color="text.secondary">{t('jpyc_ex.note')}</Typography>
        <Button
          size="small" variant="text" endIcon={<OpenInNewIcon />}
          component="a" href={JPYC_CORPORATE_URL} target="_blank" rel="noopener noreferrer"
        >
          {t('jpyc_ex.open_corporate')}
        </Button>
      </Box>
      <Snackbar open={snackbar !== ''} autoHideDuration={2000} onClose={() => setSnackbar('')} message={snackbar} />
    </Box>
  );
}
