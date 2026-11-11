import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { Dialog, Box, IconButton, Typography, TextField, Button, InputAdornment } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useTranslation } from 'react-i18next';
import { PinCodeHelper, WalletsHelper } from '../lib/storage';
import { useBlockBackNavigation } from '../lib/useBlockBackNavigation';
import MessageDialog from './MessageDialog';

type PasswordMode = 'check' | 'register' | 'change';
type PasswordState = 'check' | 'registration';

interface PasswordDialogProps {
  open: boolean;
  mode?: PasswordMode;
  onClose: () => void;
  // 入力・検証済みのパスワード。ウォレットの秘密鍵の暗号化キーとしてそのまま使われる
  // （従来の PIN コードと同じ役割）。
  onPass: (password: string) => void;
  onCancel?: () => void;
}

// 新しく設定するパスワードの最低文字数。確認(check)時は検証しない - 以前の6桁PINを
// そのままパスワードとして使い続けている既存ユーザーも、これまで通りログインできるように。
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 64;
// 連続して間違えられる回数。超えたら前の画面に戻す（保存側の lockout とは別に UI 側でも）。
const MAX_ATTEMPTS = 3;

/**
 * アプリのパスワード入力ダイアログ（旧 PasswordDialog の6桁キーパッド方式を置き換え）。
 *
 * - mode="check": 設定済みパスワードの確認。
 * - mode="register": パスワードの新規設定（新規入力＋確認入力を1画面で行う）。
 * - mode="change": 設定済みパスワードを確認 → 新しいパスワードを設定（未設定なら新規設定のみ）。
 *
 * 保存形式・ウォレットの再暗号化など、PinCodeHelper /
 * WalletsHelper 側の仕組みは従来のまま。変わったのは入力UIだけ（数字キーパッド→
 * テキスト入力）なので、これまでの PIN で暗号化された既存ウォレットも、その PIN を
 * パスワードとして入力すればそのまま開ける。
 */
