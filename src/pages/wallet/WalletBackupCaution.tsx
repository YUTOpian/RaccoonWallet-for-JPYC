import { Box, Button, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import cautionIcon from '../../assets/icon_caution.png';

export default function WalletBackupCaution() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  // Optional override for where "←" and the eventual "完了" land - used when this screen
  // is reached from somewhere other than a specific wallet's own settings screen (e.g. the
  // app-wide Settings screen's "Backup" item, which has no wallet id in its URL).
  const back = searchParams.get('back') || '';
  // 'mnemonic' when reached from the app-wide Settings screen's バックアップ item (see
  // SettingsTop's goToBackup), 'key' when reached from a specific wallet's own settings
  // screen (see WalletSettingsDialog) - controls whether the next screen (WalletBackup) reveals
  // the private key or the recovery phrase.
  const mode = searchParams.get('mode') === 'mnemonic' ? 'mnemonic' : 'key';

  const backParam = back ? `&back=${encodeURIComponent(back)}` : '';
  const modeParam = mode === 'mnemonic' ? '&mode=mnemonic' : '';

  const cautionTitleKey = mode === 'mnemonic' ? 'wallet.mnemonic_caution_title' : 'wallet.key_caution_title';
  const cautionMessageLines = mode === 'mnemonic'
    ? [t('wallet.mnemonic_caution_message')]
    : (t('wallet.key_caution_message', { returnObjects: true }) as string[]);

  return (
    <Box sx={{ bgcolor: '#606060', minHeight: '100dvh' }}>
      <AppToolBar
        back={back || `/wallet/select?settings=${id}`}
        title={t('common.backup')}
      />
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <Typography sx={{ color: 'white' }}>{t(cautionTitleKey)}</Typography>
        </Box>

        <Typography align="center" sx={{ mt: 1, mx: 2, color: 'white' }}>
          {cautionMessageLines.map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pb: 4 }}>
        <Button
          variant="contained" color="primary" size="small"
          onClick={() => navigate(`/wallet/backup?id=${id}${backParam}${modeParam}`)}
        >
          OK
        </Button>
      </Box>
    </Box>
  );
}
