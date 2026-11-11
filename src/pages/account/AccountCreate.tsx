import { useState } from 'react';
import { Box, Button, Card, Checkbox, FormControlLabel, Grid, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { MnemonicHelper } from '../../lib/mnemonic';
import { useAppStore } from '../../store/appStore';
import cautionIcon from '../../assets/icon_caution.png';

// アカウントの新規作成: ①リカバリーフレーズの表示 → ②パスワード設定 → 完了画面 → ホーム。
// 生成したフレーズ・秘密鍵はパスワードが決まるまでこの画面のメモリ上にしか持たず、
// パスワード設定が済んだ時点で、そのパスワードで暗号化して初めて保存する（固定の仮
// パスワードで先に保存することはしない）。リロードすると新しいフレーズが作り直される。
export default function AccountCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backPathFromLesson = useAppStore((s) => s.backPathFromLesson);
  const [generated] = useState(() => MnemonicHelper.createNew());
  const [confirmed, setConfirmed] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'check' | 'register'>('register');
  const [errorMessage, setErrorMessage] = useState('');

  const words = generated.phrase.split(' ');

  const onClickedNext = async () => {
    // すでにパスワードが設定済みなら確認(check)、まだなら新規設定(register)。
    setPasswordMode((await PinCodeHelper.hasSavedCode()) ? 'check' : 'register');
    setShowPasswordDialog(true);
  };

  const onPasswordReady = async (password: string) => {
    try {
      const { phrase, account } = generated;
      const wallet = await WalletsHelper.createWithMnemonic(
        t('lesson.default_wallet_name'), account.address, account.publicKey, account.privateKey, phrase, password,
      );
      wallet.derivationIndex = 0;
      await WalletsHelper.add(wallet);
      await WalletsHelper.setActive(wallet.id);
      navigate('/account/complete', { replace: true });
    } catch (e) {
      console.error('AccountCreate: failed to create the account', e);
      setErrorMessage(t('wallet.creation_failed'));
      setShowPasswordDialog(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppToolBar back={backPathFromLesson || '/welcome'} title={t('lesson.level_beginner_title')} />
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2, gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 16, height: 16 }} />
          <span>{t('wallet.mnemonic_caution_title')}</span>
        </Box>
        <Typography align="center" sx={{ mt: 2, mx: 2 }}>{t('wallet.mnemonic_caution_message')}</Typography>
        <Typography align="center" sx={{ mt: 2, mx: 2, color: 'text.secondary', fontSize: 13 }}>
          {(t('wallet.mnemonic_interop_notice', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>

        <Grid container spacing={0.5} sx={{ justifyContent: 'center', mt: 3, px: 2 }}>
          {words.map((word, index) => (
            <Grid key={index} size={4} sx={{ p: 0.5 }}>
              <Card variant="outlined" sx={{ bgcolor: 'grey.100', p: 1, position: 'relative' }}>
                <Typography component="span" sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary', fontSize: 12 }}>{index + 1}</Typography>
                <Typography align="center" sx={{ fontSize: 'inherit' }}>{word}</Typography>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <FormControlLabel
            control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />}
            label={t('wallet.mnemonic_confirm_checkbox')}
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pb: 4 }}>
        <Button variant="contained" color="primary" disabled={!confirmed} onClick={onClickedNext}>
          {t('common.pin_settings')}
        </Button>
      </Box>

      {/* 成功時は onPasswordReady が画面遷移するまでダイアログで覆っておく（onClose は no-op）。
          閉じるのは明示的なキャンセルだけ。 */}
      <PasswordDialog
        open={showPasswordDialog}
        mode={passwordMode}
        onClose={() => {}}
        onCancel={() => setShowPasswordDialog(false)}
        onPass={onPasswordReady}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
