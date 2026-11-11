import { useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import cautionIcon from '../../assets/icon_caution.png';

// アカウントの新規作成／リカバリーフレーズのインポート共通の最終画面。
// 「完了」の表示ではなく、利用上の注意事項を示し、同意チェックを入れた場合のみホームへ進める。
export default function AccountComplete() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const items = t('lesson.notice_items', { returnObjects: true }) as string[];

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppToolBar showBack={false} title={t('lesson.notice_title')} />
      <Box sx={{ px: 2, mt: 3, mx: 'auto', maxWidth: 560 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={cautionIcon} sx={{ width: 20, height: 20, flexShrink: 0 }} />
          <Typography align="center" sx={{ fontSize: 14 }}>{t('lesson.notice_lead')}</Typography>
        </Box>

        <Box
          component="ol"
          sx={{
            mt: 3, mb: 0, pl: 3, pr: 1, textAlign: 'left',
            '& li': { mb: 2, fontSize: 14, lineHeight: 1.7 },
          }}
        >
          {items.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
          <FormControlLabel
            control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 14 }}>{t('lesson.notice_agree')}</Typography>}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, pb: 4 }}>
          <Button
            variant="contained"
            color="primary"
            disabled={!agreed}
            onClick={() => navigate('/top?tab=home', { replace: true })}
          >
            {t('lesson.notice_start')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
