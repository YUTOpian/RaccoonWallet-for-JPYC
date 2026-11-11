import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import SendForm from '../../components/SendForm';

// Full-screen host for the send form. Home の「送る」パネルは JPYC 専用(SendForm jpycOnly)。JPYC 以外のトークンは
// トークン画面からこの汎用フォームを開いて送る。QRスキャン/アドレス帳からの入口もここ。
// トークン画面から開いたとき(?from=token)は、チェーンとトークンが決まっているので固定表示にする。
export default function SendAmount() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const fromToken = searchParams.get('from') === 'token';
  return (
    <Box sx={{ height: '100%' }}>
      <AppToolBar back="/balance" title={t('home.send')} />
      <SendForm backPath={fromToken ? '/send/amount?from=token' : '/send/amount'} lockAsset={fromToken} />
    </Box>
  );
}
