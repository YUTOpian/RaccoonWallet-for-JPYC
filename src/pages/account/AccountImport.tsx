import { useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { MnemonicHelper } from '../../lib/mnemonic';
import { useAppStore } from '../../store/appStore';

const MNEMONIC_LENGTH = 12;

// リカバリーフレーズのインポート: ①リカバリーフレーズ入力 → ②パスワード設定 → 完了画面 → ホーム。
export default function AccountImport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backPathFromLesson = useAppStore((s) => s.backPathFromLesson);
  const [words, setWords] = useState<string[]>(Array(MNEMONIC_LENGTH).fill(''));
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'check' | 'register'>('register');
  const [errorMessage, setErrorMessage] = useState('');
  const wordRefs = useRef<(HTMLInputElement | null)[]>([]);

  const phrase = words.join(' ').trim();
  const isValidPhrase = MnemonicHelper.isValid(phrase);

  const distributeWords = (tokens: string[], startIndex: number) => {
    setWords((prev) => {
      const next = [...prev];
      tokens.forEach((word, i) => {
        if (startIndex + i < MNEMONIC_LENGTH) {
          next[startIndex + i] = word;
        }
      });
      return next;
    });
    wordRefs.current[Math.min(startIndex + tokens.length, MNEMONIC_LENGTH - 1)]?.focus();
  };

  const onWordChange = (index: number, value: string) => {
    if (/\s/.test(value)) {
      distributeWords(value.split(/\s+/).filter((w) => w.length > 0), index);
      return;
    }
    setWords((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const onWordKeyDown = (index: number, e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && index < MNEMONIC_LENGTH - 1) {
      e.preventDefault();
      wordRefs.current[index + 1]?.focus();
    } else if (e.key === 'Backspace' && words[index] === '' && index > 0) {
      e.preventDefault();
      wordRefs.current[index - 1]?.focus();
    }
  };

  const onWordPaste = (index: number, e: ClipboardEvent<HTMLDivElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (/\s/.test(pasted.trim())) {
      e.preventDefault();
      distributeWords(pasted.trim().split(/\s+/), index);
    }
  };

  const onClickedNext = async () => {
    setPasswordMode((await PinCodeHelper.hasSavedCode()) ? 'check' : 'register');
    setShowPasswordDialog(true);
  };

  const onPasswordReady = async (password: string) => {
    try {
      if (!MnemonicHelper.isValid(phrase)) {
        throw new Error('invalid mnemonic');
      }
      const account = MnemonicHelper.accountFromMnemonic(phrase, 0);
      const wallet = await WalletsHelper.createWithMnemonic(
        t('lesson.default_wallet_name'), account.address, account.publicKey, account.privateKey,
        MnemonicHelper.normalize(phrase), password,
      );
      wallet.derivationIndex = 0;
      await WalletsHelper.add(wallet);
      await WalletsHelper.setActive(wallet.id);
      navigate('/account/complete', { replace: true });
    } catch (e) {
      console.error('AccountImport: failed to import the account', e);
      setErrorMessage(t('wallet.invalid_key'));
      setShowPasswordDialog(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppToolBar back={backPathFromLesson || '/welcome'} title={t('lesson.level_login_title')} />
      <Box sx={{ px: 2, pt: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mx: 1 }}>
          {words.map((word, i) => {
            const invalid = !MnemonicHelper.isValidWord(word);
            return (
              <TextField
                key={i}
                inputRef={(el) => { wordRefs.current[i] = el; }}
                label={t('wallet.import_mnemonic_word_label', { index: i + 1 })}
                value={word}
                onChange={(e) => onWordChange(i, e.target.value)}
                onKeyDown={(e) => onWordKeyDown(i, e)}
                onPaste={(e) => onWordPaste(i, e)}
                size="small"
                error={invalid}
                sx={invalid ? { '& .MuiInputBase-input': { color: 'error.main' } } : undefined}
                slotProps={{ input: { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } }}
              />
            );
          })}
        </Box>

        {phrase.length > 0 && !isValidPhrase && (
          <Typography align="center" sx={{ color: 'error.main', fontSize: 12, mt: 1 }}>{t('wallet.invalid_key')}</Typography>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 3, pb: 4 }}>
          <Button variant="contained" color="primary" disabled={!isValidPhrase} onClick={onClickedNext}>
            {t('common.pin_settings')}
          </Button>
        </Box>
      </Box>

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
