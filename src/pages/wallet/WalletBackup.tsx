import { useEffect, useState } from 'react';
import { Box, Button, Grid, Card, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { Environment } from '../../lib/environment';
import cautionIcon from '../../assets/icon_caution.png';

export default function WalletBackup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  // See WalletBackupCaution's matching `back` param - carried forward here so the "完了"
  // button lands in the right place even when this screen was reached from somewhere other
  // than a specific wallet's own settings screen.
  const back = searchParams.get('back') || '';
  // 'mnemonic' when reached from the app-wide Settings screen's バックアップ item (no wallet
  // id, `back=/settings/top`) - shows the recovery phrase for the active wallet. 'key' when
  // reached from a specific wallet's own settings screen (WalletSettingsDialog, has `id`) - shows
  // that wallet's private key. See WalletBackupCaution, which sets this same param.
  const mode = searchParams.get('mode') === 'mnemonic' ? 'mnemonic' : 'key';

  const [key, setKey] = useState('');
  const [hasMnemonic, setHasMnemonic] = useState(true);
  const [walletNotFound, setWalletNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isExternal, setIsExternal] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const getWallet = async () => (id.length === 0 ? await WalletsHelper.getActive() : await WalletsHelper.get(id));

  useEffect(() => {
    (async () => {
      setWalletNotFound(false);
      setLoadError(false);
      try {
        const wallet = await getWallet();
        if (wallet == null) {
          setKey('');
          setWalletNotFound(true);
          return;
        }
        setIsExternal(!!wallet.externalProvider);
        if (wallet.externalProvider) {
          // MetaMask / Bitget Wallet: 鍵はこのアプリに無いのでバックアップ対象が存在しない。
          setKey('');
          return;
        }
        if (mode === 'mnemonic' && !wallet.hasMnemonic()) {
          // Imported by private key - there is no recovery phrase to show.
          setHasMnemonic(false);
          setKey('');
          return;
        }
        setHasMnemonic(true);
        if (!(await PinCodeHelper.hasSavedCode())) {
          // No PIN has ever been set on this device, so there is nothing to check the
          // person against - this only happens for a wallet left over from a pre-fix
          // installation that was still encrypted with the old default placeholder PIN
          // (see PinCodeHelper.defaultPin's comment); every wallet created since always
          // has a real PIN behind it before it's ever persisted.
          const secret = mode === 'mnemonic'
            ? await WalletsHelper.decryptMnemonic(wallet.id, PinCodeHelper.defaultPin)
            : await WalletsHelper.decryptKey(wallet.id, PinCodeHelper.defaultPin);
          // Treat a blank result the same as a failed decryption - a real private key or
          // recovery phrase is never empty, so an empty/whitespace-only string here means
          // something upstream (stored ciphertext, PIN) is wrong, not that the secret
          // legitimately "is" blank.
          if (secret == null || secret.trim().length === 0) {
            setLoadError(true);
          }
          setKey(secret || '');
        } else {
          setShowPasswordDialog(true);
        }
      } catch (e) {
        console.error('WalletBackup: failed to load/decrypt wallet secret', e);
        setLoadError(true);
        setKey('');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode]);

  const onPassed = async (pin: string) => {
    try {
      const wallet = await getWallet();
      if (wallet != null) {
        const secret = mode === 'mnemonic'
          ? await WalletsHelper.decryptMnemonic(wallet.id, pin)
          : await WalletsHelper.decryptKey(wallet.id, pin);
        setLoadError(secret == null || secret.trim().length === 0);
        setKey(secret || '');
      }
    } catch (e) {
      console.error('WalletBackup: failed to decrypt wallet secret after PIN entry', e);
      setLoadError(true);
      setKey('');
    }
  };

  const goBackSettings = () => {
    if (Environment.isIos() && Environment.isInStandaloneMode()) {
      navigate(back || `/wallet/select?settings=${id}`);
    } else {
      navigate(-2 as any);
    }
  };

  const backParam = back ? `&back=${encodeURIComponent(back)}` : '';
  const modeParam = mode === 'mnemonic' ? '&mode=mnemonic' : '';

  const words = mode === 'mnemonic' && key.length > 0 ? key.split(' ') : [];

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppToolBar
        back={`/wallet/backup_caution?id=${id}${backParam}${modeParam}`}
        title={mode === 'mnemonic' ? t('wallet.mnemonic_title') : t('common.backup')}
      />
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2, gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <span>{t('wallet.key_backup_title')}</span>
        </Box>

        <Typography align="center" sx={{ mt: 2, mx: 2 }}>{t('wallet.key_backup_message')}</Typography>

        {isExternal ? (
          <Typography align="center" sx={{ mt: 2, mx: 2 }}>{t('external.no_backup')}</Typography>
        ) : walletNotFound ? (
          <Typography align="center" sx={{ mt: 2, mx: 2, color: 'error.main' }}>{t('wallet.backup_wallet_not_found')}</Typography>
        ) : loadError ? (
          <Typography align="center" sx={{ mt: 2, mx: 2, color: 'error.main' }}>{t('wallet.backup_decrypt_failed')}</Typography>
        ) : mode === 'mnemonic' && !hasMnemonic ? (
          <Typography align="center" sx={{ mt: 2, mx: 2 }}>{t('wallet.mnemonic_unavailable')}</Typography>
        ) : mode === 'mnemonic' ? (
          <>
            <Typography align="center" sx={{ mt: 2, color: 'error.main' }}>{t('wallet.mnemonic_title')}</Typography>
            <Typography align="center" sx={{ mt: 1, mx: 2, color: 'text.secondary', fontSize: 13 }}>
              {(t('wallet.mnemonic_interop_notice', { returnObjects: true }) as string[]).map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </Typography>
            <Grid container spacing={0.5} sx={{ justifyContent: 'center', mt: 1, px: 2 }}>
              {words.map((word, index) => (
                <Grid key={index} size={4} sx={{ p: 0.5 }}>
                  <Card variant="outlined" sx={{ bgcolor: 'grey.100', p: 1, position: 'relative' }}>
                    <Typography component="span" sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary', fontSize: 12 }}>{index + 1}</Typography>
                    <Typography align="center" sx={{ fontSize: 'inherit' }}>{word}</Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : (
          <>
            <Typography align="center" sx={{ mt: 2, color: 'error.main' }}>{t('wallet.private_key_title')}</Typography>
            <Typography align="center" sx={{ mt: 2, mx: 2, wordBreak: 'break-all' }}>{key}</Typography>
          </>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pb: 4 }}>
        <Button
          variant="contained" color="primary" size="small"
          onClick={goBackSettings}
        >
          {t('common.done')}
        </Button>
      </Box>

      <PasswordDialog open={showPasswordDialog} mode="check" onClose={() => setShowPasswordDialog(false)} onPass={onPassed} />
    </Box>
  );
}
