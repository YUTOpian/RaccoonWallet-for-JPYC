import { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ErrorSnackbar from './ErrorSnackbar';
import { Wallet, WalletsHelper } from '../lib/storage';
import { connectExternalWallet, isExternalWalletError } from '../lib/externalWallet';
import type { ExternalWalletKind } from '../lib/externalWallet';

// MetaMask / Bitget Wallet(ブラウザ拡張)で接続してログインするポップアップ。秘密鍵も
// パスワードもこのアプリには保存せず、アドレスだけを「外部ウォレット」として登録して
// 完了画面へ進む。
export default function ExternalWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState<ExternalWalletKind | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const onConnect = async (kind: ExternalWalletKind) => {
    setConnecting(kind);
    try {
      const address = await connectExternalWallet(kind);
      const existing = (await WalletsHelper.gets()).find(
        (w) => w.externalProvider === kind && w.address.toLowerCase() === address.toLowerCase(),
      );
      if (existing) {
        await WalletsHelper.setActive(existing.id);
      } else {
        const wallet = Wallet.createExternal(t(`external.default_name_${kind}`), address, kind);
        await WalletsHelper.add(wallet);
        await WalletsHelper.setActive(wallet.id);
      }
      navigate('/account/complete', { replace: true });
    } catch (e) {
      console.error('ExternalWalletDialog: failed to connect the external wallet', e);
      setErrorMessage(t(`external.error_${isExternalWalletError(e) ? e.code : 'unknown'}`));
    } finally {
      setConnecting(null);
    }
  };

  const items: { kind: ExternalWalletKind; label: string }[] = [
    { kind: 'metamask', label: t('external.metamask') },
    { kind: 'bitget', label: t('external.bitget') },
  ];

  return (
    <>
      <Dialog open={open} onClose={connecting ? undefined : onClose} fullWidth maxWidth="xs">
        <DialogTitle sx={{ textAlign: 'center', fontWeight: 700 }}>{t('external.title')}</DialogTitle>
        <DialogContent>
          <Typography align="center" sx={{ fontSize: 14, lineHeight: 1.7 }}>{t('external.lead')}</Typography>
          <Typography align="center" sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>{t('external.browser_only')}</Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 3 }}>
            {items.map((item) => (
              <Button
                key={item.kind}
                variant="contained"
                color="primary"
                disabled={connecting !== null}
                onClick={() => onConnect(item.kind)}
                sx={{ py: 1.25, fontWeight: 700, textTransform: 'none' }}
              >
                {connecting === item.kind ? <CircularProgress size={22} color="inherit" /> : item.label}
              </Button>
            ))}
            <Button disabled={connecting !== null} onClick={onClose} sx={{ textTransform: 'none' }}>
              {t('common.cancel')}
            </Button>
          </Box>
          {connecting !== null && (
            <Typography align="center" sx={{ mt: 2, fontSize: 13, color: 'text.secondary' }}>{t('external.connecting')}</Typography>
          )}
        </DialogContent>
      </Dialog>
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </>
  );
}
