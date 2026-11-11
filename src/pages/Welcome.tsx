import { useState } from 'react';
import { Box, Button, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import logoPyoko from '../assets/logo_pyoko.png';
import ExternalWalletDialog from '../components/ExternalWalletDialog';
import { Environment } from '../lib/environment';
import { useAppStore } from '../store/appStore';
import type { AppLanguage } from '../store/appStore';

// アプリを一番最初に起動したとき、またはウォレットが1件も無いときに表示するウェルカム画面。
// ここでは「アカウントの新規作成」(/account/create)と「リカバリーフレーズのインポート」
// (/account/import)の2つを横並びで選ばせる（以前の GET STARTED → 選択画面は廃止）。
// ボタンの下には言語切替トグル（日本語／English）を設置。切替はSettingsTop.tsx
// と同じsetLanguage（i18n.changeLanguage + zustand永続化）を使うため、ここで選んだ言語は
// アプリ全体・以降の起動時にも引き継がれる。
export default function Welcome() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const [externalOpen, setExternalOpen] = useState(false);
  const setBackPathFromLesson = useAppStore((s) => s.setBackPathFromLesson);

  const onChangeLanguage = (_: React.MouseEvent<HTMLElement>, value: AppLanguage | null) => {
    if (value) setLanguage(value);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        width: '100%',
        bgcolor: 'primary.main',
        color: '#fff',
        textAlign: 'center',
        px: 4,
        overflow: 'hidden',
      }}
    >
      <Box
        component="img"
        src={logoPyoko}
        alt="Raccoon Wallet for JPYC"
        sx={{ width: 140, height: 140, mb: 4 }}
      />

      <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
        {t('wallet.welcome_title_1')}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.4, mb: 2 }}>
        {t('wallet.welcome_title_2')}
      </Typography>

      <Typography variant="body2" sx={{ opacity: 0.85, mb: 6 }}>
        {t('wallet.welcome_subtitle')}
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1.5, width: '100%', maxWidth: 360 }}>
        {[
          { label: t('wallet.welcome_create_account'), to: '/account/create' },
          { label: t('wallet.welcome_import_account'), to: '/account/import' },
        ].map((item) => (
          <Button
            key={item.to}
            variant="contained"
            onClick={() => { setBackPathFromLesson('/welcome'); navigate(item.to); }}
            sx={{
              flex: 1,
              py: 1.5,
              px: 1,
              bgcolor: '#fff',
              color: 'primary.main',
              fontWeight: 700,
              lineHeight: 1.3,
              '&:hover': { bgcolor: '#f0f0f0' },
            }}
          >
            {item.label}
          </Button>
        ))}
      </Box>

      {/* ブラウザ拡張で接続する機能なので、拡張が使えないスマホ・タブレットでは出さない。 */}
      {!Environment.isMobile() && (
        <Button
          variant="outlined"
          onClick={() => setExternalOpen(true)}
          sx={{
            width: '100%',
            maxWidth: 360,
            mt: 1.5,
            py: 1.25,
            color: '#fff',
            borderColor: 'rgba(255,255,255,0.7)',
            fontWeight: 700,
            '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
          }}
        >
          {t('wallet.welcome_external')}
        </Button>
      )}

      <ToggleButtonGroup
        value={language}
        exclusive
        onChange={onChangeLanguage}
        size="small"
        sx={{
          mt: 3,
          bgcolor: 'rgba(255,255,255,0.15)',
          borderRadius: 999,
          p: 0.5,
          '& .MuiToggleButton-root': {
            border: 'none',
            borderRadius: 999,
            px: 2.5,
            py: 0.5,
            color: '#fff',
            fontWeight: 700,
            textTransform: 'none',
            '&.Mui-selected': {
              bgcolor: '#fff',
              color: 'primary.main',
              '&:hover': { bgcolor: '#f0f0f0' },
            },
          },
        }}
      >
        <ToggleButton value="ja">{t('settings.language_name_ja')}</ToggleButton>
        <ToggleButton value="en">{t('settings.language_name_en')}</ToggleButton>
      </ToggleButtonGroup>
      {!Environment.isMobile() && <ExternalWalletDialog open={externalOpen} onClose={() => setExternalOpen(false)} />}
    </Box>
  );
}