export default function PasswordDialog({ open, mode = 'check', onClose, onPass, onCancel }: PasswordDialogProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PasswordState>('check');
  const [input, setInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [showText, setShowText] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRegistrationInfo, setShowRegistrationInfo] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRetryError, setShowRetryError] = useState(false);
  const [checkErrorCount, setCheckErrorCount] = useState(0);
  const [showCheckFailedLimit, setShowCheckFailedLimit] = useState(false);
  // 保存側(PinCodeHelper)のロックアウトの残りミリ秒。0 ならロックされていない。
  const [lockoutRemainingMs, setLockoutRemainingMs] = useState(0);

  // ダイアログが開いている間はブラウザ/ハードウェアの戻る操作を無効化し、戻る操作で
  // パスワード入力を回避できないようにする。画面内の矢印(cancel)だけは使える。
  const { bypassNext } = useBlockBackNavigation(open);

  const initializeState = useCallback(async () => {
    if (mode === 'check') {
      setState('check');
    } else if (mode === 'register') {
      setState('registration');
    } else {
      setState((await PinCodeHelper.hasSavedCode()) ? 'check' : 'registration');
    }
    setOldPassword('');
    setInput('');
    setConfirmInput('');
    setFieldError('');
    setShowText(false);
    setBusy(false);
    setCheckErrorCount(0);
  }, [mode]);

  useEffect(() => {
    if (open) {
      setShowRegistrationInfo(mode === 'register');
      initializeState();
      PinCodeHelper.getLockoutRemainingMs().then(setLockoutRemainingMs);
    } else {
      setLockoutRemainingMs(0);
    }
  }, [open, mode, initializeState]);

  useEffect(() => {
    if (!open || lockoutRemainingMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setLockoutRemainingMs((prev) => Math.max(prev - 1000, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [open, lockoutRemainingMs > 0]);

  const closeView = async (finalPassword: string) => {
    onClose();
    onPass(finalPassword);
    await initializeState();
  };

  const cancel = async () => {
    setInput('');
    setConfirmInput('');
    // WalletDelete など、onCancel 自体が戻る遷移をする呼び出し元のために、一度だけ
    // 自前のブロッカーをすり抜けさせる。
    bypassNext();
    onClose();
    onCancel?.();
    await initializeState();
  };

  const onWrongPassword = () => {
    setInput('');
    const nextCount = checkErrorCount + 1;
    setCheckErrorCount(nextCount);
    if (nextCount >= MAX_ATTEMPTS) {
      setShowCheckFailedLimit(true);
    } else {
      setShowRetryError(true);
    }
  };

  // 設定済みパスワードの確認ステップ（mode=check、または mode=change の最初のステップ）。
  const submitCheck = async () => {
    const remaining = await PinCodeHelper.getLockoutRemainingMs();
    if (remaining > 0) {
      setInput('');
      setLockoutRemainingMs(remaining);
      return;
    }
    if (!(await PinCodeHelper.check(input))) {
      onWrongPassword();
      return;
    }
    if (mode === 'check') {
      await closeView(input);
    } else {
      // mode=change: 確認できたので、新しいパスワードの設定ステップへ。
      setOldPassword(input);
      setInput('');
      setConfirmInput('');
      setState('registration');
    }
  };

  // 新しいパスワードの設定ステップ（mode=register、または mode=change の2番目）。
  const submitRegistration = async () => {
    if (input.length < MIN_PASSWORD_LENGTH) {
      setFieldError(t('common.password_too_short', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (input !== confirmInput) {
      setFieldError(t('common.password_mismatch'));
      return;
    }
    setFieldError('');

    // encryptWallets は、アクティブなウォレットの秘密鍵が想定した旧パスワードで復号
    // できないと false を返す（例: 以前のセッション/ビルドで設定した値と食い違っている）。
    // その場合に保存済みパスワードだけ更新してしまうと、ウォレットが永久に復号できなく
    // なるので、戻り値を必ず確認する。
    const effectiveOld = mode === 'register'
      ? PinCodeHelper.defaultPin
      : ((await PinCodeHelper.hasSavedCode()) ? oldPassword : PinCodeHelper.defaultPin);
    if (await WalletsHelper.encryptWallets(effectiveOld, input)) {
      await PinCodeHelper.update(input);
      setShowSuccess(true);
    } else {
      await cancel();
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || lockoutRemainingMs > 0 || input.length === 0) {
      return;
    }
    setBusy(true);
    try {
      if (state === 'check') {
        await submitCheck();
      } else {
        await submitRegistration();
      }
    } finally {
      setBusy(false);
    }
  };

  const stateLabel = state === 'check' ? t('common.pin_label_check') : t('common.pin_label_new');
  const registering = state === 'registration';
  const locked = lockoutRemainingMs > 0;

  const visibilityToggle = (
    <InputAdornment position="end">
      <IconButton
        aria-label={showText ? t('common.password_hide') : t('common.password_show')}
        onClick={() => setShowText((prev) => !prev)}
        edge="end"
        sx={{ color: 'rgba(255,255,255,0.8)' }}
      >
        {showText ? <VisibilityOffIcon /> : <VisibilityIcon />}
      </IconButton>
    </InputAdornment>
  );

  // 紺背景の上に置くので、文字・枠線・ラベルを白系にそろえる。
  const fieldSx = {
    '& .MuiInputBase-root': { color: '#fff' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.6)' },
    '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#fff' },
    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#fff' },
    '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.8)' },
    '& .MuiInputLabel-root.Mui-focused': { color: '#fff' },
    '& .MuiFormHelperText-root': { color: '#fff' },
  };

  return (
    <Dialog fullScreen open={open} onClose={cancel}>
      <Box sx={{ bgcolor: 'primary.main', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 2 }}>
        <IconButton onClick={cancel} sx={{ alignSelf: 'flex-start', ml: 1 }}>
          <ArrowBackIcon sx={{ color: 'white' }} />
        </IconButton>
        <Typography sx={{ color: 'white', fontWeight: 'bold', fontSize: 'large', mt: 1, mb: 3 }}>{stateLabel}</Typography>

        <Box
          component="form"
          onSubmit={onSubmit}
          noValidate
          sx={{ width: '100%', maxWidth: 360, px: 3, display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            autoFocus
            fullWidth
            type={showText ? 'text' : 'password'}
            label={registering ? t('common.password_new_field') : t('common.password_field')}
            value={input}
            onChange={(e) => { setInput(e.target.value); setFieldError(''); }}
            disabled={locked || busy}
            autoComplete={registering ? 'new-password' : 'current-password'}
            helperText={registering ? t('common.password_hint', { min: MIN_PASSWORD_LENGTH }) : undefined}
            sx={fieldSx}
            slotProps={{
              htmlInput: { maxLength: MAX_PASSWORD_LENGTH, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false },
              input: { endAdornment: visibilityToggle },
            }}
          />

          {registering && (
            <TextField
              fullWidth
              type={showText ? 'text' : 'password'}
              label={t('common.password_confirm_field')}
              value={confirmInput}
              onChange={(e) => { setConfirmInput(e.target.value); setFieldError(''); }}
              disabled={busy}
              autoComplete="new-password"
              error={fieldError.length > 0}
              helperText={fieldError.length > 0 ? fieldError : undefined}
              sx={fieldSx}
              slotProps={{
                htmlInput: { maxLength: MAX_PASSWORD_LENGTH, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false },
              }}
            />
          )}

          <Button
            type="submit"
            variant="contained"
            disabled={locked || busy || input.length === 0 || (registering && confirmInput.length === 0)}
            sx={{
              mt: 1, py: 1.25, fontWeight: 'bold', bgcolor: '#fff', color: 'primary.main',
              '&:hover': { bgcolor: '#f0f0f0' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.35)', color: 'rgba(255,255,255,0.7)' },
            }}
          >
            OK
          </Button>
        </Box>

        {locked && (
          <Typography sx={{ color: 'white', mt: 2, opacity: 0.85, textAlign: 'center', px: 3 }}>
            {(t('common.pin_locked', { returnObjects: true, seconds: Math.ceil(lockoutRemainingMs / 1000) }) as string[]).join(' ')}
          </Typography>
        )}
      </Box>

      <MessageDialog
        open={showRegistrationInfo}
        title={t('common.pin_settings')}
        texts={t('common.pin_registration_message', { returnObjects: true }) as string[]}
        onClose={() => setShowRegistrationInfo(false)}
      />
      <MessageDialog
        open={showSuccess}
        title={t('common.success')}
        texts={t('common.pin_registration_complete', { returnObjects: true }) as string[]}
        onClose={() => { setShowSuccess(false); closeView(input); }}
      />
      <MessageDialog
        open={showRetryError}
        title={t('common.error')}
        texts={t('common.pin_retry', { returnObjects: true }) as string[]}
        onClose={() => setShowRetryError(false)}
        variant="error"
      />
      {/* MAX_ATTEMPTS 回連続で間違えた - 前の画面に戻る（矢印で戻るのと同じ）。 */}
      <MessageDialog
        open={showCheckFailedLimit}
        title={t('common.error')}
        texts={t('common.pin_check_failed_limit', { returnObjects: true }) as string[]}
        onClose={() => { setShowCheckFailedLimit(false); cancel(); }}
        variant="error"
      />
    </Dialog>
  );
}
