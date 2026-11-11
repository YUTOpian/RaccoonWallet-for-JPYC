import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import TransactionHistory from '../../components/TransactionHistory';

// Full-screen host for the transaction history. The same list is shown inline on Home
// (取引履歴 panel).
export default function TransactionList() {
  const { t } = useTranslation();
  return (
    <Box>
      <AppToolBar back="/top?tab=home" title={t('transaction.list_title')} />
      <TransactionHistory />
    </Box>
  );
}
