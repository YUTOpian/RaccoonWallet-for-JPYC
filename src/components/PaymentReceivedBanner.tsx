import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useTranslation } from 'react-i18next';

// 受け取り(QRレジ・QR Lab・売り物リスト)が完了した時の、大きな緑のチェック表示。
// お店の人が遠くからでも「入金された」と分かるように、アイコンと見出しを大きく出す。
export default function PaymentReceivedBanner() {
  const { t } = useTranslation();
  return (
    <Box role="status" aria-live="polite" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
      <CheckCircleIcon sx={{ fontSize: 96, color: 'success.main' }} />
      <Typography sx={{ mt: 0.5, fontSize: '1.6rem', fontWeight: 700, color: 'success.main' }}>
        {t('qrlab.payment_complete_title')}
      </Typography>
    </Box>
  );
}
