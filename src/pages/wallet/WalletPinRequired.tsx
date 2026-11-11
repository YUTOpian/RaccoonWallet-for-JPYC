import { Box, Typography } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import cautionIcon from '../../assets/icon_caution.png';

// Reached only via PinExposureGuard's redirect - never linked to directly from anywhere
// in the app's normal navigation. The PasswordDialog below is open from the moment this
// screen mounts and is never dismissible (onClose/onCancel are both no-ops): the whole
// point of this screen is that the person can't do anything else in the app - including
// backing out - while the active wallet's secret is still sitting behind
// PinCodeHelper.defaultPin, the fixed placeholder baked into the shipped source. Setting
// a real PIN here re-encrypts that wallet onto it (PasswordDialog's mode="register" branch
// calls WalletsHelper.encryptWallets(defaultPin, next) automatically), which is what lets
// PinExposureGuard stop redirecting here on the next navigation.
export default function WalletPinRequired() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const onPass = () => {
    // Send the person back wherever they were actually headed before the guard
    // intercepted them, falling back to Home if that's not available (e.g. this was the
    // very first screen the app loaded on).
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== '/wallet/pin-required' ? from : '/top', { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppToolBar showBack={false} title={t('wallet.pin_required_title')} />
      <Box sx={{ mb: 5, mx: 2, mt: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <span>{t('wallet.pin_required_title')}</span>
        </Box>
        <Typography align="center" sx={{ mt: 2 }}>
          {(t('wallet.pin_required_message', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>
      </Box>

      <PasswordDialog
        open
        mode="register"
        onClose={() => {}}
        onCancel={() => {}}
        onPass={onPass}
      />
    </Box>
  );
}
